/**
 * Thinking effort for THINK-stage calls (router / plot / agency / extraction —
 * the generateStructured and streamThink paths). Scene prose is never affected.
 *
 *  - openai-compat: the level string goes out as a top-level `reasoning_effort`.
 *  - anthropic: the level maps to an extended-thinking token budget
 *    (`thinking: {"type": "enabled", "budget_tokens": N}`).
 *
 * Since the user-facing thinkMaxTokens setting was removed, the THINK call's
 * max_tokens is derived from the effort level: budget + answer headroom, so
 * Anthropic's hard rule (budget_tokens < max_tokens) always holds.
 */

export type CustomBody = { key: string; value: unknown };

export const DEFAULT = 'medium';

/** The four valid levels, in ascending order. Stored lowercase. */
export const LEVELS = ['low', 'medium', 'high', 'xhigh'];

/** Anthropic's hard floor for `budget_tokens`. */
export const MIN_BUDGET_TOKENS = 1024;

/** Headroom reserved for the visible answer above the thinking budget. */
export const ANSWER_HEADROOM_TOKENS = 1024;

/** Defensive: any unknown/legacy stored value falls back to DEFAULT. */
export function normalize(raw: string | null | undefined): string {
  const level = raw == null ? null : raw.trim().toLowerCase();
  if (level === null) return DEFAULT;
  return LEVELS.includes(level) ? level : DEFAULT;
}

/** Level → Anthropic extended-thinking budget. */
export function anthropicBudgetTokens(level: string): number {
  switch (normalize(level)) {
    case 'low':
      return 1_024;
    case 'medium':
      return 4_096;
    case 'high':
      return 16_384;
    case 'xhigh':
      return 32_768;
    default:
      return 4_096; // unreachable: normalize() only returns LEVELS values
  }
}

/**
 * max_tokens for THINK calls, derived from the effort level so that
 * budget_tokens < max_tokens always holds (Anthropic requirement).
 */
export function thinkMaxTokensFor(level: string): number {
  return anthropicBudgetTokens(level) + ANSWER_HEADROOM_TOKENS;
}

/** OpenAI-compatible: top-level `reasoning_effort: "<level>"`. */
export function openAiCustomBody(level: string): CustomBody[] {
  return [{ key: 'reasoning_effort', value: normalize(level) }];
}

/** Anthropic: `thinking: {"type": "enabled", "budget_tokens": N}`. */
export function anthropicCustomBody(level: string): CustomBody[] {
  return [
    { key: 'thinking', value: { type: 'enabled', budget_tokens: anthropicBudgetTokens(level) } },
  ];
}
