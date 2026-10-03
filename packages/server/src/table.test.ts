import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Table, type TableConfig } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog, HandLogEntry } from './handLog';

class FakePlayerStore implements PlayerStore {
  private balances = new Map<string, number>();
  constructor(private defaultBalance: number) {}
  async getBalance(displayName: string): Promise<number> {
    return this.balances.get(displayName) ?? this.defaultBalance;
  }
  async setBalance(displayName: string, balance: number): Promise<void> {
    this.balances.set(displayName, balance);
  }
  setDefaultStartingBalance(balance: number): void {
    this.defaultBalance = balance;
  }
}

class FakeHandLog implements HandLog {
  entries: HandLogEntry[] = [];
  async append(entry: HandLogEntry): Promise<void> {
    this.entries.push(entry);
  }
  async readAll(): Promise<HandLogEntry[]> {
    // Round-trip through JSON, matching production's JsonlHandLog (which
    // serializes every entry through JSON.stringify/JSON.parse). Returning
    // `this.entries` directly would let a writer/reader shape drift (e.g. a
    // field that doesn't survive JSON serialization) pass every test here
    // while still breaking in production.
    return JSON.parse(JSON.stringify(this.entries));
  }
  async clear(): Promise<void> {
    this.entries = [];
  }
}

// Test-local fake used only by the C2 concurrency-guard test below. Unlike
// FakeHandLog, `append` can be told (via `holdAppends`) to return a Promise
// that only resolves when the test explicitly calls `releaseNextAppend()`.
// This lets a test suspend Table.submitAction mid-flight -- exactly where
// production's real fs-backed HandLog would yield to the event loop -- so a
// second, independently-triggered call into Table's settlement path can run
// while the first is still pending, reproducing the interleaving the C2 fix
// guards against instead of just trusting the guard by inspection.
class ControllableHandLog implements HandLog {
  entries: HandLogEntry[] = [];
  holdAppends = false;
  private pendingResolvers: Array<() => void> = [];
  async append(entry: HandLogEntry): Promise<void> {
    this.entries.push(entry);
    if (!this.holdAppends) {
      return;
    }
    return new Promise<void>((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  }
  async readAll(): Promise<HandLogEntry[]> {
    // See FakeHandLog.readAll for why this round-trips through JSON.
    return JSON.parse(JSON.stringify(this.entries));
  }
  async clear(): Promise<void> {
    this.entries = [];
  }
  releaseNextAppend(): void {
    const resolve = this.pendingResolvers.shift();
    if (!resolve) {
      throw new Error('ControllableHandLog: no pending append to release');
    }
    resolve();
  }
}

// Test-local fake used only by the join() concurrency-guard tests below.
// Unlike FakePlayerStore, `getBalance` can be told (via `holdGetBalance`) to
// return a Promise that only resolves when the test explicitly calls
// `releaseNextGetBalance()`. This lets a test suspend two Table.join() calls
// mid-flight, right at the shared await point
// (`await this.deps.playerStore.getBalance(...)`) where a real fs-backed
// PlayerStore would yield to the event loop -- so both calls can be confirmed
// genuinely in-flight simultaneously, before either has written to
// `this.seats`, reproducing the interleaving the join() fix guards against
// instead of just trusting the guard by inspection. Same pattern as
// ControllableHandLog above, applied to PlayerStore.getBalance instead of
// HandLog.append.
class ControllablePlayerStore implements PlayerStore {
  private balances = new Map<string, number>();
  holdGetBalance = false;
  private pendingResolvers: Array<() => void> = [];
  constructor(private defaultBalance: number) {}
  async getBalance(displayName: string): Promise<number> {
    if (this.holdGetBalance) {
      await new Promise<void>((resolve) => {
        this.pendingResolvers.push(resolve);
      });
    }
    return this.balances.get(displayName) ?? this.defaultBalance;
  }
  async setBalance(displayName: string, balance: number): Promise<void> {
    this.balances.set(displayName, balance);
  }
  setDefaultStartingBalance(balance: number): void {
    this.defaultBalance = balance;
  }
  get pendingCount(): number {
    return this.pendingResolvers.length;
  }
  releaseNextGetBalance(): void {
    const resolve = this.pendingResolvers.shift();
    if (!resolve) {
      throw new Error('ControllablePlayerStore: no pending getBalance to release');
    }
    resolve();
  }
}

// Test-local fake whose setBalance can be made to reject for specific display
// names, and which records every setBalance call it was asked to make
// (including the ones it then rejected). Used by the settlement-resilience
// tests below to prove that one player's failed durable write neither skips
// another player's write nor leaves the table stuck mid-hand.
class FlakyPlayerStore implements PlayerStore {
  private balances = new Map<string, number>();
  rejectSetBalanceFor = new Set<string>();
  setBalanceCalls: Array<{ displayName: string; balance: number }> = [];
  constructor(private defaultBalance: number) {}
  async getBalance(displayName: string): Promise<number> {
    return this.balances.get(displayName) ?? this.defaultBalance;
  }
  async setBalance(displayName: string, balance: number): Promise<void> {
    this.setBalanceCalls.push({ displayName, balance });
    if (this.rejectSetBalanceFor.has(displayName)) {
      throw new Error(`simulated persist failure for ${displayName}`);
    }
    this.balances.set(displayName, balance);
  }
  setDefaultStartingBalance(balance: number): void {
    this.defaultBalance = balance;
  }
}

// Deterministic, reproducible default in place of Math.random: a real
// shuffle has a ~4.75% chance of dealing a natural blackjack to seat 0, which
// finishes its hand instantly and advances play past it, flaking any test that
// expects seat 0 to still be active or playable. Seed 2 is verified (by
// direct simulation of Table's exact shuffle call sequence -- since the
// shared dealer, ONE buildShuffledDeck(6, random) call per hand, dealer's two
// cards first, then two per seat in seat order) to deal neither of 2 seated
// players a natural (alice 9+2, bob 8+2). Tests that specifically need
// genuine per-run randomness pass `random: Math.random` as an explicit
// override.
function makeDeterministicRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// ---- Shared-dealer hand-log fixtures -------------------------------------
// Shared shoe order: the dealer's two cards, then alice's two, then bob's two, then draws.
type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
const SUITS: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function parseCards(codes: string[]) {
  return codes.map((code) => ({ rank: code.slice(0, -1), suit: SUITS[code.slice(-1)] }));
}
function bjStart(shoe: ReturnType<typeof parseCards>) {
  return {
    type: 'blackjack_hand_started' as const,
    data: {
      players: [
        { seatIndex: 0, displayName: 'alice', initialBet: 25 },
        { seatIndex: 1, displayName: 'bob', initialBet: 25 },
      ],
      shoe,
    },
  };
}
// Dealer 9,8 | alice 5,6 | bob 4,5 | next draws: 2, 3 -- nobody has a natural.
const SHOE_IN_PROGRESS = parseCards(['9h', '8h', '5c', '6c', '4d', '5d', '2s', '3s']);
// Dealer 9,9 (18) | alice A,K (natural) | bob 5,6 | draws: 3
const SHOE_ALICE_NATURAL = parseCards(['9c', '9d', 'As', 'Kh', '5d', '6d', '3s']);
// Dealer 9,9 | alice A,K | bob A,Q -- both naturals
const SHOE_BOTH_NATURAL = parseCards(['9c', '9d', 'As', 'Kh', 'Ad', 'Qd']);

function makeTable(overrides: Partial<TableConfig> = {}, onChange?: (table: Table) => void) {
  const config: TableConfig = {
    gameMode: 'holdem',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 50,
    random: makeDeterministicRandom(2),
    ...overrides,
  };
  const playerStore = new FakePlayerStore(config.defaultStartingBalance);
  const handLog = new FakeHandLog();
  let stateChangeCount = 0;
  const table = new Table(config, {
    playerStore,
    handLog,
    onStateChange: () => {
      stateChangeCount += 1;
      onChange?.(table);
    },
  });
  return { table, playerStore, handLog, getStateChangeCount: () => stateChangeCount };
}

describe('Table seats', () => {
  it('assigns increasing seat indices on join', async () => {
    const { table } = makeTable();
    await expect(table.join('alice')).resolves.toBe(0);
    await expect(table.join('bob')).resolves.toBe(1);
  });

  it('rejects a duplicate display name', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await expect(table.join('alice')).rejects.toThrow('already seated');
  });

  it('treats names that differ only in case as the same player (audit M8)', async () => {
    const { table } = makeTable();
    await table.join('Bob');
    await expect(table.join('bob')).rejects.toThrow('already seated');
    table.disconnect(0);
    expect(table.reconnect('BOB')).toBe(0);
  });

  it('connectedSeatIndexOf finds a connected seat by name, ignoring case', async () => {
    const { table } = makeTable();
    await table.join('alice');
    expect(table.connectedSeatIndexOf('ALICE')).toBe(0);
    table.disconnect(0);
    expect(table.connectedSeatIndexOf('alice')).toBeNull();
    expect(table.connectedSeatIndexOf('bob')).toBeNull();
  });

  it('rejects joining once all 8 seats are full', async () => {
    const { table } = makeTable();
    for (let i = 0; i < 8; i++) {
      await table.join(`player-${i}`);
    }
    await expect(table.join('one-too-many')).rejects.toThrow('full');
  });

  it('loads the joining player balance from PlayerStore', async () => {
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('alice', 4242);
    await table.join('alice');
    expect(table.seats[0]?.balance).toBe(4242);
  });

  it('leave clears the seat', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.leave(0);
    expect(table.seats[0]).toBeNull();
  });

  it('leave throws on an already-empty seat', async () => {
    const { table } = makeTable();
    await expect(table.leave(0)).rejects.toThrow('empty');
  });

  it('leave throws while a hand is in progress', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await expect(table.leave(0)).rejects.toThrow('in progress');
  });

  it('calls onStateChange on join and leave', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    expect(getStateChangeCount()).toBe(1);
    await table.leave(0);
    expect(getStateChangeCount()).toBe(2);
  });
});

describe('Table.join concurrency guard', () => {
  function makeControllableTable(seatCount: number) {
    const playerStore = new ControllablePlayerStore(1000);
    const handLog = new FakeHandLog();
    const config: TableConfig = {
      gameMode: 'holdem',
      seatCount,
      smallBlind: 5,
      bigBlind: 10,
      blackjackDefaultBet: 25,
      defaultStartingBalance: 1000,
      reconnectGraceMs: 50,
      random: makeDeterministicRandom(2),
    };
    const table = new Table(config, { playerStore, handLog, onStateChange: () => {} });
    return { table, playerStore };
  }

  it('two concurrent join() calls with the same displayName: exactly one resolves with a seat index, the other rejects as already seated', async () => {
    const { table, playerStore } = makeControllableTable(2);

    playerStore.holdGetBalance = true;
    const call1 = table.join('alice');
    const call2 = table.join('alice');

    // Confirm genuine overlap -- both calls are suspended mid-flight at the
    // shared `await getBalance(...)` point, before either has written to
    // `this.seats`. Without this check, a bug that accidentally serialized
    // the two calls (e.g. an await added earlier in join()) could still make
    // this test pass despite testing nothing concurrent.
    expect(playerStore.pendingCount).toBe(2);

    // Release in a controlled order: call1's getBalance resolves first, then
    // call2's, both synchronously back-to-back (no intervening await).
    playerStore.releaseNextGetBalance();
    playerStore.releaseNextGetBalance();

    const results = await Promise.allSettled([call1, call2]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as Error).message).toMatch(/already seated/);

    // The table itself ends up self-consistent: exactly one alice, sitting at
    // the seat index the winning call actually resolved with.
    const aliceSeats = table.seats.filter((s) => s?.displayName === 'alice');
    expect(aliceSeats).toHaveLength(1);
    expect(aliceSeats[0]?.seatIndex).toBe(fulfilled[0].value);
  });

  it('two concurrent join() calls with different displayNames racing for the same open seat both resolve with distinct seat indices', async () => {
    const { table, playerStore } = makeControllableTable(2);

    playerStore.holdGetBalance = true;
    const call1 = table.join('alice');
    const call2 = table.join('bob');

    // Confirm genuine overlap before either write happens -- both calls
    // independently see the identical all-null `this.seats`, which is
    // exactly the pre-fix condition that made them collide on the same index.
    expect(playerStore.pendingCount).toBe(2);

    playerStore.releaseNextGetBalance();
    playerStore.releaseNextGetBalance();

    const [aliceSeatIndex, bobSeatIndex] = await Promise.all([call1, call2]);

    // Distinct seats, not the same index silently overwritten -- this is the
    // assertion that fails against the pre-fix code (both would resolve with
    // seatIndex 0).
    expect(aliceSeatIndex).not.toBe(bobSeatIndex);
    expect(table.seats[aliceSeatIndex]?.displayName).toBe('alice');
    expect(table.seats[bobSeatIndex]?.displayName).toBe('bob');
    // Both players are actually present on the table -- neither call's write
    // silently clobbered the other's.
    expect(table.seats.filter((s) => s !== null)).toHaveLength(2);
  });
});

describe('Table ready-gating and hand start (Hold\'em)', () => {
  it('does not start a hand with only one seated player ready', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.setReady(0);
    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
  });

  it('starts a hand once all seated players (>= 2) are ready', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    expect(table.handInProgress).toBe(false);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand).not.toBeNull();
  });

  it('constructs the HoldemHand with each seated player\'s display name and balance', async () => {
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('alice', 800);
    await playerStore.setBalance('bob', 600);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const hand = table.holdemHand!;
    expect(hand.players.map((p) => p.playerId).sort()).toEqual(['alice', 'bob']);
    expect(hand.players.find((p) => p.playerId === 'alice')?.stack).toBeLessThanOrEqual(800);
    expect(hand.players.find((p) => p.playerId === 'bob')?.stack).toBeLessThanOrEqual(600);
  });

  it('the first hand ever played seats the button at the lowest occupied seat index', async () => {
    const { table } = makeTable();
    await table.join('alice'); // seat 0
    await table.join('bob'); // seat 1
    await table.setReady(0);
    await table.setReady(1);

    // Heads-up: button posts the small blind and acts first preflop, so the
    // acting player at hand start is whoever is on the button.
    expect(table.holdemHand!.actingPlayerId).toBe('alice');
  });

  it('logs a holdem_hand_started entry', async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(handLog.entries).toHaveLength(1);
    expect(handLog.entries[0].type).toBe('holdem_hand_started');
  });
});

describe('Table: a Hold\'em hand that is already over when it is dealt (audit C1)', () => {
  // Both stacks are at or below the big blind, so both players are all-in from
  // posting blinds: nobody can act, and HoldemHand runs the board out to
  // 'settled' inside its constructor. No submitAction ever arrives to settle it.
  async function dealShortStackedHand() {
    const made = makeTable({ smallBlind: 5, bigBlind: 10 });
    await made.playerStore.setBalance('alice', 5);
    await made.playerStore.setBalance('bob', 8);
    await made.table.join('alice');
    await made.table.join('bob');
    await made.table.setReady(0);
    await made.table.setReady(1);
    return made;
  }

  it('pays the hand out and returns to between-hands', async () => {
    const { table, playerStore, handLog } = await dealShortStackedHand();

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(handLog.entries).toHaveLength(0);
    const alice = await playerStore.getBalance('alice');
    const bob = await playerStore.getBalance('bob');
    expect(alice + bob).toBe(13); // chips conserved
    expect([alice, bob]).not.toEqual([5, 8]); // and the pot actually moved
  });

  it('leaves the table usable: players can leave afterwards', async () => {
    const { table } = await dealShortStackedHand();
    await expect(table.leave(0)).resolves.toBeUndefined();
  });

  it('shows the finished hand (full board, both hands) to everyone', async () => {
    const { table } = await dealShortStackedHand();
    const view = table.getStateForSeat(null).holdem!;
    expect(view.street).toBe('settled');
    expect(view.communityCards).toHaveLength(5);
    expect(view.players.every((p) => p.holeCards !== null)).toBe(true);
  });
});

describe('Table.updateConfig', () => {
  it('changes smallBlind/bigBlind used by the next hand without touching an in-progress one', async () => {
    const { table } = makeTable();

    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);

    table.updateConfig({ smallBlind: 50, bigBlind: 100 });

    // The in-progress hand's blinds were posted at start and must not change.
    // `pots` is only populated once a hand settles, so read the live total
    // the same way HoldemHand itself computes it at settlement: the sum of
    // each player's total contribution for the hand.
    const totalContributed = (hand: typeof table.holdemHand) =>
      hand!.players.reduce((sum, p) => sum + p.contributed, 0);
    expect(totalContributed(table.holdemHand)).toBe(15); // 5 + 10, unaffected by the live update

    // Finish the hand (both check/fold to settlement isn't needed here --
    // this test only asserts the *next* hand picks up the new blinds, so
    // fold it out immediately). Go through Table.submitAction rather than
    // acting on the HoldemHand directly, so Table's own settlement plumbing
    // (which flips handInProgress once street === 'settled') actually runs.
    await table.submitAction(0, 'fold'); // seat 0 is alice, on the button, first to act heads-up
    expect(table.handInProgress).toBe(false);

    await table.setReady(0);
    await table.setReady(1);
    expect(totalContributed(table.holdemHand)).toBe(150); // 50 + 100
  });
});

describe('Table.adminSetBalance', () => {
  // Seat mutation stays inside Table; the race cases are in 'Table concurrency' below.
  it("persists and sets a seated player's balance, and notifies state change", async () => {
    const { table, playerStore, getStateChangeCount } = makeTable();
    await table.join('alice');
    const callsBefore = getStateChangeCount();

    await table.adminSetBalance('alice', 5000);
    expect(table.seats[0]!.balance).toBe(5000);
    expect(table.getStateForSeat(0).seats[0].balance).toBe(5000);
    await expect(playerStore.getBalance('alice')).resolves.toBe(5000);
    expect(getStateChangeCount()).toBeGreaterThan(callsBefore);
  });
});

describe('Table ready-gating and hand start (Blackjack)', () => {
  it('constructs one BlackjackRound per seated player', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.blackjackRounds.size).toBe(2);
    expect(table.blackjackRounds.get(0)).toBeDefined();
    expect(table.blackjackRounds.get(1)).toBeDefined();
  });

  it('deals each round with the configured default bet', async () => {
    const { table } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.blackjackRounds.get(0)!.playerHands[0].bet).toBe(25);
    expect(table.blackjackRounds.get(1)!.playerHands[0].bet).toBe(25);
  });

  it('recovers exactly the cards live play produced, after a split and a hit', async () => {
    // Recovery replays the logged shoe and actions; with one shared shoe every seat and
    // the dealer draw from the same sequence, so any ordering drift would show up here.
    // Seed 38 deals alice a splittable pair (see the split test above).
    const live = makeTable({ gameMode: 'blackjack', random: makeDeterministicRandom(38) });
    await live.table.join('alice');
    await live.table.join('bob');
    await live.table.setReady(0);
    await live.table.setReady(1);
    await live.table.submitAction(0, 'split');
    await live.table.submitAction(0, 'hit');
    expect(live.table.handInProgress).toBe(true);

    const recovered = makeTable({ gameMode: 'blackjack' });
    recovered.handLog.entries = JSON.parse(JSON.stringify(live.handLog.entries));
    await recovered.table.recoverFromLog();

    const cardsOf = (t: Table, seat: number) => t.blackjackRounds.get(seat)!.playerHands.map((h) => h.cards);
    expect(cardsOf(recovered.table, 0)).toEqual(cardsOf(live.table, 0));
    expect(cardsOf(recovered.table, 1)).toEqual(cardsOf(live.table, 1));
    expect(recovered.table.blackjackRounds.get(0)!.getDealerCards()).toEqual(
      live.table.blackjackRounds.get(0)!.getDealerCards()
    );
    expect(recovered.table.activeSeatIndex).toBe(live.table.activeSeatIndex);
  });

  it('sets activeSeatIndex to the lowest seated index', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.activeSeatIndex).toBe(0);
  });

  it('logs a blackjack_hand_started entry', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(handLog.entries).toHaveLength(1);
    expect(handLog.entries[0].type).toBe('blackjack_hand_started');
  });
});

describe('Table submitAction (Hold\'em)', () => {
  it('rejects an action from a seat when it is not that seat\'s turn', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    // Heads-up: alice (button) acts first preflop, so seat 1 (bob) is out of turn.
    await expect(table.submitAction(1, 'fold')).rejects.toThrow();
  });

  it('rejects an illegal action and leaves state unchanged', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const countBefore = getStateChangeCount();
    // Heads-up preflop: alice (SB) faces a bet from the BB, so check is illegal.
    await expect(table.submitAction(0, 'check')).rejects.toThrow();
    expect(getStateChangeCount()).toBe(countBefore);
    expect(table.handInProgress).toBe(true);
  });

  it('settling an uncontested hand commits payouts via PlayerStore and returns to between-hands', async () => {
    const { table, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    // Heads-up, alice on the button/SB acts first preflop -- folding here
    // immediately ends the hand uncontested in bob's favor.
    await table.submitAction(0, 'fold');

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    await expect(playerStore.getBalance('alice')).resolves.toBe(995); // lost the 5-chip small blind
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005); // won alice's small blind
    expect(table.seats[0]?.ready).toBe(false);
    expect(table.seats[1]?.ready).toBe(false);
  });

  it('clears the HandLog once a hand settles', async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'fold');
    await expect(handLog.readAll()).resolves.toEqual([]);
  });

  it('rotates the button to the next seated player on the next hand', async () => {
    const { table } = makeTable();
    await table.join('alice'); // seat 0
    await table.join('bob'); // seat 1
    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // button = seat 0 on the first hand

    await table.submitAction(0, 'fold'); // settles hand 1, resets ready flags

    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('bob'); // button rotated to seat 1
  });
});

describe('Table submitAction (Blackjack)', () => {
  it('rejects an action from a seat that is not currently active', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.activeSeatIndex).toBe(0);
    await expect(table.submitAction(1, 'stand')).rejects.toThrow();
  });

  it('advances to the next seat once the active seat is done, without settling anyone yet', async () => {
    const { table, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'stand');
    // Alice is finished but the dealer has not played and nobody is paid: that waits for bob.
    expect(table.blackjackRounds.get(0)!.playingComplete).toBe(true);
    expect(table.blackjackRounds.get(0)!.phase).toBe('playing');
    expect(table.activeSeatIndex).toBe(1);
    expect(table.handInProgress).toBe(true);
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
  });

  it('deals every seat from ONE shoe against ONE dealer hand', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const a = table.blackjackRounds.get(0)!;
    const b = table.blackjackRounds.get(1)!;
    expect(a.getDealerUpcard()).toEqual(b.getDealerUpcard());
    expect(a.getDealerCards()).toBe(b.getDealerCards());
  });

  it('plays the dealer once after the LAST seat acts, then settles every seat together', async () => {
    const { table, playerStore } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const rounds = [table.blackjackRounds.get(0)!, table.blackjackRounds.get(1)!];
    const dealerBefore = rounds[0].getDealerCards().length;

    await table.submitAction(0, 'stand');
    expect(rounds[0].getDealerCards()).toHaveLength(dealerBefore); // the dealer has not played yet
    expect(table.getStateForSeat(0).blackjackRounds![0].dealerCards).toBeNull(); // hole card still hidden
    expect(rounds.every((r) => r.phase !== 'settled')).toBe(true);

    await table.submitAction(1, 'stand');
    expect(rounds.every((r) => r.phase === 'settled')).toBe(true);
    expect(table.handInProgress).toBe(false);
    const total = (await playerStore.getBalance('alice')) + (await playerStore.getBalance('bob'));
    expect(total).toBeGreaterThanOrEqual(1950);
    expect(total).toBeLessThanOrEqual(2075);
  });

  it('finishes the table hand and commits balances once every seat\'s round settles', async () => {
    const { table, playerStore } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'stand');
    await table.submitAction(1, 'stand');

    expect(table.handInProgress).toBe(false);
    expect(table.blackjackRounds.size).toBe(0);
    expect(table.activeSeatIndex).toBeNull();
    const aliceBalance = await playerStore.getBalance('alice');
    const bobBalance = await playerStore.getBalance('bob');
    // Both started at 1000 with a 25-chip bet; win/push/lose all land within [975, 1037.5].
    expect(aliceBalance).toBeGreaterThanOrEqual(975);
    expect(aliceBalance).toBeLessThanOrEqual(1037.5);
    expect(bobBalance).toBeGreaterThanOrEqual(975);
    expect(bobBalance).toBeLessThanOrEqual(1037.5);
  });

  it('rejects an illegal Blackjack action and leaves state unchanged', async () => {
    // Seed 3 (not the file default of 2): verified by direct simulation that
    // alice's opening hand is not a natural and her single 'hit' below does
    // not bust (4+10+7=21, still an active 3-card hand) -- both are required
    // for 'double' to reach its own "first two cards" validation rather than
    // failing on a turn-order or "no active hand" check first. Seed 2 (the
    // file default) deals alice 4+K and busts her on this exact hit, which
    // settles her round and makes the subsequent 'double' fail on turn order
    // instead of the validation this test exists to exercise.
    const { table, getStateChangeCount } = makeTable({
      gameMode: 'blackjack',
      random: makeDeterministicRandom(3),
    });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'hit');
    const countBefore = getStateChangeCount();
    // A hand with 3+ cards can no longer double.
    await expect(table.submitAction(0, 'double')).rejects.toThrow('first two cards');
    expect(getStateChangeCount()).toBe(countBefore);
  });

  it('sums both hands\' payouts into one balance update after a split', async () => {
    // Settlement reduces over round.results (one entry per split hand), so a
    // player who splits must have BOTH hands' payouts reflected in their
    // final balance, not just the first hand's -- the bug this guards
    // against is silently using `results[0].payout` alone. Seed 38 is
    // verified (by direct simulation) to: deal neither seat a natural; deal
    // alice a splittable Qd/Js opening hand; and, after splitting and
    // standing on both resulting hands (Qd7d and Js4c), have BOTH hands lose
    // to the dealer. A net of -50 is only reachable by summing both results
    // -- applying either hand's payout alone would show as -25 (balance
    // 975), and skipping settlement entirely would leave the balance at the
    // starting 1000, so this seed's outcome distinguishes the correct
    // "sum all results" behavior from every plausible partial-settlement bug.
    const { table, playerStore } = makeTable({
      gameMode: 'blackjack',
      blackjackDefaultBet: 25,
      random: makeDeterministicRandom(38),
    });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'split');
    expect(table.blackjackRounds.get(0)!.playerHands).toHaveLength(2);

    await table.submitAction(0, 'stand'); // resolves the first split hand
    await table.submitAction(0, 'stand'); // resolves the second split hand
    await table.submitAction(1, 'stand'); // the dealer only plays, and everyone settles, after bob

    expect(table.getStateForSeat(0).blackjackRounds![0].results).toEqual([
      { outcome: 'lose', payout: -25 },
      { outcome: 'lose', payout: -25 },
    ]);
    await expect(playerStore.getBalance('alice')).resolves.toBe(950);
  });

  it('completes cleanly when a third player joins mid-hand instead of crashing', async () => {
    // A new player sitting down mid-hand is normal, expected behavior (real
    // tables let people join anytime and wait for the next deal). But the
    // seat-advancement logic must walk only the seats actually dealt into
    // this hand, not every currently-seated player -- otherwise, once
    // alice's and bob's rounds both settle, it would hand carol's un-dealt
    // seat to blackjackRounds.get(), which returns undefined and throws on
    // `.phase`, permanently stalling the table (handInProgress stuck true).
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.join('carol');

    await table.submitAction(0, 'stand');
    await table.submitAction(1, 'stand');

    expect(table.handInProgress).toBe(false);
    expect(table.blackjackRounds.size).toBe(0);
    expect(table.activeSeatIndex).toBeNull();
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Table disconnect/reconnect', () => {
  it('marks a seat disconnected and fires onStateChange', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    const before = getStateChangeCount();
    table.disconnect(0);
    expect(table.seats[0]?.connected).toBe(false);
    expect(getStateChangeCount()).toBe(before + 1);
  });

  it('reconnect within the grace window rebinds the seat and returns its index', async () => {
    const { table } = makeTable({ reconnectGraceMs: 200 });
    await table.join('alice');
    table.disconnect(0);
    const seatIndex = table.reconnect('alice');
    expect(seatIndex).toBe(0);
    expect(table.seats[0]?.connected).toBe(true);
  });

  it('reconnect returns null for a name that is not currently disconnected', async () => {
    const { table } = makeTable();
    await table.join('alice');
    expect(table.reconnect('alice')).toBeNull(); // never disconnected
    expect(table.reconnect('nobody')).toBeNull(); // not seated at all
  });

  it('a between-hands disconnect excludes that seat from the next hand instead of blocking it', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');
    table.disconnect(2); // carol disconnects before anyone is ready

    await table.setReady(0);
    await table.setReady(1);
    // Only alice and bob are connected; the hand should start without carol.
    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand!.players.map((p) => p.playerId).sort()).toEqual(['alice', 'bob']);
  });

  it('disconnecting the seat whose turn it is auto-folds/checks once the grace window elapses (heads-up)', async () => {
    const { table } = makeTable({ reconnectGraceMs: 30, smallBlind: 5, bigBlind: 10 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // button acts first, heads-up

    table.disconnect(0);
    await wait(100);

    // Alice was facing a bet (SB posted 5, BB posted 10) so the safe default is fold,
    // which ends the hand uncontested in bob's favor.
    expect(table.handInProgress).toBe(false);
  });

  it('a reconnect before the grace window elapses prevents the auto-action', async () => {
    const { table } = makeTable({ reconnectGraceMs: 200 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    table.disconnect(0);
    await wait(20);
    table.reconnect('alice');
    await wait(250); // past where the original timer would have fired

    expect(table.handInProgress).toBe(true); // never auto-folded
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // still alice's turn
  });

  it('disconnecting a seat that is not currently acting only auto-acts once it becomes their turn', async () => {
    const { table } = makeTable({ reconnectGraceMs: 30 });
    await table.join('alice'); // seat 0 -- button, first to act in a 3-handed hand
    await table.join('bob'); // seat 1 -- small blind
    await table.join('carol'); // seat 2 -- big blind
    await table.setReady(0);
    await table.setReady(1);
    await table.setReady(2);
    expect(table.holdemHand!.actingPlayerId).toBe('alice');

    table.disconnect(1); // bob disconnects while it is alice's turn, not his
    await wait(100); // past the grace window

    // Still alice's turn -- bob's disconnect hasn't reached his turn yet, so nothing
    // should have been auto-submitted on his behalf.
    expect(table.holdemHand!.actingPlayerId).toBe('alice');
    expect(table.handInProgress).toBe(true);

    // Alice calls, advancing the turn to bob -- who is already past his grace window,
    // so his action should be auto-submitted immediately with no further waiting.
    await table.submitAction(0, 'call');

    expect(table.holdemHand!.actingPlayerId).not.toBe('bob'); // bob's turn was auto-resolved
  });

  it('auto-acts with stand in Blackjack once the active seat times out', async () => {
    const { table } = makeTable({ gameMode: 'blackjack', reconnectGraceMs: 30 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.activeSeatIndex).toBe(0);

    table.disconnect(0);
    await wait(100);

    expect(table.blackjackRounds.get(0)?.playingComplete).toBe(true); // alice auto-stood
    expect(table.activeSeatIndex).toBe(1); // advanced to the next seat
  });

  it('a disconnect that leaves every remaining connected seat ready starts the hand (closes the ready-gate deadlock, C1)', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');
    await table.setReady(0); // alice ready
    await table.setReady(1); // bob ready; carol has not called ready yet, so the gate stays blocked
    expect(table.handInProgress).toBe(false);

    table.disconnect(2); // carol disconnects -- every remaining CONNECTED seat (alice, bob) is now ready
    await wait(10); // let the async startHand chain (handLog.append, etc.) finish

    // Before the fix, only setReady ever re-checked the ready gate, so a
    // disconnect that completed the "all connected seats ready" condition
    // would never start the hand -- the table would stall forever.
    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand!.players.map((p) => p.playerId).sort()).toEqual(['alice', 'bob']);
  });

  it('a second disconnect on the same seat clears the previous grace timer instead of leaking it (C3)', async () => {
    const { table } = makeTable({ gameMode: 'blackjack', reconnectGraceMs: 30 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.activeSeatIndex).toBe(0);

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    table.disconnect(0);
    table.disconnect(0); // same seat, no reconnect in between -- must not leak the first timer
    // The fix clears the stale timer before arming the new one; without it,
    // this would be 0 and both timers would remain independently scheduled.
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    clearTimeoutSpy.mockRestore();

    let unhandledRejection: unknown = null;
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejection = reason;
    };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      await wait(100); // past the grace window -- only one timer should still be armed
      expect(table.blackjackRounds.get(0)?.playingComplete).toBe(true); // alice auto-stood exactly once
      expect(table.activeSeatIndex).toBe(1); // advanced cleanly to bob, nothing thrown
      await wait(50); // give a stray leaked timer a chance to misfire before asserting clean
      expect(unhandledRejection).toBeNull();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it("leave clears a seat's timed-out flag so a new occupant of the recycled seat index is not auto-acted for (I2/M1)", async () => {
    const { table } = makeTable({ reconnectGraceMs: 30 });
    await table.join('bob'); // seat 0
    await table.join('alice'); // seat 1

    table.disconnect(1); // alice disconnects before any hand starts
    await wait(100); // past the grace window -- alice (seat 1) is now in timedOutSeats

    await table.leave(1); // alice leaves; handInProgress is false, so this is allowed
    expect(table.seats[1]).toBeNull();

    await table.join('dave'); // recycles seat 1, the lowest empty index
    expect(table.seats[1]?.displayName).toBe('dave');

    await table.setReady(0); // bob
    await table.setReady(1); // dave -- hand starts; this is the table's first-ever hand, so
    // the button defaults to the lowest occupied seat index (bob, seat 0)
    expect(table.holdemHand!.actingPlayerId).toBe('bob');
    expect(table.holdemHand!.street).toBe('preflop');

    await table.submitAction(0, 'call'); // bob (button/SB) calls, advancing the turn to dave (BB)

    // Without the I2/M1 fix, seat 1 would still be in timedOutSeats (leaked
    // from alice's earlier timeout), and the "whose turn is it now" check at
    // the end of submitAction would auto-act (check, since dave's toCall is
    // 0) on dave's behalf -- silently ending his BB option and pushing the
    // hand to the flop, despite dave never having disconnected. Asserting
    // actingPlayerId alone would not catch this: heads-up, the BB also acts
    // first postflop, so it lands back on 'dave' either way. `street`
    // staying at 'preflop' is the assertion that actually distinguishes
    // fixed from buggy here.
    expect(table.holdemHand!.street).toBe('preflop');
    expect(table.holdemHand!.actingPlayerId).toBe('dave');
    expect(table.handInProgress).toBe(true);
  });
});

describe("Table Hold'em settlement concurrency guard (C2)", () => {
  it('a settlement triggered twice (write-ahead action, then a duplicate call) applies the payout exactly once', async () => {
    const handLog = new ControllableHandLog();
    const playerStore = new FakePlayerStore(1000);
    const config: TableConfig = {
      gameMode: 'holdem',
      seatCount: 8,
      smallBlind: 5,
      bigBlind: 10,
      blackjackDefaultBet: 25,
      defaultStartingBalance: 1000,
      reconnectGraceMs: 50,
      random: makeDeterministicRandom(2),
    };
    const table = new Table(config, { playerStore, handLog, onStateChange: () => {} });

    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    // Heads-up: alice (button) acts first preflop.
    expect(table.holdemHand!.actingPlayerId).toBe('alice');
    const hand = table.holdemHand!;

    // From here on, handLog.append only resolves when the test releases it, which
    // suspends submitAction at its (write-ahead) log write.
    handLog.holdAppends = true;
    const call1 = table.submitAction(0, 'fold');
    // submitAction runs inside the table lock, so its log write starts a microtask later.
    await vi.waitFor(() => expect(handLog.entries).toHaveLength(2));

    // Write-ahead: while the log write is pending the fold has NOT been applied.
    expect(hand.street).toBe('preflop');
    expect(table.handInProgress).toBe(true);

    handLog.releaseNextAppend();
    await call1;
    expect(hand.street).toBe('settled');
    await expect(playerStore.getBalance('alice')).resolves.toBe(995); // alice folded the 5-chip small blind
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005); // bob won alice's small blind

    // A second, independently triggered settlement of the same hand (e.g. a timer-driven
    // auto-act racing the first) must be a no-op thanks to the holdemSettled guard.
    await (table as unknown as { settleHoldem(h: typeof hand): Promise<void> }).settleHoldem(hand);
    await expect(playerStore.getBalance('alice')).resolves.toBe(995);
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005);
    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
  });
});

describe('Table hand eligibility (C1/C2)', () => {
  it("excludes a 0-balance Hold'em seat from the hand instead of bricking the table", async () => {
    // Pre-fix, carol was passed to HoldemHand with stack 0, whose constructor
    // throws -- and because handInProgress was already true by then, the throw
    // escaped setReady and left the table permanently unable to start, act, or
    // let anyone leave. She must simply not be dealt in.
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('carol', 0);
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');

    // carol readies first, so if she were still counted the "everyone ready"
    // gate would be satisfied by all three and she would be dealt in.
    await table.setReady(2);
    await table.setReady(0);
    await table.setReady(1);

    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand!.players.map((p) => p.playerId).sort()).toEqual(['alice', 'bob']);
    // Not kicked -- still seated and visibly connected, just out of the hand.
    expect(table.seats[2]?.displayName).toBe('carol');
    expect(table.seats[2]?.connected).toBe(true);
    expect(table.seats[2]?.balance).toBe(0);
  });

  it("simply never starts a hand when only one of two Hold'em seats can afford to play", async () => {
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('bob', 0);
    await table.join('alice');
    await table.join('bob');

    await table.setReady(0);
    await table.setReady(1);

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    // And the table is not bricked: with no hand in progress, leave() works.
    await expect(table.leave(0)).resolves.toBeUndefined();
  });

  it('excludes a Blackjack seat that cannot cover the default bet', async () => {
    // Blackjack had no affordability check at all pre-fix: carol was dealt in
    // and settled against a bet she could not cover, driving her balance
    // negative.
    const { table, playerStore } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await playerStore.setBalance('carol', 20);
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');

    await table.setReady(2);
    await table.setReady(0);
    await table.setReady(1);

    expect(table.handInProgress).toBe(true);
    expect(table.blackjackRounds.size).toBe(2);
    expect(table.blackjackRounds.has(2)).toBe(false);

    // Play the hand out; carol's balance must be untouched by a hand she was
    // never dealt into, and certainly never negative.
    await table.submitAction(0, 'stand');
    await table.submitAction(1, 'stand');
    expect(table.handInProgress).toBe(false);
    expect(table.seats[2]?.balance).toBe(20);
    await expect(playerStore.getBalance('carol')).resolves.toBe(20);
    for (const seat of table.seats) {
      if (seat) expect(seat.balance).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats a Blackjack balance exactly equal to the default bet as eligible', async () => {
    // The affordability bound is `>=`, not `>`: a player with exactly one
    // bet left is still allowed to play it.
    const { table, playerStore } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await playerStore.setBalance('bob', 25);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    expect(table.handInProgress).toBe(true);
    expect(table.blackjackRounds.has(1)).toBe(true);
  });
});

describe('Table Blackjack action affordability (C2)', () => {
  // Seed 3 is the same one the "rejects an illegal Blackjack action" test
  // documents: alice's opening hand is a non-natural two-card hand, which is
  // exactly what `double` requires, so the affordability check below is what
  // rejects the action rather than one of the engine's own validations.
  it('rejects a double the seat cannot cover, instead of letting the balance go negative', async () => {
    const { table, playerStore, getStateChangeCount } = makeTable({
      gameMode: 'blackjack',
      blackjackDefaultBet: 25,
      random: makeDeterministicRandom(3),
    });
    // Exactly one bet's worth: eligible to be dealt in (the bound is `>=`),
    // but doubling would put 50 at risk against a 25 balance.
    await playerStore.setBalance('alice', 25);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);

    const countBefore = getStateChangeCount();
    await expect(table.submitAction(0, 'double')).rejects.toThrow(/Insufficient balance to double/);
    // Rejected before round.act(), so nothing moved: no state change, no
    // extra hand-log entry, and the hand's bet is untouched.
    expect(getStateChangeCount()).toBe(countBefore);
    expect(table.blackjackRounds.get(0)!.playerHands[0].bet).toBe(25);
    expect(table.seats[0]?.balance).toBe(25);

    // The seat can still play the hand out normally, and its balance never
    // goes negative -- the outcome the pre-fix code reached at -25.
    await table.submitAction(0, 'stand');
    while (table.handInProgress && table.activeSeatIndex !== null) {
      await table.submitAction(table.activeSeatIndex, 'stand');
    }
    expect(table.handInProgress).toBe(false);
    expect(table.seats[0]!.balance).toBeGreaterThanOrEqual(0);
    await expect(playerStore.getBalance('alice')).resolves.toBeGreaterThanOrEqual(0);
  });

  it('allows a double the seat can exactly cover', async () => {
    // The bound is `>=` here too: a balance of exactly two bets can cover the
    // doubled exposure, worst case landing on 0 rather than below it.
    const { table, playerStore } = makeTable({
      gameMode: 'blackjack',
      blackjackDefaultBet: 25,
      random: makeDeterministicRandom(3),
    });
    await playerStore.setBalance('alice', 50);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await expect(table.submitAction(0, 'double')).resolves.toBeUndefined();
    expect(table.blackjackRounds.get(0)!.playerHands[0].bet).toBe(50);

    while (table.handInProgress && table.activeSeatIndex !== null) {
      await table.submitAction(table.activeSeatIndex, 'stand');
    }
    expect(table.seats[0]!.balance).toBeGreaterThanOrEqual(0);
  });

  it('rejects a split the seat cannot cover', async () => {
    // Seed 38 is the same one the split-payout test documents: it deals alice
    // a splittable Qd/Js opening hand, so the affordability check is what
    // rejects this rather than the engine's own split eligibility check.
    const { table, playerStore, getStateChangeCount } = makeTable({
      gameMode: 'blackjack',
      blackjackDefaultBet: 25,
      random: makeDeterministicRandom(20),
    });
    await playerStore.setBalance('alice', 25);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const countBefore = getStateChangeCount();
    await expect(table.submitAction(0, 'split')).rejects.toThrow(/Insufficient balance to split/);
    expect(getStateChangeCount()).toBe(countBefore);
    // Still a single, un-split hand.
    expect(table.blackjackRounds.get(0)!.playerHands).toHaveLength(1);

    while (table.handInProgress && table.activeSeatIndex !== null) {
      await table.submitAction(table.activeSeatIndex, 'stand');
    }
    expect(table.seats[0]!.balance).toBeGreaterThanOrEqual(0);
  });

  it('rejects doubling a split hand once total exposure would exceed the balance', async () => {
    // The compounding case the initial-bet gate cannot see: split then double
    // reaches 3x the default bet, and doubling both split hands reaches 4x.
    // A balance of exactly 2 bets covers the split but not a double on top.
    const { table, playerStore } = makeTable({
      gameMode: 'blackjack',
      blackjackDefaultBet: 25,
      random: makeDeterministicRandom(20),
    });
    await playerStore.setBalance('alice', 50);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    // 50 covers two hands at 25 apiece.
    await expect(table.submitAction(0, 'split')).resolves.toBeUndefined();
    expect(table.blackjackRounds.get(0)!.playerHands).toHaveLength(2);

    // ...but not a third bet's worth on top of them.
    if (table.activeSeatIndex === 0 && table.blackjackRounds.get(0)!.phase === 'playing') {
      await expect(table.submitAction(0, 'double')).rejects.toThrow(/Insufficient balance to double/);
    }

    while (table.handInProgress && table.activeSeatIndex !== null) {
      await table.submitAction(table.activeSeatIndex, 'stand');
    }
    expect(table.seats[0]!.balance).toBeGreaterThanOrEqual(0);
    await expect(playerStore.getBalance('alice')).resolves.toBeGreaterThanOrEqual(0);
  });
});

describe('Table Blackjack settlement failure does not brick the hand (I6 follow-up)', () => {
  it('advances past a seat whose write-ahead marker append fails, and skips its balance write', async () => {
    const { table, playerStore, handLog } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const passthrough = handLog.append.bind(handLog);
    vi.spyOn(handLog, 'append').mockImplementation(async (entry) => {
      if (entry.type === 'blackjack_seat_settled') {
        throw new Error('simulated marker write failure');
      }
      return passthrough(entry);
    });
    const setBalanceSpy = vi.spyOn(playerStore, 'setBalance');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Pre-fix, this rejection escaped advancePastSettledBlackjackRounds'
    // while-loop before activeSeatIndex advanced, pinning it to an
    // already-'settled' round -- every later action threw and the hand could
    // never finish. Total loss of service until a restart. (Since the shared
    // dealer, seats settle together inside advanceBlackjackTurn after the LAST
    // seat acts, so the failing marker append now fires on bob's stand below.)
    await expect(table.submitAction(0, 'stand')).resolves.toBeUndefined();
    expect(table.activeSeatIndex).toBe(1);

    // Crucially, alice's balance write must NOT have happened: the marker is
    // write-ahead of it precisely so a crash can't leave a persisted payout
    // with no marker, which recovery would then pay a second time.
    expect(setBalanceSpy.mock.calls.map((c) => c[0])).not.toContain('alice');

    await expect(table.submitAction(1, 'stand')).resolves.toBeUndefined();
    expect(table.handInProgress).toBe(false);
    expect(table.blackjackRounds.size).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe('Table startHand failure clears blackjackSettledSeats', () => {
  // NOTE ON REACHABILITY: this is a defensive invariant, not a live
  // reproduction. `blackjackSettledSeats` is only ever populated by
  // settleBlackjackSeatIfNeeded, reached via advanceBlackjackTurn (formerly
  // advancePastSettledBlackjackRounds) -- and every exit from that method either resets the set
  // (finishBlackjackHandIfComplete, which runs *before* its own failing
  // clear(); or voidBlackjackHand) or returns early with the hand still live
  // and startHand's catch not involved. The one path that used to escape into
  // startHand's catch with the set populated -- a settlement throwing mid-loop
  // -- is now caught one level down, by the per-seat catch in
  // advanceBlackjackTurn (the fix above).
  //
  // The set is therefore seeded directly here. That is deliberate: the reset
  // pairs `blackjackSettledSeats` with the `blackjackRounds` reset already in
  // that catch, and the two must stay consistent, because if any future change
  // reopens a path that leaves the set populated the failure is *silent* -- a
  // stale entry makes settleBlackjackSeatIfNeeded early-return on a later,
  // unrelated hand and skip that seat's entire payout with no error and no
  // log. This test pins both the reset and that money consequence.
  it('does not let a settled-seat marker survive into a later, unrelated hand', async () => {
    const { table, playerStore, handLog } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');

    // The exact state settleBlackjackSeatIfNeeded produces: it adds the seat
    // to this set *before* either of its durable writes.
    table.blackjackSettledSeats.add(0);

    const appendSpy = vi
      .spyOn(handLog, 'append')
      .mockRejectedValue(new Error('simulated disk failure'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await table.setReady(0);
    await table.setReady(1);

    expect(table.handInProgress).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    // The invariant: the catch resets this alongside blackjackRounds.
    expect(table.blackjackSettledSeats.size).toBe(0);

    // The money consequence, proven rather than asserted in the abstract: the
    // next hand must actually pay seat 0. Pre-fix, the stale entry survived
    // and alice's payout was silently skipped.
    appendSpy.mockRestore();
    const setBalanceSpy = vi.spyOn(playerStore, 'setBalance');

    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);
    while (table.handInProgress && table.activeSeatIndex !== null) {
      await table.submitAction(table.activeSeatIndex, 'stand');
    }
    expect(table.handInProgress).toBe(false);

    const paid = setBalanceSpy.mock.calls.map((c) => c[0]);
    expect(paid).toContain('alice');
    expect(paid).toContain('bob');

    vi.restoreAllMocks();
  });
});

describe('Table reconnect re-checks the ready gate (I1)', () => {
  it('starts a hand on reconnect when the returning seat was already ready', async () => {
    // Pre-fix deadlock: bob readies, drops, and comes back still flagged
    // ready. Both seats then show connected+ready with no hand in progress,
    // and nothing is left to trigger one -- no client message changes that.
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');

    await table.setReady(1);
    table.disconnect(1);
    await table.setReady(0);
    expect(table.handInProgress).toBe(false); // bob is away; only one eligible seat

    expect(table.reconnect('bob')).toBe(1);
    await wait(0); // reconnect fires the ready-gate re-check without awaiting it

    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand).not.toBeNull();
  });
});

describe('Table startHand failure safety net (C1 residual)', () => {
  it('reverts to no-hand-in-progress and clears the log when starting a hand throws', async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');

    // A hand-start failure unrelated to the now-filtered 0-balance case: the
    // durable write of the hand's opening entry rejects. Pre-fix this escaped
    // startHand with handInProgress already true, bricking the table.
    const appendSpy = vi.spyOn(handLog, 'append').mockRejectedValue(new Error('simulated disk failure'));
    const clearSpy = vi.spyOn(handLog, 'clear');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await table.setReady(0);
    await expect(table.setReady(1)).resolves.toBeUndefined();

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(table.activeSeatIndex).toBeNull();
    expect(table.blackjackRounds.size).toBe(0);
    expect(clearSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    appendSpy.mockRestore();
    errorSpy.mockRestore();

    // The table is genuinely usable again, not just superficially reset.
    await table.setReady(0);
    expect(table.handInProgress).toBe(true);
  });
});

describe('Table settlement survives a rejected balance write (I6)', () => {
  function makeFlakyTable(overrides: Partial<TableConfig> = {}) {
    const config: TableConfig = {
      gameMode: 'holdem',
      seatCount: 8,
      smallBlind: 5,
      bigBlind: 10,
      blackjackDefaultBet: 25,
      defaultStartingBalance: 1000,
      reconnectGraceMs: 50,
      random: makeDeterministicRandom(2),
      ...overrides,
    };
    const playerStore = new FlakyPlayerStore(config.defaultStartingBalance);
    const handLog = new FakeHandLog();
    const table = new Table(config, { playerStore, handLog, onStateChange: () => {} });
    return { table, playerStore, handLog };
  }

  it("Hold'em: one player's failed persist blocks neither the other player's write nor the table", async () => {
    const { table, playerStore, handLog } = makeFlakyTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    playerStore.rejectSetBalanceFor.add('alice');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Heads-up: alice (button) acts first preflop; folding settles the hand.
    await expect(table.submitAction(0, 'fold')).resolves.toBeUndefined();

    // Both writes were attempted regardless of which one the results loop
    // reached first -- the rejection did not abort the loop.
    const attempted = playerStore.setBalanceCalls.map((c) => c.displayName);
    expect(attempted).toContain('alice');
    expect(attempted).toContain('bob');
    // bob's durable write still landed.
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005);
    // alice's did not, but her in-memory balance is still correct and
    // self-corrects on the next successful write.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
    expect(table.seats[0]?.balance).toBe(995);

    // The table completed its state transition instead of sticking mid-hand.
    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(table.seats.every((s) => s === null || !s.ready)).toBe(true);
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // ...and can start the next hand.
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);
  });

  it('Blackjack: a failed persist does not pin activeSeatIndex to an already-settled round', async () => {
    const { table, playerStore } = makeFlakyTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    playerStore.rejectSetBalanceFor.add('alice');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(table.submitAction(0, 'stand')).resolves.toBeUndefined();
    // Pre-fix (and pre-shared-dealer, when a seat settled as soon as it
    // finished), the rejection propagated out of
    // advancePastSettledBlackjackRounds' while-loop, leaving activeSeatIndex
    // stuck on seat 0 whose round is already 'settled' -- so every further
    // action on it threw and the hand could never finish.
    expect(table.activeSeatIndex).toBe(1);

    await expect(table.submitAction(1, 'stand')).resolves.toBeUndefined();
    expect(table.handInProgress).toBe(false);
    expect(table.blackjackRounds.size).toBe(0);

    // bob's seat settled and persisted normally despite alice's failure.
    expect(playerStore.setBalanceCalls.map((c) => c.displayName)).toContain('bob');
    await expect(playerStore.getBalance('bob')).resolves.toBe(table.seats[1]!.balance);
    // alice's durable write never landed; her in-memory balance is authoritative.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('Table.recoverFromLog', () => {
  it('is a no-op when the log is empty', async () => {
    const { table } = makeTable();
    await table.recoverFromLog();
    expect(table.handInProgress).toBe(false);
    expect(table.seats.every((s) => s === null)).toBe(true);
  });

  it('reconstructs an in-progress Hold\'em hand and marks recovered seats disconnected', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    const { createDeck, shuffle } = await import('@poker-blackjack/game-engine');
    const config = { smallBlind: 5, bigBlind: 10, buttonIndex: 0, deck: shuffle(createDeck(), Math.random) };
    await handLog.append({
      type: 'holdem_hand_started',
      data: {
        players: [
          { playerId: 'alice', stack: 1000 },
          { playerId: 'bob', stack: 1000 },
        ],
        config,
      },
    });
    await handLog.append({
      type: 'holdem_action',
      data: { playerId: 'alice', action: 'call' },
    });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(true);
    expect(table.holdemHand).not.toBeNull();
    expect(table.holdemHand!.actingPlayerId).toBe('bob'); // alice called, action moved to bob
    expect(table.seats[0]?.displayName).toBe('alice');
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
    // Recovery starts the same grace-window mechanism as an ordinary disconnect --
    // reconnect() should succeed for a recovered seat.
    expect(table.reconnect('alice')).toBe(0);
  });

  // A heads-up hand where alice (button, small blind) folds preflop: alice ends on 995, bob on 1005.
  async function aliceFoldsLog(stacks: { alice: number; bob: number } = { alice: 1000, bob: 1000 }) {
    const { createDeck, shuffle } = await import('@poker-blackjack/game-engine');
    const config = { smallBlind: 5, bigBlind: 10, buttonIndex: 0, deck: shuffle(createDeck(), Math.random) };
    return [
      {
        type: 'holdem_hand_started',
        data: {
          players: [
            { playerId: 'alice', stack: stacks.alice },
            { playerId: 'bob', stack: stacks.bob },
          ],
          config,
        },
      },
      { type: 'holdem_action', data: { playerId: 'alice', action: 'fold' } },
    ] as HandLogEntry[];
  }

  it('I3: pays out a Hold\'em hand that was decided before the crash but never written', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    handLog.entries = await aliceFoldsLog();

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(table.seats.every((s) => s === null)).toBe(true);
    await expect(handLog.readAll()).resolves.toEqual([]);
    await expect(playerStore.getBalance('alice')).resolves.toBe(995);
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005);
  });

  it('I3: recovering a settled hand is idempotent (balances are absolute, not added again)', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    const log = await aliceFoldsLog();
    // Both live writes landed; the crash came before the log was cleared.
    await playerStore.setBalance('alice', 995);
    await playerStore.setBalance('bob', 1005);
    handLog.entries = log;
    await table.recoverFromLog();
    // And again, as if the first recovery's clear had been lost too.
    const again = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, random: makeDeterministicRandom(2),
      },
      { playerStore, handLog, onStateChange: () => {} }
    );
    handLog.entries = log;
    await again.recoverFromLog();

    await expect(playerStore.getBalance('alice')).resolves.toBe(995);
    await expect(playerStore.getBalance('bob')).resolves.toBe(1005);
  });

  it('I3: finishes a live settlement that crashed between the two balance writes (chips conserved)', async () => {
    const live = makeTable();
    await live.table.join('alice');
    await live.table.join('bob');
    await live.table.setReady(0);
    await live.table.setReady(1);
    let writes = 0;
    const realSet = live.playerStore.setBalance.bind(live.playerStore);
    // The second write never lands: that is the crash.
    live.playerStore.setBalance = (name: string, balance: number) =>
      ++writes === 1 ? realSet(name, balance) : new Promise<void>(() => {});
    const folder = live.table.holdemHand!.actingPlayerId!;
    void live.table.submitAction(live.table.seats.findIndex((s) => s?.displayName === folder), 'fold');
    await wait(10);
    expect(writes).toBe(2);

    // A fresh server: the same balances file, the same uncleared log.
    const recovered = makeTable();
    for (const name of ['alice', 'bob']) {
      await recovered.playerStore.setBalance(name, await live.playerStore.getBalance(name));
    }
    recovered.handLog.entries = JSON.parse(JSON.stringify(live.handLog.entries));
    await recovered.table.recoverFromLog();

    const other = folder === 'alice' ? 'bob' : 'alice';
    await expect(recovered.playerStore.getBalance(folder)).resolves.toBe(995);
    await expect(recovered.playerStore.getBalance(other)).resolves.toBe(1005);
    expect(recovered.handLog.entries).toEqual([]);
  });

  it('I3: a failed write while recovering a settled hand still writes the others and clears the log', async () => {
    // Keeping the log would be worse: startHand appends to it, so the next hand's entries would
    // follow this hand's start entry and the next recovery would replay a mix of both.
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    const realSet = playerStore.setBalance.bind(playerStore);
    playerStore.setBalance = async (name: string, balance: number) => {
      if (name === 'alice') throw new Error('disk full');
      return realSet(name, balance);
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    handLog.entries = await aliceFoldsLog();

    await table.recoverFromLog();

    await expect(playerStore.getBalance('bob')).resolves.toBe(1005);
    expect(handLog.entries).toEqual([]);
    // The admin can set it by hand from the server log.
    expect(errors.mock.calls.some((c) => String(c[0]).includes('alice') && String(c[0]).includes('995'))).toBe(true);
    errors.mockRestore();
  });

  it('seats an unfinished recovered Hold\'em hand with the stacks it was dealt from, not the balances file', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
    // An earlier best-effort write failed, so the file is behind the live balance.
    await playerStore.setBalance('alice', 700);
    const [started] = await aliceFoldsLog({ alice: 900, bob: 1000 });
    handLog.entries = [started, { type: 'holdem_action', data: { playerId: 'alice', action: 'call' } }];

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(true);
    expect(table.seats[0]?.balance).toBe(900);
    expect(table.seats[1]?.balance).toBe(1000);
  });

  it('reconstructs an in-progress Blackjack hand from a hand-crafted shared shoe', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    // Neither seat's first two cards are a natural blackjack.
    await handLog.append(bjStart(SHOE_IN_PROGRESS));
    await handLog.append({ type: 'blackjack_action', data: { seatIndex: 0, action: 'hit' } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(true);
    expect(table.blackjackRounds.get(0)!.playerHands[0].cards).toHaveLength(3); // 2 dealt + 1 hit
    expect(table.activeSeatIndex).toBe(0); // seat 0's round is still in progress
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
  });

  it('skips a seat that was already complete at deal time (natural blackjack) during recovery, without paying it early', async () => {
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await handLog.append(bjStart(SHOE_ALICE_NATURAL));

    await table.recoverFromLog();

    expect(table.activeSeatIndex).toBe(1); // seat 0 is complete and skipped
    // ...but nobody is paid until the last seat has acted and the dealer has played.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
    expect(handLog.entries.filter((e) => e.type === 'blackjack_seat_settled')).toEqual([]);
  });

  it('preserves seats and completes cleanup when every Blackjack seat was already settled and marked before the crash', async () => {
    // A crash between the last seat's payout commit and the final handLog.clear():
    // every settlement was already applied and marked, so recovery must finish the
    // interrupted cleanup WITHOUT re-paying anyone.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1500); // reflects a payout already applied pre-crash
    await playerStore.setBalance('bob', 800); // reflects a payout already applied pre-crash
    await handLog.append(bjStart(SHOE_BOTH_NATURAL));
    await handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex: 0 } });
    await handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex: 1 } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(table.seats[0]?.displayName).toBe('alice');
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
    expect(table.seats[1]?.connected).toBe(false);
    await expect(playerStore.getBalance('alice')).resolves.toBe(1500);
    await expect(playerStore.getBalance('bob')).resolves.toBe(800);
  });

  it('pays every seat exactly once when the hand completes after recovery', async () => {
    // Alice has a natural, bob is still to act. Nothing is paid at recovery; once
    // bob stands, the dealer plays once and BOTH seats are paid exactly once.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await handLog.append(bjStart(SHOE_ALICE_NATURAL));

    await table.recoverFromLog();
    expect(table.activeSeatIndex).toBe(1);
    expect(table.handInProgress).toBe(true);
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);

    await table.submitAction(1, 'stand');

    // Dealer 9,9 = 18. Alice's natural pays 3:2; bob's 5,6 = 11 loses.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1037.5);
    await expect(playerStore.getBalance('bob')).resolves.toBe(975);
    expect(table.handInProgress).toBe(false);
  });

  it('finishes only the unpaid seat when a crash landed between two seats settlements', async () => {
    // The real crash window in the shared-dealer flow: every action is logged (the
    // hand is complete), seat 0 was paid AND marked, but the process died before
    // seat 1's payout. Recovery must NOT re-pay seat 0, and must pay seat 1 once.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1500); // reflects the payout already applied pre-crash
    await playerStore.setBalance('bob', 1000);
    await handLog.append(bjStart(SHOE_ALICE_NATURAL));
    await handLog.append({ type: 'blackjack_action', data: { seatIndex: 1, action: 'stand' } });
    await handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex: 0 } });

    const appendSpy = vi.spyOn(handLog, 'append');
    await table.recoverFromLog();

    await expect(playerStore.getBalance('alice')).resolves.toBe(1500); // not re-paid
    await expect(playerStore.getBalance('bob')).resolves.toBe(975); // paid now: 5,6 loses to dealer 18
    const markers = appendSpy.mock.calls.filter(([e]) => e.type === 'blackjack_seat_settled');
    expect(markers).toHaveLength(1); // only bob's new marker; alice's already existed
    expect(markers[0][0].data).toEqual({ seatIndex: 1 });
    expect(table.handInProgress).toBe(false);
  });

  it('writes the settlement marker before committing the balance (write-ahead ordering)', async () => {
    // settleBlackjackSeatIfNeeded must append the blackjack_seat_settled marker
    // BEFORE calling playerStore.setBalance, so a crash between the two durable
    // writes leaves a recoverable "lost payout" rather than a re-payable "double
    // payout". Recovery of a complete hand exercises the same call site as live play.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await handLog.append(bjStart(SHOE_ALICE_NATURAL));
    await handLog.append({ type: 'blackjack_action', data: { seatIndex: 1, action: 'stand' } });

    const appendSpy = vi.spyOn(handLog, 'append');
    const setBalanceSpy = vi.spyOn(playerStore, 'setBalance');

    await table.recoverFromLog();

    const markerCallIndex = appendSpy.mock.calls.findIndex(
      ([entry]) => entry.type === 'blackjack_seat_settled'
    );
    const balanceCallIndex = setBalanceSpy.mock.calls.findIndex(([name]) => name === 'alice');
    expect(markerCallIndex).toBeGreaterThanOrEqual(0);
    expect(balanceCallIndex).toBeGreaterThanOrEqual(0);
    // invocationCallOrder uses a global counter shared across all mocks, so
    // comparing across these two spies genuinely proves relative call order.
    expect(appendSpy.mock.invocationCallOrder[markerCallIndex]).toBeLessThan(
      setBalanceSpy.mock.invocationCallOrder[balanceCallIndex]
    );
  });

  it('discards a Blackjack hand log written in the old per-seat-shoe format', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    await handLog.append({
      type: 'blackjack_hand_started',
      data: { rounds: [{ seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: [] }] },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await table.recoverFromLog();
    expect(table.handInProgress).toBe(false);
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('recovers cleanly from a corrupted/torn log entry instead of crash-looping on every future boot', async () => {
    // Simulates a process killed mid-appendFile leaving a torn final JSONL
    // line: the first entry is missing its `rounds` field entirely, so
    // destructuring it and then calling `rounds.map(...)` during replay
    // throws a TypeError. Pushed directly into `.entries` (bypassing
    // `append`) because this stands in for data that already made it onto
    // disk malformed -- not data Table itself would ever produce.
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    handLog.entries.push({ type: 'blackjack_hand_started', data: {} });

    await expect(table.recoverFromLog()).resolves.toBeUndefined();

    // The corrupted log must be discarded, not left in place -- otherwise
    // every subsequent boot would hit the same throw and the server could
    // never start.
    await expect(handLog.readAll()).resolves.toEqual([]);
  });

  it("discards a Hold'em log rather than replaying it into a Blackjack-configured table (I3)", async () => {
    // A restart reconfigured to the other game mode finds the previous mode's
    // log still on disk. Pre-fix the branch matched on entry type alone, so a
    // Blackjack table happily replayed a Hold'em hand -- seating players and
    // setting handInProgress against a mode that has no way to act on it.
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    const { createDeck, shuffle } = await import('@poker-blackjack/game-engine');
    await handLog.append({
      type: 'holdem_hand_started',
      data: {
        players: [
          { playerId: 'alice', stack: 1000 },
          { playerId: 'bob', stack: 1000 },
        ],
        config: { smallBlind: 5, bigBlind: 10, buttonIndex: 0, deck: shuffle(createDeck(), Math.random) },
      },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(table.blackjackRounds.size).toBe(0);
    expect(table.seats.every((s) => s === null)).toBe(true);
    // Cleared, not left in place: otherwise the mismatched entry would poison
    // every future boot permanently -- this failure mode survives a restart.
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("discards a Blackjack log rather than replaying it into a Hold'em-configured table (I3)", async () => {
    const { table, handLog } = makeTable({ gameMode: 'holdem' });
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          {
            seatIndex: 0,
            displayName: 'alice',
            initialBet: 25,
            shoe: [card('5', 'clubs'), card('6', 'clubs'), card('7', 'hearts'), card('8', 'hearts'), card('2', 'spades')],
          },
        ],
      },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.blackjackRounds.size).toBe(0);
    expect(table.seats.every((s) => s === null)).toBe(true);
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('discards a log whose first entry is an unrecognized type instead of leaving it to poison every boot (I4)', async () => {
    const { table, handLog } = makeTable();
    handLog.entries.push({ type: 'some_future_entry_type', data: { anything: true } });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.seats.every((s) => s === null)).toBe(true);
    // Pre-fix this fell through the if/else-if with no else: nothing replayed,
    // and critically nothing cleared, so the same entry re-ran forever.
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('Table.getStateForSeat', () => {
  it('hides the dealer hole card in Blackjack until settled', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const view = table.getStateForSeat(0);
    expect(view.blackjackRounds![0].dealerUpcard).toBeDefined();
    expect(view.blackjackRounds![0].dealerCards).toBeNull();
    expect(view.blackjackRounds![0].results).toBeNull();
  });

  it('reveals the full dealer hand and results once the hand settles', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'stand');
    await table.submitAction(1, 'stand');

    const view = table.getStateForSeat(0);
    expect(view.blackjackRounds![0].dealerCards).not.toBeNull();
    expect(view.blackjackRounds![0].results).not.toBeNull();
  });

  it('shows a Hold\'em player their own hole cards but not an opponent\'s', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const aliceView = table.getStateForSeat(0);
    const alice = aliceView.holdem!.players.find((p) => p.playerId === 'alice')!;
    const bobFromAliceView = aliceView.holdem!.players.find((p) => p.playerId === 'bob')!;
    expect(alice.holeCards).not.toBeNull();
    expect(bobFromAliceView.holeCards).toBeNull();
  });

  it('keeps a fold-out winner\'s hole cards hidden from the loser and from spectators', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'call');
    await table.submitAction(1, 'fold');

    // Nobody called alice down, so she never has to show: not to bob, not to a spectator.
    for (const viewer of [null, 1]) {
      const alice = table.getStateForSeat(viewer).holdem!.players.find((p) => p.playerId === 'alice')!;
      expect(alice.holeCards).toBeNull();
    }
    const bobFromSpectator = table.getStateForSeat(null).holdem!.players.find((p) => p.playerId === 'bob')!;
    expect(bobFromSpectator.holeCards).toBeNull();
    // The winner still sees her own cards.
    const aliceOwn = table.getStateForSeat(0).holdem!.players.find((p) => p.playerId === 'alice')!;
    expect(aliceOwn.holeCards).not.toBeNull();
  });

  it('reveals every non-folded player\'s hole cards to everyone after a real showdown', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    // Heads-up: alice (button) acts first preflop, bob acts first on every later street.
    await table.submitAction(0, 'call');
    await table.submitAction(1, 'check');
    for (let street = 0; street < 3; street++) {
      await table.submitAction(1, 'check');
      await table.submitAction(0, 'check');
    }

    const spectatorView = table.getStateForSeat(null);
    expect(spectatorView.holdem!.street).toBe('settled');
    for (const p of spectatorView.holdem!.players) {
      expect(p.holeCards).not.toBeNull();
    }
  });

  it('an empty seat has a null displayName and no other identifying data', async () => {
    const { table } = makeTable();
    await table.join('alice');
    const view = table.getStateForSeat(0);
    expect(view.seats[1]).toEqual({ seatIndex: 1, displayName: null, balance: 0, connected: false, ready: false });
  });

  it('keeps the full settled Blackjack table visible via a snapshot after every seat has settled and the live rounds map is cleared', async () => {
    // Mirrors the Task 4/5 test 'finishes the table hand and commits balances
    // once every seat's round settles': once BOTH seats settle,
    // finishBlackjackHandIfComplete() replaces the live this.blackjackRounds
    // with a fresh empty Map -- so getStateForSeat must fall back to a
    // snapshot taken just before that replacement, or clients would never
    // see the final dealer hand/results for a hand that's fully complete
    // (as opposed to the already-covered case of just one seat settling
    // while the other is still mid-round, where the live map still holds
    // the data).
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'stand');
    await table.submitAction(1, 'stand');

    expect(table.blackjackRounds.size).toBe(0); // live map is cleared, same as the pre-existing test
    expect(table.handInProgress).toBe(false);

    const view = table.getStateForSeat(null);
    expect(view.blackjackRounds).not.toBeNull();
    expect(view.blackjackRounds![0].dealerCards).not.toBeNull();
    expect(view.blackjackRounds![0].results).not.toBeNull();
    expect(view.blackjackRounds![1].dealerCards).not.toBeNull();
    expect(view.blackjackRounds![1].results).not.toBeNull();
  });
});


describe('Table hand-log write-ahead and shoe exhaustion', () => {
  it('rejects a Blackjack action when its log write fails, leaving the hand exactly as it was', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack', random: makeDeterministicRandom(3) });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const cardsBefore = JSON.stringify(table.blackjackRounds.get(0)!.playerHands);
    const dealerBefore = JSON.stringify(table.blackjackRounds.get(0)!.getDealerCards());

    vi.spyOn(handLog, 'append').mockRejectedValueOnce(new Error('disk full'));
    await expect(table.submitAction(0, 'hit')).rejects.toThrow('disk full');

    expect(JSON.stringify(table.blackjackRounds.get(0)!.playerHands)).toBe(cardsBefore); // no card drawn
    expect(JSON.stringify(table.blackjackRounds.get(0)!.getDealerCards())).toBe(dealerBefore);
    expect(table.activeSeatIndex).toBe(0);
    // ...and the same action goes through once the log works again.
    await table.submitAction(0, 'hit');
    expect(table.blackjackRounds.get(0)!.playerHands[0].cards.length).toBeGreaterThan(2);
  });

  it("rejects a Hold'em action when its log write fails, leaving the hand exactly as it was", async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const hand = table.holdemHand!;

    vi.spyOn(handLog, 'append').mockRejectedValueOnce(new Error('disk full'));
    await expect(table.submitAction(0, 'call')).rejects.toThrow('disk full');

    expect(table.holdemHand!.actingPlayerId).toBe('alice');
    expect(hand.players.find((p) => p.playerId === 'alice')!.streetContributed).toBe(5); // still just the small blind
    await table.submitAction(0, 'call');
    expect(hand.actingPlayerId).toBe('bob');
  });

  it('replays a hand identically even though a rejected action was logged (write-ahead)', async () => {
    // Seed 3: alice hits to a live 3-card hand, so a following double is rejected by the engine
    // AFTER its log entry was written.
    const live = makeTable({ gameMode: 'blackjack', random: makeDeterministicRandom(3) });
    await live.table.join('alice');
    await live.table.join('bob');
    await live.table.setReady(0);
    await live.table.setReady(1);
    await live.table.submitAction(0, 'hit');
    await expect(live.table.submitAction(0, 'double')).rejects.toThrow('first two cards');
    expect(live.handLog.entries.filter((e) => e.type === 'blackjack_action')).toHaveLength(2);

    const recovered = makeTable({ gameMode: 'blackjack' });
    recovered.handLog.entries = JSON.parse(JSON.stringify(live.handLog.entries));
    await recovered.table.recoverFromLog();

    const cards = (t: Table) => t.blackjackRounds.get(0)!.playerHands.map((h) => h.cards);
    expect(cards(recovered.table)).toEqual(cards(live.table));
    expect(recovered.table.activeSeatIndex).toBe(live.table.activeSeatIndex);
    expect(recovered.table.blackjackRounds.get(0)!.playerHands[0].bet).toBe(25); // the rejected double did not stick
  });

  it('voids the Blackjack hand with no balance changes if the dealer cannot play, instead of locking the table', async () => {
    const { SharedDealer } = await import('@poker-blackjack/game-engine');
    const { table, playerStore, handLog } = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'stand');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dealerSpy = vi.spyOn(SharedDealer.prototype, 'playAndSettle').mockImplementation(() => {
      throw new Error('Shoe is empty');
    });
    await table.submitAction(1, 'stand');
    dealerSpy.mockRestore();
    errorSpy.mockRestore();

    expect(table.handInProgress).toBe(false);
    expect(table.activeSeatIndex).toBeNull();
    expect(table.blackjackRounds.size).toBe(0);
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
    await expect(playerStore.getBalance('bob')).resolves.toBe(1000);
    await expect(handLog.readAll()).resolves.toEqual([]);
    expect(table.seats.every((s) => !s || !s.ready)).toBe(true);

    // The table is usable again: both ready up and a fresh hand deals.
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);
  });
});

describe('Table concurrency (audit C3, I1, I2)', () => {
  // Dealer 9,8 | alice 8,8 (a pair she can split) | bob 4,5 | then draws.
  const SHOE_ALICE_PAIR = parseCards(['9h', '8h', '8c', '8d', '4d', '5d', '2s', '3s', '4s', '5s', '6s', '7s']);

  async function aliceHoldsAPair(aliceBalance: number) {
    const made = makeTable({ gameMode: 'blackjack', blackjackDefaultBet: 25 });
    await made.playerStore.setBalance('alice', aliceBalance);
    await made.table.recoverFromLog([bjStart(SHOE_ALICE_PAIR)]);
    // Recovery marks every seat disconnected; bring both back so no grace timer auto-acts.
    made.table.reconnect('alice');
    made.table.reconnect('bob');
    return made;
  }

  it('C3: a split and a double sent together are checked one after the other, so the balance cannot go negative', async () => {
    const { table, playerStore } = await aliceHoldsAPair(50);
    expect(table.activeSeatIndex).toBe(0);

    // Split takes exposure to 50 (all of alice's balance); a double on top would risk 75.
    const results = await Promise.allSettled([table.submitAction(0, 'split'), table.submitAction(0, 'double')]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/Insufficient balance to double/);

    while (table.handInProgress && table.activeSeatIndex !== null) {
      await table.submitAction(table.activeSeatIndex, 'stand');
    }
    expect(await playerStore.getBalance('alice')).toBeGreaterThanOrEqual(0);
  });

  it('I1: a repeated action carrying the same action sequence number is rejected as stale', async () => {
    const { table } = await aliceHoldsAPair(1000);
    const seq = table.actionSeq;

    const results = await Promise.allSettled([
      table.submitAction(0, 'hit', undefined, seq),
      table.submitAction(0, 'hit', undefined, seq),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/already been handled/);
    expect(table.blackjackRounds.get(0)!.playerHands[0].cards).toHaveLength(3); // one hit, not two
  });

  it('I1: the action sequence number is published in every table view and moves on after each action', async () => {
    const { table } = await aliceHoldsAPair(1000);
    const before = table.getStateForSeat(0).actionSeq;
    expect(before).toBe(table.actionSeq);
    await table.submitAction(0, 'hit', undefined, before);
    expect(table.getStateForSeat(0).actionSeq).toBeGreaterThan(before);
  });

  it('I2: adminSetBalance is refused while a hand is in progress', async () => {
    const { table, playerStore } = await aliceHoldsAPair(1000);
    await expect(table.adminSetBalance('alice', 5)).rejects.toThrow(/in an active hand/);
    expect(table.seats[0]!.balance).toBe(1000);
    expect(await playerStore.getBalance('alice')).toBe(1000);
  });

  it('I2: adminSetBalance rejects a name that is not seated', async () => {
    const { table } = makeTable();
    await expect(table.adminSetBalance('nobody', 5)).rejects.toThrow(/No player named "nobody"/);
  });

  it('I2: a hand cannot start while an admin balance write is still being saved, and then uses the new balance', async () => {
    let releaseWrite!: () => void;
    const playerStore = new FakePlayerStore(1000);
    const realSet = playerStore.setBalance.bind(playerStore);
    let holdWrites = false;
    playerStore.setBalance = async (name: string, balance: number) => {
      if (holdWrites) await new Promise<void>((r) => (releaseWrite = r));
      return realSet(name, balance);
    };
    const handLog = new FakeHandLog();
    const table = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, random: makeDeterministicRandom(2),
      },
      { playerStore, handLog, onStateChange: () => {} }
    );
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);

    holdWrites = true;
    const adjust = table.adminSetBalance('alice', 0);
    const ready = table.setReady(1); // the last Ready lands while the write is in flight
    await new Promise((r) => setTimeout(r, 10));
    expect(table.handInProgress).toBe(false); // waits for the admin write
    holdWrites = false;
    releaseWrite();
    await adjust;
    await ready;

    // alice now has 0, so she is not eligible and no hand starts with her old 1000.
    expect(table.handInProgress).toBe(false);
    expect(handLog.entries).toHaveLength(0);
    expect(await playerStore.getBalance('alice')).toBe(0);
  });

  it('I2: a retired table never starts a hand or writes to the shared hand log', async () => {
    const { table, handLog } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    table.retire();
    await table.setReady(1);
    expect(table.handInProgress).toBe(false);
    expect(handLog.entries).toHaveLength(0);
  });

  it('M5: a hand that fails to start does not move the dealer button', async () => {
    async function firstDealtButton(failFirstStart: boolean): Promise<unknown> {
      const { table, handLog } = makeTable();
      const realAppend = handLog.append.bind(handLog);
      let failNext = failFirstStart;
      handLog.append = async (entry) => {
        if (failNext) {
          failNext = false;
          throw new Error('disk full');
        }
        return realAppend(entry);
      };
      await table.join('alice');
      await table.join('bob');
      await table.join('carol');
      await table.setReady(0);
      await table.setReady(1);
      await table.setReady(2);
      if (failFirstStart) {
        expect(table.handInProgress).toBe(false);
        await table.setReady(0); // retry: everyone is still ready
      }
      expect(table.handInProgress).toBe(true);
      const started = handLog.entries.find((e) => e.type === 'holdem_hand_started') as
        | { data: { config: { buttonIndex: number } } }
        | undefined;
      return started?.data.config.buttonIndex;
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await firstDealtButton(true)).toBe(await firstDealtButton(false));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('I4: a hand that fails to start is reported in the table view until a hand starts', async () => {
    const { table, getStateChangeCount } = makeTable({ smallBlind: 50, bigBlind: 10 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const changesBefore = getStateChangeCount();
    await table.setReady(1);
    errorSpy.mockRestore();

    expect(table.handInProgress).toBe(false);
    expect(getStateChangeCount()).toBe(changesBefore + 2); // the Ready, then the failure
    expect(table.getStateForSeat(null).handStartError).toMatch(/^The hand could not start: .*blind/i);

    table.updateConfig({ smallBlind: 5 }); // the admin fixes the blinds; the ready check re-runs
    await wait(10);
    expect(table.handInProgress).toBe(true);
    expect(table.getStateForSeat(null).handStartError).toBeNull();
  });

  it('I5: topping up a ready player who could not afford the hand starts it', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.adminSetBalance('bob', 0);
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(false); // bob is not eligible, so only one player

    await table.adminSetBalance('bob', 500);
    await wait(10);
    expect(table.handInProgress).toBe(true);
  });

  it('I5: lowering the Blackjack bet so a ready player can afford it starts the hand', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.adminSetBalance('bob', 10);
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(false); // bob can't cover the 25 bet

    table.updateConfig({ blackjackDefaultBet: 10 });
    await wait(10);
    expect(table.handInProgress).toBe(true);
  });

  it('I2: a hand start already queued on the lock when the table is retired never runs', async () => {
    // What the mode switch relies on: the last Ready can queue a start behind other locked work
    // (here an admin balance write) just before retire() is called.
    let releaseWrite!: () => void;
    const playerStore = new FakePlayerStore(1000);
    const realSet = playerStore.setBalance.bind(playerStore);
    let holdWrites = false;
    playerStore.setBalance = async (name: string, balance: number) => {
      if (holdWrites) await new Promise<void>((r) => (releaseWrite = r));
      return realSet(name, balance);
    };
    const handLog = new FakeHandLog();
    const table = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, random: makeDeterministicRandom(2),
      },
      { playerStore, handLog, onStateChange: () => {} }
    );
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);

    holdWrites = true;
    const adjust = table.adminSetBalance('bob', 500); // holds the lock
    const ready = table.setReady(1); // queues the hand start behind it
    await new Promise((r) => setTimeout(r, 10));
    table.retire();
    holdWrites = false;
    releaseWrite();
    await adjust;
    await ready;

    expect(table.handInProgress).toBe(false);
    expect(handLog.entries).toHaveLength(0);
  });

  it('MIN-1: a leave and rejoin sent during an admin balance write wait for it, so the correction sticks', async () => {
    // The live seat used to keep the old balance (the write landed on the detached Seat object),
    // and the next settlement overwrote the correction. Holds because leave runs under the lock.
    let releaseWrite!: () => void;
    const playerStore = new FakePlayerStore(1000);
    const realSet = playerStore.setBalance.bind(playerStore);
    let holdWrites = false;
    playerStore.setBalance = async (name: string, balance: number) => {
      if (holdWrites) await new Promise<void>((r) => (releaseWrite = r));
      return realSet(name, balance);
    };
    const table = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, random: makeDeterministicRandom(2),
      },
      { playerStore, handLog: new FakeHandLog(), onStateChange: () => {} }
    );
    await table.join('alice');

    holdWrites = true;
    const adjust = table.adminSetBalance('alice', 5);
    await wait(10);
    const rejoin = table.leave(0).then(() => table.join('alice'));
    await wait(10);
    holdWrites = false;
    releaseWrite();
    await adjust;
    const seatIndex = await rejoin;

    await expect(playerStore.getBalance('alice')).resolves.toBe(5);
    expect(table.seats[seatIndex]?.balance).toBe(5);
  });

  it('MIN-2: retire() resolves only once an admin balance write already running has landed', async () => {
    let releaseWrite!: () => void;
    const playerStore = new FakePlayerStore(1000);
    const realSet = playerStore.setBalance.bind(playerStore);
    playerStore.setBalance = async (name: string, balance: number) => {
      await new Promise<void>((r) => (releaseWrite = r));
      return realSet(name, balance);
    };
    const table = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, random: makeDeterministicRandom(2),
      },
      { playerStore, handLog: new FakeHandLog(), onStateChange: () => {} }
    );
    await table.join('alice');
    const adjust = table.adminSetBalance('alice', 5);
    await wait(10);

    let drained = false;
    const retired = table.retire().then(() => (drained = true));
    await wait(10);
    expect(drained).toBe(false);

    releaseWrite();
    await adjust;
    await retired;
    await expect(playerStore.getBalance('alice')).resolves.toBe(5);
  });

  it('MIN-2: a retired table refuses an admin balance write and writes nothing', async () => {
    const { table, playerStore } = makeTable();
    await table.join('alice');
    await table.retire();

    await expect(table.adminSetBalance('alice', 5)).rejects.toThrow(/replaced/);
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
  });
});

describe('Table.leave mid-hand and under the lock (audit I11)', () => {
  it('a seat that was not dealt in can leave while a hand is in progress', async () => {
    const { table, playerStore } = makeTable();
    await playerStore.setBalance('carol', 0); // broke: not dealt into Hold'em
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);

    await table.leave(2);
    expect(table.seats[2]).toBeNull();
    expect(table.handInProgress).toBe(true);
  });

  it('a seat in the hand still cannot leave, and keeps its seat', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await expect(table.leave(0)).rejects.toThrow('Cannot leave while a hand you are in is in progress');
    expect(table.seats[0]?.displayName).toBe('alice');
  });

  it("a Hold'em player who folded mid-hand still cannot leave, keeps the seat, and the loss is settled", async () => {
    const { table, playerStore } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');
    await table.setReady(0);
    await table.setReady(1);
    await table.setReady(2);
    expect(table.handInProgress).toBe(true);
    const seatOf = (name: string) => table.seats.findIndex((s) => s?.displayName === name);

    // Three-handed: the first player to act calls, the small blind folds (5 chips already in),
    // and the hand carries on between the other two.
    await table.submitAction(seatOf(table.holdemHand!.actingPlayerId!), 'call');
    const folder = table.holdemHand!.actingPlayerId!;
    const folderSeat = seatOf(folder);
    await table.submitAction(folderSeat, 'fold');
    expect(table.handInProgress).toBe(true);

    await expect(table.leave(folderSeat)).rejects.toThrow('Cannot leave while a hand you are in is in progress');
    expect(table.seats[folderSeat]?.displayName).toBe(folder);

    // Finish the hand: the folder's chips are lost at settlement, which needs their seat.
    await table.submitAction(seatOf(table.holdemHand!.actingPlayerId!), 'fold');
    expect(table.handInProgress).toBe(false);
    await expect(playerStore.getBalance(folder)).resolves.toBe(995);
    await expect(table.leave(folderSeat)).resolves.toBeUndefined();
  });

  it('a leave sent while a hand start is mid-write waits for it, then sees the player is in the hand', async () => {
    const handLog = new ControllableHandLog();
    const config: TableConfig = {
      gameMode: 'holdem',
      seatCount: 8,
      smallBlind: 5,
      bigBlind: 10,
      blackjackDefaultBet: 25,
      defaultStartingBalance: 1000,
      reconnectGraceMs: 50,
      random: makeDeterministicRandom(2),
    };
    const table = new Table(config, { playerStore: new FakePlayerStore(1000), handLog, onStateChange: () => {} });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);

    handLog.holdAppends = true;
    const ready = table.setReady(1);
    // The hand start has set handInProgress but has not built the hand yet: nobody is dealt in.
    await vi.waitFor(() => expect(handLog.entries).toHaveLength(1));
    const leave = table.leave(0);

    handLog.releaseNextAppend();
    await ready;
    await expect(leave).rejects.toThrow('in progress');
    expect(table.seats[0]?.displayName).toBe('alice');
    expect(table.holdemHand!.players.map((p) => p.playerId)).toContain('alice');
  });

  it('runs onLeft after the seat is freed and before the state change is broadcast', async () => {
    const calls: string[] = [];
    const playerStore = new FakePlayerStore(1000);
    const table = new Table(
      {
        gameMode: 'holdem',
        seatCount: 8,
        smallBlind: 5,
        bigBlind: 10,
        blackjackDefaultBet: 25,
        defaultStartingBalance: 1000,
        reconnectGraceMs: 50,
        random: makeDeterministicRandom(2),
      },
      { playerStore, handLog: new FakeHandLog(), onStateChange: () => calls.push('broadcast') }
    );
    await table.join('alice');
    calls.length = 0;
    await table.leave(0, () => calls.push(table.seats[0] === null ? 'onLeft:freed' : 'onLeft:still-seated'));
    expect(calls).toEqual(['onLeft:freed', 'broadcast']);
  });
});

describe('Table.kick (audit I6)', () => {
  it('between hands frees the seat, and that can be what lets the ready players start', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('cara'); // connected, never clicks Ready
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(false);

    const removed: number[] = [];
    await expect(table.kick('CARA', (i) => removed.push(i))).resolves.toBe('now');
    expect(removed).toEqual([2]);
    expect(table.seats[2]).toBeNull();
    await vi.waitFor(() => expect(table.handInProgress).toBe(true));
  });

  it('rejects a name that is not seated', async () => {
    const { table } = makeTable();
    await expect(table.kick('nobody')).rejects.toThrow('No player named "nobody" is currently seated');
  });

  it("mid-hand acts for the player when they are up, and frees the seat once the hand ends (Hold'em)", async () => {
    const { table, playerStore } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // heads-up: the button acts first

    await expect(table.kick('alice')).resolves.toBe('after-hand');
    // Facing the big blind, the default is a fold, which ends the hand.
    expect(table.handInProgress).toBe(false);
    expect(table.seats[0]).toBeNull();
    await expect(playerStore.getBalance('alice')).resolves.toBe(995); // paid before the seat went
  });

  it("mid-hand, a player who is not up yet keeps the seat until the hand ends and is paid first (Hold'em)", async () => {
    const { table, playerStore } = makeTable();
    await table.join('alice'); // button
    await table.join('bob'); // small blind
    await table.join('carol'); // big blind
    await table.setReady(0);
    await table.setReady(1);
    await table.setReady(2);
    expect(table.holdemHand!.actingPlayerId).toBe('alice');

    await table.kick('carol');
    expect(table.seats[2]?.connected).toBe(false);
    await table.submitAction(0, 'fold');
    await table.submitAction(1, 'fold');
    // Everyone else folded, so carol wins the blinds without acting.
    expect(table.handInProgress).toBe(false);
    expect(table.seats[2]).toBeNull();
    await expect(playerStore.getBalance('carol')).resolves.toBe(1005);
  });

  it('mid-hand, the kicked player rejoining before the hand ends cancels the removal', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('carol');
    await table.setReady(0);
    await table.setReady(1);
    await table.setReady(2);

    await table.kick('carol');
    expect(table.reconnect('carol')).toBe(2);
    await table.submitAction(0, 'fold');
    await table.submitAction(1, 'fold');
    expect(table.handInProgress).toBe(false);
    expect(table.seats[2]?.displayName).toBe('carol');
  });

  it('mid-hand in Blackjack stands for the player on their turn and frees the seat after settlement', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.activeSeatIndex).toBe(0); // seed 2: no naturals

    await expect(table.kick('bob')).resolves.toBe('after-hand');
    expect(table.seats[1]).not.toBeNull();
    await table.submitAction(0, 'stand'); // bob is up next and is stood for; the dealer plays
    expect(table.handInProgress).toBe(false);
    expect(table.seats[1]).toBeNull();
  });
});

describe('Table.leave precondition (audit I11, with kick)', () => {
  it('a leave whose precondition no longer holds is refused and frees nothing', async () => {
    const { table } = makeTable();
    await table.join('alice');
    const onLeft = vi.fn();
    await expect(table.leave(0, onLeft, () => false)).rejects.toThrow('Not seated');
    expect(onLeft).not.toHaveBeenCalled();
    expect(table.seats[0]?.displayName).toBe('alice');
  });
});

describe('Table.forceDefaultAction (audit I6)', () => {
  it("acts once for whoever is up and returns their name (Hold'em fold facing a bet)", async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await expect(table.forceDefaultAction(table.actionSeq)).resolves.toBe('alice');
    expect(table.handInProgress).toBe(false);
  });

  it('a stale sequence number does nothing (a double-click must not act for the next player too)', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const seq = table.actionSeq;
    await table.forceDefaultAction(seq); // stands for alice
    await expect(table.forceDefaultAction(seq)).rejects.toThrow('already been handled');
    expect(table.activeSeatIndex).toBe(1); // bob is still up
  });

  it('rejects when no hand is in progress', async () => {
    const { table } = makeTable();
    await expect(table.forceDefaultAction()).rejects.toThrow('No hand in progress');
  });
});

describe('Table turn clock (audit I6)', () => {
  it('acts for a connected player who lets the clock run out', async () => {
    const { table } = makeTable({ turnClockMs: 40 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.handInProgress).toBe(true);
    await wait(120);
    expect(table.handInProgress).toBe(false); // alice was folded for, facing the big blind
  });

  it('an action restarts the clock for the next player', async () => {
    const { table } = makeTable({ turnClockMs: 100 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'call');
    const hand = table.holdemHand!;
    await wait(50);
    expect(hand.street).toBe('preflop');
    expect(hand.actingPlayerId).toBe('bob');
    await wait(100); // bob's clock (started at the call) has run out: checked for, on to the flop
    expect(hand.street).not.toBe('preflop');
  });

  it('is off by default', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await wait(100);
    expect(table.holdemHand!.actingPlayerId).toBe('alice');
  });

  it('can be switched on between hands with updateConfig', async () => {
    const { table } = makeTable();
    table.updateConfig({ turnClockMs: 40 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await wait(120);
    expect(table.handInProgress).toBe(false);
  });

  it('a retired table never acts on its clock', async () => {
    const { table } = makeTable({ turnClockMs: 40 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    table.retire();
    await wait(120);
    expect(table.handInProgress).toBe(true);
  });

  it('a hand that ends leaves no live clock to act on the next hand', async () => {
    const { table } = makeTable({ turnClockMs: 80 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect((table as any).turnClockTimer).not.toBeNull();
    await table.submitAction(0, 'fold'); // hand over well inside alice's clock
    expect(table.handInProgress).toBe(false);
    expect((table as any).turnClockTimer).toBeNull(); // cleared, not just guarded
    await wait(150);
    expect(table.handInProgress).toBe(false);
  });

  it('retire() clears the live timer', async () => {
    const { table } = makeTable({ turnClockMs: 60 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect((table as any).turnClockTimer).not.toBeNull();
    table.retire();
    expect((table as any).turnClockTimer).toBeNull();
  });

  it('setting the clock to 0 mid-turn cancels the running clock at once', async () => {
    const { table } = makeTable({ turnClockMs: 60 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'call'); // re-arms for bob
    expect((table as any).turnClockTimer).not.toBeNull();
    table.updateConfig({ turnClockMs: 0 });
    expect((table as any).turnClockTimer).toBeNull();
    const hand = table.holdemHand!;
    await wait(150);
    expect(hand.street).toBe('preflop'); // bob was never acted for
    expect(hand.actingPlayerId).toBe('bob');
  });

  it('a manual action before the clock fires means the old clock does not act for the next player', async () => {
    const { table } = makeTable({ turnClockMs: 80 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await wait(50);
    await table.submitAction(0, 'call'); // alice acts at ~50ms; bob's clock restarts
    await wait(50); // ~100ms: alice's original clock would have fired by now
    expect(table.holdemHand!.street).toBe('preflop');
    expect(table.holdemHand!.actingPlayerId).toBe('bob');
  });
});

describe('Table turn clock vs a queued action (audit I6)', () => {
  it('a clock that fires while the player\'s own action holds the lock does not act for the next player', async () => {
    const handLog = new ControllableHandLog();
    const playerStore = new FakePlayerStore(1000);
    const table = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, turnClockMs: 60,
        random: makeDeterministicRandom(2),
      },
      { playerStore, handLog, onStateChange: () => {} }
    );
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    handLog.holdAppends = true;
    const call = table.submitAction(0, 'call'); // suspended inside the lock, at the log write
    await wait(100); // alice's clock fires now and queues behind the lock
    handLog.holdAppends = false;
    handLog.releaseNextAppend();
    await call;
    await wait(20); // the queued clock callback has run; bob's own clock (60ms) has not
    expect(table.holdemHand!.street).toBe('preflop');
    expect(table.holdemHand!.actingPlayerId).toBe('bob');
  });
});

describe('Table turn clock switched off while queued (audit I6)', () => {
  it('a clock callback queued behind a busy lock does not act once the clock was set to 0', async () => {
    const handLog = new ControllableHandLog();
    const playerStore = new FakePlayerStore(1000);
    const table = new Table(
      {
        gameMode: 'holdem', seatCount: 8, smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25,
        defaultStartingBalance: 1000, reconnectGraceMs: 50, turnClockMs: 60,
        random: makeDeterministicRandom(2),
      },
      { playerStore, handLog, onStateChange: () => {} }
    );
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    // Hold the table lock directly, so the fired clock callback has to queue behind it.
    let release!: () => void;
    const held = (table as unknown as { runExclusive: (f: () => Promise<void>) => Promise<void> }).runExclusive(
      () => new Promise<void>((r) => (release = r))
    );
    await wait(100); // alice's clock fires and queues behind the held lock
    table.updateConfig({ turnClockMs: 0 }); // too late to clear the timer: it already fired
    release();
    await held;
    await wait(20);
    expect(table.holdemHand!.street).toBe('preflop');
    expect(table.holdemHand!.actingPlayerId).toBe('alice'); // nobody was acted for
  });
});

describe('Table view fields for the HUD (Plan B)', () => {
  it('reports the button and blind seats where startHand posted them', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.join('cara');
    await table.setReady(0);
    await table.setReady(1);
    await table.setReady(2);
    const view = table.getStateForSeat(0);
    expect([view.buttonSeatIndex, view.smallBlindSeatIndex, view.bigBlindSeatIndex]).toEqual([0, 1, 2]);
  });

  it('heads-up, the button seat is also the small blind', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const view = table.getStateForSeat(1);
    expect([view.buttonSeatIndex, view.smallBlindSeatIndex, view.bigBlindSeatIndex]).toEqual([0, 0, 1]);
  });

  it('has no blind seats in Blackjack or before the first hand', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    expect(table.getStateForSeat(0).buttonSeatIndex).toBeNull();
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const view = table.getStateForSeat(0);
    expect([view.buttonSeatIndex, view.smallBlindSeatIndex, view.bigBlindSeatIndex]).toEqual([null, null, null]);
  });

  it('adds the hand name and best five to every non-folded result at a real showdown', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'call');
    await table.submitAction(1, 'check');
    for (let street = 0; street < 3; street++) {
      await table.submitAction(1, 'check');
      await table.submitAction(0, 'check');
    }
    const results = table.getStateForSeat(null).holdem!.results!;
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(typeof r.handName).toBe('string');
      expect(r.bestCards).toHaveLength(5);
    }
  });

  it('leaves the hand name off a fold-out', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'call');
    await table.submitAction(1, 'fold');
    for (const r of table.getStateForSeat(null).holdem!.results!) {
      expect(r.handName).toBeUndefined();
      expect(r.bestCards).toBeUndefined();
    }
  });

  it('has no turn-clock time when the clock is off', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(table.getStateForSeat(0).turnClockRemainingMs).toBeNull();
  });

  it('counts the turn clock down for whoever is up, and clears it between hands', async () => {
    const { table } = makeTable({ turnClockMs: 10_000 });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const first = table.getStateForSeat(0).turnClockRemainingMs!;
    expect(first).toBeGreaterThan(9_000);
    expect(first).toBeLessThanOrEqual(10_000);
    await wait(60);
    expect(table.getStateForSeat(0).turnClockRemainingMs!).toBeLessThan(first);
    await table.submitAction(0, 'fold'); // heads-up fold-out: the hand is over
    expect(table.getStateForSeat(0).turnClockRemainingMs).toBeNull();
    table.updateConfig({ turnClockMs: 0 });
  });

  // The socket server builds every view inside onStateChange, so the clock must already be armed
  // when it fires; reading getStateForSeat afterwards would hide an arm-after-broadcast bug.
  it('arms the turn clock before it broadcasts, so each acting seat gets a fresh time', async () => {
    const emitted: { seq: number; ms: number | null }[] = [];
    const { table } = makeTable({ turnClockMs: 10_000 }, (t) => {
      const view = t.getStateForSeat(0); // the clock field is the same in every seat's view
      emitted.push({ seq: view.actionSeq, ms: view.turnClockRemainingMs });
    });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    const afterStart = emitted[emitted.length - 1];
    expect(afterStart.ms).not.toBeNull();
    expect(afterStart.ms!).toBeGreaterThan(9_000);
    await wait(80);
    await table.submitAction(0, 'call');
    const afterAction = emitted[emitted.length - 1];
    expect(afterAction.seq).toBeGreaterThan(afterStart.seq);
    expect(afterAction.ms).not.toBeNull();
    // Fresh for the next actor, not the first actor's remaining time (which is now below 9,950).
    expect(afterAction.ms!).toBeGreaterThan(9_950);
    table.updateConfig({ turnClockMs: 0 });
  });
});
