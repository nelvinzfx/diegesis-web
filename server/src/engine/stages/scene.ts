/**
 * Scene stage: streams the narrative prose using the write model.
 * This is the only stage whose output reaches the story screen.
 * Ported from engine/stages/SceneStage.kt.
 */

import type { AiCaller, StreamHooks } from '../ai-caller.js';
import { resolvePrompt, type PromptTemplateGetter } from '../prompt-templates.js';
import { formatPrompt, type SceneContext } from '../visibility.js';

export const DEFAULT_NARRATOR_VOICE = `You are the narrator of a tabletop campaign. Write in second person, present tense.
Write in the story language's everyday spoken register (Bahasa Indonesia: "kamu", never the literary "kau"). Dialog in quotes. Never decide the player's actions or thoughts.

Render the beat described in the synopsis. Honor mechanic outcomes exactly.
Voice each present NPC exactly by their voice examples: their slang and rhythm are the reference, not standard polite narration.
Output markdown prose only — no headers, no meta commentary.`;

/**
 * System prompt (narrator voice) with template override support. Variables:
 * {{playerInput}}, {{synopsis}}, {{location}}, {{presentNpcs}}. An override
 * replaces the narrator voice entirely; without one the campaign narrator
 * voice (or the shipped default) is used verbatim.
 */
export function resolveSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  context: SceneContext,
  narratorVoice: string = DEFAULT_NARRATOR_VOICE,
): string {
  return resolvePrompt(getTemplate, 'scene', narratorVoice.trim(), {
    playerInput: context.playerInput,
    synopsis: context.synopsis,
    location: context.location,
    presentNpcs: context.presentNpcs.map((npc) => npc.name).join(', '),
  }).trim();
}

/**
 * Stream the scene prose.
 *
 * @param context Visibility-assembled scene context
 * @param narratorVoice Campaign-configurable narrator instructions
 * @param hooks Live tap for model reasoning deltas; omitted = ignore
 */
export async function* execute(
  aiCaller: AiCaller,
  context: SceneContext,
  narratorVoice: string = DEFAULT_NARRATOR_VOICE,
  hooks?: StreamHooks,
  getTemplate?: PromptTemplateGetter | null,
): AsyncGenerator<string> {
  const userPrompt = formatPrompt(context);
  yield* aiCaller.streamProse(resolveSystemPrompt(getTemplate, context, narratorVoice), userPrompt, hooks);
}
