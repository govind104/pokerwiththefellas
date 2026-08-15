import { Card } from './deck';
import { cardValue } from './handValue';

export function canSplit(cards: Card[]): boolean {
  return cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);
}
