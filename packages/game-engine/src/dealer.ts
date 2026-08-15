import { Card } from './deck';
import { handValue } from './handValue';

// Spec Section 3: dealer stands on all 17s, hard and soft — calling this
// out explicitly because a soft-17-hits ruleset is common elsewhere and
// changes the house edge; this MVP always stands.
export function dealerShouldHit(dealerCards: Card[]): boolean {
  return handValue(dealerCards).total < 17;
}
