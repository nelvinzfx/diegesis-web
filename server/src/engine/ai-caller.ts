/**
 * The engine's only door to the model providers — TypeScript port of
 * engine/ai/AiCaller.kt (interface + pure helpers).
 *
 * Two call shapes, because the pipeline only ever needs two:
 *  - generateStructured for the JSON stages (router/plot/agency/extraction),
 *    which retries once and then falls back rather than throwing.
 *  - streamProse / streamThink as async iterables of text chunks, with an
 *    optional live reasoning tap.
 *
 * The real SDK-backed implementation is phase 2; everything here is transport-
 * free so tests run against fakes. The helpers below (fence sanitizer,
 * structured decode-with-retry, language directives) carry the exact
 * semantics of the Kotlin DefaultAiCaller companion functions.
 */

import * as ThinkingEffort from './thinking-effort.js';
import type { AppSettings } from '../shared/types.js';

export interface StreamHooks {
  /** Live tap for reasoning/thinking deltas; prose never routes here. */
  onReasoningChunk?: ((chunk: string) => void) | null;
}

export interface AiCaller {
  /**
   * Run a structured stage. Contract per pipeline.md: on decode failure,
   * retry once with "Return valid JSON only, no prose."; on second failure
   * return fallback. MUST NOT throw for parse or transport problems.
   */
  generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    decoder: (raw: string) => T,
    fallback: T,
  ): Promise<T>;

  /** Stream scene prose from the write model. */
  streamProse(systemPrompt: string, userPrompt: string, hooks?: StreamHooks): AsyncIterable<string>;

  /**
   * Stream non-scene prose from the THINK model (e.g. session plan
   * generation). Providers route reasoning deltas to the hook; prose tokens
   * flow through the returned iterable.
   */
  streamThink(systemPrompt: string, userPrompt: string, hooks?: StreamHooks): AsyncIterable<string>;
}

export const PROVIDER_OPENAI = 'openai-compat';
export const PROVIDER_ANTHROPIC = 'anthropic';
export const MISSING_KEY_MESSAGE = 'Set your API key in Settings first.';
export const RETRY_NUDGE = 'Return valid JSON only, no prose.';

/**
 * Models fence JSON in ```json blocks even when told not to. Strip the fence
 * and any leading/trailing prose before handing text to a decoder, so a
 * cosmetic wrapper doesn't burn the single retry. Exact port of
 * DefaultAiCaller.sanitize.
 */
export function sanitize(raw: string): string {
  let text = raw.trim();

  if (text.startsWith('```')) {
    text = text
      .replace(/^```/, '')
      .replace(/^json/, '')
      .replace(/^JSON/, '')
      .trim();
    const fence = text.lastIndexOf('```');
    if (fence >= 0) text = text.slice(0, fence).trim();
  }

  // Trim to the outermost JSON object/array if the model added prose.
  let firstBrace = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      firstBrace = i;
      break;
    }
  }
  if (firstBrace > 0) {
    const opener = text[firstBrace];
    const closer = opener === '{' ? '}' : ']';
    const lastClose = text.lastIndexOf(closer);
    if (lastClose > firstBrace) {
      text = text.slice(firstBrace, lastClose + 1);
    }
  }

  return text;
}

/**
 * Structured generation with one retry, transport-agnostic. Mirrors the
 * DefaultAiCaller.generateStructured control flow exactly:
 *  1. attempt = fetch(); if non-null and decoder(sanitize(attempt)) succeeds → done.
 *  2. retry once, echoing the bad output back so the model can correct it
 *     (assistant: first ?? "", user: "Return valid JSON only, no prose.").
 *  3. second attempt null or undecodable → fallback. Never throws.
 *
 * `fetch` receives the messages list (system + user [+ assistant echo + nudge]
 * on the retry) and resolves null on transport failure.
 */
export async function structuredWithRetry<T>(
  systemPrompt: string,
  userPrompt: string,
  fetchFn: (messages: readonly ChatMessage[]) => Promise<string | null>,
  decoder: (raw: string) => T,
  fallback: T,
): Promise<T> {
  const base: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let first: string | null = null;
  try {
    first = await fetchFn(base);
  } catch {
    first = null;
  }
  if (first !== null) {
    try {
      return decoder(sanitize(first));
    } catch {
      // fall through to retry
    }
  }

  // Retry once, echoing the bad output back so the model can correct it.
  const retry: ChatMessage[] = [
    ...base,
    { role: 'assistant', content: first ?? '' },
    { role: 'user', content: RETRY_NUDGE },
  ];

  let second: string | null = null;
  try {
    second = await fetchFn(retry);
  } catch {
    second = null;
  }
  if (second === null) return fallback;
  try {
    return decoder(sanitize(second));
  } catch {
    return fallback;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Appends the output-language directive to a system prompt. Applies to every
 * non-empty language, English included, so the writer's language never
 * silently follows the character cards instead. Exact port of
 * DefaultAiCaller.languageDirective.
 */
export function languageDirective(prompt: string, language: string): string {
  if (language.length === 0) return prompt;
  return (
    prompt.trimEnd() +
    '\n\nIMPORTANT: Write all narration, dialogue, and prose in ' +
    language +
    ', regardless of the language of any character sheets or source material.'
  );
}

/**
 * Scene-stage language rule: narration always follows the story language,
 * but dialogue follows each character's own background — an American
 * character speaks English even in an Indonesian story, unless their sheet
 * marks them bilingual/fluent in the story language. Exact port of
 * DefaultAiCaller.sceneLanguageDirective.
 */
export function sceneLanguageDirective(prompt: string, language: string): string {
  if (language.length === 0) return prompt;
  return (
    prompt.trimEnd() +
    '\n\nIMPORTANT: Write all narration and prose in ' +
    language +
    '. For dialogue, honor each character\'s background: a character speaks the language that fits ' +
    'their origin and sheet (for example an American character speaks English), unless their sheet ' +
    'says they are bilingual or fluent in ' +
    language +
    ' — then they speak ' +
    language +
    '.'
  );
}

/**
 * THINK-stage request body extras (structured stages + streamThink): the
 * thinking-effort custom body for the provider, plus the temperature rule —
 * on the Anthropic path extended thinking rejects temperature adjustments, so
 * temperature is dropped whenever the thinking object is attached. Ported from
 * DefaultAiCaller.thinkGenerationParams.
 */
export function thinkRequestExtras(
  settings: Pick<AppSettings, 'thinkingEffort'>,
  provider: string,
  temperature: number,
): { customBody: ThinkingEffort.CustomBody[]; temperature: number | null } {
  let effortBody: ThinkingEffort.CustomBody[];
  switch (provider) {
    case PROVIDER_ANTHROPIC:
      effortBody = ThinkingEffort.anthropicCustomBody(settings.thinkingEffort);
      break;
    case PROVIDER_OPENAI:
      effortBody = ThinkingEffort.openAiCustomBody(settings.thinkingEffort);
      break;
    default:
      effortBody = [];
  }
  const effectiveTemperature =
    provider === PROVIDER_ANTHROPIC && effortBody.length > 0 ? null : temperature;
  return { customBody: effortBody, temperature: effectiveTemperature };
}
