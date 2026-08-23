import { describe, expect, it } from 'vitest';
import { trimToFit } from './trimmer.js';
import type { Turn } from '../shared/types.js';

function turnOf(index: number, input: string, output: string): Turn {
  return {
    index,
    playerInput: input,
    createdAt: 0,
    variants: [
      {
        id: `v${index}`,
        synopsis: `synopsis ${index}`,
        sceneOutput: output,
        routerDecision: null,
        presentNpcIds: [],
        mechanicResults: [],
        interrupted: false,
        timestamp: 0,
        stageEvents: [], tension: null,
        reasoning: null,
      },
    ],
  };
}

/** A turn whose input+output totals exactly [chars] characters. */
function turnOfSize(index: number, chars: number): Turn {
  const half = Math.floor(chars / 2);
  return turnOf(index, 'a'.repeat(half), 'b'.repeat(chars - half));
}

describe('ContextWindowTrimmer', () => {
  it('empty input yields empty output', () => {
    expect(trimToFit([], 1000)).toEqual([]);
  });

  it('zero or negative budget yields empty output', () => {
    const turns = [turnOfSize(0, 100)];
    expect(trimToFit(turns, 0)).toEqual([]);
    expect(trimToFit(turns, -5)).toEqual([]);
  });

  it('everything fits when under budget', () => {
    // 3 turns x 400 chars = 1200 chars = 300 tokens; budget 1000 tokens.
    const turns = [0, 1, 2].map((i) => turnOfSize(i, 400));
    expect(trimToFit(turns, 1000)).toEqual(turns);
  });

  it('oldest turns are dropped first and newest kept', () => {
    // Each turn is 4000 chars = 1000 tokens. Budget 2000 tokens fits 2.
    const turns = [0, 1, 2, 3, 4].map((i) => turnOfSize(i, 4000));
    const trimmed = trimToFit(turns, 2000);
    expect(trimmed).toHaveLength(2);
    expect(trimmed.map((t) => t.index)).toEqual([3, 4]);
  });

  it('result stays in chronological order', () => {
    const turns = Array.from({ length: 10 }, (_, i) => turnOfSize(i, 2000)); // 500 tokens each
    const trimmed = trimToFit(turns, 1600); // fits 3
    expect(trimmed.map((t) => t.index)).toEqual([...trimmed.map((t) => t.index)].sort((a, b) => a - b));
    expect(trimmed.map((t) => t.index)).toEqual([7, 8, 9]);
  });

  it('budget is respected by estimated size', () => {
    const turns = Array.from({ length: 10 }, (_, i) => turnOfSize(i, 4000)); // 1000 tokens each
    const budget = 3500;
    const trimmed = trimToFit(turns, budget);
    const estimatedTokens = trimmed.reduce(
      (sum, turn) =>
        sum +
        Math.trunc(
          (turn.playerInput.length + turn.variants[turn.variants.length - 1].sceneOutput.length) / 4,
        ),
      0,
    );
    expect(estimatedTokens).toBeLessThanOrEqual(budget);
    expect(trimmed).toHaveLength(3);
  });

  it('a single oversized newest turn is still kept', () => {
    const turns = [turnOfSize(0, 400), turnOfSize(1, 40000)];
    const trimmed = trimToFit(turns, 100);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].index).toBe(1);
  });

  it('turn without variants counts only its input', () => {
    const bare: Turn = { index: 0, playerInput: 'x'.repeat(400), variants: [], createdAt: 0 };
    const newest = turnOfSize(1, 400);
    // Budget of 250 tokens = 1000 chars fits both (400 + 400 chars).
    const trimmed = trimToFit([bare, newest], 250);
    expect(trimmed).toHaveLength(2);
  });
});
