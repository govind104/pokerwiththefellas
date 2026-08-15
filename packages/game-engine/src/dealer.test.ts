import { describe, it, expect } from 'vitest';
import { dealerShouldHit } from './dealer';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('dealerShouldHit', () => {
  it('hits below 17', () => {
    expect(dealerShouldHit([card('9'), card('6')])).toBe(true);
  });

  it('stands on a hard 17', () => {
    expect(dealerShouldHit([card('10'), card('7')])).toBe(false);
  });

  it('stands on a soft 17', () => {
    expect(dealerShouldHit([card('A'), card('6')])).toBe(false);
  });

  it('stands above 17', () => {
    expect(dealerShouldHit([card('10'), card('9')])).toBe(false);
  });
});
