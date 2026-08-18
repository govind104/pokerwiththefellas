import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Table, type TableConfig } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog, HandLogEntry } from './handLog';

class FakePlayerStore implements PlayerStore {
  private balances = new Map<string, number>();
  constructor(private readonly defaultBalance: number) {}
  async getBalance(displayName: string): Promise<number> {
    return this.balances.get(displayName) ?? this.defaultBalance;
  }
  async setBalance(displayName: string, balance: number): Promise<void> {
    this.balances.set(displayName, balance);
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
    expect(table.handInProgress).toBe(true);
    // Recovery correctly resumes at the still-in-progress seat, not just
    // correctly skips the marked one.
    expect(table.activeSeatIndex).toBe(1);
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
});
