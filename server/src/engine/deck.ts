/**
 * Pure code mechanics for deck-based checks.
 *
 * Ported from engine/mechanics/DeckMechanics.kt. Standard 52-card deck:
 * ranks 2..14 (J=11, Q=12, K=13, A=14), suits hearts/diamonds/clubs/spades.
 *
 * The Kotlin `Random` is replaced by an injectable RandomSource so tests can
 * be deterministic; the draw semantics are identical:
 *  - advantage = 0: draw 1
 *  - advantage = 1: draw 2, take the higher rank
 *  - advantage = -1: draw 2, take the lower rank
 *  - any other value: draw 1 (defensive, same as Kotlin's else branch)
 */

import type { DrawnCard, MechanicCheck, MechanicResult } from '../shared/types.js';

export interface RandomSource {
  /** Uniform integer in [minInclusive, maxExclusive). Mirrors Random.nextInt. */
  nextInt(minInclusive: number, maxExclusive: number): number;
}

/** Default source backed by Math.random (no ambient state beyond the call). */
export const defaultRandom: RandomSource = {
  nextInt(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(Math.random() * (maxExclusive - minInclusive));
  },
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;

const RANK_NAMES: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};

export function executeCheck(
  check: MechanicCheck,
  random: RandomSource = defaultRandom,
): MechanicResult {
  let drawnCards: DrawnCard[];
  if (check.advantage === 1 || check.advantage === -1) {
    // Advantage / disadvantage: draw 2.
    drawnCards = [drawCard(random), drawCard(random)];
  } else {
    // Normal (and any stray model-generated value): draw 1.
    drawnCards = [drawCard(random)];
  }

  let cardValue: number;
  switch (check.advantage) {
    case 1:
      cardValue = Math.max(...drawnCards.map((c) => c.rank));
      break;
    case -1:
      cardValue = Math.min(...drawnCards.map((c) => c.rank));
      break;
    default:
      cardValue = drawnCards[0].rank;
  }

  const totalValue = cardValue + check.modifier;
  const tier = calculateTier(totalValue, check.dc);

  return {
    skill: check.skill,
    dc: check.dc,
    modifier: check.modifier,
    drawn: drawnCards,
    value: totalValue,
    tier,
  };
}

function drawCard(random: RandomSource): DrawnCard {
  const rank = random.nextInt(2, 15); // 2..14 inclusive
  const suit = SUITS[random.nextInt(0, SUITS.length)];
  const suitName = suit.charAt(0).toUpperCase() + suit.slice(1);
  return { rank, suit, name: `${RANK_NAMES[rank]} of ${suitName}` };
}

/**
 * Calculate outcome tier based on value vs DC.
 * - value >= DC + 5 → critical_success
 * - value >= DC     → success
 * - value >= DC - 3 → partial
 * - else            → failure
 */
export function calculateTier(value: number, dc: number): string {
  if (value >= dc + 5) return 'critical_success';
  if (value >= dc) return 'success';
  if (value >= dc - 3) return 'partial';
  return 'failure';
}
