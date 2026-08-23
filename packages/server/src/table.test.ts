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
// settles it instantly and advances play past it, flaking any test that
// expects seat 0 to still be active or playable. Seed 2 is verified (by
// direct simulation of Table's exact shuffle call sequence -- one
// buildShuffledDeck(6, random) call per seated player, in seat order) to
// deal neither of 2 seated players a natural. Tests that specifically need
// genuine per-run randomness (e.g. proving two shoes are independent) pass
// `random: Math.random` as an explicit override.
function makeDeterministicRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function makeTable(overrides: Partial<TableConfig> = {}) {
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
    table.leave(0);
    expect(table.seats[0]).toBeNull();
  });

  it('leave throws on an already-empty seat', async () => {
    const { table } = makeTable();
    expect(() => table.leave(0)).toThrow('empty');
  });

  it('leave throws while a hand is in progress', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    expect(() => table.leave(0)).toThrow('in progress');
  });

  it('calls onStateChange on join and leave', async () => {
    const { table, getStateChangeCount } = makeTable();
    await table.join('alice');
    expect(getStateChangeCount()).toBe(1);
    table.leave(0);
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

describe('Table ready-gating and hand start (Blackjack)', () => {
  it('constructs one independent BlackjackRound per seated player', async () => {
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

  it('gives each round an independent shoe (different card sequences)', async () => {
    // The default deterministic random is a stateful generator whose output
    // advances across calls, so alice's and bob's sequential
    // buildShuffledDeck calls produce different shoes deterministically --
    // verified below by checking their first cards differ, with no flake
    // risk (unlike relying on Math.random's small-but-real chance of a
    // 6-deck shoe collision on the very first card, ~1.92% per run).
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    const aliceFirstCard = table.blackjackRounds.get(0)!.playerHands[0].cards[0];
    const bobFirstCard = table.blackjackRounds.get(1)!.playerHands[0].cards[0];
    expect(aliceFirstCard).not.toEqual(bobFirstCard);
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

  it('advances to the next seat once the active seat\'s round settles', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);

    await table.submitAction(0, 'stand');
    expect(table.blackjackRounds.get(0)!.phase).toBe('settled');
    expect(table.activeSeatIndex).toBe(1);
    expect(table.handInProgress).toBe(true);
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
    // against is silently using `results[0].payout` alone. Seed 20 is
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
      random: makeDeterministicRandom(20),
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

    expect(table.blackjackRounds.get(0)!.phase).toBe('settled');
    expect(table.blackjackRounds.get(0)!.results).toEqual([
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

    expect(table.blackjackRounds.get(0)?.phase).toBe('settled');
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
      expect(table.blackjackRounds.get(0)?.phase).toBe('settled'); // alice auto-stood exactly once
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

    table.leave(1); // alice leaves; handInProgress is false, so this is allowed
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
  it('two overlapping calls into settlement apply the payout exactly once instead of doubling it', async () => {
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

    // From here on, handLog.append returns a Promise that only resolves when
    // we explicitly call releaseNextAppend() -- reproducing the real await
    // point (submitAction's `await handLog.append(...)`) that the production
    // race suspends on, using the actual code path instead of a synthetic one.
    handLog.holdAppends = true;

    // Call 1: a real submitAction fold. `hand.act(...)` runs synchronously --
    // folding heads-up settles the engine-level hand immediately, so
    // hand.street flips to 'settled' and hand.results is populated -- and
    // THEN submitAction suspends on the handLog.append await, before it ever
    // reaches its own `if (hand.street === 'settled') settleHoldem(...)` call.
    const call1 = table.submitAction(0, 'fold');
    expect(hand.street).toBe('settled'); // settled by hand.act; call1 has not invoked settleHoldem yet

    // Call 2: directly invoke the private settlement path while call 1 is
    // still suspended mid-flight. This stands in for the second,
    // independently-triggered submitAction (e.g. a timer-driven auto-act)
    // that in production reaches settleHoldem while the first call is still
    // awaiting handLog.append.
    await (table as unknown as { settleHoldem(h: typeof hand): Promise<void> }).settleHoldem(hand);

    const aliceAfterCall2 = await playerStore.getBalance('alice');
    const bobAfterCall2 = await playerStore.getBalance('bob');
    // The payout was genuinely applied exactly once at this point already:
    expect(aliceAfterCall2).toBe(995); // alice folded the 5-chip small blind
    expect(bobAfterCall2).toBe(1005); // bob won alice's small blind

    // Now let call 1 resume. Without the holdemSettled guard, it would reach
    // its own `settleHoldem(hand)` call and double-apply the same payout.
    handLog.releaseNextAppend();
    await call1;

    const aliceFinal = await playerStore.getBalance('alice');
    const bobFinal = await playerStore.getBalance('bob');
    // Unchanged by call 1's resumed (guarded, no-op) attempt -- proving the
    // guard, not just trusting that it exists.
    expect(aliceFinal).toBe(aliceAfterCall2);
    expect(bobFinal).toBe(bobAfterCall2);
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
    expect(() => table.leave(0)).not.toThrow();
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
    // Seed 20 is the same one the split-payout test documents: it deals alice
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
    // never finish. Total loss of service until a restart.
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
  // settleBlackjackSeatIfNeeded, reached via advancePastSettledBlackjackRounds
  // -- and every exit from that method either resets the set
  // (finishBlackjackHandIfComplete, which runs *before* its own failing
  // clear()) or returns early with the hand still live and startHand's catch
  // not involved. The one path that used to escape into startHand's catch
  // with the set populated -- a settlement throwing mid-loop -- is now caught
  // one level down, by the advancePastSettledBlackjackRounds fix above.
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
    // Pre-fix, the rejection propagated out of
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

  it('discards an already-settled Hold\'em hand instead of re-settling it', async () => {
    const { table, handLog, playerStore } = makeTable({ smallBlind: 5, bigBlind: 10 });
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
    await handLog.append({ type: 'holdem_action', data: { playerId: 'alice', action: 'fold' } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    expect(table.holdemHand).toBeNull();
    expect(table.seats.every((s) => s === null)).toBe(true);
    await expect(handLog.readAll()).resolves.toEqual([]);
    // No balance write should have been attempted for either player.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1000);
  });

  it('reconstructs in-progress Blackjack rounds from hand-crafted shoes', async () => {
    const { table, handLog } = makeTable({ gameMode: 'blackjack' });
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // Neither seat's first two cards are a natural blackjack.
    const aliceShoe = [card('5', 'clubs'), card('6', 'clubs'), card('7', 'hearts'), card('8', 'hearts'), card('2', 'spades')];
    const bobShoe = [card('4', 'diamonds'), card('5', 'diamonds'), card('9', 'hearts'), card('10', 'hearts'), card('3', 'spades')];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });
    await handLog.append({ type: 'blackjack_action', data: { seatIndex: 0, action: 'hit' } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(true);
    expect(table.blackjackRounds.get(0)!.playerHands[0].cards).toHaveLength(3); // 2 dealt + 1 hit
    expect(table.activeSeatIndex).toBe(0); // seat 0's round is still in progress
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
  });

  it('auto-settles a round that was already complete at deal time (natural blackjack) during recovery', async () => {
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // alice: natural blackjack (settles instantly at construction, no action needed).
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    const bobShoe = [card('5', 'diamonds'), card('6', 'diamonds'), card('9', 'hearts'), card('10', 'hearts'), card('3', 'spades')];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });

    await table.recoverFromLog();

    expect(table.activeSeatIndex).toBe(1); // seat 0 auto-settled and skipped
    await expect(playerStore.getBalance('alice')).resolves.toBe(1037.5); // 25 * 1.5 blackjack payout
  });

  it('preserves seats and completes cleanup when every Blackjack seat was already settled and marked before the crash', async () => {
    // Represents a crash that happened between the last seat's payout commit
    // and the final handLog.clear() that should have followed it -- i.e. both
    // settlements were already applied and logged (settleBlackjackSeatIfNeeded
    // appends a blackjack_seat_settled marker right after its PlayerStore
    // write), so recovery must finish the interrupted cleanup WITHOUT
    // re-paying either seat.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1500); // reflects a payout already applied pre-crash
    await playerStore.setBalance('bob', 800); // reflects a payout already applied pre-crash
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    const bobShoe = [card('A', 'diamonds'), card('Q', 'diamonds'), card('9', 'hearts'), card('10', 'hearts')];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });
    await handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex: 0 } });
    await handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex: 1 } });

    await table.recoverFromLog();

    expect(table.handInProgress).toBe(false);
    await expect(handLog.readAll()).resolves.toEqual([]);
    // Seats are preserved (marked disconnected, same as an ordinary disconnect)
    // instead of being wiped from the table -- the improvement over the old
    // discard-everything behavior, now safe because per-seat markers (not a
    // coarse discard) are what prevent double payment.
    expect(table.seats[0]?.displayName).toBe('alice');
    expect(table.seats[0]?.connected).toBe(false);
    expect(table.seats[1]?.displayName).toBe('bob');
    expect(table.seats[1]?.connected).toBe(false);
    // Balances are exactly what they were pre-recovery -- both settlements are
    // skipped as already-applied (markers present), not re-paid.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1500);
    await expect(playerStore.getBalance('bob')).resolves.toBe(800);
  });

  it('pays a Blackjack seat with no settlement marker during recovery and lands activeSeatIndex on the still-in-progress seat', async () => {
    // Mirror image of the marked-seats test above: seat 0's natural blackjack
    // settled at deal time but has NO blackjack_seat_settled marker, simulating
    // a crash before that payout/marker write ever committed. This is exactly
    // the history the original recovery design could not distinguish from
    // "already paid" (both replay to the identical blackjack_hand_started-only
    // log) -- marker absence must mean "never applied", so recovery pays it
    // now, exactly once, while correctly leaving the still-in-progress seat 1
    // untouched and active.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // alice: natural blackjack (settles instantly at construction, no action needed).
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    // bob: not a natural, no action taken -- round stays in progress.
    const bobShoe = [
      card('5', 'diamonds'),
      card('6', 'diamonds'),
      card('9', 'hearts'),
      card('10', 'hearts'),
      card('3', 'spades'),
    ];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });
    // No blackjack_seat_settled marker for seat 0.

    await table.recoverFromLog();

    // Marker absent -> safe to apply now: seat 0 gets paid during recovery.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1037.5); // 25 * 1.5 blackjack payout
    // Recovery's own settlement write appends the marker exactly once, same as live play.
    expect(handLog.entries.filter((e) => e.type === 'blackjack_seat_settled')).toEqual([
      { type: 'blackjack_seat_settled', data: { seatIndex: 0 } },
    ]);
    // Seat 1's round never reached 'settled' (no action taken), so recovery
    // correctly stops there instead of skipping past it.
    expect(table.activeSeatIndex).toBe(1);
    expect(table.handInProgress).toBe(true);
  });

  it('resumes at the still-in-progress seat without re-paying a marked-settled Blackjack seat', async () => {
    // Complementary case to the "no settlement marker" test above, and the
    // exact scenario the marker mechanism was built to guard: seat 0's
    // natural blackjack settled AND was marked (a crash landed after that
    // payout/marker write fully committed) while seat 1 is still mid-hand
    // (no action taken yet). Recovery must skip re-paying seat 0 (marker
    // present) while still correctly resuming play at seat 1 -- not just
    // correctly skip seat 0 in isolation, and not short-circuit into
    // full-hand cleanup the way the "every seat marked" test above does,
    // since seat 1 has not settled.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1500); // reflects a payout already applied pre-crash
    await playerStore.setBalance('bob', 1000);
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // alice: natural blackjack (settles instantly at construction, no action needed).
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    // bob: not a natural, no action taken -- round stays in progress.
    const bobShoe = [
      card('5', 'diamonds'),
      card('6', 'diamonds'),
      card('9', 'hearts'),
      card('10', 'hearts'),
      card('3', 'spades'),
    ];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });
    await handLog.append({ type: 'blackjack_seat_settled', data: { seatIndex: 0 } });

    await table.recoverFromLog();

    // Marker present -> recovery must NOT re-pay seat 0.
    await expect(playerStore.getBalance('alice')).resolves.toBe(1500);
    // Recovery must not re-append a duplicate marker for the already-marked seat either.
    expect(handLog.entries.filter((e) => e.type === 'blackjack_seat_settled')).toHaveLength(1);
    expect(table.handInProgress).toBe(true);
    // Recovery correctly resumes at the still-in-progress seat, not just
    // correctly skips the marked one.
    expect(table.activeSeatIndex).toBe(1);
  });

  it('writes the settlement marker before committing the balance (write-ahead ordering)', async () => {
    // Pins the Critical fix from round 2: settleBlackjackSeatIfNeeded must
    // append the blackjack_seat_settled marker BEFORE calling
    // playerStore.setBalance, so a crash between the two durable writes
    // leaves a recoverable "lost payout" rather than a re-payable "double
    // payout" on the next recovery. Nothing else in the suite observes the
    // *relative order* of these two calls -- swapping them back would leave
    // every other test green. Recovery (rather than live play) is used to
    // exercise the settlement path here because it's the same
    // settleBlackjackSeatIfNeeded call site either way, and reuses the
    // existing natural-blackjack recovery fixture.
    const { table, handLog, playerStore } = makeTable({ gameMode: 'blackjack' });
    await playerStore.setBalance('alice', 1000);
    await playerStore.setBalance('bob', 1000);
    const card = (rank: string, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades') => ({ suit, rank });
    // alice: natural blackjack (settles instantly at construction, no action needed).
    const aliceShoe = [card('A', 'spades'), card('K', 'hearts'), card('9', 'clubs'), card('9', 'diamonds')];
    // bob: not a natural, no action taken -- round stays in progress.
    const bobShoe = [
      card('5', 'diamonds'),
      card('6', 'diamonds'),
      card('9', 'hearts'),
      card('10', 'hearts'),
      card('3', 'spades'),
    ];
    await handLog.append({
      type: 'blackjack_hand_started',
      data: {
        rounds: [
          { seatIndex: 0, displayName: 'alice', initialBet: 25, shoe: aliceShoe },
          { seatIndex: 1, displayName: 'bob', initialBet: 25, shoe: bobShoe },
        ],
      },
    });

    // Attach spies after the setup append above, so only calls made DURING
    // recoverFromLog() are captured.
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
    // comparing across these two different spies genuinely proves relative
    // call order, not just that both were eventually called.
    expect(appendSpy.mock.invocationCallOrder[markerCallIndex]).toBeLessThan(
      setBalanceSpy.mock.invocationCallOrder[balanceCallIndex]
    );
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

  it('reveals the full dealer hand and results once a round settles', async () => {
    const { table } = makeTable({ gameMode: 'blackjack' });
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    await table.submitAction(0, 'stand');

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

  it('reveals hole cards for non-folded players to everyone once the street settles', async () => {
    const { table } = makeTable();
    await table.join('alice');
    await table.join('bob');
    await table.setReady(0);
    await table.setReady(1);
    // alice is dealt into a hand and immediately calls, but the simplest way
    // to reach settled is bob folding after alice acts.
    await table.submitAction(0, 'call');
    await table.submitAction(1, 'fold');

    const spectatorView = table.getStateForSeat(null);
    const alice = spectatorView.holdem!.players.find((p) => p.playerId === 'alice')!;
    const bob = spectatorView.holdem!.players.find((p) => p.playerId === 'bob')!;
    expect(alice.holeCards).not.toBeNull(); // alice reached showdown uncontested-favorably, did not fold
    expect(bob.holeCards).toBeNull(); // bob folded, so his cards stay hidden even though the street settled
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
