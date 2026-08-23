/**
 * Plot stage: decides what happens in this beat.
 * Ported from engine/stages/PlotStage.kt (prompts verbatim).
 */

import type { AiCaller } from '../ai-caller.js';
import { resolvePrompt, type PromptTemplateGetter } from '../prompt-templates.js';
import {
  isTensionValue,
  type MechanicResult,
  type MemoryEntry,
  type PlotOutput,
  type RouterDecision,
  type TrackerUpdate,
} from '../../shared/types.js';
import { arrayOrEmpty, boolOrDefault, asRecord, optString, requireString } from './decode.js';

/**
 * Sentinel synopsis of the documented plot fallback (pipeline.md §3).
 * The orchestrator compares against this to record a stage event whenever the
 * plot stage fell back rather than parsed.
 */
export const FALLBACK_SYNOPSIS = 'The moment stretches; the situation stays tense.';

export const plotFallback: PlotOutput = {
  synopsis: FALLBACK_SYNOPSIS,
  present_npcs: [],
  scene_change: false,
  location: null,
  tracker_updates: [],
  tension: null,
};

export const DEFAULT_SYSTEM_PROMPT = `You are the plot engine of a tabletop campaign. You decide WHAT happens, never how it is told.

Session plan (the arc to follow):
{{sessionPlan}}

Story so far (compressed):
{{storySoFar}}

Rules:
- Advance the arc. Do not stall, do not repeat beats.
- Pace the tension deliberately. Judge each beat as "escalate", "hold", or "release": escalate only when the story earns more pressure, never chain escalate after escalate without cause; after a peak, let the beat release and breathe; hold mid-scene to let a moment land. Choose the beat's tension to fit the recent tension history.
- If mechanic results are provided, the synopsis MUST honor their tiers exactly.
- Nominate which NPCs are physically present. NPCs not listed leave the scene.
- Reply with JSON only.`;

/**
 * System prompt with template override support. Variables:
 * {{sessionPlan}}, {{storySoFar}}, {{tensionHistory}}.
 *
 * The JSON output contract deliberately does NOT live here: it rides the
 * code-built user payload (buildUserPayload) so a template override can
 * change guidance/voice but can never break the parse contract.
 */
export function resolveSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  sessionPlan: string,
  recentSummary: string,
  tensionHistory: readonly string[] = [],
): string {
  const storySoFar = recentSummary.length > 0 ? recentSummary : 'Campaign just started.';
  return resolvePrompt(getTemplate, 'plot', DEFAULT_SYSTEM_PROMPT, {
    sessionPlan,
    storySoFar,
    tensionHistory: tensionHistory.join('\n'),
  });
}

/**
 * Code-built user payload. The JSON contract at the bottom is the parse
 * contract; overrides to the system template cannot remove it.
 *
 * @param tensionHistory Recent per-turn tension lines, oldest first
 */
export function buildUserPayload(
  playerInput: string,
  mechanicResults: MechanicResult[],
  retrievedMemories: MemoryEntry[],
  tensionHistory: readonly string[] = [],
): string {
  let payload = `Player action: ${playerInput}\n\n`;

  if (tensionHistory.length > 0) {
    payload += '## Recent tension\n';
    for (const line of tensionHistory) {
      payload += `- ${line}\n`;
    }
    payload += '\n';
  }

  if (mechanicResults.length > 0) {
    payload += '## Mechanic Results (MUST honor these):\n';
    for (const result of mechanicResults) {
      payload += `- ${result.skill}: ${result.tier} (DC ${result.dc}, rolled ${result.value})\n`;
    }
    payload += '\n';
  }

  if (retrievedMemories.length > 0) {
    payload += '## Recalled Facts:\n';
    for (const mem of retrievedMemories) {
      payload += `- ${mem.fact}\n`;
    }
    payload += '\n';
  }

  payload += `Set "tension" to this beat's pacing: one of "escalate", "hold", or "release".
Reply with JSON:
{
  "synopsis": "2-6 sentences, what happens in this beat",
  "tension": "hold",
  "present_npcs": ["npcId"],
  "scene_change": false,
  "location": null,
  "tracker_updates": [{"npc": "npcId", "key": "trust", "delta": -1}]
}`;
  return payload;
}

export function decodePlotOutput(raw: string): PlotOutput {
  const obj = asRecord(JSON.parse(raw));
  const trackerUpdates: TrackerUpdate[] = arrayOrEmpty(obj, 'tracker_updates').map((entry) => {
    const t = asRecord(entry);
    return { npc: requireString(t, 'npc'), key: requireString(t, 'key'), delta: requireInt(t, 'delta') };
  });
  const presentNpcs: string[] = arrayOrEmpty(obj, 'present_npcs').map((id) => {
    if (typeof id !== 'string') throw new Error('present_npcs entries must be strings');
    return id;
  });
  return {
    synopsis: requireString(obj, 'synopsis'),
    present_npcs: presentNpcs,
    scene_change: boolOrDefault(obj, 'scene_change', false),
    location: optString(obj, 'location') ?? null,
    tracker_updates: trackerUpdates,
    tension: parseTension(obj),
  };
}

/** Valid tension passes through; missing/invalid becomes null. */
function parseTension(obj: Record<string, unknown>): PlotOutput['tension'] {
  return isTensionValue(obj['tension']) ? obj['tension'] : null;
}

function requireInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`field "${key}" must be an integer`);
  return Math.trunc(v);
}

export async function execute(
  aiCaller: AiCaller,
  input: {
    sessionPlan: string;
    recentSummary: string;
    playerInput: string;
    routerDecision: RouterDecision | null;
    mechanicResults: MechanicResult[];
    retrievedMemories: MemoryEntry[];
    /** Recent tension lines ("turn N: <value>") from stored variants, oldest first. */
    tensionHistory?: readonly string[];
    getTemplate?: PromptTemplateGetter | null;
  },
): Promise<PlotOutput> {
  return aiCaller.generateStructured(
    resolveSystemPrompt(
      input.getTemplate ?? null,
      input.sessionPlan,
      input.recentSummary,
      input.tensionHistory ?? [],
    ),
    buildUserPayload(
      input.playerInput,
      input.mechanicResults,
      input.retrievedMemories,
      input.tensionHistory ?? [],
    ),
    decodePlotOutput,
    plotFallback,
  );
}
