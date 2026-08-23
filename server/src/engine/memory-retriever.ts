/**
 * Retrieves relevant memories using forced top-k BM25-style term overlap
 * scoring. Ported from engine/memory/MemoryRetriever.kt.
 */

import type { MemoryEntry } from '../shared/types.js';

/**
 * Retrieve top-k memories based on term overlap with query.
 *
 * @param query Combined playerInput + synopsis for scoring
 * @param allMemories All available memory entries
 * @param k Number of top results to return (default 5)
 * @returns Relevant memories, deduplicated by exact fact text
 */
export function retrieve(
  query: string,
  allMemories: MemoryEntry[],
  k: number = 5,
): MemoryEntry[] {
  // Fewer than 10 memories total: ranking costs more than it buys, return all.
  if (allMemories.length < 10) {
    return distinctByFact(allMemories);
  }

  const queryTerms = tokenize(query);
  if (queryTerms.size === 0) {
    return distinctByFact(allMemories.slice(0, k));
  }

  const scored = allMemories.map((memory) => ({
    memory,
    score: calculateScore(queryTerms, tokenize(memory.fact)),
  }));

  // Sort by score descending (stable, like Kotlin sortedByDescending), take
  // top k, then deduplicate by exact fact text.
  scored.sort((a, b) => b.score - a.score);
  return distinctByFact(scored.slice(0, k).map((s) => s.memory));
}

function distinctByFact(memories: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  const out: MemoryEntry[] = [];
  for (const memory of memories) {
    if (seen.has(memory.fact)) continue;
    seen.add(memory.fact);
    out.push(memory);
  }
  return out;
}

/** Tokenize text into lowercase alphanumeric terms; single-char tokens skipped. */
function tokenize(text: string): Set<string> {
  const terms = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  return new Set(terms);
}

/**
 * BM25-style term overlap score, simple version: count of query terms that
 * appear in the memory, normalized by query length.
 */
function calculateScore(queryTerms: Set<string>, memoryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;
  let overlap = 0;
  for (const term of queryTerms) {
    if (memoryTerms.has(term)) overlap++;
  }
  return overlap / queryTerms.size;
}
