import type { HoldemView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card } from '@poker-blackjack/game-engine';
import { actingSeatIndex, amountToCall, buildPokerModel, livePot } from './pokerModel';

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
  it('has no felt rings and no pot before a hand starts', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b']), mySeatIndex: 0, holdem: null });
    expect(m.kind).toBe('holdem');
    expect(m.felt).toEqual({ kind: 'holdem', rings: [] });
    expect(m.pot).toBeNull();
    expect(m.hasRound).toBe(false);
    expect(m.seats.map((s) => s.status)).toEqual(['Ready', 'Ready']);
  });

  it('spreads seats evenly round the whole table: me at the bottom, then left, far, right', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c', 'd']), mySeatIndex: 0, holdem: null });
    const [me, left, far, right] = m.seats.map((s) => s.plate);
    expect(me?.x).toBeCloseTo(0, 6);
    expect(me?.z).toBeGreaterThan(0);
    expect(left?.x).toBeLessThan(0);
    expect(left?.z).toBeCloseTo(0, 2);
    expect(far?.x).toBeCloseTo(0, 2);
    expect(far?.z).toBeLessThan(0);
    expect(right?.x).toBeGreaterThan(0);
  });

  it('places the board in the centre and the pot just beyond it', () => {
    const h = hand({ street: 'flop', communityCards: [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts')] });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    const cc = m.cards.filter((k) => k.key.startsWith('cc:'));
    expect(cc.map((k) => k.z)).toEqual([0, 0, 0]);
    expect(cc[2].x).toBeCloseTo(0, 6);
    expect(m.pot?.z).toBeLessThan(0);
  });

  it('gives a player who sat down mid-hand no place, and points the turn light at the acting hand', () => {
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c', 'late']), mySeatIndex: 0, holdem: hand({ actingPlayerId: 'b' }) });
    expect(m.seats[3].plate).toBeNull();
    const b = m.cards.filter((k) => k.key.startsWith('h:1:'));
    expect(m.turnLight?.x).toBeCloseTo((b[0].x + b[1].x) / 2, 6);
    expect(buildPokerModel({ seats: seats(['a']), mySeatIndex: 0, holdem: null }).turnLight).toBeNull();
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

  it('lays out community cards left to right and derives the running pot from what players have put in', () => {
    // The server leaves `pots` empty until settlement and only debits seat balances then,
    // so the live pot is (balance before the hand - in-hand stack), summed.
    const h = hand({
      street: 'flop',
      communityCards: [c('2', 'clubs'), c('7', 'diamonds'), c('Q', 'hearts')],
      pots: [],
      players: [player('a', { stack: 920 }), player('b', { stack: 920 }), player('c', { stack: 960 })],
    });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    const cc = m.cards.filter((k) => k.key.startsWith('cc:'));
    expect(cc.map((k) => k.key)).toEqual(['cc:0', 'cc:1', 'cc:2']);
    expect(cc[0].x).toBeLessThan(cc[1].x);
    expect(cc[1].x).toBeLessThan(cc[2].x);
    expect(m.pot?.amount).toBe(200);
    expect(m.chips.find((k) => k.key === 'pot')?.amount).toBe(200);
    // Plates show the live in-hand stack, not the not-yet-debited seat balance.
    expect(m.seats.map((s) => s.balance)).toEqual([920, 920, 960]);
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

describe('livePot / amountToCall', () => {
  it('uses the settled pots once the hand is over', () => {
    const h = hand({ street: 'settled', pots: [{ amount: 80, eligiblePlayerIds: ['a'] }, { amount: 20, eligiblePlayerIds: ['a'] }] });
    expect(livePot(seats(['a', 'b', 'c']), h)).toBe(100);
  });

  it('excludes an uncalled bet (a single-player side pot) from the settled pot', () => {
    // 120 was put in by one player but only 80 was matched: the extra 40 is its own one-player pot.
    const h = hand({
      street: 'settled',
      pots: [
        { amount: 160, eligiblePlayerIds: ['a', 'b'] },
        { amount: 40, eligiblePlayerIds: ['a'] },
      ],
    });
    expect(livePot(seats(['a', 'b', 'c']), h)).toBe(160);
  });

  it('keeps this street’s bets out of the centre stack (they sit in front of each player)', () => {
    const h = hand({
      players: [player('a', { stack: 900, streetContributed: 40 }), player('b', { stack: 900, streetContributed: 40 }), player('c', { stack: 1000 })],
    });
    const m = buildPokerModel({ seats: seats(['a', 'b', 'c']), mySeatIndex: 0, holdem: h });
    expect(m.pot?.amount).toBe(200);
    expect(m.chips.find((k) => k.key === 'pot')?.amount).toBe(120);
    expect(m.chips.filter((k) => k.key.startsWith('bet:')).map((k) => k.amount)).toEqual([40, 40]);
  });

  it('computes the call amount from the biggest live bet, capped by the stack', () => {
    const h = hand({
      players: [
        player('a', { stack: 50, streetContributed: 10 }),
        player('b', { stack: 500, streetContributed: 200 }),
        player('c', { stack: 500, streetContributed: 500, folded: true }),
      ],
    });
    expect(amountToCall(h, h.players[0])).toBe(50); // owes 190 but only has 50
    expect(amountToCall(h, h.players[1])).toBe(0);
  });
});

describe('actingSeatIndex', () => {
  it('maps the acting player id to its seat', () => {
    expect(actingSeatIndex(seats(['a', 'b']), hand({ actingPlayerId: 'b' }))).toBe(1);
    expect(actingSeatIndex(seats(['a', 'b']), null)).toBeNull();
    expect(actingSeatIndex(seats(['a', 'b']), hand({ actingPlayerId: null }))).toBeNull();
  });
});
