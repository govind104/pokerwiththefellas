import type { BlackjackRoundView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card, PlayerHand } from '@poker-blackjack/game-engine';
import { MY_SLOT, OTHER_SLOTS, buildSceneModel, chipsFor } from './sceneModel';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const hand = (cards: Card[], bet = 25): PlayerHand => ({ cards, bet, doubled: false, done: false });

function seats(names: (string | null)[]): SeatView[] {
  return names.map((displayName, seatIndex) => ({
    seatIndex,
    displayName,
    balance: 1000,
    connected: true,
    ready: true,
  }));
}

function round(over: Partial<BlackjackRoundView> = {}): BlackjackRoundView {
  return {
    phase: 'playing',
    playerHands: [hand([c('7', 'diamonds'), c('4', 'clubs')])],
    dealerUpcard: c('K', 'spades'),
    dealerCards: null,
    results: null,
    ...over,
  };
}

describe('buildSceneModel', () => {
  it('puts the local player in the near slot and everyone else on the far arc, relative to them', () => {
    const model = buildSceneModel({
      seats: seats(['a', 'b', 'c', 'd']),
      activeSeatIndex: null,
      mySeatIndex: 2,
      blackjackRounds: null,
    });
    const angle = (name: string) => model.seats.find((s) => s.name === name)?.angle;
    expect(angle('c')).toBe(MY_SLOT);
    // Relative order from seat 2: d(3), a(0), b(1)
    expect(angle('d')).toBe(OTHER_SLOTS[0]);
    expect(angle('a')).toBe(OTHER_SLOTS[1]);
    expect(angle('b')).toBe(OTHER_SLOTS[2]);
  });

  it('gives a spectator no avatar of their own but seats the first player in the near slot', () => {
    const model = buildSceneModel({
      seats: seats(['a', 'b']),
      activeSeatIndex: null,
      mySeatIndex: null,
      blackjackRounds: null,
    });
    expect(model.seats.map((s) => s.isMe)).toEqual([false, false]);
    expect(model.seats[0].angle).toBe(MY_SLOT);
    expect(model.seats[1].angle).toBe(OTHER_SLOTS[0]);
  });

  it('shows the dealer hole card face-down until the dealer hand is revealed, with stable keys', () => {
    const before = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: 0,
      mySeatIndex: 0,
      blackjackRounds: { 0: round() },
    });
    const dealerBefore = before.cards.filter((k) => k.key.startsWith('d:'));
    expect(dealerBefore.map((k) => k.card)).toEqual([c('K', 'spades'), null]);

    const after = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: null,
      mySeatIndex: 0,
      blackjackRounds: {
        0: round({ phase: 'dealer', dealerCards: [c('K', 'spades'), c('7', 'hearts'), c('2', 'clubs')] }),
      },
    });
    const dealerAfter = after.cards.filter((k) => k.key.startsWith('d:'));
    expect(dealerAfter.map((k) => k.key)).toEqual(['d:0', 'd:1', 'd:2']);
    expect(dealerAfter[1].card).toEqual(c('7', 'hearts'));
    expect(after.dealerActive).toBe(true);
  });

  it('keeps existing card keys when a hit adds a card (so it animates as a deal, not a rebuild)', () => {
    const mk = (cards: Card[]) =>
      buildSceneModel({
        seats: seats(['a']),
        activeSeatIndex: 0,
        mySeatIndex: 0,
        blackjackRounds: { 0: round({ playerHands: [hand(cards)] }) },
      }).cards.filter((k) => k.key.startsWith('s0:'));
    const two = mk([c('7', 'diamonds'), c('4', 'clubs')]);
    const three = mk([c('7', 'diamonds'), c('4', 'clubs'), c('9', 'spades')]);
    expect(two.map((k) => k.key)).toEqual(['s0:h0:c0', 's0:h0:c1']);
    expect(three.map((k) => k.key)).toEqual(['s0:h0:c0', 's0:h0:c1', 's0:h0:c2']);
    expect(three[2].order).toBe(2);
  });

  it('emits one bet stack per hand and outcome labels only once the round is settled', () => {
    const split = [hand([c('8', 'hearts'), c('3', 'clubs')], 25), hand([c('8', 'spades'), c('5', 'clubs')], 25)];
    const playing = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: 0,
      mySeatIndex: 0,
      blackjackRounds: { 0: round({ playerHands: split }) },
    });
    expect(playing.chips.map((k) => k.key)).toEqual(['bet:0:h0', 'bet:0:h1']);
    expect(playing.outcomes).toEqual([]);

    const settled = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: null,
      mySeatIndex: 0,
      blackjackRounds: {
        0: round({
          phase: 'settled',
          playerHands: split,
          dealerCards: [c('K', 'spades'), c('7', 'hearts')],
          results: [
            { outcome: 'win', payout: 25 },
            { outcome: 'bust', payout: -25 },
          ],
        }),
      },
    });
    expect(settled.outcomes.map((o) => [o.text, o.polarity])).toEqual([
      ['Win', 'win'],
      ['Bust', 'lose'],
    ]);
  });

  it('reports myTurn only for the active local seat and uses the same status wording as the 2D table', () => {
    const rounds = { 0: round(), 1: round() };
    const base = { seats: seats(['a', 'b']), blackjackRounds: rounds };
    const mine = buildSceneModel({ ...base, activeSeatIndex: 0, mySeatIndex: 0 });
    expect(mine.myTurn).toBe(true);
    expect(mine.seats[0].status).toBe('Your turn');
    expect(mine.seats[1].status).toBe('Bet 25');
    const theirs = buildSceneModel({ ...base, activeSeatIndex: 1, mySeatIndex: 0 });
    expect(theirs.myTurn).toBe(false);
    expect(theirs.seats[1].status).toBe('Thinking…');
  });

  it('skips empty chairs', () => {
    const model = buildSceneModel({
      seats: seats(['a', null, 'c']),
      activeSeatIndex: null,
      mySeatIndex: 0,
      blackjackRounds: null,
    });
    expect(model.seats.map((s) => s.name)).toEqual(['a', 'c']);
    expect(model.hasRound).toBe(false);
  });
});

describe('chipsFor', () => {
  it('breaks a bet into the fewest chips, largest first', () => {
    expect(chipsFor(0)).toEqual([]);
    expect(chipsFor(25)).toEqual([25]);
    expect(chipsFor(130)).toEqual([100, 25, 5]);
    expect(chipsFor(7)).toEqual([5, 1, 1]);
  });

  it('caps the stack height for huge bets', () => {
    expect(chipsFor(1_000_000).length).toBeLessThanOrEqual(14);
  });
});
