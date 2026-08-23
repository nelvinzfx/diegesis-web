import { describe, expect, it } from 'vitest';
import * as ThinkingEffort from './thinking-effort.js';

describe('ThinkingEffort', () => {
  // ---- level → budget mapping ------------------------------------------

  it('level maps to documented anthropic budgets', () => {
    expect(ThinkingEffort.anthropicBudgetTokens('low')).toBe(1_024);
    expect(ThinkingEffort.anthropicBudgetTokens('medium')).toBe(4_096);
    expect(ThinkingEffort.anthropicBudgetTokens('high')).toBe(16_384);
    expect(ThinkingEffort.anthropicBudgetTokens('xhigh')).toBe(32_768);
  });

  it('unknown level maps to the medium budget', () => {
    expect(ThinkingEffort.anthropicBudgetTokens('turbo')).toBe(4_096);
    expect(ThinkingEffort.anthropicBudgetTokens('')).toBe(4_096);
  });

  // ---- normalization ----------------------------------------------------

  it('normalize accepts the four levels and trims case and whitespace', () => {
    expect(ThinkingEffort.normalize('low')).toBe('low');
    expect(ThinkingEffort.normalize('medium')).toBe('medium');
    expect(ThinkingEffort.normalize('high')).toBe('high');
    expect(ThinkingEffort.normalize('xhigh')).toBe('xhigh');
    expect(ThinkingEffort.normalize(' HIGH ')).toBe('high');
  });

  it('normalize falls back to medium for invalid values', () => {
    expect(ThinkingEffort.normalize(null)).toBe('medium');
    expect(ThinkingEffort.normalize(undefined)).toBe('medium');
    expect(ThinkingEffort.normalize('')).toBe('medium');
    expect(ThinkingEffort.normalize('banana')).toBe('medium');
    expect(ThinkingEffort.normalize('x-high')).toBe('medium');
  });

  // ---- clamping ---------------------------------------------------------

  it('budget is clamped to thinkMaxTokens minus headroom', () => {
    // xhigh wants 32768, but 8192 - 1024 = 7168 is all that fits.
    expect(ThinkingEffort.effectiveAnthropicBudget('xhigh', 8_192)).toBe(7_168);
    // high wants 16384; with 20k max tokens it fits unclamped.
    expect(ThinkingEffort.effectiveAnthropicBudget('high', 20_000)).toBe(16_384);
  });

  it('budget below the anthropic minimum is omitted', () => {
    // 2048 - 1024 = 1024 → exactly the floor, still allowed.
    expect(ThinkingEffort.effectiveAnthropicBudget('low', 2_048)).toBe(1_024);
    // 2047 - 1024 = 1023 → under the floor, omit.
    expect(ThinkingEffort.effectiveAnthropicBudget('low', 2_047)).toBeNull();
    // Degenerate max_tokens: omit for every level.
    expect(ThinkingEffort.effectiveAnthropicBudget('xhigh', 1_024)).toBeNull();
    expect(ThinkingEffort.effectiveAnthropicBudget('medium', 0)).toBeNull();
  });

  // ---- request body construction ---------------------------------------

  it('openai body is a top level reasoning_effort string', () => {
    const body = ThinkingEffort.openAiCustomBody('high');
    expect(body).toHaveLength(1);
    expect(body[0].key).toBe('reasoning_effort');
    expect(body[0].value).toBe('high');
  });

  it('openai body normalizes invalid levels to medium', () => {
    const body = ThinkingEffort.openAiCustomBody('nope');
    expect(body[0].value).toBe('medium');
  });

  it('anthropic body is thinking enabled with the clamped budget', () => {
    const body = ThinkingEffort.anthropicCustomBody('xhigh', 8_192);
    expect(body).toHaveLength(1);
    expect(body[0].key).toBe('thinking');
    expect(body[0].value).toEqual({ type: 'enabled', budget_tokens: 7_168 });
  });

  it('anthropic body is omitted when the clamped budget is under 1024', () => {
    expect(ThinkingEffort.anthropicCustomBody('low', 2_047)).toEqual([]);
    expect(ThinkingEffort.anthropicCustomBody('xhigh', 1_024)).toEqual([]);
  });
});
