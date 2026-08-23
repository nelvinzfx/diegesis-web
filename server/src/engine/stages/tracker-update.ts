/**
 * Narrative status board stage: rewrites the campaign-level trackerState
 * after every finished turn so the inspector shows a live "status board".
 *
 * Full-state replace (not a diff) on purpose: the model returns the ENTIRE
 * board every time, so a bad previous state self-heals on the next turn.
 * This stage is a READER affordance: innerVoice lines may be honest and may
 * reveal what an NPC hides, because the visibility invariant (engine/
 * visibility.ts) governs SCENE NARRATION only, never this board.
 */

import type { AiCaller } from '../ai-caller.js';
import { resolvePrompt, type PromptTemplateGetter } from '../prompt-templates.js';
import type { TrackerEntry, TrackerState } from '../../shared/types.js';
import { asRecord, optString, requireString } from './decode.js';

export const DEFAULT_SYSTEM_PROMPT = `You maintain a live status board for a roleplay story: a compact reader-facing snapshot of the moment, updated after every turn.

Reply with ONE JSON object only, no prose, no code fences:
{
  "dateTime": "...",
  "location": "...",
  "atmosphere": "...",
  "player": {"look": "...", "condition": "...", "carrying": "..."},
  "npcs": {"<npcId>": {"look": "...", "condition": "...", "carrying": "...", "innerVoice": "..."}}
}

Rules:
- dateTime: advances plausibly from the previous board; it never moves backwards. If the previous board is empty and the scene gives no time, derive a believable starting date and time for the story.
- location: where the scene now takes place (short place name).
- atmosphere: one short sensory line (light, air, sound, mood).
- player: the player persona as the scene shows them right now. look = what they are wearing / how they present, condition = physical and emotional state, carrying = notable items on them. Use "-" for unknown. Use null instead of the object only if the persona is truly absent from the scene.
- npcs: ONLY the NPCs present in this scene (ids are given below). Same look/condition/carrying fields; use "-" for unknown. innerVoice: one short first-person line in the NPC's own words. The board is a READER affordance: innerVoice may be honest and may reveal secrets the NPC hides, even when the scene narration hides them. Scene visibility rules do NOT apply to this board.
- All text in the story language.`;

export interface TrackerNpcInput {
  id: string;
  name: string;
  description: string;
}

export interface TrackerStageInput {
  previous: TrackerState | null;
  synopsis: string;
  sceneOutput: string;
  location: string;
  presentNpcs: TrackerNpcInput[];
  playerPersona: string;
  language: string;
  /** Template override getter; absent/null = shipped default. */
  getTemplate?: PromptTemplateGetter | null;
}

/** System prompt with template override support. */
export function resolveSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  input: TrackerStageInput,
): string {
  return resolvePrompt(getTemplate, 'tracker-update', DEFAULT_SYSTEM_PROMPT, {
    previousTracker: formatPrevious(input.previous),
    synopsis: input.synopsis,
    sceneOutput: input.sceneOutput,
    location: input.location,
    presentNpcs: formatPresentNpcs(input.presentNpcs),
    playerPersona: input.playerPersona,
    language: input.language,
  });
}

export function buildUserPrompt(input: TrackerStageInput): string {
  return `## Current status board
${formatPrevious(input.previous)}

## Beat plan
${input.synopsis}

## How the scene was narrated
${input.sceneOutput}

## Location
${input.location}

## Present NPCs
${formatPresentNpcs(input.presentNpcs)}

## Player persona
${input.playerPersona.trim().length > 0 ? input.playerPersona : '(unspecified)'}

Story language: ${input.language}

Write the updated status board now. JSON object only.`;
}

function formatPrevious(previous: TrackerState | null): string {
  if (previous === null) return '(none yet: this is the first board)';
  return JSON.stringify(previous);
}

function formatPresentNpcs(presentNpcs: TrackerNpcInput[]): string {
  if (presentNpcs.length === 0) return '(none)';
  return presentNpcs
    .map((npc) => {
      const snippet =
        npc.description.trim().length > 0 ? npc.description.trim().slice(0, 200) : '(no description)';
      return `- id: ${npc.id} | name: ${npc.name} | ${snippet}`;
    })
    .join('\n');
}

// ---- decoding ----------------------------------------------------------------

export function decodeTrackerEntry(value: unknown): TrackerEntry & { innerVoice?: string } {
  const obj = asRecord(value);
  const entry: TrackerEntry & { innerVoice?: string } = {
    look: requireString(obj, 'look'),
    condition: requireString(obj, 'condition'),
    carrying: requireString(obj, 'carrying'),
  };
  const innerVoice = optString(obj, 'innerVoice');
  if (innerVoice !== undefined) entry.innerVoice = innerVoice;
  return entry;
}

/**
 * Strict full-state decoder: throws on any structural problem so the caller
 * burns its retry and then falls back to "keep previous state".
 */
export function decodeTrackerState(raw: string): TrackerState {
  const parsed: unknown = JSON.parse(raw);
  const obj = asRecord(parsed);
  const npcsRaw = asRecord(obj['npcs'] ?? {});
  const npcs: TrackerState['npcs'] = {};
  for (const [id, value] of Object.entries(npcsRaw)) {
    npcs[id] = decodeTrackerEntry(value);
  }
  const playerRaw = obj['player'];
  return {
    dateTime: requireString(obj, 'dateTime'),
    location: requireString(obj, 'location'),
    atmosphere: requireString(obj, 'atmosphere'),
    player: playerRaw === null || playerRaw === undefined ? null : decodeTrackerEntry(playerRaw),
    npcs,
    // The orchestrator stamps the turn index; the model's value is ignored.
    updatedAtTurn: null,
  };
}

/**
 * Rewrite the status board from the finished turn. Returns the updated state
 * with npcs filtered to PRESENT ids, or null when the model output was
 * undecodable (caller keeps the previous state).
 */
export async function execute(
  aiCaller: AiCaller,
  input: TrackerStageInput,
): Promise<TrackerState | null> {
  const decoded = await aiCaller.generateStructured<TrackerState | null>(
    resolveSystemPrompt(input.getTemplate ?? null, input),
    buildUserPrompt(input),
    decodeTrackerState,
    null,
  );
  if (decoded === null) return null;

  // Only NPCs present in the scene may appear on the board, regardless of
  // what the model returned (stale ids must not linger).
  const presentIds = new Set(input.presentNpcs.map((npc) => npc.id));
  const npcs: TrackerState['npcs'] = {};
  for (const [id, entry] of Object.entries(decoded.npcs)) {
    if (presentIds.has(id)) npcs[id] = entry;
  }
  return { ...decoded, npcs };
}
