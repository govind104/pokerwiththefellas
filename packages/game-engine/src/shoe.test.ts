import { describe, it, expect } from 'vitest';
import { createShoe } from './shoe';

describe('createShoe', () => {
  it('creates a shoe with deckCount * 52 cards', () => {
    const shoe = createShoe(6, () => 0.5);
    expect(shoe).toHaveLength(6 * 52);
  });

  it('contains exactly deckCount copies of each card', () => {
    const shoe = createShoe(6, () => 0.42);
    const counts = new Map<string, number>();
    for (const card of shoe) {
      const key = `${card.rank}-${card.suit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    for (const count of counts.values()) {
      expect(count).toBe(6);
    }
  });
});
