/**
 * Thinking effort for THINK-stage calls (router / plot / agency / extraction —
 * the generateStructured and streamThink paths). Scene prose is never affected.
 *
 * Ported from engine/ai/ThinkingEffort.kt. Pure functions only:
 *  - openai-compat: the level string goes out as a top-level `reasoning_effort`.
 *  - anthropic: the level maps to an extended-thinking token budget
 *    (`thinking: {"type": "enabled", "budget_tokens": N}`), clamped so the
 *    budget always stays below max_tokens, and omitted entirely when the
 *    clamped budget would fall under Anthropic's 1024-token minimum.
 */

export type CustomBody = { key: string; value: unknown };

export const DEFAULT = 'medium';

/** The four valid levels, in ascending order. Stored lowercase. */
export const LEVELS = ['low', 'medium', 'high', 'xhigh'];

/** Anthropic's hard floor for `budget_tokens`. */
export const MIN_BUDGET_TOKENS = 1024;

/** Headroom reserved for the visible answer: budget <= thinkMaxTokens - 1024. */
export const ANSWER_HEADROOM_TOKENS = 1024;

/** Defensive: any unknown/legacy stored value falls back to DEFAULT. */
export function normalize(raw: string | null | undefined): string {
  const level = raw == null ? null : raw.trim().toLowerCase();
  if (level === null) return DEFAULT;
  return LEVELS.includes(level) ? level : DEFAULT;
}

/** Level → Anthropic extended-thinking budget, before clamping. */
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
 * Effective Anthropic budget after clamping, or null when the thinking object
 * must be omitted. Anthropic rejects budget_tokens < 1024 and
 * budget_tokens >= max_tokens, so:
 *   effective = min(budget, thinkMaxTokens - 1024); null if < 1024.
 */
export function effectiveAnthropicBudget(level: string, thinkMaxTokens: number): number | null {
  const clamped = Math.min(
    anthropicBudgetTokens(level),
    thinkMaxTokens - ANSWER_HEADROOM_TOKENS,
  );
  return clamped < MIN_BUDGET_TOKENS ? null : clamped;
}

/** OpenAI-compatible: top-level `reasoning_effort: "<level>"`. */
export function openAiCustomBody(level: string): CustomBody[] {
  return [{ key: 'reasoning_effort', value: normalize(level) }];
}

/**
 * Anthropic: `thinking: {"type": "enabled", "budget_tokens": N}` with the
 * clamped budget, or an empty array when the budget is too small to send.
 */
export function anthropicCustomBody(level: string, thinkMaxTokens: number): CustomBody[] {
  const budget = effectiveAnthropicBudget(level, thinkMaxTokens);
  if (budget === null) return [];
  return [{ key: 'thinking', value: { type: 'enabled', budget_tokens: budget } }];
}
