import { describe, it, expect } from 'vitest';
import { HoldemHand } from './holdemHand';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

// 8 cards is enough for 3 players' hole cards (6) plus 2 spare, ordered so
// dealing (2 cards per player, in player order) is easy to trace by hand.
function threeHandedDeck(): Card[] {
  return [
    card('2', 'clubs'), card('3', 'clubs'), // player 0's hole cards
    card('4', 'clubs'), card('5', 'clubs'), // player 1's hole cards
    card('6', 'clubs'), card('7', 'clubs'), // player 2's hole cards
    card('8', 'clubs'), card('9', 'clubs'),
  ];
}

describe('HoldemHand construction — 3+ handed', () => {
  it('deals two hole cards to each player in seat order', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[0].holeCards).toEqual([card('2', 'clubs'), card('3', 'clubs')]);
    expect(hand.players[1].holeCards).toEqual([card('4', 'clubs'), card('5', 'clubs')]);
    expect(hand.players[2].holeCards).toEqual([card('6', 'clubs'), card('7', 'clubs')]);
  });

  it('posts small blind at button+1 and big blind at button+2', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[0]).toMatchObject({ stack: 1000, streetContributed: 0, contributed: 0 });
    expect(hand.players[1]).toMatchObject({ stack: 990, streetContributed: 10, contributed: 10 });
    expect(hand.players[2]).toMatchObject({ stack: 980, streetContributed: 20, contributed: 20 });
  });

  it('sets first-to-act preflop to the player after the big blind (the button, in 3-handed)', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    // n=3, button=0, sb=1, bb=2, first-to-act = (bb+1)%3 = 0 = the button itself,
    // since there's nobody else left between BB and the button in 3-handed play.
    expect(hand.actingPlayerId).toBe('a');
  });

  it('lets a short-stacked player post a blind all-in for less', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 5 }, // posts small blind (10) but only has 5
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[1]).toMatchObject({ stack: 0, streetContributed: 5, contributed: 5, isAllIn: true });
  });

  it('marks a player all-in when a blind post exactly exhausts their stack', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 10 }, // posts small blind (10), exactly matching their stack
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeck() }
    );
    expect(hand.players[1]).toMatchObject({ stack: 0, streetContributed: 10, contributed: 10, isAllIn: true });
  });

  it('rejects fewer than 2 or more than 8 players', () => {
    expect(
      () =>
        new HoldemHand([{ playerId: 'solo', stack: 1000 }], {
          smallBlind: 10,
          bigBlind: 20,
          buttonIndex: 0,
        })
    ).toThrow("Hold'em requires between 2 and 8 players");
  });

  it('rejects a buttonIndex out of range', () => {
    expect(
      () =>
        new HoldemHand(
          [
            { playerId: 'a', stack: 1000 },
            { playerId: 'b', stack: 1000 },
          ],
          { smallBlind: 10, bigBlind: 20, buttonIndex: 5 }
        )
    ).toThrow('buttonIndex out of range');
  });
});

describe('HoldemHand construction — heads-up', () => {
  function headsUpDeck(): Card[] {
    return [card('A', 'spades'), card('K', 'spades'), card('2', 'hearts'), card('3', 'hearts')];
  }

  it('makes the button post the small blind and the other player post the big blind', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 1000 },
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: headsUpDeck() }
    );
    expect(hand.players[0]).toMatchObject({ streetContributed: 10, contributed: 10 });
    expect(hand.players[1]).toMatchObject({ streetContributed: 20, contributed: 20 });
  });

  it('makes the button act first preflop', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 1000 },
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: headsUpDeck() }
    );
    expect(hand.actingPlayerId).toBe('button');
  });
});
