import { Card, Rank } from './deck';

export interface HandValue {
  total: number;
  isSoft: boolean;
}

export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export function handValue(cards: Card[]): HandValue {
  let total = cards.reduce((sum, c) => sum + cardValue(c.rank), 0);
  let aceCount = cards.filter((c) => c.rank === 'A').length;

  let isSoft = aceCount > 0;
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }
  if (aceCount === 0) {
    isSoft = false;
  }

  return { total, isSoft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}
