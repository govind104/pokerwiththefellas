import { describe, it, expect } from 'vitest';
import { createDeck, shuffle } from './deck';

describe('createDeck', () => {
  it('creates 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map((c) => `${c.rank}-${c.suit}`));
    expect(unique.size).toBe(52);
  });
});

describe('shuffle', () => {
  it('preserves all cards, only reorders them', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, () => 0.5);
    expect(shuffled).toHaveLength(52);
    const originalKeys = deck.map((c) => `${c.rank}-${c.suit}`).sort();
    const shuffledKeys = shuffled.map((c) => `${c.rank}-${c.suit}`).sort();
    expect(shuffledKeys).toEqual(originalKeys);
  });

  it('is deterministic given a fixed random function', () => {
    const deck = createDeck();
    let seed = 0;
    const fixedRandom = () => {
      seed = (seed + 0.137) % 1;
      return seed;
    };
    seed = 0;
    const shuffledA = shuffle(deck, fixedRandom);
    seed = 0;
    const shuffledB = shuffle(deck, fixedRandom);
    expect(shuffledA).toEqual(shuffledB);
  });
});
