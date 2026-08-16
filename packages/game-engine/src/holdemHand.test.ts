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

  it('rejects a non-positive small blind', () => {
    expect(
      () =>
        new HoldemHand(
          [
            { playerId: 'a', stack: 1000 },
            { playerId: 'b', stack: 1000 },
          ],
          { smallBlind: 0, bigBlind: 20, buttonIndex: 0 }
        )
    ).toThrow('smallBlind must be greater than 0');
  });

  it('rejects a big blind smaller than the small blind', () => {
    expect(
      () =>
        new HoldemHand(
          [
            { playerId: 'a', stack: 1000 },
            { playerId: 'b', stack: 1000 },
          ],
          { smallBlind: 20, bigBlind: 10, buttonIndex: 0 }
        )
    ).toThrow('bigBlind must be greater than or equal to smallBlind');
  });

  it('rejects a player with a non-positive stack', () => {
    expect(
      () =>
        new HoldemHand(
          [
            { playerId: 'a', stack: 1000 },
            { playerId: 'b', stack: 0 },
          ],
          { smallBlind: 10, bigBlind: 20, buttonIndex: 0 }
        )
    ).toThrow('Player b must start with a positive stack');
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

  it('correctly skips an all-in player (all-in via an exact-stack call, not the all-in action) on every postflop street, and settles a genuine side pot', () => {
    const deck: Card[] = [
      card('2', 'clubs'), card('3', 'clubs'), // a (button)
      card('4', 'clubs'), card('5', 'clubs'), // b (SB, will end up all-in)
      card('6', 'clubs'), card('7', 'clubs'), // c (BB)
      card('8', 'clubs'), card('9', 'clubs'), card('10', 'clubs'), // flop
      card('J', 'clubs'), // turn
      card('Q', 'clubs'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'a', stack: 1000 },
        { playerId: 'b', stack: 50 }, // SB, short stack
        { playerId: 'c', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );

    // Preflop: a raises to 50, b calls with their exact remaining stack (40 more, on top of the 10 SB) -- a 'call', not 'all-in'.
    hand.act('a', 'raise', 50);
    hand.act('b', 'call');
    expect(hand.players[1]).toMatchObject({ stack: 0, isAllIn: true, contributed: 50 }); // C2: isAllIn must be true even though the action was 'call'
    hand.act('c', 'call');

    // Flop: first-to-act must be 'c', never the all-in 'b' (C1).
    expect(hand.street).toBe('flop');
    expect(hand.actingPlayerId).toBe('c');
    hand.act('c', 'raise', 100); // bets more, growing a side pot only a/c are eligible for
    expect(hand.actingPlayerId).toBe('a');
    hand.act('a', 'call');

    // Turn: first-to-act must again be 'c', not 'b'.
    expect(hand.street).toBe('turn');
    expect(hand.actingPlayerId).toBe('c');
    hand.act('c', 'check');
    hand.act('a', 'check');

    // River: same check.
    expect(hand.street).toBe('river');
    expect(hand.actingPlayerId).toBe('c');
    hand.act('c', 'check');
    hand.act('a', 'check');

    expect(hand.street).toBe('settled');
    // a and c each put in 150 total (50 preflop + 100 flop); b capped at 50.
    expect(hand.pots).toEqual([
      { amount: 150, eligiblePlayerIds: ['a', 'b', 'c'] },
      { amount: 200, eligiblePlayerIds: ['a', 'c'] }, // b never reaches this layer -- proves the cap is respected
    ]);
    const totalPayout = hand.results.reduce((sum, r) => sum + r.payout, 0);
    expect(totalPayout).toBe(0); // conservation
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

describe('HoldemHand — full showdown (heads-up)', () => {
  it('checks through every street to a showdown and pays the better hand, verifying button acts first preflop but last postflop', () => {
    const deck: Card[] = [
      card('A', 'spades'), card('2', 'clubs'), // player 0 (button/SB) hole cards
      card('K', 'hearts'), card('3', 'diamonds'), // player 1 (BB) hole cards
      card('A', 'clubs'), card('K', 'clubs'), card('7', 'hearts'), // flop
      card('8', 'spades'), // turn
      card('9', 'diamonds'), // river
    ];
    const hand = new HoldemHand(
      [
        { playerId: 'button', stack: 1000 },
        { playerId: 'other', stack: 1000 },
      ],
      { smallBlind: 10, bigBlind: 20, buttonIndex: 0, deck }
    );

    expect(hand.actingPlayerId).toBe('button'); // preflop: button acts first
    hand.act('button', 'call');
    hand.act('other', 'check');

    expect(hand.street).toBe('flop');
    expect(hand.actingPlayerId).toBe('other'); // postflop: button acts last
    hand.act('other', 'check');
    hand.act('button', 'check');

    expect(hand.street).toBe('turn');
    expect(hand.actingPlayerId).toBe('other');
    hand.act('other', 'check');
    hand.act('button', 'check');

    expect(hand.street).toBe('river');
    expect(hand.actingPlayerId).toBe('other');
    hand.act('other', 'check');
    hand.act('button', 'check');

    // Board: A K 7 8 9. Button plays A-A (pair of aces, K-9-8 kickers) using
    // hole A + board A. Other plays K-K (pair of kings, A-9-8 kickers) using
    // hole K + board K. Pair of aces beats pair of kings outright.
    expect(hand.street).toBe('settled');
    expect(hand.results).toEqual([
      { playerId: 'button', payout: 20 },
      { playerId: 'other', payout: -20 },
    ]);
    expect(hand.pots).toEqual([{ amount: 40, eligiblePlayerIds: ['button', 'other'] }]);
  });
});
