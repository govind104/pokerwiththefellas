import { Card } from './deck';
import { handValue, isBlackjack, isBust } from './handValue';

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface RoundResult {
  outcome: Outcome;
  /**
   * The complete net change to apply to the player's chip balance for this
   * hand: `balance += payout`. This already nets out the wager — do not
   * separately deduct the bet before the hand or add it back after settling.
   * Positive on a win/blackjack, negative on a loss/bust, 0 on a push.
   */
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
    // Bets/payouts may be fractional (e.g. bet=101 -> blackjack payout 151.5).
    // No rounding is applied anywhere in this MVP — chip balances are stored
    // and compared as raw numbers. Revisit only if the app ever needs
    // integer-only chip semantics.
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
