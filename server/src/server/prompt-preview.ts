/**
 * Prompt preview: rebuilds the EXACT system+user prompt pair a stage would
 * send right now (visibility filtering, context trimming, template overrides)
 * WITHOUT calling any AI provider. A divergence between preview and reality
 * is a bug — this module reuses the engine's real assembly code paths.
 */

import type { AppSettings, Campaign, MemoryEntry, Npc, Turn } from '../shared/types.js';
import type { StorageHub } from '../storage/hub.js';
import { getterFromOverrides } from '../engine/prompt-templates.js';
import { buildTensionHistory } from '../engine/orchestrator.js';
import { filterVisibleTurns, assemble, formatPrompt } from '../engine/visibility.js';
import { trimToFit } from '../engine/trimmer.js';
import { retrieve as retrieveMemories } from '../engine/memory-retriever.js';
import * as RouterStage from '../engine/stages/router.js';
import * as PlotStage from '../engine/stages/plot.js';
import * as AgencyStage from '../engine/stages/agency.js';
import * as MemoryExtractionStage from '../engine/stages/memory-extraction.js';
import * as TrackerUpdateStage from '../engine/stages/tracker-update.js';
import { resolveSystemPrompt as resolveSceneSystemPrompt } from '../engine/stages/scene.js';
import {
  buildTitleUserPrompt,
  resolveTitleSystemPrompt,
  MAX_TITLE_CHARS,
} from './title-service.js';
import { planUserPrompt, resolvePlanSystemPrompt } from '../routes/plan.js';
import {
  buildOpeningValues,
  resolveOpeningSystemPrompt,
} from '../routes/opening.js';

export interface PreviewMeta {
  turnsIncluded: number;
  turnsDropped: number;
  presentNpcs: string[];
}

export interface StagePreview {
  stage: string;
  system: string;
  user: string;
  meta: PreviewMeta;
}

/** Shown in the user prompt where the live beat synopsis would appear. */
const SYNOPSIS_PLACEHOLDER = '(plot synopsis will appear here)';
/** Shown where the live narration would feed memory extraction. */
const SCENE_OUTPUT_PLACEHOLDER = '(scene prose will appear here)';

export const SAMPLE_PLAYER_INPUT = 'I search the room for clues.';

interface PreviewInput {
  hub: StorageHub;
  settings: AppSettings;
  campaignId: string;
  stage: string;
  playerInput?: string | null;
  npcId?: string | null;
}

/**
 * Build the preview pair for one stage. Returns 'campaign_not_found' when the
 * campaign does not exist; callers translate that into their own 404 shape.
 */
export async function buildStagePreview(
  input: PreviewInput,
): Promise<StagePreview | null | 'campaign_not_found'> {
  const campaign = await input.hub.campaigns.get(input.campaignId);
  if (!campaign) return 'campaign_not_found';

  const overrides = await input.hub.prompts.load();
  const getTemplate = getterFromOverrides(overrides);
  const playerInput =
    typeof input.playerInput === 'string' && input.playerInput.trim().length > 0
      ? input.playerInput.trim()
      : SAMPLE_PLAYER_INPUT;

  // Shared scene-state facts (same sources as executeTurn).
  const turns = await input.hub.turns.list(input.campaignId);
  let memories: MemoryEntry[];
  try {
    memories = await input.hub.memories.list(input.campaignId);
  } catch {
    memories = [];
  }
  const presentIds = campaign.sceneState.presentNpcIds;
  const presentNpcs: Npc[] = [];
  for (const id of presentIds) {
    const npc = await input.hub.npcs.get(input.campaignId, id);
    if (npc) presentNpcs.push(npc);
  }

  // Visibility filtering + context-window trimming, exactly like step 6 of
  // executeTurn (chars/4 ≈ tokens, 80% of window minus write budget).
  const visibleTurns = filterVisibleTurns(turns, presentIds);
  const budgetTokens = Math.trunc(
    (input.settings.contextWindowTokens - input.settings.writeMaxTokens) * 0.8,
  );
  const trimmedTurns = trimToFit(visibleTurns, budgetTokens);
  const meta: PreviewMeta = {
    turnsIncluded: trimmedTurns.length,
    turnsDropped: turns.length - trimmedTurns.length,
    presentNpcs: presentNpcs.map((npc) => npc.name),
  };

  switch (input.stage) {
    case 'router':
      return {
        stage: 'router',
        system: RouterStage.resolveSystemPrompt(getTemplate, playerInput, campaign.sceneState),
        user: RouterStage.buildUserPrompt(playerInput, campaign.sceneState),
        meta,
      };

    case 'plot': {
      const recentSummary = buildRecentSummary(turns);
      const sessionPlan =
        campaign.sessionPlan.trim().length > 0 ? campaign.sessionPlan : '(no session plan yet)';
      // Same source as executeTurn: latest variants of the stored turns.
      const tensionHistory = buildTensionHistory(turns);
      return {
        stage: 'plot',
        system: PlotStage.resolveSystemPrompt(getTemplate, sessionPlan, recentSummary, tensionHistory),
        user: PlotStage.buildUserPayload(
          playerInput,
          [],
          retrieveMemories(playerInput, memories),
          tensionHistory,
        ),
        meta,
      };
    }

    case 'agency': {
      const npc = await pickAgencyNpc(input.hub, input.campaignId, campaign, input.npcId ?? null);
      if (!npc) return null;
      const witnessed = witnessedTurnsFor(npc.id, turns);
      const witnessedContext =
        witnessed.length > 0 ? formatWitnessed(witnessed) : 'Nothing yet.';
      return {
        stage: 'agency',
        system: AgencyStage.resolveSystemPrompt(getTemplate, npc, witnessedContext),
        user: AgencyStage.buildUserPrompt(npc, witnessedContext),
        meta,
      };
    }

    case 'scene': {
      const sceneRetrieval = retrieveMemories(`${playerInput} ${SYNOPSIS_PLACEHOLDER}`, memories);
      const context = assemble({
        synopsis: SYNOPSIS_PLACEHOLDER,
        // The live beat's tension is not known at preview time.
        tension: null,
        location: campaign.sceneState.location,
        mechanicResults: [],
        presentNpcIds: presentIds,
        presentNpcs,
        allTurns: trimmedTurns,
        retrievedMemories: sceneRetrieval,
        playerInput,
      });
      return {
        stage: 'scene',
        system: resolveSceneSystemPrompt(getTemplate, context),
        user: formatPrompt(context),
        meta,
      };
    }

    case 'memory-extraction':
      return {
        stage: 'memory-extraction',
        system: MemoryExtractionStage.resolveSystemPrompt(getTemplate, {
          playerInput,
          synopsis: SYNOPSIS_PLACEHOLDER,
          sceneOutput: SCENE_OUTPUT_PLACEHOLDER,
        }),
        user: MemoryExtractionStage.buildUserPrompt(
          playerInput,
          SYNOPSIS_PLACEHOLDER,
          SCENE_OUTPUT_PLACEHOLDER,
        ),
        meta,
      };

    case 'tracker-update': {
      const language = input.settings.language?.trim() || 'English';
      const trackerValues = {
        previous: campaign.trackerState ?? null,
        synopsis: SYNOPSIS_PLACEHOLDER,
        sceneOutput: SCENE_OUTPUT_PLACEHOLDER,
        location: campaign.sceneState.location,
        presentNpcs: presentNpcs.map((npc) => ({
          id: npc.id,
          name: npc.name,
          description: npc.description,
        })),
        playerPersona: campaign.playerPersona.trim().length > 0
          ? campaign.playerPersona
          : '(unspecified)',
        language,
      };
      return {
        stage: 'tracker-update',
        system: TrackerUpdateStage.resolveSystemPrompt(getTemplate, trackerValues),
        user: TrackerUpdateStage.buildUserPrompt(trackerValues),
        meta,
      };
    }

    case 'session-plan': {
      const values = {
        title: campaign.title.trim().length > 0 ? campaign.title.trim() : 'Untitled',
        premise:
          campaign.premise.trim().length > 0 ? campaign.premise.trim() : '(no premise given)',
        playerPersona:
          campaign.playerPersona.trim().length > 0
            ? campaign.playerPersona.trim()
            : '(unspecified)',
      };
      return {
        stage: 'session-plan',
        system: resolvePlanSystemPrompt(getTemplate, values),
        user: planUserPrompt(values),
        meta,
      };
    }

    case 'title': {
      const language = input.settings.language?.trim() || 'English';
      return {
        stage: 'title',
        system: resolveTitleSystemPrompt(getTemplate, language),
        user: buildTitleUserPrompt({
          language,
          playerInput: playerInput.slice(0, 600),
          synopsis: SYNOPSIS_PLACEHOLDER.slice(0, 600),
        }),
        meta: {
          ...meta,
          presentNpcs: [...meta.presentNpcs, `max ${MAX_TITLE_CHARS} chars`],
        },
      };
    }

    case 'opening': {
      const values = await buildOpeningValues(input.hub, input.settings, campaign);
      return {
        stage: 'opening',
        system: resolveOpeningSystemPrompt(getTemplate, values),
        user: 'Write the opening scene now.',
        meta,
      };
    }

    default:
      return null;
  }
}

async function pickAgencyNpc(
  hub: StorageHub,
  campaignId: string,
  campaign: Campaign,
  npcId: string | null,
): Promise<Npc | null> {
  if (npcId !== null && npcId.length > 0) {
    return hub.npcs.get(campaignId, npcId);
  }
  for (const id of campaign.sceneState.presentNpcIds) {
    const npc = await hub.npcs.get(campaignId, id);
    if (npc) return npc;
  }
  const roster = await hub.npcs.list(campaignId);
  return roster[0] ?? null;
}

function witnessedTurnsFor(npcId: string, allTurns: Turn[]): Turn[] {
  return allTurns.filter((turn) => {
    const variant = turn.variants[turn.variants.length - 1];
    return variant !== undefined && variant.presentNpcIds.includes(npcId);
  });
}

/** Mirrors AgencyStage.buildWitnessedContext's shape for the preview panel. */
function formatWitnessed(witnessed: Turn[]): string {
  return witnessed
    .map((turn) => {
      const variant = turn.variants[turn.variants.length - 1];
      const synopsis = variant ? variant.synopsis : '';
      return synopsis.length > 0
        ? `**Player:** ${turn.playerInput}\n${synopsis}`
        : `**Player:** ${turn.playerInput}`;
    })
    .join('\n\n');
}

/** Mirrors orchestrator.buildRecentSummary (kept local to avoid cycles). */
function buildRecentSummary(allTurns: Turn[], limit: number = 6): string {
  if (allTurns.length === 0) return '';
  return allTurns
    .slice(-limit)
    .map((turn) => {
      const variant = turn.variants[turn.variants.length - 1];
      const synopsis = variant ? variant.synopsis : '';
      return `- ${turn.playerInput} -> ${synopsis}`;
    })
    .join('\n');
}
