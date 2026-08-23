/**
 * Orchestrates the full turn execution pipeline.
 *
 * Ported from engine/PipelineOrchestrator.kt. The Android storage classes are
 * replaced by an injected `OrchestratorStores` interface so this module stays
 * pure/injectable — the file-backed implementation arrives in phase 2.
 *
 * Resilience contract: no stage failure crashes the turn. Every structured
 * stage has fallback handling; the scene stage failing yields an interrupted
 * variant rather than an exception.
 */

import type {
  Campaign,
  MechanicResult,
  MemoryEntry,
  Npc,
  SceneState,
  Turn,
  TurnVariant,
  TrackerState,
} from '../shared/types.js';
import type { AiCaller } from './ai-caller.js';
import type { PromptTemplateGetter } from './prompt-templates.js';
import * as DeckMechanics from './deck.js';
import { filterVisibleTurns, assemble, formatPrompt, type SceneContext } from './visibility.js';
import { trimToFit } from './trimmer.js';
import { retrieve as retrieveMemories } from './memory-retriever.js';
import * as RouterStage from './stages/router.js';
import * as PlotStage from './stages/plot.js';
import * as AgencyStage from './stages/agency.js';
import { execute as executeScene } from './stages/scene.js';
import * as MemoryExtractionStage from './stages/memory-extraction.js';
import * as TrackerUpdateStage from './stages/tracker-update.js';

/** Storage surface the orchestrator needs; phase 2 provides the file-backed impl. */
export interface OrchestratorStores {
  loadCampaign(campaignId: string): Promise<Campaign | null>;
  saveCampaign(campaign: Campaign): Promise<void>;
  listTurnIndices(campaignId: string): Promise<number[]>;
  loadTurn(campaignId: string, index: number): Promise<Turn | null>;
  saveTurn(campaignId: string, turn: Turn): Promise<void>;
  appendVariant(campaignId: string, index: number, variant: TurnVariant): Promise<void>;
  loadNpc(campaignId: string, npcId: string): Promise<Npc | null>;
  listNpcs(campaignId: string): Promise<Npc[]>;
  saveNpc(campaignId: string, npc: Npc): Promise<void>;
  loadMemories(campaignId: string): Promise<MemoryEntry[]>;
  appendMemory(campaignId: string, entry: MemoryEntry): Promise<void>;
}

export interface ExecuteTurnInput {
  campaignId: string;
  playerInput: string;
  /**
   * Null = new turn appended after the highest existing index. Non-null =
   * regenerate/append: a new variant on that turn. targetTurnIndex semantics
   * match PipelineOrchestrator.kt exactly.
   */
  targetTurnIndex?: number;
  /** Live progress hook: receives every stageEvents line plus transient boundaries. */
  onPipelineEvent?: ((line: string) => void) | null;
  /** Live tap for scene-stage reasoning deltas. */
  onReasoningChunk?: ((chunk: string) => void) | null;
  /** Called with each streamed prose chunk. */
  onChunk?: ((chunk: string) => void) | null;
}

export interface OrchestratorOptions {
  aiCaller: AiCaller;
  stores: OrchestratorStores;
  random?: DeckMechanics.RandomSource;
  contextWindowTokens?: number;
  writeMaxTokens?: number;
  makeId?: () => string;
  /** Story language for reader-facing stages; defaults to 'English'. */
  language?: string;
  /** Constructor-level progress hook; per-call override supported. */
  onPipelineEvent?: ((line: string) => void) | null;
  /**
   * Prompt template overrides by stage key; null/absent = shipped defaults.
   * Typically a snapshot getter built from PromptTemplateStorage.load().
   */
  getTemplates?: PromptTemplateGetter | null;
}

export class PipelineOrchestrator {
  private readonly stores: OrchestratorStores;

  constructor(private readonly options: OrchestratorOptions) {
    this.stores = options.stores;
  }

  /** Stage-key -> template override snapshot; never null as a function. */
  private get templateGetter(): PromptTemplateGetter {
    return this.options.getTemplates ?? (() => null);
  }

  async executeTurn(input: ExecuteTurnInput): Promise<TurnVariant> {
    const {
      campaignId,
      playerInput,
      targetTurnIndex = null,
      onChunk = null,
      onReasoningChunk = null,
    } = input;
    let { onPipelineEvent } = input;
    if (onPipelineEvent === undefined) onPipelineEvent = this.options.onPipelineEvent ?? null;

    // Per-call override of the constructor-level progress hook.
    const progressHook: ((line: string) => void) | null = onPipelineEvent ?? null;

    const campaign = await this.stores.loadCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    // Terse one-line transparency log, stored on the saved variant so the
    // stage-details sheet can explain fallbacks instead of staying silent.
    const stageEvents: string[] = [];
    const emitProgress = (line: string): void => {
      progressHook?.(line);
    };
    const recordEvent = (line: string): void => {
      stageEvents.push(line);
      emitProgress(line);
    };

    const existingIndices = await this.stores.listTurnIndices(campaignId);
    const maxExisting = existingIndices.length > 0 ? Math.max(...existingIndices) : -1;
    const turnIndex = targetTurnIndex ?? maxExisting + 1;
    const allTurns: Turn[] = [];
    for (const index of existingIndices.filter((i) => i < turnIndex)) {
      const turn = await this.stores.loadTurn(campaignId, index);
      if (turn) allTurns.push(turn);
    }

    // ---- 1. Retrieve memories -------------------------------------------
    let allMemories: MemoryEntry[];
    try {
      allMemories = await this.stores.loadMemories(campaignId);
    } catch {
      allMemories = [];
    }
    const preRetrieval = retrieveMemories(playerInput, allMemories);

    // ---- 2. Router ------------------------------------------------------
    emitProgress('router: deciding checks…');
    let routerDecision: Awaited<ReturnType<typeof RouterStage.execute>> | null = null;
    try {
      routerDecision = await RouterStage.execute(
        this.options.aiCaller,
        playerInput,
        campaign.sceneState,
        this.templateGetter,
      );
    } catch (t) {
      recordEvent(`router: fallback used (${errorMessage(t)})`);
    }
    if (routerDecision !== null) emitProgress('router: done');

    // ---- 3. Mechanics (pure code, cannot fail on the model) -------------
    const random = this.options.random ?? DeckMechanics.defaultRandom;
    const mechanicResults: MechanicResult[] =
      routerDecision?.needs_check === true
        ? routerDecision.checks.map((check) => DeckMechanics.executeCheck(check, random))
        : [];

    // ---- 4. Plot --------------------------------------------------------
    const recentSummary = buildRecentSummary(allTurns);
    emitProgress('plot: generating turn plan…');
    let plotOutput: Awaited<ReturnType<typeof PlotStage.execute>>;
    try {
      plotOutput = await PlotStage.execute(this.options.aiCaller, {
        sessionPlan: campaign.sessionPlan,
        recentSummary,
        playerInput,
        routerDecision,
        mechanicResults,
        retrievedMemories: preRetrieval,
        getTemplate: this.templateGetter,
      });
    } catch (t) {
      recordEvent(`plot: fallback used (${errorMessage(t)})`);
      plotOutput = {
        synopsis: PlotStage.FALLBACK_SYNOPSIS,
        present_npcs: campaign.sceneState.presentNpcIds,
        scene_change: false,
        location: null,
        tracker_updates: [],
      };
    }

    // The stage falls back internally on parse failure (per pipeline.md);
    // detect that via the documented sentinel synopsis so it is visible too.
    if (
      plotOutput.synopsis === PlotStage.FALLBACK_SYNOPSIS &&
      !stageEvents.some((event) => event.startsWith('plot:'))
    ) {
      recordEvent('plot: fallback used (json parse failed)');
    }
    if (!stageEvents.some((event) => event.startsWith('plot:'))) emitProgress('plot: done');

    // present_npcs is authoritative for the new scene, but the model writes
    // free text (usually names, not ids) — resolve mentions to real ids
    // before trusting them. Empty (or fully unresolvable) keeps the campaign
    // scene state rather than emptying the scene.
    const presentNpcIds = await resolvePlotPresence(
      plotOutput.present_npcs,
      campaign.sceneState.presentNpcIds,
      (npcId) => this.stores.loadNpc(campaignId, npcId),
      () => this.stores.listNpcs(campaignId),
      recordEvent,
    );

    // ---- 5. Agency (optional) -------------------------------------------
    const agencyShouldRun =
      routerDecision?.run_agency_update === true ||
      plotOutput.scene_change ||
      plotOutput.tracker_updates.length > 0;

    if (agencyShouldRun) {
      recordEvent(`agency: run for ${presentNpcIds.length} npc(s)`);
      for (const npcId of presentNpcIds) {
        try {
          const npc = await this.stores.loadNpc(campaignId, npcId);
          if (!npc) continue;
          const witnessed = witnessedTurnsFor(npcId, allTurns);
          const updated = await AgencyStage.updateNpcAgency(
            this.options.aiCaller,
            npc,
            witnessed,
            this.templateGetter,
          );
          await this.stores.saveNpc(campaignId, { ...npc, agency: updated });
        } catch (t) {
          recordEvent(`agency: update failed for ${npcId} (${errorMessage(t)})`);
        }
      }
      emitProgress('agency: done');
    }

    // ---- 6. Visibility-filtered assembly --------------------------------
    const presentNpcs: Npc[] = [];
    for (const npcId of presentNpcIds) {
      const npc = await this.stores.loadNpc(campaignId, npcId);
      if (npc) presentNpcs.push(npc);
    }
    const sceneRetrieval = retrieveMemories(`${playerInput} ${plotOutput.synopsis}`, allMemories);

    // Context-window enforcement: trim the visibility-filtered history so the
    // estimated payload fits the configured window, dropping oldest turns
    // first. chars/4 ≈ tokens; 80% of (window - write budget).
    const writeMaxTokens = this.options.writeMaxTokens ?? 8192;
    const contextWindowTokens = this.options.contextWindowTokens ?? 32768;
    const visibleTurns = filterVisibleTurns(allTurns, presentNpcIds);
    const historyBudgetTokens = Math.trunc((contextWindowTokens - writeMaxTokens) * 0.8);
    const trimmedTurns = trimToFit(visibleTurns, historyBudgetTokens);
    if (trimmedTurns.length < visibleTurns.length) {
      recordEvent(
        `context: history trimmed to last ${trimmedTurns.length} turns ` +
          `(budget ${historyBudgetTokens} tokens)`,
      );
    }

    const context: SceneContext = assemble({
      synopsis: plotOutput.synopsis,
      mechanicResults,
      presentNpcIds,
      presentNpcs,
      allTurns: trimmedTurns,
      retrievedMemories: sceneRetrieval,
      playerInput,
    });

    // ---- 7. Scene (streaming) -------------------------------------------
    const proseParts: string[] = [];
    const reasoningParts: string[] = [];
    let interrupted = false;
    emitProgress('scene: streaming…');
    try {
      const stream = executeScene(
        this.options.aiCaller,
        context,
        undefined,
        {
          onReasoningChunk: (delta) => {
            reasoningParts.push(delta);
            onReasoningChunk?.(delta);
          },
        },
        this.templateGetter,
      );
      for await (const chunk of stream) {
        proseParts.push(chunk);
        onChunk?.(chunk);
      }
    } catch (t) {
      interrupted = true;
      recordEvent(`scene: interrupted (${errorMessage(t)})`);
    }
    let prose = proseParts.join('');
    if (prose.trim().length === 0 && !interrupted) {
      interrupted = true;
      recordEvent('scene: interrupted (empty output)');
    }

    const sceneOutput = prose;

    // ---- 8. Memory extraction -------------------------------------------
    emitProgress('memory: extracting…');
    let memoryFailed = false;
    let extracted: MemoryEntry[];
    try {
      extracted = await MemoryExtractionStage.execute(this.options.aiCaller, {
        playerInput,
        synopsis: plotOutput.synopsis,
        sceneOutput,
        turnIndex,
        getTemplate: this.templateGetter,
      });
    } catch (t) {
      recordEvent(`memory: extraction failed (${errorMessage(t)})`);
      memoryFailed = true;
      extracted = [];
    }

    for (const entry of extracted) {
      try {
        await this.stores.appendMemory(campaignId, entry);
      } catch (t) {
        recordEvent(`memory: append failed (${errorMessage(t)})`);
      }
    }
    if (!memoryFailed) emitProgress('memory: done');

    // ---- 9. Tracker updates + scene state -------------------------------
    for (const update of plotOutput.tracker_updates) {
      try {
        const target = await resolveTrackerTarget(
          (npcId) => this.stores.loadNpc(campaignId, npcId),
          update.npc,
          presentNpcs,
        );
        if (!target) {
          recordEvent(`tracker: update skipped, unknown npc ${update.npc}`);
          continue;
        }
        const npc = target.npc;
        const current = npc.trackers[update.key] ?? 0;
        const merged = { ...npc.trackers };
        merged[update.key] = current + update.delta;
        await this.stores.saveNpc(campaignId, { ...npc, trackers: merged });
        const sign = update.delta >= 0 ? '+' : '';
        const label =
          target.how === 'name' ? `${npc.name} (resolved by name)` : npc.id;
        recordEvent(`tracker: ${update.key} ${sign}${update.delta} applied to ${label}`);
      } catch (t) {
        recordEvent(`tracker: update failed for ${update.npc} (${errorMessage(t)})`);
      }
    }

    const newSceneState: SceneState = {
      location:
        plotOutput.location !== null && plotOutput.location.trim().length > 0
          ? plotOutput.location
          : campaign.sceneState.location,
      presentNpcIds,
    };

    // ---- 9b. Narrative status board (campaign.trackerState) ---------------
    // Full-state replace via the THINK model; failure keeps the previous
    // board so the inspector never shows a broken state.
    emitProgress('tracker: updating…');
    let trackerState: TrackerState | null = campaign.trackerState ?? null;
    try {
      const updated = await TrackerUpdateStage.execute(this.options.aiCaller, {
        previous: campaign.trackerState ?? null,
        synopsis: plotOutput.synopsis,
        sceneOutput,
        location: newSceneState.location,
        presentNpcs: presentNpcs.map((npc) => ({
          id: npc.id,
          name: npc.name,
          description: npc.description,
        })),
        playerPersona: campaign.playerPersona,
        language: this.options.language ?? 'English',
        getTemplate: this.templateGetter,
      });
      if (updated === null) {
        recordEvent('tracker: update failed, keeping previous state');
        trackerState = campaign.trackerState ?? null;
      } else {
        trackerState = { ...updated, updatedAtTurn: turnIndex };
        recordEvent(
          `tracker: updated (${trackerState.dateTime}, ${trackerState.location}, ` +
            `${Object.keys(trackerState.npcs).length} npcs)`,
        );
      }
    } catch (t) {
      recordEvent(`tracker: update failed (${errorMessage(t)})`);
      trackerState = campaign.trackerState ?? null;
    }
    try {
      // Single merged save so sceneState and the board land atomically.
      await this.stores.saveCampaign({
        ...campaign,
        sceneState: newSceneState,
        trackerState,
        updatedAt: Date.now(),
      });
    } catch {
      // Swallowed, like the Kotlin runCatching around campaignStorage.save.
    }

    // ---- 10. Save the turn ----------------------------------------------
    const makeId = this.options.makeId ?? (() => crypto.randomUUID());
    const variant: TurnVariant = {
      id: makeId(),
      synopsis: plotOutput.synopsis,
      sceneOutput,
      routerDecision,
      presentNpcIds,
      mechanicResults,
      interrupted,
      timestamp: Date.now(),
      stageEvents: [...stageEvents],
      reasoning: reasoningParts.join('').trim().length > 0 ? reasoningParts.join('') : null,
    };

    try {
      const existing = await this.stores.loadTurn(campaignId, turnIndex);
      if (existing === null) {
        await this.stores.saveTurn(campaignId, {
          index: turnIndex,
          playerInput,
          variants: [variant],
          createdAt: Date.now(),
        });
      } else if (targetTurnIndex !== null) {
        // Explicit regenerate: appending a variant is the point.
        await this.stores.appendVariant(campaignId, turnIndex, variant);
      } else {
        // New-turn send that lost the index race: a concurrent pipeline
        // claimed this index while we were streaming. Never stack a send's
        // output as a variant on someone else's turn — claim the next free
        // index instead.
        const indices = await this.stores.listTurnIndices(campaignId);
        const nextFree = (indices.length > 0 ? Math.max(...indices) : -1) + 1;
        await this.stores.saveTurn(campaignId, {
          index: nextFree,
          playerInput,
          variants: [variant],
          createdAt: Date.now(),
        });
      }
    } catch {
      // Swallowed, like the Kotlin runCatching around the save block.
    }

    // ---- 11. Return ------------------------------------------------------
    return variant;
  }
}

/**
 * Resolve a tracker-update key to a concrete NPC. The plot model is told to
 * emit npc ids but sometimes emits the NAME instead; accept both:
 *  (a) exact id, (b) exact present-NPC name case-insensitive, (c) trimmed
 *  name containment. Null when nothing resolves (caller logs the skip).
 */
/**
 * Plot writes present_npcs as free text (usually names, not ids). Resolve
 * each mention against the campaign's real NPCs: exact id first, then name
 * (case-insensitive / containment via resolveTrackerTarget). Unresolvable
 * mentions are dropped with a stage event; a fully-unresolvable non-empty
 * list falls back to the campaign scene state instead of emptying the scene.
 */
export async function resolvePlotPresence(
  plotMentions: string[],
  sceneNpcIds: string[],
  loadNpc: (npcId: string) => Promise<Npc | null>,
  listNpcs: () => Promise<Npc[]>,
  recordEvent: (line: string) => void,
): Promise<string[]> {
  if (plotMentions.length === 0) return sceneNpcIds;
  const all = await listNpcs();
  const resolved: string[] = [];
  for (const mention of plotMentions) {
    const hit = await resolveTrackerTarget(loadNpc, mention, all);
    if (hit === null) {
      recordEvent(`plot: dropped unknown npc "${mention}"`);
      continue;
    }
    if (hit.how === 'name') {
      recordEvent(`plot: npc "${mention}" resolved to ${hit.npc.name}`);
    }
    if (!resolved.includes(hit.npc.id)) resolved.push(hit.npc.id);
  }
  if (resolved.length === 0) {
    recordEvent('plot: presence unresolved, keeping campaign scene state');
    return sceneNpcIds;
  }
  return resolved;
}

export async function resolveTrackerTarget(
  loadNpc: (npcId: string) => Promise<Npc | null>,
  key: string,
  presentNpcs: Npc[],
): Promise<{ npc: Npc; how: 'id' | 'name' } | null> {
  if (key.length === 0) return null;
  const byId = await loadNpc(key);
  if (byId) return { npc: byId, how: 'id' };

  const needle = key.trim().toLowerCase();
  if (needle.length === 0) return null;
  let contained: Npc | null = null;
  for (const npc of presentNpcs) {
    const name = npc.name.trim().toLowerCase();
    if (name.length === 0) continue;
    if (name === needle) return { npc, how: 'name' };
    if (contained === null && (name.includes(needle) || needle.includes(name))) {
      contained = npc;
    }
  }
  return contained ? { npc: contained, how: 'name' } : null;
}

/**
 * Turns a given NPC witnessed — i.e. turns where that NPC was present.
 * Mirrors the visibility invariant at single-NPC granularity.
 */
function witnessedTurnsFor(npcId: string, allTurns: Turn[]): Turn[] {
  return allTurns.filter((turn) => {
    const variant = turn.variants[turn.variants.length - 1];
    return variant !== undefined && variant.presentNpcIds.includes(npcId);
  });
}

/**
 * Compressed story-so-far for the plot stage. Unfiltered on purpose: the
 * plot engine is omniscient, only the scene stage is visibility-bound.
 */
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

/** Kotlin's `${t.message ?: t.javaClass.simpleName}` equivalent. */
function errorMessage(t: unknown): string {
  if (t instanceof Error && t.message) return t.message;
  if (t instanceof Error) return t.name;
  if (typeof t === 'object' && t !== null && 'message' in t) {
    const m = (t as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return 'Error';
}
