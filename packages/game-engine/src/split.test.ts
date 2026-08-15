import { describe, it, expect } from 'vitest';
import { canSplit } from './split';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('canSplit', () => {
  it('allows splitting a matching pair', () => {
    expect(canSplit([card('8'), card('8', 'hearts')])).toBe(true);
  });

  it('allows splitting two different ten-value cards', () => {
    expect(canSplit([card('K'), card('10', 'hearts')])).toBe(true);
  });

  it('rejects a non-matching hand', () => {
    expect(canSplit([card('8'), card('9')])).toBe(false);
  });

  it('rejects hands that already have more than two cards', () => {
    expect(canSplit([card('8'), card('8', 'hearts'), card('2')])).toBe(false);
  });
});
