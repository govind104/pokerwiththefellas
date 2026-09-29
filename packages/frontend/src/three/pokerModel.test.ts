import type { HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card } from '@poker-blackjack/game-engine';
import { MY_SLOT } from './sceneModel';
import { POKER_OTHER_SLOTS, actingSeatIndex, buildPokerModel } from './pokerModel';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
type P = HoldemView['players'][number];

const player = (playerId: string, over: Partial<P> = {}): P => ({
  playerId,
  stack: 990,
  streetContributed: 0,
  folded: false,
  isAllIn: false,
  holeCards: null,
  ...over,
});

function seats(names: (string | null)[]): SeatView[] {
  return names.map((displayName, seatIndex) => ({ seatIndex, displayName, balance: 1000, connected: true, ready: true }));
}

function hand(over: Partial<HoldemView> = {}): HoldemView {
  return {
    street: 'preflop',
    communityCards: [],
    actingPlayerId: 'a',
    pots: [{ amount: 15, eligiblePlayerIds: ['a', 'b', 'c'] }],
    results: null,
    players: [
      player('a', { holeCards: [c('A', 'spades'), c('K', 'hearts')], streetContributed: 10 }),
      player('b', { streetContributed: 5 }),
      player('c'),
    ],
    ...over,
  };
}

describe('buildPokerModel', () => {
  it('has no dealer figure and no pot before a hand starts', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b']), mySeatIndex: 0, holdem: null });
    expect(m.kind).toBe('holdem');
    expect(m.dealerFigure).toBe(false);
    expect(m.pot).toBeNull();
    expect(m.hasRound).toBe(false);
    expect(m.seats.map((s) => s.status)).toEqual(['Ready', 'Ready']);
  });

  it('seats the far-centre chair for a fifth opponent since there is no dealer there', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c', 'd', 'e', 'f']), mySeatIndex: 0, holdem: null });
    expect(m.seats[0].angle).toBe(MY_SLOT);
    expect(m.seats.slice(1).map((s) => s.angle)).toEqual(POKER_OTHER_SLOTS);
    expect(POKER_OTHER_SLOTS).toContain(0);
  });

  it('shows my hole cards face-up and everyone else\'s face-down, with stable keys', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: hand() });
    const hole = (seat: number) => m.cards.filter((k) => k.key.startsWith(`h:${seat}:`));
    expect(hole(0).map((k) => k.card)).toEqual([c('A', 'spades'), c('K', 'hearts')]);
    expect(hole(1).map((k) => k.card)).toEqual([null, null]);
    expect(hole(2).map((k) => k.key)).toEqual(['h:2:0', 'h:2:1']);
  });

  it('turns opponents\' cards over when the server reveals them, keeping the same keys (so they flip)', () => {
    const h = hand({
      street: 'settled',
      actingPlayerId: null,
      players: [
        player('a', { holeCards: [c('A', 'spades'), c('K', 'hearts')] }),
        player('b', { holeCards: [c('Q', 'clubs'), c('Q', 'diamonds')] }),
        player('c', { folded: true }),
      ],
      results: [
        { playerId: 'a', payout: 20 },
        { playerId: 'b', payout: -20 },
      ],
    });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    expect(m.cards.filter((k) => k.key.startsWith('h:1:')).map((k) => k.card)).toEqual([c('Q', 'clubs'), c('Q', 'diamonds')]);
    // Folded players have no cards on the table.
    expect(m.cards.some((k) => k.key.startsWith('h:2:'))).toBe(false);
  });

  it('lays out community cards left to right and totals every pot into one stack', () => {
    const h = hand({
      street: 'flop',
      communityCards: [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts')],
      pots: [
        { amount: 60, eligiblePlayerIds: ['a', 'b'] },
        { amount: 20, eligiblePlayerIds: ['a'] },
      ],
    });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    const cc = m.cards.filter((k) => k.key.startsWith('cc:'));
    expect(cc.map((k) => k.key)).toEqual(['cc:0', 'cc:1', 'cc:2']);
    expect(cc[0].x).toBeLessThan(cc[1].x);
    expect(cc[1].x).toBeLessThan(cc[2].x);
    expect(m.pot?.amount).toBe(80);
    expect(m.chips.find((k) => k.key === 'pot')?.amount).toBe(80);
  });

  it('emits a bet stack only for players who have money in this street', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: hand() });
    expect(m.chips.filter((k) => k.key.startsWith('bet:')).map((k) => [k.key, k.amount])).toEqual([
      ['bet:0', 10],
      ['bet:1', 5],
    ]);
  });

  it('uses the same status wording as the 2D rail', () => {
    const h = hand({
      actingPlayerId: 'b',
      players: [player('a', { holeCards: [c('A', 'spades'), c('K', 'hearts')] }), player('b'), player('c', { folded: true })],
    });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    expect(m.seats.map((s) => s.status)).toEqual(['Waiting', 'Thinking…', 'Folded']);
    expect(m.myTurn).toBe(false);
    const mine = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: hand() });
    expect(mine.myTurn).toBe(true);
    expect(mine.seats[0].status).toBe('Your turn');
  });

  it('reports results on plates for everyone and a floating label only for the local player', () => {
    const h = hand({
      street: 'settled',
      actingPlayerId: null,
      results: [
        { playerId: 'a', payout: 30 },
        { playerId: 'b', payout: -30 },
        { playerId: 'c', payout: 0 },
      ],
    });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    expect(m.seats.map((s) => s.status)).toEqual(['Won 30', 'Lost 30', 'Push']);
    expect(m.outcomes.map((o) => [o.text, o.polarity])).toEqual([['Won 30', 'win']]);
  });
});

describe('actingSeatIndex', () => {
  it('maps the acting player id to its seat', () => {
    expect(actingSeatIndex(seats(['a', 'b']), hand({ actingPlayerId: 'b' }))).toBe(1);
    expect(actingSeatIndex(seats(['a', 'b']), null)).toBeNull();
    expect(actingSeatIndex(seats(['a', 'b']), hand({ actingPlayerId: null }))).toBeNull();
  });
});
