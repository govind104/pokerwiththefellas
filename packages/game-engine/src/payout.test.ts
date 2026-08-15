import { describe, it, expect } from 'vitest';
import { resolveHand } from './payout';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('resolveHand', () => {
  it('pays 3:2 for a player blackjack against a non-blackjack dealer', () => {
    expect(resolveHand([card('A'), card('K')], [card('9'), card('8')], 100)).toEqual({
      outcome: 'blackjack',
      payout: 150,
    });
  });

  it('pushes when both player and dealer have blackjack', () => {
    expect(resolveHand([card('A'), card('K')], [card('A'), card('Q')], 100)).toEqual({
      outcome: 'push',
      payout: 0,
    });
  });

  it('player loses to a dealer blackjack', () => {
    expect(resolveHand([card('9'), card('8')], [card('A'), card('Q')], 100)).toEqual({
      outcome: 'lose',
      payout: -100,
    });
  });

  it('player busts regardless of dealer hand', () => {
    expect(resolveHand([card('K'), card('Q'), card('5')], [card('9'), card('8')], 100)).toEqual({
      outcome: 'bust',
      payout: -100,
    });
  });

  it('player wins when dealer busts and player did not', () => {
    expect(resolveHand([card('9'), card('8')], [card('K'), card('Q'), card('5')], 100)).toEqual({
      outcome: 'win',
      payout: 100,
    });
  });

  it('player wins with a higher total than the dealer', () => {
    expect(resolveHand([card('10'), card('9')], [card('10'), card('7')], 100)).toEqual({
      outcome: 'win',
      payout: 100,
    });
  });

  it('player loses with a lower total than the dealer', () => {
    expect(resolveHand([card('10'), card('7')], [card('10'), card('9')], 100)).toEqual({
      outcome: 'lose',
      payout: -100,
    });
  });

  it('pushes on equal totals', () => {
    expect(resolveHand([card('10'), card('8')], [card('9'), card('9')], 100)).toEqual({
      outcome: 'push',
      payout: 0,
    });
  });
});
