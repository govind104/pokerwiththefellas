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
    // With a real random function, two independently shuffled 6-deck shoes
    // dealing the same first card to both players would be astronomically
    // unlikely -- a cheap, reliable signal they are not sharing one shoe.
    const { table } = makeTable({ gameMode: 'blackjack', random: Math.random });
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
