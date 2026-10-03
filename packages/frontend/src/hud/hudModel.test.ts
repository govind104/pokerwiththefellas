import { describe, expect, it } from 'vitest';
import type { BlackjackRoundView, HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card } from '@poker-blackjack/game-engine';
import {
  NO_BLINDS,
  blackjackTotal,
  buildBlackjackHud,
  buildHoldemHud,
  canLeaveBlackjack,
  canLeaveHoldem,
  fitScale,
  tableOrder,
} from './hudModel';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const seat = (seatIndex: number, displayName: string | null, extra: Partial<SeatView> = {}): SeatView => ({
  seatIndex,
  displayName,
  balance: 1000,
  connected: true,
  ready: true,
  ...extra,
});
type P = HoldemView['players'][number];
const pl = (playerId: string, stack: number, streetContributed: number, holeCards: P['holeCards'], extra: Partial<P> = {}): P => ({
  playerId,
  stack,
  streetContributed,
  folded: false,
  isAllIn: false,
  holeCards,
  ...extra,
});
function holdem(over: Partial<HoldemView> = {}): HoldemView {
  return {
    street: 'flop',
    communityCards: [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts')],
    actingPlayerId: 'alice',
    pots: [],
    results: null,
    players: [pl('alice', 980, 0, [c('A', 'spades'), c('K', 'hearts')]), pl('bob', 940, 40, null)],
    ...over,
  };
}

describe('tableOrder', () => {
  it('lists the others clockwise after you, and you last', () => {
    const s = [0, 1, 2, 3].map((i) => ({ seatIndex: i }));
    expect(tableOrder(s, 1, 4).map((x) => x.seatIndex)).toEqual([2, 3, 0, 1]);
    expect(tableOrder(s, null, 4).map((x) => x.seatIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe('buildHoldemHud', () => {
  const seats = [seat(0, 'alice'), seat(1, 'bob'), seat(2, null)];

  it('shows readiness and no panel between hands', () => {
    const m = buildHoldemHud({
      seats: [seat(0, 'alice', { ready: false }), seat(1, 'bob', { connected: false })],
      mySeatIndex: 0,
      holdem: null,
      blinds: NO_BLINDS,
    });
    expect(m.panel).toBeNull();
    expect(m.rows.map((r) => [r.name, r.status])).toEqual([
      ['bob', 'Disconnected'],
      ['alice', 'Not ready'],
    ]);
  });

  it('fills rows mid-hand: turn, bets, badges, my cards only, live stack', () => {
    const m = buildHoldemHud({
      seats,
      mySeatIndex: 0,
      holdem: holdem(),
      blinds: { buttonSeatIndex: 0, smallBlindSeatIndex: 0, bigBlindSeatIndex: 1 },
    });
    const [bob, me] = m.rows;
    expect(me).toMatchObject({ name: 'alice', isMe: true, isActive: true, status: 'Your turn', tone: 'turn', balance: 980, bet: null, badges: ['D', 'SB'] });
    expect(me.groups).toEqual([{ cards: [c('A', 'spades'), c('K', 'hearts')], total: null }]);
    expect(bob).toMatchObject({ status: 'Waiting', bet: 40, badges: ['BB'], groups: [] });
    expect(m.panel).toEqual({
      kind: 'holdem',
      board: [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts'), null, null],
      street: 'Flop',
      pot: 80,
    });
  });

  it('marks folded, all-in and not-dealt-in seats', () => {
    const m = buildHoldemHud({
      seats: [seat(0, 'alice'), seat(1, 'bob'), seat(2, 'cara'), seat(3, 'dan')],
      mySeatIndex: 0,
      holdem: holdem({
        actingPlayerId: 'alice',
        players: [
          pl('alice', 980, 0, [c('A', 'spades'), c('K', 'hearts')]),
          pl('bob', 1000, 0, null, { folded: true }),
          pl('cara', 0, 0, null, { isAllIn: true }),
        ],
      }),
      blinds: NO_BLINDS,
    });
    const byName = Object.fromEntries(m.rows.map((r) => [r.name, r]));
    expect(byName.bob).toMatchObject({ status: 'Folded', dimmed: true });
    expect(byName.cara).toMatchObject({ status: 'All-in' });
    expect(byName.dan).toMatchObject({ status: 'Not in this hand' });
  });

  it('shows hand names, results and the winner at a showdown', () => {
    const m = buildHoldemHud({
      seats,
      mySeatIndex: 0,
      holdem: holdem({
        street: 'settled',
        actingPlayerId: null,
        pots: [{ amount: 300, eligiblePlayerIds: ['alice', 'bob'] }],
        players: [pl('alice', 1150, 0, [c('A', 'spades'), c('K', 'hearts')]), pl('bob', 850, 0, [c('Q', 'clubs'), c('Q', 'diamonds')])],
        results: [
          { playerId: 'alice', payout: 150, handName: "Two Pair, A's & Q's", bestCards: [] },
          { playerId: 'bob', payout: -150, handName: "Three of a Kind, Q's", bestCards: [] },
        ],
      }),
      blinds: NO_BLINDS,
    });
    const [bob, me] = m.rows;
    expect(me).toMatchObject({ status: 'Won 150', tone: 'win', won: true, handName: "Two Pair, A's & Q's", balance: 1000 });
    expect(bob).toMatchObject({ status: 'Lost 150', tone: 'lose', won: false, handName: "Three of a Kind, Q's" });
    expect(bob.groups[0].cards).toEqual([c('Q', 'clubs'), c('Q', 'diamonds')]);
    expect(m.panel).toMatchObject({ street: 'Showdown', pot: 300 });
  });
});

describe('blackjackTotal', () => {
  it('counts aces soft until they would bust', () => {
    expect(blackjackTotal([c('A', 'clubs'), c('6', 'diamonds')])).toEqual({ total: 17, soft: true });
    expect(blackjackTotal([c('A', 'clubs'), c('6', 'diamonds'), c('9', 'spades')])).toEqual({ total: 16, soft: false });
    expect(blackjackTotal([c('K', 'clubs'), c('Q', 'diamonds')])).toEqual({ total: 20, soft: false });
  });
});

describe('buildBlackjackHud', () => {
  const hand = (cards: Card[], bet: number, done = false) => ({ cards, bet, doubled: false, done });
  const round = (over: Partial<BlackjackRoundView> = {}): BlackjackRoundView => ({
    phase: 'playing',
    playerHands: [hand([c('7', 'diamonds'), c('4', 'clubs')], 25)],
    dealerUpcard: c('K', 'spades'),
    dealerCards: null,
    results: null,
    ...over,
  });

  it('shows totals, turn and the dealer upcard with a face-down card', () => {
    const m = buildBlackjackHud({
      seats: [seat(0, 'you'), seat(1, 'ana')],
      mySeatIndex: 0,
      activeSeatIndex: 1,
      handInProgress: true,
      blackjackRounds: { 0: round(), 1: round({ playerHands: [hand([c('A', 'clubs'), c('6', 'diamonds')], 50)] }) },
    });
    const [ana, me] = m.rows;
    expect(ana).toMatchObject({ status: 'Thinking…', tone: 'turn', bet: 50 });
    expect(ana.groups).toEqual([{ cards: [c('A', 'clubs'), c('6', 'diamonds')], total: 'soft 17' }]);
    expect(me).toMatchObject({ status: 'Waiting', bet: 25 });
    expect(m.panel).toEqual({ kind: 'blackjack', cards: [c('K', 'spades'), null], total: '10 + ?' });
  });

  it('shows Stood / Bust once every hand is done, and results once settled', () => {
    const done = buildBlackjackHud({
      seats: [seat(0, 'you')],
      mySeatIndex: 0,
      activeSeatIndex: null,
      handInProgress: true,
      blackjackRounds: {
        0: round({ playerHands: [hand([c('10', 'clubs'), c('9', 'clubs')], 25, true), hand([c('10', 'hearts'), c('5', 'hearts'), c('9', 'spades')], 25, true)] }),
      },
    });
    expect(done.rows[0].status).toBe('Stood / Bust');
    expect(done.rows[0].groups).toHaveLength(2);

    const settled = buildBlackjackHud({
      seats: [seat(0, 'you')],
      mySeatIndex: 0,
      activeSeatIndex: null,
      handInProgress: false,
      blackjackRounds: {
        0: round({
          phase: 'settled',
          dealerCards: [c('K', 'spades'), c('7', 'hearts')],
          results: [{ outcome: 'win', payout: 25 }],
        }),
      },
    });
    expect(settled.rows[0]).toMatchObject({ status: 'Win +25', tone: 'win' });
    expect(settled.panel).toEqual({ kind: 'blackjack', cards: [c('K', 'spades'), c('7', 'hearts')], total: '17' });
  });

  it('says Not in this hand for a seat dealt out mid-hand, readiness otherwise', () => {
    const m = buildBlackjackHud({
      seats: [seat(0, 'you'), seat(1, 'late', { ready: false })],
      mySeatIndex: 0,
      activeSeatIndex: 0,
      handInProgress: true,
      blackjackRounds: { 0: round() },
    });
    expect(m.rows[0]).toMatchObject({ name: 'late', status: 'Not in this hand', bet: null });
    const idle = buildBlackjackHud({ seats: [seat(0, 'you', { ready: false })], mySeatIndex: 0, activeSeatIndex: null, handInProgress: false, blackjackRounds: null });
    expect(idle.rows[0].status).toBe('Not ready');
    expect(idle.panel).toBeNull();
  });
});

describe('leave rules (mirror Table.leave / isDealtIn)', () => {
  it('Hold’em: always between hands; mid-hand only if not dealt in', () => {
    const seats = [seat(0, 'alice'), seat(1, 'bob'), seat(2, 'cara')];
    expect(canLeaveHoldem(false, seats, 0, holdem())).toBe(true);
    expect(canLeaveHoldem(true, seats, 0, holdem())).toBe(false);
    expect(canLeaveHoldem(true, seats, 2, holdem())).toBe(true);
    expect(canLeaveHoldem(true, seats, null, holdem())).toBe(false);
  });

  it('Blackjack: always between hands; mid-hand only without a round', () => {
    const r = { 0: {} as BlackjackRoundView };
    expect(canLeaveBlackjack(false, 0, r)).toBe(true);
    expect(canLeaveBlackjack(true, 0, r)).toBe(false);
    expect(canLeaveBlackjack(true, 1, r)).toBe(true);
    expect(canLeaveBlackjack(true, null, r)).toBe(false);
  });
});

describe('fitScale', () => {
  it('shrinks only when the content is taller than the space', () => {
    expect(fitScale(100, 200)).toBe(1);
    expect(fitScale(200, 100)).toBe(0.5);
    expect(fitScale(0, 100)).toBe(1);
  });
});
