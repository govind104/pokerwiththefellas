import { describe, it, expect, beforeEach } from 'vitest';
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
    return this.entries;
  }
  async clear(): Promise<void> {
    this.entries = [];
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
});
