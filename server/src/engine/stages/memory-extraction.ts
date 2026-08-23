/**
 * Memory extraction stage: pulls durable facts from a finished turn.
 * Ported from engine/stages/MemoryExtractionStage.kt (prompts verbatim).
 */

import type { AiCaller } from '../ai-caller.js';
import { resolvePrompt, type PromptTemplateGetter } from '../prompt-templates.js';
import type { MemoryEntry } from '../../shared/types.js';
import { asRecord, optString, requireString } from './decode.js';

export const DEFAULT_SYSTEM_PROMPT = `Extract durable facts from this turn worth remembering across sessions: revelations, decisions, relationships changes, promises, names, places. Ignore transient detail.

Reply with a JSON array only:
[{"scope": "campaign", "npc_id": null, "fact": "..."}]

- scope: "campaign" for world facts, "npc" for facts about a specific NPC
- npc_id: the NPC's id when scope is "npc", otherwise null
- fact: one durable fact, stated plainly
- Return an empty array [] if nothing durable happened.`;

/**
 * System prompt with template override support. Variables:
 * {{playerInput}}, {{synopsis}}, {{sceneOutput}}.
 */
export function resolveSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  input: { playerInput: string; synopsis: string; sceneOutput: string },
): string {
  return resolvePrompt(getTemplate, 'memory-extraction', DEFAULT_SYSTEM_PROMPT, {
    playerInput: input.playerInput,
    synopsis: input.synopsis,
    sceneOutput: input.sceneOutput,
  });
}

export function buildUserPrompt(playerInput: string, synopsis: string, sceneOutput: string): string {
  return `## Player action
${playerInput}

## What happened
${synopsis}

## How it was narrated
${sceneOutput}

Extract durable facts. JSON array only.`;
}

interface ExtractedFact {
  scope: string;
  npc_id: string | null;
  fact: string;
}

export function decodeExtractedFacts(raw: string): ExtractedFact[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
  // Re-stringify so the sanitize path in structuredWithRetry behaves the same
  // as for object stages, then map entries.
  return parsed.map((entry) => {
    const obj = asRecord(entry);
    return {
      scope: requireString(obj, 'scope'),
      npc_id: optString(obj, 'npc_id') ?? null,
      fact: requireString(obj, 'fact'),
    };
  });
}

/**
 * Extract durable memories from the finished turn.
 * Returns memory entries (empty list on failure).
 */
export async function execute(
  aiCaller: AiCaller,
  input: {
    playerInput: string;
    synopsis: string;
    sceneOutput: string;
    turnIndex: number;
    getTemplate?: PromptTemplateGetter | null;
  },
): Promise<MemoryEntry[]> {
  const extracted = await aiCaller.generateStructured(
    resolveSystemPrompt(input.getTemplate ?? null, input),
    buildUserPrompt(input.playerInput, input.synopsis, input.sceneOutput),
    decodeExtractedFacts,
    [] as ExtractedFact[],
  );

  return extracted.map((fact) => ({
    scope: fact.scope,
    npc_id: fact.npc_id,
    fact: fact.fact,
    turn: input.turnIndex,
    ts: Date.now(),
  }));
}
