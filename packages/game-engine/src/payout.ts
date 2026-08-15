import { Card } from './deck';
import { handValue, isBlackjack, isBust } from './handValue';

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface RoundResult {
  outcome: Outcome;
  payout: number;
}

export function resolveHand(playerCards: Card[], dealerCards: Card[], bet: number): RoundResult {
  if (isBust(playerCards)) {
    return { outcome: 'bust', payout: -bet };
  }

  const playerBlackjack = isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);

  if (playerBlackjack && dealerBlackjack) {
    return { outcome: 'push', payout: 0 };
  }
  if (playerBlackjack) {
    return { outcome: 'blackjack', payout: bet * 1.5 };
  }
  if (dealerBlackjack) {
    return { outcome: 'lose', payout: -bet };
  }
  if (isBust(dealerCards)) {
    return { outcome: 'win', payout: bet };
  }

  const playerTotal = handValue(playerCards).total;
  const dealerTotal = handValue(dealerCards).total;

  if (playerTotal > dealerTotal) {
    return { outcome: 'win', payout: bet };
  }
  if (playerTotal < dealerTotal) {
    return { outcome: 'lose', payout: -bet };
  }
  return { outcome: 'push', payout: 0 };
}
