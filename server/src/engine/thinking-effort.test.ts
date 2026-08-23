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

  // ---- derived max_tokens (budget + headroom invariant) ------------------

  it('think max tokens is derived from the effort level', () => {
    expect(ThinkingEffort.thinkMaxTokensFor('low')).toBe(2_048);
    expect(ThinkingEffort.thinkMaxTokensFor('medium')).toBe(5_120);
    expect(ThinkingEffort.thinkMaxTokensFor('high')).toBe(17_408);
    expect(ThinkingEffort.thinkMaxTokensFor('xhigh')).toBe(33_792);
    expect(ThinkingEffort.thinkMaxTokensFor('banana')).toBe(5_120);
  });

  it('derived max_tokens always leaves headroom above the budget', () => {
    for (const level of ThinkingEffort.LEVELS) {
      const budget = ThinkingEffort.anthropicBudgetTokens(level);
      expect(ThinkingEffort.thinkMaxTokensFor(level)).toBe(budget + 1_024);
    }
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

  it('anthropic body is thinking enabled with the level budget', () => {
    const body = ThinkingEffort.anthropicCustomBody('xhigh');
    expect(body).toHaveLength(1);
    expect(body[0].key).toBe('thinking');
    expect(body[0].value).toEqual({ type: 'enabled', budget_tokens: 32_768 });
  });

  it('anthropic body normalizes invalid levels to medium', () => {
    const body = ThinkingEffort.anthropicCustomBody('nope');
    expect(body[0].value).toEqual({ type: 'enabled', budget_tokens: 4_096 });
  });
});
