import { describe, it, expect } from 'vitest';
import { handValue, isBlackjack, isBust, cardValue } from './handValue';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('handValue', () => {
  it('sums a hard hand with no aces', () => {
    expect(handValue([card('10'), card('7')])).toEqual({ total: 17, isSoft: false });
  });

  it('treats a single ace as 11 when it fits', () => {
    expect(handValue([card('A'), card('6')])).toEqual({ total: 17, isSoft: true });
  });

  it('drops an ace to 1 when 11 would bust the hand', () => {
    expect(handValue([card('A'), card('6'), card('9')])).toEqual({ total: 16, isSoft: false });
  });

  it('handles two aces correctly', () => {
    expect(handValue([card('A'), card('A'), card('9')])).toEqual({ total: 21, isSoft: true });
  });

  it('handles three aces correctly', () => {
    expect(handValue([card('A'), card('A'), card('A'), card('8')])).toEqual({ total: 21, isSoft: true });
  });
});

describe('isBlackjack', () => {
  it('is true for an ace + ten-value card as the starting two cards', () => {
    expect(isBlackjack([card('A'), card('K')])).toBe(true);
  });

  it('is false for 21 made with more than two cards', () => {
    expect(isBlackjack([card('7'), card('7'), card('7')])).toBe(false);
  });
});

describe('isBust', () => {
  it('is true when total exceeds 21', () => {
    expect(isBust([card('K'), card('Q'), card('5')])).toBe(true);
  });

  it('is false at 21 or under', () => {
    expect(isBust([card('K'), card('Q')])).toBe(false);
  });
});

describe('cardValue', () => {
  it('values an ace at 11', () => {
    expect(cardValue('A')).toBe(11);
  });
  it('values face cards at 10', () => {
    expect(cardValue('K')).toBe(10);
    expect(cardValue('Q')).toBe(10);
    expect(cardValue('J')).toBe(10);
  });
  it('values numeric ranks at their face value', () => {
    expect(cardValue('7')).toBe(7);
    expect(cardValue('10')).toBe(10);
  });
});
