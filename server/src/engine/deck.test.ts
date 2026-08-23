import { describe, expect, it } from 'vitest';
import { executeCheck, calculateTier, type RandomSource } from './deck.js';
import type { MechanicCheck } from '../shared/types.js';

/** Deterministic mulberry32-backed source; stands in for Kotlin Random(seed). */
function seededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    nextInt(minInclusive: number, maxExclusive: number): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return minInclusive + Math.floor(r * (maxExclusive - minInclusive));
    },
  };
}

const suits = new Set(['hearts', 'diamonds', 'clubs', 'spades']);

function check(overrides: Partial<MechanicCheck> = {}): MechanicCheck {
  return { skill: 'x', dc: 10, modifier: 0, advantage: 0, ...overrides };
}

describe('DeckMechanics', () => {
  // ---- deck shape ------------------------------------------------------

  it('drawn ranks always fall in 2 to 14', () => {
    for (let seed = 0; seed < 500; seed++) {
      const result = executeCheck(check({ skill: 'athletics' }), seededRandom(seed));
      for (const card of result.drawn) {
        expect(card.rank).toBeGreaterThanOrEqual(2);
        expect(card.rank).toBeLessThanOrEqual(14);
      }
    }
  });

  it('drawn suits are always one of the four standard suits', () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = executeCheck(check({ skill: 'insight', dc: 8 }), seededRandom(seed));
      for (const card of result.drawn) {
        expect(suits.has(card.suit)).toBe(true);
      }
    }
  });

  it('face cards map to the documented values', () => {
    // J=11, Q=12, K=13, A=14 per pipeline.md, verified via generated names.
    const names = new Map<number, string>();
    for (let seed = 0; seed < 2000; seed++) {
      for (const card of executeCheck(check(), seededRandom(seed)).drawn) {
        names.set(card.rank, card.name);
      }
    }
    expect(names.get(11)).toMatch(/^Jack/);
    expect(names.get(12)).toMatch(/^Queen/);
    expect(names.get(13)).toMatch(/^King/);
    expect(names.get(14)).toMatch(/^Ace/);
    expect(names.get(10)).toMatch(/^10/);
    expect(names.get(2)).toMatch(/^2/);
    expect(names.get(2)).toContain('Of'.replace('O', 'o')); // "of" separator
  });

  it('all thirteen ranks are reachable', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 3000; seed++) {
      for (const card of executeCheck(check(), seededRandom(seed)).drawn) {
        seen.add(card.rank);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  // ---- draw counts -----------------------------------------------------

  it('advantage zero draws exactly one card', () => {
    const result = executeCheck(check({ skill: 'stealth', advantage: 0 }), seededRandom(1));
    expect(result.drawn).toHaveLength(1);
  });

  it('advantage draws two cards', () => {
    const result = executeCheck(check({ skill: 'stealth', advantage: 1 }), seededRandom(1));
    expect(result.drawn).toHaveLength(2);
  });

  it('disadvantage draws two cards', () => {
    const result = executeCheck(check({ skill: 'stealth', advantage: -1 }), seededRandom(1));
    expect(result.drawn).toHaveLength(2);
  });

  // ---- advantage / disadvantage selection ------------------------------

  it('advantage takes the higher of the two draws', () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = executeCheck(check({ advantage: 1 }), seededRandom(seed));
      expect(result.value).toBe(Math.max(...result.drawn.map((c) => c.rank)));
    }
  });

  it('disadvantage takes the lower of the two draws', () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = executeCheck(check({ advantage: -1 }), seededRandom(seed));
      expect(result.value).toBe(Math.min(...result.drawn.map((c) => c.rank)));
    }
  });

  it('advantage and disadvantage differ when the two draws differ', () => {
    let sawStrictDifference = false;
    for (let seed = 0; seed < 200; seed++) {
      const adv = executeCheck(check({ advantage: 1 }), seededRandom(seed)).value;
      const dis = executeCheck(check({ advantage: -1 }), seededRandom(seed)).value;
      expect(adv).toBeGreaterThanOrEqual(dis);
      if (adv > dis) sawStrictDifference = true;
    }
    expect(sawStrictDifference).toBe(true);
  });

  // ---- modifier --------------------------------------------------------

  it('value is card rank plus modifier', () => {
    for (let seed = 0; seed < 100; seed++) {
      const result = executeCheck(check({ skill: 'arcana', modifier: 3 }), seededRandom(seed));
      expect(result.value).toBe(result.drawn[0].rank + 3);
    }
  });

  it('negative modifier lowers the value', () => {
    for (let seed = 0; seed < 100; seed++) {
      const result = executeCheck(check({ skill: 'arcana', modifier: -4 }), seededRandom(seed));
      expect(result.value).toBe(result.drawn[0].rank - 4);
    }
  });

  // ---- tier boundaries (the whole point) --------------------------------

  /** Pin `value` exactly by probing a seed's single draw then offsetting. */
  function tierForValue(value: number, dc: number): string {
    const probe = executeCheck(check({ dc }), seededRandom(7));
    const rank = probe.drawn[0].rank;
    const result = executeCheck(check({ dc, modifier: value - rank }), seededRandom(7));
    expect(result.value).toBe(value);
    return result.tier;
  }

  it('critical success at exactly DC plus 5', () => {
    expect(tierForValue(15, 10)).toBe('critical_success');
  });

  it('critical success above DC plus 5', () => {
    expect(tierForValue(30, 10)).toBe('critical_success');
  });

  it('success at one below DC plus 5', () => {
    expect(tierForValue(14, 10)).toBe('success');
  });

  it('success at exactly DC', () => {
    expect(tierForValue(10, 10)).toBe('success');
  });

  it('partial at one below DC', () => {
    expect(tierForValue(9, 10)).toBe('partial');
  });

  it('partial at exactly DC minus 3', () => {
    expect(tierForValue(7, 10)).toBe('partial');
  });

  it('failure at one below DC minus 3', () => {
    expect(tierForValue(6, 10)).toBe('failure');
  });

  it('failure far below DC', () => {
    expect(tierForValue(-20, 10)).toBe('failure');
  });

  it('boundaries hold across the full documented DC range', () => {
    for (let dc = 3; dc <= 18; dc++) {
      expect(tierForValue(dc + 5, dc)).toBe('critical_success');
      expect(tierForValue(dc + 4, dc)).toBe('success');
      expect(tierForValue(dc, dc)).toBe('success');
      expect(tierForValue(dc - 1, dc)).toBe('partial');
      expect(tierForValue(dc - 3, dc)).toBe('partial');
      expect(tierForValue(dc - 4, dc)).toBe('failure');
    }
  });

  it('calculateTier agrees with executeCheck tiers', () => {
    expect(calculateTier(15, 10)).toBe('critical_success');
    expect(calculateTier(5, 10)).toBe('failure');
  });

  // ---- result echo -----------------------------------------------------

  it('result echoes the check inputs verbatim', () => {
    const c = check({ skill: 'persuasion', dc: 14, modifier: 2, advantage: 1 });
    const result = executeCheck(c, seededRandom(3));
    expect(result.skill).toBe('persuasion');
    expect(result.dc).toBe(14);
    expect(result.modifier).toBe(2);
  });

  it('same seed is deterministic', () => {
    const a = executeCheck(check({ advantage: 1 }), seededRandom(42));
    const b = executeCheck(check({ advantage: 1 }), seededRandom(42));
    expect(a).toEqual(b);
  });

  it('unknown advantage values fall back to a single draw', () => {
    for (const adv of [2, -2, 7, -7]) {
      const result = executeCheck(check({ advantage: adv }), seededRandom(5));
      expect(result.drawn, `advantage=${adv}`).toHaveLength(1);
    }
  });
});
