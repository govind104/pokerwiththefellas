import type { BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { Rank } from '@poker-blackjack/game-engine';

// Mirrors the engine and server rules so the UI can grey out moves that would
// only bounce back with an error: Double needs exactly two cards, Split needs a
// pair (same blackjack value) and is allowed once per round, and either one
// stakes another copy of the active hand's bet, which the balance must cover.

function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export interface BlackjackAvailability {
  double: boolean;
  split: boolean;
}

export function blackjackAvailability(round: BlackjackRoundView | undefined, balance: number): BlackjackAvailability {
  const hand = round?.playerHands.find((h) => !h.done);
  if (!round || !hand) return { double: false, split: false };
  const exposure = round.playerHands.reduce((sum, h) => sum + h.bet, 0);
  const affordable = balance >= exposure + hand.bet;
  const twoCards = hand.cards.length === 2;
  const pair = twoCards && cardValue(hand.cards[0].rank) === cardValue(hand.cards[1].rank);
  return {
    double: twoCards && affordable,
    split: pair && round.playerHands.length === 1 && affordable,
  };
}
