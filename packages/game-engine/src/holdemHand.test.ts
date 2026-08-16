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

describe('HoldemHand.act — betting rounds', () => {
  function threeHandedDeckWithFlop(): Card[] {
    return [
      card('2', 'clubs'), card('3', 'clubs'),
      card('4', 'clubs'), card('5', 'clubs'),
      card('6', 'clubs'), card('7', 'clubs'),
      card('8', 'clubs'), card('9', 'clubs'), card('10', 'clubs'), // flop
    ];
  }

  it('advances to the flop once everyone calls the big blind', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'call'); // button calls the BB
    hand.act('b', 'call'); // SB completes
    hand.act('c', 'check'); // BB checks, closing the round

    expect(hand.street).toBe('flop');
    expect(hand.communityCards).toEqual([card('8', 'clubs'), card('9', 'clubs'), card('10', 'clubs')]);
    expect(hand.actingPlayerId).toBe('b'); // first active player after the button, postflop
    for (const p of hand.players) {
      expect(p.streetContributed).toBe(0);
      expect(p.contributed).toBe(20);
    }
  });

  it('reopens action for players who already acted when a later player raises', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'raise', 60);
    hand.act('b', 'fold');
    hand.act('c', 'call');

    expect(hand.street).toBe('flop');
    expect(hand.players[0]).toMatchObject({ contributed: 60, streetContributed: 0 });
    expect(hand.players[1]).toMatchObject({ contributed: 10, folded: true });
    expect(hand.players[2]).toMatchObject({ contributed: 60, streetContributed: 0 });
  });

  it('ends the hand immediately when only one player remains, without dealing the flop', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'raise', 60);
    hand.act('b', 'fold');
    hand.act('c', 'fold');

    expect(hand.street).toBe('settled');
    expect(hand.communityCards).toEqual([]);
    expect(hand.actingPlayerId).toBeNull();
    expect(hand.results).toEqual([
      { playerId: 'a', payout: 30 }, // wins the 90-chip pot, having put in 60 of it
      { playerId: 'b', payout: -10 },
      { playerId: 'c', payout: -20 },
    ]);
    expect(hand.pots).toEqual([{ amount: 90, eligiblePlayerIds: ['a'] }]);
  });

  it('rejects an action from a player who is not up', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    expect(() => hand.act('b', 'call')).toThrow("It is not b's turn to act");
  });

  it('rejects checking while facing a bet, and raising below the minimum', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    expect(() => hand.act('a', 'check')).toThrow('Cannot check while facing a bet');
    expect(() => hand.act('a', 'raise', 30)).toThrow('Raise must be to at least 40');
  });

  it('rejects acting after the hand has settled', () => {
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 1000 },
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck: threeHandedDeckWithFlop() }
    );
    hand.act('a', 'raise', 60);
    hand.act('b', 'fold');
    hand.act('c', 'fold');
    expect(() => hand.act('a', 'check')).toThrow('Cannot act after the hand has settled');
  });
});

describe('HoldemHand.act — all-in runout', () => {
  it('deals every remaining street with no further betting once both players are all-in, and conserves chips', () => {
    // Enough cards for 2 hole-card pairs + 5 community cards.
    const deck: Card[] = [
      card('2', 'clubs'), card('3', 'clubs'),
      card('9', 'hearts'), card('9', 'spades'),
      card('4', 'diamonds'), card('5', 'diamonds'), card('6', 'diamonds'), // flop
      card('7', 'diamonds'), // turn
      card('8', 'diamonds'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 100 }, // button/SB, short stack
        { playerId: 'b', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );
    hand.act('a', 'all-in'); // shoves the rest of their stack (90 more, on top of the 10 SB)
    hand.act('b', 'call');

    expect(hand.street).toBe('settled');
    expect(hand.communityCards).toHaveLength(5);
    expect(hand.results).toHaveLength(2);
    const totalPayout = hand.results.reduce((sum, r) => sum + r.payout, 0);
    expect(totalPayout).toBe(0); // chips are conserved -- nothing created or destroyed
    expect(hand.players[0].stack).toBe(0);
  });
});

describe('HoldemHand construction — all-in from blinds', () => {
  it('skips the short-stacked button and starts action with the big blind, heads-up', () => {
    const deck: Card[] = [
      card('2', 'clubs'), card('3', 'clubs'),
      card('4', 'diamonds'), card('5', 'diamonds'),
      card('6', 'hearts'), card('7', 'hearts'), card('8', 'hearts'), // flop (unused unless this reaches showdown)
      card('9', 'spades'), // turn
      card('10', 'spades'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 10 }, // exactly the small blind -- posts all-in
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );
    expect(hand.players[0].isAllIn).toBe(true);
    expect(hand.actingPlayerId).toBe('other'); // not 'button' -- button can't act
  });

  it('deals straight through to showdown when every active player is already all-in from blinds', () => {
    const deck: Card[] = [
      card('A', 'spades'), card('K', 'spades'),
      card('2', 'hearts'), card('3', 'hearts'),
      card('4', 'clubs'), card('5', 'clubs'), card('6', 'diamonds'), // flop
      card('7', 'diamonds'), // turn
      card('8', 'diamonds'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 5 }, // less than the 10 small blind -- posts all-in for 5
        { playerId: 'other', stack: 8 }, // less than the 20 big blind -- posts all-in for 8
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );
    expect(hand.street).toBe('settled');
    expect(hand.communityCards).toHaveLength(5);
    expect(hand.actingPlayerId).toBeNull();
    const totalPayout = hand.results.reduce((sum, r) => sum + r.payout, 0);
    expect(totalPayout).toBe(0);
  });
});
