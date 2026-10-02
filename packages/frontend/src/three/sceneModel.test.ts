import type { BlackjackRoundView, SeatView } from '@poker-blackjack/server/src/table';
import type { Card, PlayerHand } from '@poker-blackjack/game-engine';
import { buildSceneModel, chipsFor, feltPrintKey, pickDealerRound } from './sceneModel';

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
  it('puts the local player at the bottom centre and the rest in seat order, left first', () => {
    const model = buildSceneModel({
      seats: seats(['a', 'b', 'c', 'd']),
      activeSeatIndex: null,
      mySeatIndex: 2,
      blackjackRounds: null,
    });
    const plate = (name: string) => model.seats.find((s) => s.name === name)?.plate;
    expect(plate('c')?.x).toBeCloseTo(0, 6);
    expect(plate('c')?.z).toBeGreaterThan(0);
    // Order from seat 2 is d(3), a(0), b(1): two slots on the left (centre outward), one on the right.
    expect(plate('d')?.x).toBeLessThan(0);
    expect(plate('a')?.x).toBeLessThan(0);
    expect(plate('a')?.z).toBeLessThan(plate('d')?.z ?? 0);
    expect(plate('b')?.x).toBeGreaterThan(0);
  });

  it('gives a spectator no seat of their own but puts the first player at the bottom centre', () => {
    const model = buildSceneModel({
      seats: seats(['a', 'b']),
      activeSeatIndex: null,
      mySeatIndex: null,
      blackjackRounds: null,
    });
    expect(model.seats.map((s) => s.isMe)).toEqual([false, false]);
    expect(model.seats[0].plate?.x).toBeCloseTo(0, 6);
    expect(model.seats[1].plate?.x).toBeLessThan(0);
  });

  it('lays out only the seats dealt into a hand: a mid-hand joiner has no place until the next deal', () => {
    const rounds = { 0: round(), 1: round() };
    const mid = buildSceneModel({ seats: seats(['a', 'b', 'c']), activeSeatIndex: 0, mySeatIndex: 0, blackjackRounds: rounds });
    const two = buildSceneModel({ seats: seats(['a', 'b']), activeSeatIndex: 0, mySeatIndex: 0, blackjackRounds: rounds });
    expect(mid.seats[2].plate).toBeNull();
    expect(mid.cards.some((k) => k.key.startsWith('s2:'))).toBe(false);
    expect(mid.seats[1].plate).toEqual(two.seats[1].plate);
    const between = buildSceneModel({ seats: seats(['a', 'b', 'c']), activeSeatIndex: null, mySeatIndex: 0, blackjackRounds: null });
    expect(between.seats[2].plate).not.toBeNull();
  });

  it("points the turn light at the acting hand, at the dealer's cards while the dealer plays, else nowhere", () => {
    const rounds = { 0: round(), 1: round() };
    const acting = buildSceneModel({ seats: seats(['a', 'b']), activeSeatIndex: 1, mySeatIndex: 0, blackjackRounds: rounds });
    const theirs = acting.cards.filter((k) => k.key.startsWith('s1:'));
    expect(acting.turnLight?.x).toBeCloseTo((theirs[0].x + theirs[1].x) / 2, 6);
    expect(acting.turnLight?.z).toBeCloseTo((theirs[0].z + theirs[1].z) / 2, 6);

    const dealer = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: null,
      mySeatIndex: 0,
      blackjackRounds: { 0: round({ phase: 'dealer', dealerCards: [c('K', 'spades'), c('7', 'hearts')] }) },
    });
    const d = dealer.cards.filter((k) => k.key.startsWith('d:'));
    expect(dealer.turnLight?.x).toBeCloseTo((d[0].x + d[1].x) / 2, 6);
    expect(dealer.turnLight?.z).toBeCloseTo(d[0].z, 6);

    const idle = buildSceneModel({ seats: seats(['a']), activeSeatIndex: null, mySeatIndex: 0, blackjackRounds: null });
    expect(idle.turnLight).toBeNull();
  });

  it('prints one betting ring per placed seat, unchanged as cards are dealt', () => {
    const base = { seats: seats(['a', 'b', 'c']), activeSeatIndex: 0, mySeatIndex: 0 };
    const deal = buildSceneModel({ ...base, blackjackRounds: { 0: round(), 1: round(), 2: round() } });
    const hit = buildSceneModel({
      ...base,
      blackjackRounds: { 0: round({ playerHands: [hand([c('7', 'diamonds'), c('4', 'clubs'), c('9', 'spades')])] }), 1: round(), 2: round() },
    });
    expect(deal.felt.kind).toBe('blackjack');
    expect(deal.felt.rings).toHaveLength(3);
    expect(feltPrintKey(hit.felt)).toBe(feltPrintKey(deal.felt));
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
    expect(after.turnLight).not.toBeNull();
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

describe('dealer round selection', () => {
  // The server sends the same shared dealer on every seat's round; distinct upcards here
  // only prove which round the dealer is read from.
  it('reads the dealer from the local player round, falling back to the first seat one', () => {
    const mine = round({ dealerUpcard: c('9', 'hearts') });
    const other = round({ dealerUpcard: c('K', 'spades') });
    const rounds = { 0: other, 1: mine };
    expect(pickDealerRound(rounds, 1)).toBe(mine);
    expect(pickDealerRound(rounds, null)).toBe(other);
    expect(pickDealerRound(null, 0)).toBeUndefined();
    const model = buildSceneModel({ seats: seats(['a', 'b']), activeSeatIndex: 1, mySeatIndex: 1, blackjackRounds: rounds });
    expect(model.cards.find((k) => k.key === 'd:0')?.card).toEqual(c('9', 'hearts'));
  });

  it('marks a seat done once its round settles even if still listed active', () => {
    const settled = round({
      phase: 'settled',
      dealerCards: [c('K', 'spades'), c('7', 'hearts')],
      results: [{ outcome: 'win', payout: 25 }],
    });
    const model = buildSceneModel({
      seats: seats(['a', 'b']),
      activeSeatIndex: 1,
      mySeatIndex: 0,
      blackjackRounds: { 0: round(), 1: settled },
    });
    expect(model.seats[1].isActive).toBe(false);
    expect(model.seats[1].status).toBe('Win');
    const mine = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: 0,
      mySeatIndex: 0,
      blackjackRounds: { 0: settled },
    });
    expect(mine.myTurn).toBe(false);
  });
});

describe('at-risk balance', () => {
  it('shows a live hand’s bets as already out of the balance, and the full balance once settled', () => {
    const live = buildSceneModel({ seats: seats(['a']), activeSeatIndex: 0, mySeatIndex: 0, blackjackRounds: { 0: round() } });
    expect(live.seats[0].balance).toBe(975); // 1000 - the 25 bet
    const settled = buildSceneModel({
      seats: seats(['a']),
      activeSeatIndex: null,
      mySeatIndex: 0,
      blackjackRounds: { 0: round({ phase: 'settled', dealerCards: [c('K', 'spades'), c('7', 'hearts')], results: [{ outcome: 'win', payout: 25 }] }) },
    });
    expect(settled.seats[0].balance).toBe(1000);
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
