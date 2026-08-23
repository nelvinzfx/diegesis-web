/**
 * Trims turn history to fit within a token budget.
 *
 * Ported from engine/assembler/ContextWindowTrimmer.kt.
 *
 * Estimation: chars / 4 ≈ tokens (conservative for English, generous for CJK).
 * Drops OLDEST visible turns first, keeps newest. At least one turn is always
 * kept, even when a single oversized turn exceeds the whole budget — dropping
 * everything would starve the scene stage.
 */

import type { Turn } from '../shared/types.js';

/**
 * Trim the turn list to fit within the estimated token budget.
 *
 * @param turns All visible turns (already filtered by visibility)
 * @param budgetTokens Token budget for history
 * @returns Trimmed list of turns (newest N that fit), chronological order
 */
export function trimToFit(turns: Turn[], budgetTokens: number): Turn[] {
  if (turns.length === 0) return [];
  if (budgetTokens <= 0) return [];

  const budgetChars = budgetTokens * 4;

  // Walk backward from newest, accumulating until we exceed the budget.
  const kept: Turn[] = [];
  let accumulated = 0;

  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const turnSize = estimateTurnSize(turn);
    if (accumulated + turnSize > budgetChars && kept.length > 0) {
      // Would exceed budget; stop here (but keep at least one turn).
      break;
    }
    kept.push(turn);
    accumulated += turnSize;
  }

  // Reverse back to chronological order.
  return kept.reverse();
}

/** Estimate the character size of a turn (input + latest scene output). */
function estimateTurnSize(turn: Turn): number {
  const inputSize = turn.playerInput.length;
  const lastVariant = turn.variants[turn.variants.length - 1];
  const outputSize = lastVariant ? lastVariant.sceneOutput.length : 0;
  return inputSize + outputSize;
}
