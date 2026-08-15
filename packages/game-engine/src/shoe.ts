import { Card, RandomFn, createDeck, shuffle } from './deck';

export function createShoe(deckCount: number, random: RandomFn = Math.random): Card[] {
  let cards: Card[] = [];
  for (let i = 0; i < deckCount; i++) {
    cards = cards.concat(createDeck());
  }
  return shuffle(cards, random);
}
