import { describe, expect, it } from 'vitest';
import { retrieve } from './memory-retriever.js';
import type { MemoryEntry } from '../shared/types.js';

function mem(fact: string, turn = 0): MemoryEntry {
  return { scope: 'campaign', npc_id: null, fact, turn, ts: 0 };
}

/** Filler that shares no vocabulary with the queries used below. */
function filler(n: number): MemoryEntry[] {
  return Array.from({ length: n }, (_, i) => mem(`zzz filler entry number ${i + 1}`));
}

describe('MemoryRetriever', () => {
  // ---- the under-10 short circuit --------------------------------------

  it('returns everything when fewer than ten memories exist', () => {
    const memories = Array.from({ length: 9 }, (_, i) => mem(`fact ${i + 1}`));
    expect(retrieve('anything at all', memories)).toHaveLength(9);
  });

  it('ranks once the corpus reaches ten', () => {
    const memories = [...filler(9), mem('the harbor gate is sealed at dusk')];
    const result = retrieve('harbor gate', memories);
    expect(result).toHaveLength(5);
    expect(result[0].fact).toBe('the harbor gate is sealed at dusk');
  });

  // ---- term matching ----------------------------------------------------

  it('matching terms outrank non-matching ones', () => {
    const memories = [...filler(12), mem('Kestrel betrayed the guild'), mem('The lighthouse keeper is deaf')];
    const result = retrieve('what did Kestrel do to the guild', memories);
    expect(result[0].fact).toBe('Kestrel betrayed the guild');
  });

  it('matching is case insensitive', () => {
    const memories = [...filler(12), mem('KESTREL owns the tavern')];
    const result = retrieve('kestrel', memories);
    expect(result[0].fact).toBe('KESTREL owns the tavern');
  });

  it('punctuation does not block a match', () => {
    const memories = [...filler(12), mem("Kestrel's debt: unpaid.")];
    const result = retrieve('kestrel debt', memories);
    expect(result[0].fact).toBe("Kestrel's debt: unpaid.");
  });

  it('more overlapping terms rank higher', () => {
    const memories = [
      ...filler(12),
      mem('the silver key opens the vault door'),
      mem('the key is silver'),
      mem('a door creaks'),
    ];
    const result = retrieve('silver key vault door', memories);
    expect(result[0].fact).toBe('the silver key opens the vault door');
  });

  it('single character tokens are ignored', () => {
    const memories = [...filler(12), mem('a i o u brief noise')];
    const result = retrieve('a i o u', memories);
    expect(result).toHaveLength(5);
  });

  // ---- top-k ------------------------------------------------------------

  it('returns at most k results', () => {
    const memories = Array.from({ length: 40 }, (_, i) => mem(`shared term entry ${i + 1}`));
    expect(retrieve('shared term', memories)).toHaveLength(5);
  });

  it('k is configurable', () => {
    const memories = Array.from({ length: 40 }, (_, i) => mem(`shared term entry ${i + 1}`));
    expect(retrieve('shared term', memories, 3)).toHaveLength(3);
    expect(retrieve('shared term', memories, 10)).toHaveLength(10);
  });

  it('empty corpus yields nothing', () => {
    expect(retrieve('query', [])).toEqual([]);
  });

  it('blank query still returns k results without crashing', () => {
    const memories = Array.from({ length: 20 }, (_, i) => mem(`entry ${i + 1}`));
    expect(retrieve('', memories)).toHaveLength(5);
  });

  // ---- deduplication ----------------------------------------------------

  it('exact duplicate facts are collapsed', () => {
    const memories = [
      ...filler(12),
      mem('Kestrel betrayed the guild', 1),
      mem('Kestrel betrayed the guild', 4),
      mem('Kestrel betrayed the guild', 9),
    ];
    const result = retrieve('Kestrel guild betrayal', memories);
    expect(result.filter((m) => m.fact === 'Kestrel betrayed the guild')).toHaveLength(1);
  });

  it('deduplication also applies below the ten entry threshold', () => {
    const memories = [mem('same fact', 1), mem('same fact', 2), mem('other fact', 3)];
    expect(retrieve('anything', memories)).toHaveLength(2);
  });

  it('near duplicates are kept as distinct facts', () => {
    const memories = [
      ...filler(12),
      mem('Kestrel betrayed the guild'),
      mem('Kestrel betrayed the guild in winter'),
    ];
    const result = retrieve('Kestrel betrayed guild', memories);
    expect(result.filter((m) => m.fact.startsWith('Kestrel betrayed the guild'))).toHaveLength(2);
  });

  // ---- combined query surface -------------------------------------------

  it('query combining player input and synopsis matches on either half', () => {
    const memories = [
      ...filler(12),
      mem('the ferryman only takes silver'),
      mem('the abbot keeps a ledger of debts'),
    ];
    const facts = retrieve('pay the ferryman the abbot watches', memories).map((m) => m.fact);
    expect(facts).toContain('the ferryman only takes silver');
    expect(facts).toContain('the abbot keeps a ledger of debts');
  });
});
