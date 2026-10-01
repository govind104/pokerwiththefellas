import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type CreateServerResult } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore } from './gameConfigStore';
import type { PlayerStore, IdentityStore, TokenCheck } from './playerStore';
import type { GameConfigStore, GameConfigValues } from './gameConfigStore';
import type { AppStateView } from './table';
import type { ErrorPayload } from './protocol';
import {
  ADMIN_PASSPHRASE,
  DEFAULT_STATIC_CONFIG,
  DEFAULT_GAME_CONFIG,
  waitForEvent,
  waitForState,
  waitForSeated,
  waitForReady,
  joinAndGetToken,
  startGameAsAdmin,
} from './testHelpers';

describe('socketServer', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];

  const staticConfig = DEFAULT_STATIC_CONFIG;
  const configDefaults = DEFAULT_GAME_CONFIG;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'socket-server-test-'));
    const playerStore = new JsonPlayerStore(join(dir, 'balances.json'), configDefaults.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults);
    server = await createServer(staticConfig, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE);
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  it('emits state to a client showing its own seat after join', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    const seated = waitForSeated(socket, 'alice');
    // Wait for the token too: issuing it writes balances.json, which must finish before teardown.
    await joinAndGetToken(socket, 'alice');
    const state = await seated;
    expect(state.table!.seats[0]?.displayName).toBe('alice');
  });

  it('stores the normalised name, not the raw one (audit M8)', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const socket = connect();
    const seated = waitForSeated(socket, 'alice');
    // Wait for the token too: issuing it writes balances.json, which must finish before teardown.
    await joinAndGetToken(socket, '  ali\u200Bce ');
    const state = await seated;
    expect(state.table!.seats[0]?.displayName).toBe('alice');
  });

  it('broadcasts an updated seat list to an already-connected client when a second player joins', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    // Wait for the token too: issuing it writes balances.json, which must finish before teardown.
    await joinAndGetToken(alice, 'alice');

    const bob = connect();
    const aliceUpdate = waitForState(alice, (s) => s.table?.seats[1]?.displayName === 'bob');
    const bobSeated = waitForSeated(bob, 'bob');
    await joinAndGetToken(bob, 'bob');
    await bobSeated;
    await aliceUpdate;
  });

  it('starts a hand once both seated clients send ready, and broadcasts it to both', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const bobHandStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    const state = await bobHandStarted;
    expect(state.table!.holdem).not.toBeNull();
  });

  it('emits error only to the socket whose action was illegal, with no broadcast to others', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    let aliceGotError = false;
    let bobGotError = false;
    alice.on('error', () => {
      aliceGotError = true;
    });
    bob.on('error', () => {
      bobGotError = true;
    });

    // Heads-up: alice (button) acts first preflop, so bob acting is out of turn.
    bob.emit('action', { action: 'fold' });
    await new Promise((r) => setTimeout(r, 50));

    expect(bobGotError).toBe(true);
    expect(aliceGotError).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a non-string value', 42],
    ['null', null],
    ['a name longer than the 32-character bound', 'x'.repeat(33)],
  ])('rejects a join whose displayName is %s without consuming a seat', async (_label, displayName) => {
    // Defense in depth at the network boundary: the design spec requires
    // malformed socket payloads to be rejected before reaching the engine at
    // all. Pre-fix, any value at all was passed straight through to
    // table.reconnect()/table.join() and became a seated player's identity.
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', { displayName } as never);
    const err = await errorPromise;
    expect(err.message).toBe('Invalid display name');
    // No seat was consumed -- the payload never reached the Table at all.
    expect(server.getTable()!.seats.every((s) => s === null)).toBe(true);
  });

  it('rejects a join before any admin has started a game -- the defining empty-lobby behaviour', async () => {
    // No startGameAsAdmin() call anywhere in this test on purpose: a freshly
    // created server has no Table at all, and the whole empty-lobby design
    // rests on `join` being refused until an admin picks a mode.
    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', { displayName: 'alice' });
    const err = await errorPromise;
    expect(err.message).toBe('No game is active yet');
    expect(server.getTable()).toBeNull();
  });

  it('the initial welcome state on a fresh lobby reports no mode, no table, and the current config values', async () => {
    const socket = connect();
    const state = await waitForEvent<AppStateView>(socket, 'state');
    expect(state.mode).toBeNull();
    expect(state.table).toBeNull();
    // The admin panel prefills its inputs from these, so they must be
    // present even before any game exists.
    expect(state.smallBlind).toBe(configDefaults.smallBlind);
    expect(state.bigBlind).toBe(configDefaults.bigBlind);
    expect(state.blackjackDefaultBet).toBe(configDefaults.blackjackDefaultBet);
    expect(state.defaultStartingBalance).toBe(configDefaults.defaultStartingBalance);
  });

  it('rejects a join with a missing payload instead of throwing in the handler', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const socket = connect();
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('join', undefined as never);
    const err = await errorPromise;
    expect(err.message).toBe('Invalid display name');
  });

  it('adminLogin with an incorrect passphrase reports failure and is not added to the admin set', async () => {
    const socket = connect();
    const resultPromise = waitForEvent<{ success: boolean }>(socket, 'adminLoginResult');
    socket.emit('adminLogin', { passphrase: 'not-the-right-passphrase' });
    const result = await resultPromise;
    expect(result.success).toBe(false);

    // Confirm the failed login didn't sneak this socket into the admin set:
    // any subsequent admin action from it must still be rejected.
    const errorPromise = waitForEvent<{ message: string }>(socket, 'error');
    socket.emit('adminStartGame', { mode: 'holdem' });
    const err = await errorPromise;
    expect(err.message).toBe('Admin only');
  });

  it('rejects every admin action from a socket that has not logged in', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const intruder = connect();
    const errorPromise = waitForEvent<{ message: string }>(intruder, 'error');
    intruder.emit('adminAdjustBalance', { displayName: 'alice', balance: 5000 });
    const err = await errorPromise;
    expect(err.message).toBe('Admin only');
  });

  it("adminAdjustBalance updates a non-seated player's persisted balance and broadcasts it", async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');

    const update = waitForState(alice, (s) => s.table?.seats[0]?.balance === 5000);
    admin.emit('adminAdjustBalance', { displayName: 'alice', balance: 5000 });
    const state = await update;
    expect(state.table!.seats[0]?.balance).toBe(5000);
  });

  it('adminAdjustBalance is rejected while the named player is in an active hand', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    await handStarted;

    const errorPromise = waitForEvent<{ message: string }>(admin, 'error');
    admin.emit('adminAdjustBalance', { displayName: 'alice', balance: 9999 });
    const err = await errorPromise;
    expect(err.message).toBe("Can't adjust -- alice is in an active hand");
  });

  it('adminSetBlinds applies to the next hand, not one already in progress', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const firstHandState = await handStarted;
    // `holdem.pots` is only populated once a hand reaches 'settled' (see
    // holdemHand.ts) -- mid-hand, the pot total is the sum of what each
    // player has put in so far this street. Default blinds are 5/10, and
    // nobody has acted yet, so that's just the two blinds: 15.
    const streetPotTotal = (state: AppStateView) =>
      state.table!.holdem!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(streetPotTotal(firstHandState)).toBe(15);

    admin.emit('adminSetBlinds', { smallBlind: 50, bigBlind: 100 });
    await new Promise((r) => setTimeout(r, 20));
    // Still the same (unaffected) in-progress hand.
    const stillPotTotal = server
      .getTable()!
      .holdemHand!.players.reduce((sum, p) => sum + p.streetContributed, 0);
    expect(stillPotTotal).toBe(15);

    // Fold out the first hand via the normal action pathway (not a direct
    // engine call) so Table.submitAction's settlement runs and actually
    // clears handInProgress/ready -- a direct `holdemHand.act(...)` call
    // bypasses Table.settleHoldem entirely and leaves the table thinking a
    // hand is still in progress forever, which was hanging this test.
    const settled = waitForState(bob, (s) => s.table?.handInProgress === false);
    alice.emit('action', { action: 'fold' });
    await settled;

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const secondHandStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    const secondHandState = await secondHandStarted;
    expect(streetPotTotal(secondHandState)).toBe(150);
  });

  it('adminSetStartingBalance changes the balance a never-before-seen player joins with', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    admin.emit('adminSetStartingBalance', { defaultStartingBalance: 7000 });
    await new Promise((r) => setTimeout(r, 20));

    const carol = connect();
    const seated = waitForSeated(carol, 'carol');
    // Wait for the token too: issuing it writes balances.json, which must finish before teardown.
    await joinAndGetToken(carol, 'carol');
    const state = await seated;
    expect(state.table!.seats.find((s) => s.displayName === 'carol')?.balance).toBe(7000);
  });

  it('adminSwitchMode is rejected while a hand is in progress, and succeeds once idle', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const handStarted = waitForState(bob, (s) => s.table?.handInProgress === true);
    bob.emit('ready');
    await handStarted;

    const rejectPromise = waitForEvent<{ message: string }>(admin, 'error');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    const err = await rejectPromise;
    expect(err.message).toBe("Can't switch modes while a hand is in progress");

    // Fold via the normal action pathway (not a direct engine call) so
    // Table.submitAction's settlement actually runs and clears
    // handInProgress -- see the same note in the adminSetBlinds test above.
    const settled = waitForState(admin, (s) => s.table?.handInProgress === false);
    alice.emit('action', { action: 'fold' });
    await settled;

    const switched = waitForState(admin, (s) => s.mode === 'blackjack');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    const state = await switched;
    expect(state.table!.gameMode).toBe('blackjack');
    // Both previous players were unseated by the switch.
    expect(state.table!.seats.every((s) => s.displayName === null)).toBe(true);
  });

  it('broadcasts the updated config value after a successful admin config change', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const updated = waitForState(admin, (s) => s.bigBlind === 100);
    admin.emit('adminSetBlinds', { smallBlind: 50, bigBlind: 100 });
    const state = await updated;
    expect(state.smallBlind).toBe(50);
    expect(state.bigBlind).toBe(100);
  });

  it('every admin rejection is tagged scope: "admin" so the client can route it away from the join form', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    const errorPromise = waitForEvent<{ message: string; scope?: string }>(admin, 'error');
    admin.emit('adminSetBlinds', { smallBlind: -5, bigBlind: 10 });
    const err = await errorPromise;
    expect(err.scope).toBe('admin');
  });

  describe('admin payload validation', () => {
    // Each of these used to be accepted and written straight through to a
    // file that survives a restart (game-config.json / balances.json), or --
    // for the missing-payload cases -- to throw an unhandled rejection
    // inside the async handler while reading `payload.x` off `undefined`.
    const invalidPayloadCases: { event: string; payload: unknown; expected: string }[] = [
      { event: 'adminSetBlinds', payload: { smallBlind: 0, bigBlind: 10 }, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetBlinds', payload: { smallBlind: 5, bigBlind: -10 }, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetBlinds', payload: { smallBlind: 5 }, expected: 'Blinds must be positive numbers' },
      { event: 'adminSetBlinds', payload: undefined, expected: 'Blinds must be positive numbers' },
      // audit I4: each of these used to be saved, after which no hand could ever start.
      {
        event: 'adminSetBlinds',
        payload: { smallBlind: 50, bigBlind: 10 },
        expected: "The small blind can't be larger than the big blind",
      },
      { event: 'adminSetBlinds', payload: { smallBlind: 0.5, bigBlind: 1 }, expected: 'Blinds must be whole numbers' },
      { event: 'adminSetDefaultBet', payload: { blackjackDefaultBet: 0 }, expected: 'Default bet must be a positive number' },
      { event: 'adminSetDefaultBet', payload: undefined, expected: 'Default bet must be a positive number' },
      {
        event: 'adminSetStartingBalance',
        payload: { defaultStartingBalance: 0 },
        expected: 'Starting balance must be a positive number',
      },
      { event: 'adminSetStartingBalance', payload: undefined, expected: 'Starting balance must be a positive number' },
      {
        event: 'adminAdjustBalance',
        payload: { displayName: 'alice', balance: -1 },
        expected: 'Balance must be a number of 0 or more',
      },
      { event: 'adminAdjustBalance', payload: { balance: 100 }, expected: 'Invalid display name' },
      { event: 'adminAdjustBalance', payload: undefined, expected: 'Invalid display name' },
      { event: 'adminStartGame', payload: { mode: 'roulette' }, expected: 'Invalid game mode' },
      { event: 'adminSwitchMode', payload: { mode: 'roulette' }, expected: 'Invalid game mode' },
      { event: 'adminSwitchMode', payload: undefined, expected: 'Invalid game mode' },
    ];

    for (const { event, payload, expected } of invalidPayloadCases) {
      it(`rejects ${event} with ${JSON.stringify(payload) ?? 'a missing payload'}`, async () => {
        const admin = connect();
        await startGameAsAdmin(admin, 'holdem');

        const errorPromise = waitForEvent<{ message: string; scope?: string }>(admin, 'error');
        admin.emit(event as never, payload as never);
        const err = await errorPromise;
        expect(err.message).toBe(expected);
        expect(err.scope).toBe('admin');
      });
    }

    it('leaves the persisted config untouched after a rejected adminSetBlinds', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');

      const errorPromise = waitForEvent<{ message: string }>(admin, 'error');
      admin.emit('adminSetBlinds', { smallBlind: Number.NaN, bigBlind: Number.NaN });
      await errorPromise;

      const stored = await new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults).getConfig();
      expect(stored.smallBlind).toBe(configDefaults.smallBlind);
      expect(stored.bigBlind).toBe(configDefaults.bigBlind);
    });

    it('accepts a balance of exactly 0 -- a busted player is a real state, unlike a 0 blind', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');

      const alice = connect();
      alice.emit('join', { displayName: 'alice' });
      await waitForSeated(alice, 'alice');

      const zeroed = waitForState(alice, (s) => s.table?.seats[0]?.balance === 0);
      admin.emit('adminAdjustBalance', { displayName: 'alice', balance: 0 });
      const state = await zeroed;
      expect(state.table!.seats[0]?.balance).toBe(0);
    });
  });

  describe('identity (audit C5, I9)', () => {
    async function seatAliceAndDrop(): Promise<string> {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      const token = await joinAndGetToken(alice, 'alice');
      const dropped = waitForState(admin, (s) => s.table?.seats[0]?.connected === false);
      alice.disconnect();
      await dropped;
      return token;
    }

    it('sends the joining socket a token and its normalised name', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      const identity = waitForEvent<{ displayName: string; token: string }>(alice, 'identity');
      alice.emit('join', { displayName: ' alice ' });
      expect(await identity).toEqual({ displayName: 'alice', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    });

    it("refuses a disconnected player's seat to anyone without the token", async () => {
      await seatAliceAndDrop();
      const mallory = connect();
      const error = waitForEvent<ErrorPayload>(mallory, 'error');
      mallory.emit('join', { displayName: 'ALICE' });
      expect(await error).toMatchObject({ code: 'name-claimed' });
      expect(server.getTable()!.seats[0]?.connected).toBe(false);
    });

    it('gives the seat back to the token holder', async () => {
      const token = await seatAliceAndDrop();
      const back = connect();
      // Table.reconnect() broadcasts (seat connected) before the handler maps this socket to the
      // seat, so the first connected snapshot still has mySeatIndex null; wait for the mapped one.
      const reconnected = waitForState(back, (s) => s.mySeatIndex === 0 && s.table?.seats[0]?.connected === true);
      back.emit('join', { displayName: 'alice', token });
      const state = await reconnected;
      expect(state.mySeatIndex).toBe(0);
    });

    it('tells each socket its own seat, and null to one without a seat', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      await joinAndGetToken(alice, 'alice');
      const bob = connect();
      const bobSeated = waitForState(bob, (s) => s.mySeatIndex === 1);
      const aliceSees = waitForState(alice, (s) => s.mySeatIndex === 0 && s.table?.seats[1]?.displayName === 'bob');
      const adminSees = waitForState(admin, (s) => s.table?.seats[1]?.displayName === 'bob');
      bob.emit('join', { displayName: 'bob' });
      await bobSeated;
      await aliceSees;
      expect((await adminSees).mySeatIndex).toBeNull();
    });

    it('a rejected join on a connected name leaves the socket unseated (I9)', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const ann = connect();
      await joinAndGetToken(ann, 'ann');
      const eve = connect();
      const error = waitForEvent<ErrorPayload>(eve, 'error');
      eve.emit('join', { displayName: 'ann' });
      await error;
      const next = waitForState(eve, () => true);
      admin.emit('adminSetBlinds', { smallBlind: 5, bigBlind: 10 }); // any broadcast
      expect((await next).mySeatIndex).toBeNull();
    });

    it('the token holder takes over a seat still held by another socket', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const oldTab = connect();
      const token = await joinAndGetToken(oldTab, 'alice');
      const replaced = waitForEvent<ErrorPayload>(oldTab, 'error');
      const oldTabUnseated = waitForState(oldTab, (s) => s.mySeatIndex === null);
      const newTab = connect();
      const newTabSeated = waitForState(newTab, (s) => s.mySeatIndex === 0);
      newTab.emit('join', { displayName: 'alice', token });
      await newTabSeated;
      expect(await replaced).toMatchObject({ code: 'replaced' });
      await oldTabUnseated;
      const notSeated = waitForEvent<ErrorPayload>(oldTab, 'error');
      oldTab.emit('ready');
      expect((await notSeated).message).toBe('Not seated');
      expect(server.getTable()!.seats[0]?.connected).toBe(true);
    });

    it('claims a pre-token (v1) balance on first join', async () => {
      // Overwrites the balances file this describe's beforeEach store points at; the store reads
      // the file on every call, so the next getBalance sees it.
      await writeFile(join(dir, 'balances.json'), JSON.stringify({ alice: 777 }), 'utf-8');
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      await joinAndGetToken(alice, 'alice');
      expect(server.getTable()!.seats[0]?.balance).toBe(777);
    });

    it('admin release lets the next join take a claimed name, balance included', async () => {
      await seatAliceAndDrop();
      await server.getTable()!.adminSetBalance('alice', 640);
      const admin = connect(); // a second admin socket; the first is inside seatAliceAndDrop
      admin.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
      await waitForEvent(admin, 'adminLoginResult');
      const notice = waitForEvent<{ message: string }>(admin, 'adminNotice');
      admin.emit('adminReleaseName', { displayName: 'Alice' });
      expect((await notice).message).toContain('Alice'); // case is kept for display
      const newDevice = connect();
      const token = await joinAndGetToken(newDevice, 'alice');
      expect(token).toHaveLength(43);
      expect(server.getTable()!.seats[0]).toMatchObject({ connected: true, balance: 640 });
    });

    it('release is admin-only and rejects a name that never played', async () => {
      const player = connect();
      const denied = waitForEvent<ErrorPayload>(player, 'error');
      player.emit('adminReleaseName', { displayName: 'alice' });
      expect(await denied).toEqual({ message: 'Admin only', scope: 'admin' });

      const admin = connect();
      admin.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
      await waitForEvent(admin, 'adminLoginResult');
      const unknown = waitForEvent<ErrorPayload>(admin, 'error');
      admin.emit('adminReleaseName', { displayName: 'ghost' });
      expect((await unknown).message).toContain('ghost');
    });
  });
});

// Test-local fake used only by the seat-orphan regression tests below. Same
// pattern as table.test.ts's ControllablePlayerStore: `getBalance` can be
// held open on command so a `join` event's server-side handling can be
// paused mid-flight (right at the real fs round-trip a JsonPlayerStore would
// yield to the event loop on), letting a test drive the socket into a
// disconnect (or a second join) while the first join is still in progress.
class ControllablePlayerStore implements PlayerStore, IdentityStore {
  private balances = new Map<string, number>();
  private tokens = new Map<string, string>();
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
  async checkToken(displayName: string, token: string | undefined): Promise<TokenCheck> {
    const stored = this.tokens.get(displayName.toLowerCase());
    if (stored === undefined) return 'unclaimed';
    return token === stored ? 'match' : 'mismatch';
  }
  async issueToken(displayName: string): Promise<string> {
    const token = `token-${displayName.toLowerCase()}`;
    this.tokens.set(displayName.toLowerCase(), token);
    return token;
  }
  async releaseName(displayName: string): Promise<boolean> {
    return this.tokens.delete(displayName.toLowerCase());
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

describe('socketServer join-handler seat-orphan race', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];
  let playerStore: ControllablePlayerStore;

  const staticConfig = DEFAULT_STATIC_CONFIG;
  const configDefaults = DEFAULT_GAME_CONFIG;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'socket-server-orphan-test-'));
    playerStore = new ControllablePlayerStore(configDefaults.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dir, 'game-config.json'), configDefaults);
    server = await createServer(staticConfig, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE);
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  it('a client disconnecting while its join() is still in flight does not orphan the seat or deadlock the table', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    playerStore.holdGetBalance = true;

    // Independent, test-owned signal that the SERVER has actually processed
    // alice's disconnect -- not inferred from internal map/state timing.
    let disconnectedOnServer = false;
    server.io.on('connection', (socket) => {
      socket.on('disconnect', () => {
        disconnectedOnServer = true;
      });
    });

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });

    // Confirm the server is genuinely suspended mid-join (at the real
    // getBalance await), not just that the emit was sent.
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(1);
    });

    alice.disconnect();
    await vi.waitFor(() => {
      expect(disconnectedOnServer).toBe(true);
    });

    // Now let the suspended join() resolve, with the socket already gone.
    playerStore.releaseNextGetBalance();
    // Subsequent joins (bob, carol below) must resolve normally instead of
    // also suspending on getBalance -- only alice's join needed to be held.
    playerStore.holdGetBalance = false;
    await new Promise((r) => setTimeout(r, 20));

    // No seat should be left connected:true with nothing able to reach it --
    // that is exactly the orphaned state the pre-fix handler produces here.
    const orphaned = server.getTable()!.seats.some((s) => s?.connected === true);
    expect(orphaned).toBe(false);

    // And the table itself must not be deadlocked: a fresh pair can still
    // join and start a hand. Pre-fix, alice's phantom connected:true,
    // never-ready seat would block startHandIfEveryoneReady forever, so this
    // would hang instead of resolving.
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');
    const carol = connect();
    carol.emit('join', { displayName: 'carol' });
    await waitForSeated(carol, 'carol');

    bob.emit('ready');
    await waitForReady(bob, 'bob');
    const carolHandStarted = waitForState(carol, (s) => !!s.table?.handInProgress);
    carol.emit('ready');
    const state = await carolHandStarted;
    expect(state.table!.holdem).not.toBeNull();
  });

  it('a join that resolves after a mode switch does not bind the socket to a seat on the new table (audit I2)', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    playerStore.holdGetBalance = true;
    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(1);
    });

    const switched = waitForState(admin, (s) => s.mode === 'blackjack');
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    await switched;
    playerStore.holdGetBalance = false;

    // bob takes seat 0 on the new table -- the index alice's stale join will come back with.
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');

    const aliceError = waitForEvent<{ message: string }>(alice, 'error');
    playerStore.releaseNextGetBalance();
    expect((await aliceError).message).toMatch(/game changed/i);

    // Before the fix this socket was mapped to seat 0 of the new table, which is bob's.
    alice.emit('ready');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getTable()!.seats.find((s) => s?.displayName === 'bob')?.ready).toBe(false);
  });

  it('a second join from the same still-connected socket disconnects the first seat instead of orphaning it', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');

    playerStore.holdGetBalance = true;

    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(1);
    });

    // Second join from the SAME socket, before the first has resolved.
    alice.emit('join', { displayName: 'bob' });
    await vi.waitFor(() => {
      expect(playerStore.pendingCount).toBe(2);
    });

    // Release in a controlled order: the first join ('alice') resolves
    // first, then the second ('bob'), synchronously back-to-back.
    playerStore.releaseNextGetBalance();
    playerStore.releaseNextGetBalance();
    // Subsequent joins (carol, dave below) must resolve normally instead of
    // also suspending on getBalance.
    playerStore.holdGetBalance = false;
    await new Promise((r) => setTimeout(r, 20));

    // The first seat must not be a permanent orphan -- it should have been
    // released via the normal disconnect/grace-window path, not left
    // connected:true with no socket mapped to it anymore.
    const aliceSeat = server.getTable()!.seats.find((s) => s?.displayName === 'alice');
    expect(aliceSeat?.connected).toBe(false);
    const bobSeat = server.getTable()!.seats.find((s) => s?.displayName === 'bob');
    expect(bobSeat?.connected).toBe(true);

    // Table not deadlocked either: `alice`'s client socket is now bound to
    // bob's (connected) seat, so bob's own seat plus one more connected,
    // ready player is enough to start a hand -- no separate "bob" client is
    // needed, and alice's disconnected seat 0 must NOT block the ready-gate.
    const carol = connect();
    carol.emit('join', { displayName: 'carol' });
    await waitForSeated(carol, 'carol');

    alice.emit('ready'); // this socket is bob's seat now
    await waitForReady(alice, 'bob');
    const carolHandStarted = waitForState(carol, (s) => !!s.table?.handInProgress);
    carol.emit('ready');
    const state = await carolHandStarted;
    expect(state.table!.holdem).not.toBeNull();
  });
});

describe('static file serving', () => {
  let staticDir: string;
  let dataDir: string;
  let server: CreateServerResult;
  let port: number;

  const configDefaults = DEFAULT_GAME_CONFIG;

  beforeEach(async () => {
    staticDir = await mkdtemp(join(tmpdir(), 'static-dir-test-'));
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Poker or Blackjack</title>');
    dataDir = await mkdtemp(join(tmpdir(), 'static-serving-data-'));
    const playerStore = new JsonPlayerStore(join(dataDir, 'balances.json'), configDefaults.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dataDir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dataDir, 'game-config.json'), configDefaults);
    server = await createServer(DEFAULT_STATIC_CONFIG, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE, {
      staticDir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    server.io.close();
    await rm(staticDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('serves the built index.html at the root path when staticDir is provided', async () => {
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Poker or Blackjack');
  });

  it('still accepts socket.io connections when static serving is enabled', async () => {
    const socket = ioClient(`http://localhost:${port}`);
    await waitForEvent(socket, 'state');
    socket.disconnect();
  });

  it('falls back to index.html for unmatched paths (SPA fallback)', async () => {
    const response = await fetch(`http://localhost:${port}/nonexistent-route`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Poker or Blackjack');
  });
});

describe('static file serving -- misconfigured STATIC_DIR', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'static-serving-bad-data-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function buildServerArgs(staticDir: string) {
    const playerStore = new JsonPlayerStore(join(dataDir, 'balances.json'), DEFAULT_GAME_CONFIG.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dataDir, 'hand.jsonl'));
    const gameConfigStore = new JsonGameConfigStore(join(dataDir, 'game-config.json'), DEFAULT_GAME_CONFIG);
    return [DEFAULT_STATIC_CONFIG, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE, { staticDir }] as const;
  }

  it('rejects with a clear message when staticDir does not exist', async () => {
    const missingDir = join(dataDir, 'does-not-exist');
    await expect(createServer(...(await buildServerArgs(missingDir)))).rejects.toThrow(
      /does not exist.*Build the frontend first/s
    );
  });

  it('rejects with a clear message when staticDir points at a file, not a directory', async () => {
    const filePath = join(dataDir, 'not-a-directory.txt');
    await writeFile(filePath, 'not a directory');
    await expect(createServer(...(await buildServerArgs(filePath)))).rejects.toThrow(/is not a directory/);
  });
});

// Test-local fake: a real config store whose next read or write fails the way a
// Windows file lock does (antivirus, backup or indexer holding game-config.json),
// so each admin handler's failure path can be driven (audit C4), or whose next
// read can be held open to pause an admin handler mid-await (audit I2).
class LockableGameConfigStore implements GameConfigStore {
  failNext = false;
  holdNextGetConfig = false;
  private releaseHeldGet: (() => void) | null = null;
  constructor(private inner: GameConfigStore) {}
  get isHoldingGetConfig(): boolean {
    return this.releaseHeldGet !== null;
  }
  releaseGetConfig(): void {
    const release = this.releaseHeldGet;
    if (!release) throw new Error('LockableGameConfigStore: no held getConfig to release');
    this.releaseHeldGet = null;
    release();
  }
  private maybeFail(): void {
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    }
  }
  async getConfig(): Promise<GameConfigValues> {
    this.maybeFail();
    if (this.holdNextGetConfig) {
      this.holdNextGetConfig = false;
      await new Promise<void>((resolve) => (this.releaseHeldGet = resolve));
    }
    return this.inner.getConfig();
  }
  async setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues> {
    this.maybeFail();
    return this.inner.setConfig(update);
  }
}

describe('socketServer admin handlers against a controllable config store (audit C4, I2)', () => {
  let dir: string;
  let server: CreateServerResult;
  let port: number;
  let clients: ClientSocket[];
  let gameConfigStore: LockableGameConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'socket-server-c4-test-'));
    const playerStore = new JsonPlayerStore(join(dir, 'balances.json'), DEFAULT_GAME_CONFIG.defaultStartingBalance);
    const handLog = new JsonlHandLog(join(dir, 'hand.jsonl'));
    gameConfigStore = new LockableGameConfigStore(
      new JsonGameConfigStore(join(dir, 'game-config.json'), DEFAULT_GAME_CONFIG)
    );
    server = await createServer(DEFAULT_STATIC_CONFIG, gameConfigStore, playerStore, handLog, ADMIN_PASSPHRASE);
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    port = (server.httpServer.address() as { port: number }).port;
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect(): ClientSocket {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    return socket;
  }

  async function loginAsAdmin(socket: ClientSocket): Promise<void> {
    socket.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
    await waitForEvent(socket, 'adminLoginResult');
  }

  const cases: Array<{ event: string; payload: unknown; withTable: boolean }> = [
    { event: 'adminStartGame', payload: { mode: 'holdem' }, withTable: false },
    { event: 'adminSwitchMode', payload: { mode: 'blackjack' }, withTable: true },
    { event: 'adminSetBlinds', payload: { smallBlind: 50, bigBlind: 100 }, withTable: true },
    { event: 'adminSetDefaultBet', payload: { blackjackDefaultBet: 40 }, withTable: true },
    { event: 'adminSetStartingBalance', payload: { defaultStartingBalance: 2000 }, withTable: true },
  ];

  for (const { event, payload, withTable } of cases) {
    it(`${event} reports a locked config file to the admin instead of leaving an unhandled rejection`, async () => {
      const admin = connect();
      if (withTable) {
        await startGameAsAdmin(admin, 'holdem');
      } else {
        await loginAsAdmin(admin);
      }

      const adminErrors: Array<{ message: string; scope?: string }> = [];
      admin.on('error', (err: { message: string; scope?: string }) => adminErrors.push(err));
      const rejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown): void => {
        rejections.push(reason);
      };
      process.on('unhandledRejection', onUnhandledRejection);
      try {
        gameConfigStore.failNext = true;
        admin.emit(event as never, payload as never);
        await vi.waitFor(() => expect(adminErrors.length + rejections.length).toBeGreaterThan(0));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(rejections).toEqual([]);
        expect(adminErrors).toEqual([{ message: expect.stringContaining('EBUSY'), scope: 'admin' }]);
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }
    });
  }

  it('adminSwitchMode is rejected when the last Ready starts a hand while the switch is loading config (audit I2)', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice = connect();
    alice.emit('join', { displayName: 'alice' });
    await waitForSeated(alice, 'alice');
    const bob = connect();
    bob.emit('join', { displayName: 'bob' });
    await waitForSeated(bob, 'bob');
    alice.emit('ready');
    await waitForReady(alice, 'alice');
    const holdemTable = server.getTable();

    gameConfigStore.holdNextGetConfig = true;
    admin.emit('adminSwitchMode', { mode: 'blackjack' });
    await vi.waitFor(() => expect(gameConfigStore.isHoldingGetConfig).toBe(true));

    const handStarted = waitForState(bob, (s) => !!s.table?.handInProgress);
    bob.emit('ready');
    await handStarted;

    const rejected = waitForEvent<{ message: string; scope?: string }>(admin, 'error');
    gameConfigStore.releaseGetConfig();
    expect(await rejected).toEqual({ message: "Can't switch modes while a hand is in progress", scope: 'admin' });
    expect(server.getTable()).toBe(holdemTable); // not replaced by a blackjack table
    expect(holdemTable!.handInProgress).toBe(true);
  });
});
