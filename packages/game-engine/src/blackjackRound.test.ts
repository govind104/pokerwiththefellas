import { describe, it, expect } from 'vitest';
import { BlackjackRound } from './blackjackRound';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

describe('BlackjackRound', () => {
  it('deals two cards to the player and two to the dealer', () => {
    const shoe = [card('7'), card('8'), card('2'), card('3'), card('9')];
    const round = new BlackjackRound(100, { shoe });
    expect(round.playerHands).toHaveLength(1);
    expect(round.playerHands[0].cards).toEqual([card('7'), card('8')]);
    expect(round.getDealerUpcard()).toEqual(card('2'));
    expect(round.phase).toBe('playing');
  });

  it('immediately settles a natural player blackjack without further action', () => {
    // Player: A, K (blackjack). Dealer: 9, 8 (17, stands).
    const shoe = [card('A'), card('K'), card('9'), card('8')];
    const round = new BlackjackRound(100, { shoe });
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'blackjack', payout: 150 }]);
  });

  it('lets the player hit, then settles once they stand', () => {
    // Player: 5, 4 (9) -> hits 6 (15) -> stands. Dealer: 10, 9 (19, stands).
    const shoe = [card('5'), card('4'), card('10'), card('9'), card('6')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(round.playerHands[0].cards).toEqual([card('5'), card('4'), card('6')]);
    expect(round.phase).toBe('playing');
    round.act('stand');
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'lose', payout: -100 }]);
  });

  it('busts the player on a hit that exceeds 21 and settles immediately without playing the dealer out', () => {
    // Player: 10, 9 (19) -> hits K -> busts. Dealer: 7, 6 — only 5 cards
    // in the shoe, so if the dealer tried to draw further this would throw.
    const shoe = [card('10'), card('9'), card('7'), card('6'), card('K')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'bust', payout: -100 }]);
    expect(round.getDealerCards()).toEqual([card('7'), card('6')]);
  });

  it('doubles the bet, draws exactly one card, and auto-stands', () => {
    // Player: 6, 5 (11) -> doubles, draws 10 -> 21. Dealer: 9, 8 (17, stands).
    const shoe = [card('6'), card('5'), card('9'), card('8'), card('10')];
    const round = new BlackjackRound(100, { shoe });
    round.act('double');
    expect(round.playerHands[0]).toMatchObject({ bet: 200, doubled: true, done: true });
    expect(round.playerHands[0].cards).toHaveLength(3);
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'win', payout: 200 }]);
  });

  it('rejects doubling once a hand has more than two cards', () => {
    const shoe = [card('5'), card('4'), card('9'), card('8'), card('2'), card('3')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(() => round.act('double')).toThrow('Can only double on the first two cards');
  });

  it('splits a pair into two independently-played hands and settles both', () => {
    // Player: 8, 8 -> split. New hand (index 1) draws first: 8,3 (11).
    // Original hand (index 0) draws next: 8,4 (12). Dealer: 9,6 (15) -> hits 5 -> 20.
    const shoe = [
      card('8'), card('8'), card('9'), card('6'), // initial deal
      card('3'), // new (split-off) hand's second card
      card('4'), // original hand's second card
      card('5'), // dealer hits to 20
    ];
    const round = new BlackjackRound(100, { shoe });
    round.act('split');
    expect(round.playerHands).toHaveLength(2);
    expect(round.playerHands[0].cards).toEqual([card('8'), card('4')]);
    expect(round.playerHands[1].cards).toEqual([card('8'), card('3')]);

    round.act('stand'); // stands hand 0 (12)
    expect(round.phase).toBe('playing'); // hand 1 is still active
    round.act('stand'); // stands hand 1 (11)

    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([
      { outcome: 'lose', payout: -100 },
      { outcome: 'lose', payout: -100 },
    ]);
  });

  it('auto-stands a hand that reaches a natural 21 immediately after a split', () => {
    // Player: A, A -> split. Original hand (index 0) draws K -> A,K = 21,
    // auto-stands without an explicit `stand` call. New hand (index 1)
    // draws 5 -> A,5 = 16, stays active. Dealer: 9,7 (16) -> hits 5 -> 21.
    const shoe = [card('A'), card('A'), card('9'), card('7'), card('5'), card('K'), card('5')];
    const round = new BlackjackRound(100, { shoe });

    round.act('split');
    expect(round.playerHands[0].cards).toEqual([card('A'), card('K')]);
    expect(round.playerHands[0].done).toBe(true);
    expect(round.playerHands[1].cards).toEqual([card('A'), card('5')]);
    expect(round.playerHands[1].done).toBe(false);
    expect(round.phase).toBe('playing'); // hand 1 is still active; hand 0 was auto-settled

    round.act('stand'); // stands hand 1 (16)

    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([
      { outcome: 'blackjack', payout: 150 }, // hand 0: A,K pays 3:2 per this codebase's documented split-21 simplification
      { outcome: 'lose', payout: -100 }, // hand 1: 16 loses to dealer's 21
    ]);
  });

  it('rejects splitting more than once per round', () => {
    const shoe = [card('8'), card('8'), card('9'), card('6'), card('3'), card('4')];
    const round = new BlackjackRound(100, { shoe });
    round.act('split');
    expect(() => round.act('split')).toThrow('Split already used this round');
  });

  it('rejects acting once the round has settled', () => {
    const shoe = [card('A'), card('K'), card('9'), card('8')];
    const round = new BlackjackRound(100, { shoe });
    expect(round.phase).toBe('settled');
    expect(() => round.act('stand')).toThrow('Cannot act while round is in phase "settled"');
  });

  it('player wins when the dealer busts while drawing to reach 17', () => {
    const shoe = [card('10'), card('9'), card('10'), card('6'), card('K')];
    const round = new BlackjackRound(100, { shoe });
    round.act('stand');
    expect(round.phase).toBe('settled');
    expect(round.getDealerCards()).toEqual([card('10'), card('6'), card('K')]);
    expect(round.results).toEqual([{ outcome: 'win', payout: 100 }]);
  });

  it('lets the player hit multiple times without busting before standing', () => {
    const shoe = [card('2'), card('3'), card('10'), card('9'), card('4'), card('5')];
    const round = new BlackjackRound(100, { shoe });
    round.act('hit');
    expect(round.playerHands[0].cards).toEqual([card('2'), card('3'), card('4')]);
    round.act('hit');
    expect(round.playerHands[0].cards).toEqual([card('2'), card('3'), card('4'), card('5')]);
    expect(round.phase).toBe('playing');
    round.act('stand');
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([{ outcome: 'lose', payout: -100 }]);
  });

  it('rejects splitting a hand that is not a pair', () => {
    const shoe = [card('8'), card('9'), card('10'), card('7')];
    const round = new BlackjackRound(100, { shoe });
    expect(() => round.act('split')).toThrow('Hand is not eligible to split');
  });

  it('allows doubling a two-card hand created by a split', () => {
    const shoe = [card('8'), card('8'), card('10'), card('9'), card('2'), card('3'), card('K')];
    const round = new BlackjackRound(100, { shoe });
    round.act('split');
    expect(round.playerHands[0].cards).toEqual([card('8'), card('3')]);
    expect(round.playerHands[1].cards).toEqual([card('8'), card('2')]);

    round.act('double'); // doubles hand 0, the currently active hand
    expect(round.playerHands[0]).toMatchObject({ bet: 200, doubled: true, done: true });
    expect(round.playerHands[0].cards).toEqual([card('8'), card('3'), card('K')]);
    expect(round.phase).toBe('playing'); // hand 1 is still active

    round.act('stand');
    expect(round.phase).toBe('settled');
    expect(round.results).toEqual([
      { outcome: 'win', payout: 200 },
      { outcome: 'lose', payout: -100 },
    ]);
  });
});
