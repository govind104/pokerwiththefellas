# Unsticking Tables (audit item 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix audit findings I6, I11 and I10 from
`docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md` §3: the admin can remove a
player and act for whoever the table is waiting on, an optional turn clock acts for a slow player,
leaving is confirmed by the server before the client forgets who it is, and a player whose
connection drops twice in quick succession still rejoins.

**Architecture:** Server side, `Table` gains `freeSeat`/`isDealtIn`/`actingSeatIndex`/
`applyDefaultAction` helpers; `leave` moves inside the table lock and lets a seat that is not in
the current hand leave mid-hand; `kick` frees a seat now, or (for a player in the hand) acts for
them on every turn and frees the seat when the hand ends; `forceDefaultAction` acts once for
whoever is up; a turn clock (`TableConfig.turnClockMs`, 0 = off) reuses the same default action.
`socketServer.ts` acknowledges `leave`, unmaps a freed seat's sockets *before* the state broadcast
(this is also the likely cause of the "after Leave table the table stayed on screen" observation),
and adds `adminKick`, `adminForceAct` and `adminSetTurnClock`. Client side, `SocketContext` resets
`joinInFlightRef` on disconnect, drops the player's identity only on a successful leave ack, handles
`code: 'kicked'`, and exposes the three admin calls, which `AdminPanel` renders.

**Tech Stack:** TypeScript, socket.io 4.8 (acknowledgements, `emitWithAck` in tests), React 18,
Vitest, Testing Library.

## Global Constraints

Decisions made without the user (2026-10-02); the user may override any of them:
- **Kick ("Remove from table")** is admin-only and picks a seated player by name.
  - If no hand is in progress, or the player is not dealt into it, the seat is freed at once.
  - If the player is in the hand, they are marked disconnected and timed out. They then fold, check
    or stand on every remaining turn, and the seat is freed when the hand ends. Payouts are applied
    before the seat is freed.
  - The kicked browser is told `code: 'kicked'`. It forgets its last name, so it does not
    auto-rejoin, and keeps its token. The player can sit down again by typing their name (it is not
    a ban), and the balance is kept as always. Rejoining during the same hand cancels the removal.
- **Force-act** acts once for whoever is up, with the same default action as the disconnect grace
  timer: check if there is nothing to call, otherwise fold, and stand in Blackjack. It carries the
  table's `actionSeq`, so a double-click does not act for two players in a row.
- **Turn clock:**
  - An admin setting in whole seconds: 0 means off (the default), otherwise 10-600.
  - It is kept in server memory only, so a restart turns it off.
  - It applies to every turn, connected or not. When it runs out, the default action is applied.
  - There is no countdown display in this item; Plan B's HUD can add one (see "Not covered here").
- **Leave** is confirmed by a socket.io acknowledgement: `{ ok: true }` or `{ ok: false, message }`.
  The client drops its name only on `ok: true`.
  - The server lets a seat that is not dealt in leave mid-hand. The client still hides "Leave table"
    mid-hand, which is unchanged.
  - A `leave` sent without an ack callback (bots, older pages) still gets an `error` event on failure.
- **Invariant:** no socket may stay mapped to a seat that is being freed. `unmapSeat(seatIndex)` runs
  inside the table lock, before the broadcast.

Other constraints:
- Every task is test-first. When a new test passes at once (coverage for code that already works),
  temporarily remove the code it guards and watch it fail, then restore it.
- `submitAction` is the locked public entry; `applyAction` is the body. Code that already holds the
  table lock (inside `runExclusive`) must call `applyAction`/`applyDefaultAction`, never
  `submitAction`, `leave`, `kick` or `forceDefaultAction`, or it deadlocks.
- The 2D view is frozen (HANDOFF "Open decision"): no 2D-only UI changes. `AdminPanel` and
  `SocketContext` are shared by both views, so they are fine.
- Run commands from the repo root. Tests: `npm test --workspace=@poker-blackjack/server` and
  `npm test --workspace=@poker-blackjack/frontend`; a single file:
  `npx vitest run <path> --root packages/<pkg>`. Typecheck: `npm run typecheck`.
- Commits: after a task's review is clean, commit it (code plus the ticked plan) without asking
  (the user's standing rule for SDD). Never push, open a PR or merge without asking.
- Code comments: match the surrounding files (they explain *why*, and cite the audit ID).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/server/src/table.ts` | modify | locked `leave`, `kick`, `forceDefaultAction`, turn clock, helpers |
| `packages/server/src/table.test.ts` | modify | tests for the above; existing `leave` calls become `await` |
| `packages/server/src/protocol.ts` | modify | `LeaveResult`, ack on `leave`, `'kicked'` code, three admin events |
| `packages/server/src/socketServer.ts` | modify | `unmapSeat`, leave ack, `adminKick`, `adminForceAct`, `adminSetTurnClock`, `turnClockSeconds` in state |
| `packages/server/src/socketServer.test.ts` | modify | tests for the above |
| `packages/frontend/src/socket/SocketContext.tsx` | modify | I10 reset, ack'd leave, `kicked`, `adminKick`/`adminForceAct`/`adminSetTurnClock` |
| `packages/frontend/src/socket/SocketContext.test.tsx` | modify | tests; two existing leave tests updated for the ack |
| `packages/frontend/src/components/AdminPanel.tsx` | modify | "Remove a player", "Act for …", "Turn clock" |
| `packages/frontend/src/components/AdminPanel.test.tsx` | modify | tests |
| `packages/frontend/src/fixtures/tableStateFixtures.ts` | modify | `turnClockSeconds: 0` in `DEFAULT_CONFIG_VIEW` |
| `packages/frontend/src/components/{AdminEntry,JoinScreen,Lobby}.test.tsx` | modify | three new `vi.fn()`s in their `SocketContextValue` literals |
| `docs/HOSTING.md`, `HANDOFF.md` | modify | admin tools, turn clock; progress |

---

### Task 1: `Table.leave` inside the lock; a seat not in the hand may leave (I11, server)

**Files:**
- Modify: `packages/server/src/table.ts` (the `leave` method, around line 249; new private helpers)
- Test: `packages/server/src/table.test.ts`

**Interfaces:**
- Produces:
  - `Table.leave(seatIndex: number, onLeft?: () => void): Promise<void>`. It rejects with
    `'Seat is empty'` or `'Cannot leave while a hand you are in is in progress'`. `onLeft` runs inside
    the lock, after the seat is freed and before `onStateChange`.
  - Private `freeSeat(seatIndex: number): void` (no broadcast) and
    `isDealtIn(seatIndex: number): boolean`. Task 3 uses both.

- [x] **Step 1: Update the existing `leave` callers in `table.test.ts` to the async API**

`leave` becomes async, so the synchronous `expect(() => …).toThrow` forms no longer work. Make
exactly these edits:

```ts
// 'leave clears the seat' (around line 257)
    await table.leave(0);
// 'leave throws on an already-empty seat' (around line 264)
    await expect(table.leave(0)).rejects.toThrow('empty');
// 'leave throws while a hand is in progress' (around line 269)
    await expect(table.leave(0)).rejects.toThrow('in progress');
// 'calls onStateChange on join and leave' (around line 278)
    await table.leave(0);
// 'leaves the table usable: players can leave afterwards' (around line 453)
    await expect(table.leave(0)).resolves.toBeUndefined();
// recycled-seat test (around line 1010)
    await table.leave(1); // alice leaves; handInProgress is false, so this is allowed
// startHand-failure test (around line 1128)
    await expect(table.leave(0)).resolves.toBeUndefined();
```

Run `grep -n "\.leave(" packages/server/src/table.test.ts` afterwards; every hit must be `await`ed.

- [x] **Step 2: Write the failing tests**

Append to `packages/server/src/table.test.ts`:

```ts
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
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/table.test.ts --root packages/server`
Expected: the four new tests FAIL. The first fails with "Cannot leave while a hand is in progress",
the third because the old synchronous `leave` resolves or throws before the lock, and the fourth
because `onLeft` is never called. The edited old tests may also fail where they expected a
synchronous throw.

- [x] **Step 4: Implement**

In `packages/server/src/table.ts`, replace the whole `leave(seatIndex: number): void { … }` method
with:

```ts
  /**
   * Frees a seat. Runs inside the table lock: between startHand's first line and its hand being
   * built, `handInProgress` is already true but nobody is dealt in yet, so an unlocked check could
   * free a seat the new hand is about to deal to (audit I11). A seat that is not in the current
   * hand (broke, or sat down after the deal) may leave mid-hand; a seat in it may not. `onLeft`
   * runs after the seat is freed and before the change is broadcast: the socket server unmaps
   * the player's sockets there, so no state ever points them at an empty seat.
   */
  async leave(seatIndex: number, onLeft?: () => void): Promise<void> {
    await this.runExclusive(async () => {
      if (!this.seats[seatIndex]) {
        throw new Error('Seat is empty');
      }
      if (this.handInProgress && this.isDealtIn(seatIndex)) {
        throw new Error('Cannot leave while a hand you are in is in progress');
      }
      this.freeSeat(seatIndex);
      onLeft?.();
      this.deps.onStateChange();
    });

    this.startHandIfEveryoneReady().catch((err) => {
      console.error(`Table: error starting hand after seat ${seatIndex} left:`, err);
    });
  }

  // Everything a seat leaves behind goes with it, so a new occupant of the same index starts clean.
  // No broadcast: callers do that.
  private freeSeat(seatIndex: number): void {
    const timer = this.disconnectTimers.get(seatIndex);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(seatIndex);
    }
    this.timedOutSeats.delete(seatIndex);
    this.seats[seatIndex] = null;
  }

  // Dealt into the hand being played, folded or not: a folded Hold'em player's loss and a finished
  // Blackjack seat's result are only paid at settlement, so their seat must still be there then.
  private isDealtIn(seatIndex: number): boolean {
    const seat = this.seats[seatIndex];
    if (!seat) {
      return false;
    }
    if (this.config.gameMode === 'holdem') {
      return this.holdemHand?.players.some((p) => p.playerId === seat.displayName) ?? false;
    }
    return this.blackjackRounds.has(seatIndex);
  }
```

In `packages/server/src/socketServer.ts`, keep the server compiling: in the `socket.on('leave', …)`
handler, change `table.leave(seatIndex);` to the code below. Task 2 replaces this handler.

```ts
    socket.on('leave', async () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        await table.leave(seatIndex);
        seatBySocketId.delete(socket.id);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=@poker-blackjack/server` then `npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/table.ts packages/server/src/table.test.ts packages/server/src/socketServer.ts docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "fix(server): leave runs under the table lock; seats not in the hand may leave (audit I11)"
```

---

### Task 2: Server-confirmed leave, and no state pointing at an empty seat (I11, server)

**Files:**
- Modify: `packages/server/src/protocol.ts`
- Modify: `packages/server/src/socketServer.ts` (the `leave` handler; a new `unmapSeat` helper next to `broadcast`)
- Test: `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Consumes: `Table.leave(seatIndex, onLeft)` from Task 1.
- Produces:
  - `protocol.ts`: `export type LeaveResult = { ok: true } | { ok: false; message: string };` and
    `leave: (ack?: (result: LeaveResult) => void) => void;` in `ClientToServerEvents`.
  - `socketServer.ts` (inside `createServer`): `function unmapSeat(seatIndex: number): string[]`,
    which returns the socket ids it unmapped. Task 3 uses it.

- [x] **Step 1: Write the failing tests**

Add inside the top-level `describe('socketServer', …)` block in
`packages/server/src/socketServer.test.ts`:

```ts
  describe('leave (audit I11)', () => {
    it("the leaver's next state no longer has a seat", async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      await joinAndGetToken(alice, 'alice');
      await waitForSeated(alice, 'alice');

      // The first state in which seat 0 is empty must already say we have no seat. It used to be
      // sent while the socket was still mapped, so it pointed us at the empty seat and the client
      // kept showing the table.
      const firstEmpty = waitForState(alice, (s) => s.table?.seats[0]?.displayName === null);
      const result = await alice.emitWithAck('leave');
      expect(result).toEqual({ ok: true });
      expect((await firstEmpty).mySeatIndex).toBeNull();
    });

    it('refuses with an ack, not an error event, when the player is in the hand, and keeps the seat', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      await joinAndGetToken(alice, 'alice');
      await waitForSeated(alice, 'alice');
      const bob = connect();
      await joinAndGetToken(bob, 'bob');
      await waitForSeated(bob, 'bob');
      alice.emit('ready');
      await waitForReady(alice, 'alice');
      const started = waitForState(alice, (s) => s.table?.handInProgress === true);
      bob.emit('ready');
      await started;

      const errors: ErrorPayload[] = [];
      alice.on('error', (e: ErrorPayload) => errors.push(e));
      const result = await alice.emitWithAck('leave');
      expect(result).toEqual({ ok: false, message: 'Cannot leave while a hand you are in is in progress' });
      expect(errors).toEqual([]);
      expect(server.getTable()!.seats[0]?.displayName).toBe('alice');
    });

    it('a leave without an ack callback still gets an error event when refused', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const stranger = connect();
      await waitForState(stranger, (s) => s.mode === 'holdem');
      const error = waitForEvent<ErrorPayload>(stranger, 'error');
      stranger.emit('leave');
      expect((await error).message).toBe('Not seated');
    });
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/socketServer.test.ts --root packages/server -t "audit I11"`
Expected: FAIL. The first test fails on `mySeatIndex` being 0 or the ack never arriving (the
`emitWithAck` timeout), the second on the ack. The third may already pass; check it fails with the
`fail` fallback removed in Step 3.

- [x] **Step 3: Implement**

In `packages/server/src/protocol.ts`, add above `ClientToServerEvents`:

```ts
// The answer to `leave` (audit I11): the client forgets its name only once the server has freed
// the seat, because a hand can start between the click and the server seeing it.
export type LeaveResult = { ok: true } | { ok: false; message: string };
```

and change the `leave` line in `ClientToServerEvents` to:

```ts
  leave: (ack?: (result: LeaveResult) => void) => void;
```

In `packages/server/src/socketServer.ts`, add `LeaveResult` to the `./protocol` type import, then add
this helper directly after the `broadcast` arrow function:

```ts
  // No socket may stay mapped to a seat that is being freed: its next state would point it at an
  // empty seat (the leaver's table stayed on screen), or at whoever sits down there next. Called
  // inside the table lock, just before the broadcast that shows the seat empty.
  function unmapSeat(seatIndex: number): string[] {
    const unmapped: string[] = [];
    for (const [socketId, mappedSeat] of seatBySocketId) {
      if (mappedSeat === seatIndex) {
        seatBySocketId.delete(socketId);
        unmapped.push(socketId);
      }
    }
    return unmapped;
  }
```

Replace the whole `socket.on('leave', …)` handler with:

```ts
    socket.on('leave', async (ack?: (result: LeaveResult) => void) => {
      const reply = typeof ack === 'function' ? ack : undefined;
      // A client that asked for an answer gets it in the ack only; one that didn't (the playtest
      // bots, older pages) gets the error event as before.
      const fail = (message: string) => {
        if (reply) {
          reply({ ok: false, message });
        } else {
          socket.emit('error', { message });
        }
      };
      const seatIndex = seatBySocketId.get(socket.id);
      const leavingTable = table;
      if (seatIndex === undefined || !leavingTable) {
        fail('Not seated');
        return;
      }
      try {
        await leavingTable.leave(seatIndex, () => {
          // A mode switch while we waited for the lock cleared the map; the same index may
          // now belong to someone at the new table.
          if (table === leavingTable) {
            unmapSeat(seatIndex);
          }
        });
        reply?.({ ok: true });
      } catch (err) {
        fail((err as Error).message);
      }
    });
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=@poker-blackjack/server` then `npm run typecheck`
Expected: all PASS, typecheck clean. The frontend still compiles because its `emit('leave')` passes
no ack, which the optional parameter allows.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/protocol.ts packages/server/src/socketServer.ts packages/server/src/socketServer.test.ts docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "fix(server): acknowledge leave and unmap the seat before broadcasting it empty (audit I11)"
```

---

### Task 3: Admin "Remove from table" (I6, kick)

**Files:**
- Modify: `packages/server/src/table.ts`
- Modify: `packages/server/src/protocol.ts`
- Modify: `packages/server/src/socketServer.ts`
- Test: `packages/server/src/table.test.ts`, `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Consumes: `freeSeat`, `isDealtIn` (Task 1); `unmapSeat` (Task 2).
- Produces:
  - `Table.kick(displayName: string, onRemoved?: (seatIndex: number) => void): Promise<'now' | 'after-hand'>`.
    It rejects with `No player named "<name>" is currently seated`.
  - Private `actingSeatIndex(): number | null` and
    `applyDefaultAction(seatIndex: number, expectedSeq?: number): Promise<void>`. Task 4 uses both.
  - `protocol.ts`: `ErrorCode` gains `'kicked'`; `export interface KickPayload { displayName: string }`;
    `adminKick: (payload: KickPayload) => void;` in `ClientToServerEvents`.

- [ ] **Step 1: Write the failing Table tests**

Append to `packages/server/src/table.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/table.test.ts --root packages/server -t "Table.kick"`
Expected: FAIL with "table.kick is not a function".

- [ ] **Step 3: Implement in `table.ts`**

Add a field next to `timedOutSeats`:

```ts
  // Seats the admin removed while they were in the hand: they are acted for from then on, and the
  // seat is freed when the hand ends (audit I6).
  private leavingAfterHand: Set<number> = new Set();
```

In `freeSeat` (Task 1), add `this.leavingAfterHand.delete(seatIndex);` after the
`timedOutSeats.delete` line.

Add the method after `leave`:

```ts
  /**
   * The admin's "Remove from table" (audit I6). Between hands, or for a seat not in the hand, the
   * seat is freed now. A player in the hand is treated as gone: marked disconnected and timed out,
   * so every turn of theirs gets the default action, and the seat is freed when the hand ends
   * (after payouts). `onRemoved` runs inside the lock before the broadcast; the socket server
   * unmaps and tells the player's sockets there.
   */
  async kick(displayName: string, onRemoved?: (seatIndex: number) => void): Promise<'now' | 'after-hand'> {
    const outcome = await this.runExclusive(async () => {
      const seat = this.seats.find((s) => sameName(s?.displayName, displayName));
      if (!seat) {
        throw new Error(`No player named "${displayName}" is currently seated`);
      }
      const { seatIndex } = seat;
      if (!this.handInProgress || !this.isDealtIn(seatIndex)) {
        this.freeSeat(seatIndex);
        onRemoved?.(seatIndex);
        this.deps.onStateChange();
        return 'now' as const;
      }
      seat.connected = false;
      this.timedOutSeats.add(seatIndex);
      this.leavingAfterHand.add(seatIndex);
      onRemoved?.(seatIndex);
      this.deps.onStateChange();
      await this.autoActIfSeatIsUpAndTimedOut(seatIndex);
      return 'after-hand' as const;
    });
    // Removing the one seat that never clicked Ready can be what lets the others start.
    this.startHandIfEveryoneReady().catch((err) => {
      console.error('Table: error starting hand after a seat was removed:', err);
    });
    return outcome;
  }

  private releaseSeatsLeavingAfterHand(): void {
    for (const seatIndex of this.leavingAfterHand) {
      if (this.seats[seatIndex]) {
        this.freeSeat(seatIndex);
      }
    }
    this.leavingAfterHand.clear();
  }
```

In `reconnect`, directly after `this.timedOutSeats.delete(seat.seatIndex);`, add:

```ts
    // Coming back during the hand they were removed from cancels the removal (audit I6).
    this.leavingAfterHand.delete(seat.seatIndex);
```

Call `this.releaseSeatsLeavingAfterHand();` as the **last line** of each place a hand ends:
- in `settleHoldem`'s `finally` block, after `this.timedOutSeats.clear();`;
- in `voidBlackjackHand`, after `this.timedOutSeats.clear();`;
- in `finishBlackjackHandIfComplete`, after `this.timedOutSeats.clear();` (before
  `await this.deps.handLog.clear();`).

Add the shared helpers before `autoActIfSeatIsUpAndTimedOut`:

```ts
  // Whose turn it is, as a seat index; null when no hand is in progress or nobody can act.
  private actingSeatIndex(): number | null {
    if (!this.handInProgress) {
      return null;
    }
    if (this.config.gameMode === 'holdem') {
      const acting = this.holdemHand?.actingPlayerId;
      return acting ? (this.seats.find((s) => s?.displayName === acting)?.seatIndex ?? null) : null;
    }
    return this.activeSeatIndex;
  }

  // The safe default the grace timer has always used: check when there is nothing to call,
  // otherwise fold; stand in Blackjack. Shared by the turn clock and the admin's force-act (audit
  // I6). Caller must hold the table lock.
  private async applyDefaultAction(seatIndex: number, expectedSeq?: number): Promise<void> {
    let action: PlayerAction | HoldemAction = 'stand';
    if (this.config.gameMode === 'holdem') {
      const context = this.holdemHand?.getBettingContext();
      action = context && context.toCall === 0 ? 'check' : 'fold';
    }
    await this.applyAction(seatIndex, action, undefined, expectedSeq);
  }
```

Replace the body of `autoActIfSeatIsUpAndTimedOut` with:

```ts
  private async autoActIfSeatIsUpAndTimedOut(seatIndex: number): Promise<void> {
    if (!this.timedOutSeats.has(seatIndex) || this.actingSeatIndex() !== seatIndex) {
      return;
    }
    await this.applyDefaultAction(seatIndex);
  }
```

And at the end of `applyAction`, replace the `nextSeatIndex` block with:

```ts
    if (this.handInProgress) {
      const nextSeatIndex = this.actingSeatIndex();
      if (nextSeatIndex !== null) {
        await this.autoActIfSeatIsUpAndTimedOut(nextSeatIndex);
      }
    }
```

- [ ] **Step 4: Run the Table tests**

Run: `npx vitest run src/table.test.ts --root packages/server`
Expected: all PASS, including the existing disconnect/auto-act tests, which now go through the
refactored helpers.

- [ ] **Step 5: Write the failing socket tests**

In `packages/server/src/protocol.ts`:
- change `ErrorCode` to `export type ErrorCode = 'name-claimed' | 'replaced' | 'kicked';`;
- add `export interface KickPayload { displayName: string; }`;
- add `adminKick: (payload: KickPayload) => void;` to `ClientToServerEvents`.

Then add to `packages/server/src/socketServer.test.ts`, inside `describe('socketServer', …)`:

```ts
  describe('adminKick (audit I6)', () => {
    async function seat(name: string) {
      const socket = connect();
      await joinAndGetToken(socket, name);
      await waitForSeated(socket, name);
      return socket;
    }

    it('removes an idle player between hands, tells them, and lets the ready players start', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = await seat('alice');
      const bob = await seat('bob');
      const cara = await seat('cara');
      alice.emit('ready');
      await waitForReady(alice, 'alice');
      bob.emit('ready');
      await waitForReady(bob, 'bob');

      const kicked = waitForEvent<ErrorPayload>(cara, 'error');
      const caraUnseated = waitForState(cara, (s) => s.table?.seats[2]?.displayName === null);
      const started = waitForState(alice, (s) => s.table?.handInProgress === true);
      const notice = waitForEvent<{ message: string }>(admin, 'adminNotice');
      admin.emit('adminKick', { displayName: 'cara' });

      expect(await kicked).toEqual({ message: 'The admin removed you from the table.', code: 'kicked' });
      expect((await caraUnseated).mySeatIndex).toBeNull();
      await started;
      expect((await notice).message).toBe('Removed "cara" from the table.');
    });

    it('mid-hand, folds for the player on their turn and frees the seat when the hand ends', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = await seat('alice');
      const bob = await seat('bob');
      alice.emit('ready');
      await waitForReady(alice, 'alice');
      const started = waitForState(bob, (s) => s.table?.handInProgress === true);
      bob.emit('ready');
      await started;

      const handOver = waitForState(bob, (s) => s.table?.handInProgress === false && s.table.seats[0]?.displayName === null);
      admin.emit('adminKick', { displayName: 'alice' }); // alice is up first, heads-up
      await handOver;
    });

    it('rejects a player who is not seated, and a non-admin', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const adminError = waitForEvent<ErrorPayload>(admin, 'error');
      admin.emit('adminKick', { displayName: 'ghost' });
      expect(await adminError).toEqual({ message: 'No player named "ghost" is currently seated', scope: 'admin' });

      const alice = await seat('alice');
      const aliceError = waitForEvent<ErrorPayload>(alice, 'error');
      alice.emit('adminKick', { displayName: 'alice' });
      expect(await aliceError).toEqual({ message: 'Admin only', scope: 'admin' });
    });
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/socketServer.test.ts --root packages/server -t "adminKick"`
Expected: FAIL (timeouts: no handler).

- [ ] **Step 7: Implement the handler**

In `packages/server/src/socketServer.ts`, add `KickPayload` to the `./protocol` type import, and add
after the `adminReleaseName` handler:

```ts
    // Unsticks a table held up by an idle or vanished player (audit I6). The kicked browser is
    // told before the broadcast that shows it unseated, so it doesn't auto-rejoin.
    socket.on('adminKick', adminHandler(async (payload: KickPayload) => {
      if (!isAdmin()) return;
      const displayName = normaliseDisplayName(payload?.displayName);
      if (!displayName) {
        rejectAdmin('Invalid display name');
        return;
      }
      const kickTable = table;
      if (!kickTable) {
        rejectAdmin(`No player named "${displayName}" is currently seated`);
        return;
      }
      let outcome: 'now' | 'after-hand';
      try {
        outcome = await kickTable.kick(displayName, (seatIndex) => {
          if (table !== kickTable) return;
          for (const socketId of unmapSeat(seatIndex)) {
            io.sockets.sockets
              .get(socketId)
              ?.emit('error', { message: 'The admin removed you from the table.', code: 'kicked' });
          }
        });
      } catch (err) {
        rejectAdmin((err as Error).message);
        return;
      }
      socket.emit('adminNotice', {
        message:
          outcome === 'now'
            ? `Removed "${displayName}" from the table.`
            : `Removed "${displayName}": they fold or stand from now on and leave when this hand ends.`,
      });
      broadcast();
    }));
```

- [ ] **Step 8: Run all server tests and typecheck**

Run: `npm test --workspace=@poker-blackjack/server` then `npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "feat(server): admin can remove a player from the table, mid-hand too (audit I6)"
```

---

### Task 4: Admin force-act and the optional turn clock (I6)

**Files:**
- Modify: `packages/server/src/table.ts`, `packages/server/src/protocol.ts`, `packages/server/src/socketServer.ts`
- Modify: `packages/frontend/src/fixtures/tableStateFixtures.ts` (one field, so the frontend still typechecks)
- Test: `packages/server/src/table.test.ts`, `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Consumes: `actingSeatIndex`, `applyDefaultAction` (Task 3).
- Produces:
  - `TableConfig.turnClockMs?: number` (absent or 0 means off).
  - `Table.updateConfig` also accepts `turnClockMs`.
  - `Table.forceDefaultAction(expectedSeq?: number): Promise<string>`, which resolves to the name
    acted for. It rejects with `'No hand in progress'` or `'Nobody is up to act'`.
  - `AppStateView.turnClockSeconds: number`.
  - `protocol.ts`: `ForceActPayload { seq?: number }`, `SetTurnClockPayload { seconds: number }`,
    plus `adminForceAct` and `adminSetTurnClock` in `ClientToServerEvents`.

- [ ] **Step 1: Write the failing Table tests**

Append to `packages/server/src/table.test.ts`:

```ts
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
});
```

(`wait` is the file's existing helper, defined near line 835.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/table.test.ts --root packages/server -t "audit I6"`
Expected: FAIL (`forceDefaultAction` is not a function; the clock tests see the hand still in
progress; `turnClockMs` is a type error under `npm run typecheck`).

- [ ] **Step 3: Implement in `table.ts`**

In `TableConfig`, add after `reconnectGraceMs`:

```ts
  /** How long a player has to act before the default action is applied; absent or 0 means off (audit I6). */
  turnClockMs?: number;
```

Change `updateConfig`'s parameter type to
`Partial<Pick<TableConfig, 'smallBlind' | 'bigBlind' | 'blackjackDefaultBet' | 'turnClockMs'>>`.
A changed clock takes effect from the next turn.

Add a field next to `disconnectTimers`:

```ts
  private turnClockTimer: NodeJS.Timeout | null = null;
```

In `retire()`, add before the closing brace:

```ts
    if (this.turnClockTimer) {
      clearTimeout(this.turnClockTimer);
      this.turnClockTimer = null;
    }
```

Add these methods after `autoActIfSeatIsUpAndTimedOut`:

```ts
  // Called whenever the turn may have moved (a hand started, an action was applied): restarts the
  // clock for whoever is up now. It is tied to the actionSeq it was started at, so a clock that
  // fires after the player acted does nothing (audit I6).
  private armTurnClock(): void {
    if (this.turnClockTimer) {
      clearTimeout(this.turnClockTimer);
      this.turnClockTimer = null;
    }
    const turnClockMs = this.config.turnClockMs ?? 0;
    if (this.retired || !this.handInProgress || turnClockMs <= 0) {
      return;
    }
    const seq = this.actionSeq;
    this.turnClockTimer = setTimeout(() => {
      this.turnClockTimer = null;
      this.runExclusive(async () => {
        if (this.retired || this.actionSeq !== seq) {
          return;
        }
        const seatIndex = this.actingSeatIndex();
        if (seatIndex !== null) {
          await this.applyDefaultAction(seatIndex);
        }
      }).catch((err) => {
        console.error('Table: error acting for a player whose turn clock ran out:', err);
      });
    }, turnClockMs);
  }

  /** The admin's "Act for …" (audit I6): the default action, once, for whoever is up. */
  forceDefaultAction(expectedSeq?: number): Promise<string> {
    return this.runExclusive(async () => {
      if (!this.handInProgress) {
        throw new Error('No hand in progress');
      }
      const seatIndex = this.actingSeatIndex();
      const seat = seatIndex !== null ? this.seats[seatIndex] : null;
      if (seatIndex === null || !seat) {
        throw new Error('Nobody is up to act');
      }
      await this.applyDefaultAction(seatIndex, expectedSeq);
      return seat.displayName;
    });
  }
```

Arm the clock in two places:
- in `applyAction`, directly after the `this.deps.onStateChange();` that follows the mode branches
  (before the `if (this.handInProgress) { const nextSeatIndex … }` tail), add `this.armTurnClock();`;
- in `startHand`, directly after its final `this.deps.onStateChange();`, add `this.armTurnClock();`.

When a hand ends, `handInProgress` is false at the next `armTurnClock()` call, which clears the timer.

- [ ] **Step 4: Run the Table tests**

Run: `npx vitest run src/table.test.ts --root packages/server`
Expected: all PASS.

- [ ] **Step 5: Write the failing socket tests**

In `packages/server/src/protocol.ts`, add:

```ts
export interface ForceActPayload {
  /** The table's actionSeq as the admin saw it, so a double-click doesn't act for the next player too. */
  seq?: number;
}

export interface SetTurnClockPayload {
  /** Whole seconds: 0 turns the clock off, otherwise 10-600. */
  seconds: number;
}
```

and to `ClientToServerEvents`:

```ts
  adminForceAct: (payload: ForceActPayload) => void;
  adminSetTurnClock: (payload: SetTurnClockPayload) => void;
```

Add to `packages/server/src/socketServer.test.ts`, inside `describe('socketServer', …)`:

```ts
  describe('adminForceAct and adminSetTurnClock (audit I6)', () => {
    it('acts for whoever is up and says who', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const alice = connect();
      await joinAndGetToken(alice, 'alice');
      await waitForSeated(alice, 'alice');
      const bob = connect();
      await joinAndGetToken(bob, 'bob');
      await waitForSeated(bob, 'bob');
      alice.emit('ready');
      await waitForReady(alice, 'alice');
      const started = waitForState(admin, (s) => s.table?.handInProgress === true);
      bob.emit('ready');
      const seq = (await started).table!.actionSeq;

      const notice = waitForEvent<{ message: string }>(admin, 'adminNotice');
      const over = waitForState(admin, (s) => s.table?.handInProgress === false);
      admin.emit('adminForceAct', { seq });
      expect((await notice).message).toBe('Acted for alice.');
      await over;
    });

    it('sets the turn clock, shows it in every state, and rejects values out of range', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const set = waitForState(admin, (s) => s.turnClockSeconds === 30);
      admin.emit('adminSetTurnClock', { seconds: 30 });
      await set;

      for (const seconds of [5, 601, 12.5, -1]) {
        const error = waitForEvent<ErrorPayload>(admin, 'error');
        admin.emit('adminSetTurnClock', { seconds });
        expect(await error).toEqual({
          message: 'The turn clock must be 0 (off) or a whole number of seconds from 10 to 600',
          scope: 'admin',
        });
      }

      const off = waitForState(admin, (s) => s.turnClockSeconds === 0);
      admin.emit('adminSetTurnClock', { seconds: 0 });
      await off;
    });

    it('a new table after a mode switch keeps the turn clock', async () => {
      const admin = connect();
      await startGameAsAdmin(admin, 'holdem');
      const set = waitForState(admin, (s) => s.turnClockSeconds === 20);
      admin.emit('adminSetTurnClock', { seconds: 20 });
      await set;
      const switched = waitForState(admin, (s) => s.mode === 'blackjack');
      admin.emit('adminSwitchMode', { mode: 'blackjack' });
      expect((await switched).turnClockSeconds).toBe(20);
    });
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/socketServer.test.ts --root packages/server -t "adminForceAct"`
Expected: FAIL (timeouts; `turnClockSeconds` undefined).

- [ ] **Step 7: Implement in `socketServer.ts` and `table.ts`**

In `table.ts`'s `AppStateView`, add after `defaultStartingBalance: number;`:

```ts
  /** The admin's turn clock in seconds; 0 when off (audit I6). */
  turnClockSeconds: number;
```

In `socketServer.ts`:
- add `ForceActPayload, SetTurnClockPayload` to the `./protocol` type import;
- next to `let modeChangeInFlight = false;`, add:

```ts
  // The admin's turn clock (audit I6). Memory only, like the admin session: a restart turns it off.
  let turnClockMs = 0;
```

- in `buildTableConfig`'s returned object, add `turnClockMs,` after `reconnectGraceMs`;
- in `buildAppStateView`'s returned object, add `turnClockSeconds: turnClockMs / 1000,` after
  `defaultStartingBalance`;
- add after the `adminKick` handler:

```ts
    socket.on('adminForceAct', adminHandler(async (payload: ForceActPayload) => {
      if (!isAdmin()) return;
      if (!table) {
        rejectAdmin('No game is active');
        return;
      }
      const seq = typeof payload?.seq === 'number' ? payload.seq : undefined;
      let name: string;
      try {
        name = await table.forceDefaultAction(seq);
      } catch (err) {
        rejectAdmin((err as Error).message);
        return;
      }
      socket.emit('adminNotice', { message: `Acted for ${name}.` });
    }));

    socket.on('adminSetTurnClock', adminHandler(async (payload: SetTurnClockPayload) => {
      if (!isAdmin()) return;
      const seconds = payload?.seconds;
      if (!isNonNegativeNumber(seconds) || !Number.isInteger(seconds) || (seconds !== 0 && (seconds < 10 || seconds > 600))) {
        rejectAdmin('The turn clock must be 0 (off) or a whole number of seconds from 10 to 600');
        return;
      }
      turnClockMs = seconds * 1000;
      table?.updateConfig({ turnClockMs });
      broadcast();
    }));
```

In `packages/frontend/src/fixtures/tableStateFixtures.ts`, add `turnClockSeconds: 0,` to
`DEFAULT_CONFIG_VIEW`.

- [ ] **Step 8: Run everything and typecheck**

Run: `npm test --workspace=@poker-blackjack/server`, `npm test --workspace=@poker-blackjack/frontend`,
then `npm run typecheck`.
Expected: all PASS, typecheck clean. If typecheck names another `AppStateView` literal, add
`turnClockSeconds: 0` there.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src packages/frontend/src/fixtures/tableStateFixtures.ts docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "feat(server): admin force-act and an optional turn clock (audit I6)"
```

---

### Task 5: Client: rejoin after two quick drops, confirmed leave, kicked (I10, I11, I6 client)

**Files:**
- Modify: `packages/frontend/src/socket/SocketContext.tsx`
- Test: `packages/frontend/src/socket/SocketContext.test.tsx`

**Interfaces:**
- Consumes: `LeaveResult` and the `'kicked'` error code (Tasks 2-3).
- Produces: `leave()` keeps its signature. It now waits for the ack, and a second call while one is
  pending does nothing (this also fixes M30's double-click).

- [ ] **Step 1: Update the two existing leave tests for the ack**

In `SocketContext.test.tsx`, add `import type { LeaveResult } from '@poker-blackjack/server/src/protocol';`
and this helper after `storedIdentity()`:

```ts
function answerLeave(result: LeaveResult) {
  const sent = emitted.find((e) => e.event === 'leave');
  if (!sent) throw new Error('no leave was emitted');
  act(() => {
    (sent.payload as (r: LeaveResult) => void)(result);
  });
}
```

In `'leave() while no hand is in progress emits leave and clears the session'`, replace
`expect(emitted).toContainEqual({ event: 'leave', payload: undefined });` with:

```ts
    expect(emitted.filter((e) => e.event === 'leave')).toHaveLength(1);
    expect(storedIdentity().lastName).toBe('alice'); // not until the server confirms
    answerLeave({ ok: true });
```

In `'leave forgets the last name and keeps the token'` (identity block), add
`answerLeave({ ok: true });` after the `leave` click.

- [ ] **Step 2: Write the failing tests**

Add inside `describe('SocketProvider', …)`:

```ts
  describe('unsticking (audit I10, I11, I6)', () => {
    it('rejoins after a second drop that lands before the first rejoin was answered (I10)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      expect(screen.getByTestId('status')).toHaveTextContent('at-table');

      push('disconnect');
      act(() => ioManagerHandlers.get('reconnect')?.()); // first rejoin goes out, then is lost
      push('disconnect');
      emitted.length = 0;
      act(() => ioManagerHandlers.get('reconnect')?.());
      expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
    });

    it('keeps its name when the server refuses the leave because a hand just started (I11)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('state', makeAppState(makeHoldemPreflopState(), { mySeatIndex: 0 }));
      answerLeave({ ok: false, message: 'Cannot leave while a hand you are in is in progress' });

      expect(screen.getByTestId('status')).toHaveTextContent('at-table');
      expect(screen.getByTestId('name')).toHaveTextContent('alice');
      expect(screen.getByTestId('error')).toHaveTextContent('Cannot leave while a hand you are in is in progress');
      expect(storedIdentity().lastName).toBe('alice');
    });

    it('does not rejoin on the unseated state that arrives before the leave is confirmed (I11)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      emitted.length = 0;
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      expect(emitted.filter((e) => e.event === 'join')).toEqual([]);
    });

    it('lands on the join screen once the leave is confirmed (I11)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      answerLeave({ ok: true });
      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('name')).toHaveTextContent('none');
    });

    it('a second leave click while the first is unanswered sends nothing (M30)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      act(() => screen.getByText('leave').click());
      expect(emitted.filter((e) => e.event === 'leave')).toHaveLength(1);
    });

    it('when kicked, shows why on the join screen, forgets the name, keeps the token and does not rejoin (I6)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      push('error', { message: 'The admin removed you from the table.', code: 'kicked' });
      emitted.length = 0;
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));

      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('error')).toHaveTextContent('The admin removed you from the table.');
      expect(screen.getByTestId('name')).toHaveTextContent('none');
      expect(storedIdentity()).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
      expect(emitted.filter((e) => e.event === 'join')).toEqual([]);
    });
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/socket/SocketContext.test.tsx --root packages/frontend`
Expected: the new tests FAIL (no join on the second reconnect; the leave payload is not a function;
the kicked message is cleared by the next state), and the two edited tests FAIL on the ack.

- [ ] **Step 4: Implement in `SocketContext.tsx`**

Add `LeaveResult` to the `@poker-blackjack/server/src/protocol` type import.

Add two refs after `replacedRef`:

```ts
  // True from sending `leave` until the server answers it. While it is set, an unseated state is
  // our own leave landing, not a reason to rejoin; the name is forgotten only on a confirmed leave,
  // because a hand can start between the click and the server seeing it (audit I11).
  const leavePendingRef = useRef(false);
  // Set when the admin removed us (audit I6): the reason stays on the join screen until the player
  // joins again, instead of being cleared by the next broadcast like an in-game error.
  const keepErrorRef = useRef(false);
```

In the `'state'` handler, replace `setErrorMessage(null);` with:

```ts
      if (!keepErrorRef.current) {
        setErrorMessage(null);
      }
```

and add a branch between the `joinInFlightRef` branch and the auto-rejoin branch:

```ts
      } else if (leavePendingRef.current) {
        // Our own leave landing before its ack: wait for the ack (leave() below) to decide.
```

In the `'error'` handler, add after the `replaced` block:

```ts
      if (payload.code === 'kicked') {
        // Like a confirmed leave, but the reason is shown. The token is kept, so typing the name
        // again sits back down with the same balance (audit I6).
        forgetLastName();
        displayNameRef.current = null;
        setDisplayName(null);
        joinedRef.current = false;
        joinInFlightRef.current = false;
        keepErrorRef.current = true;
        setErrorMessage(payload.message);
        setStatus('entering-name');
        return;
      }
```

In the `'disconnect'` handler, add before `if (statusRef.current === 'at-table')`:

```ts
      // A join or leave sent before the drop may never be answered. Left set, joinInFlightRef
      // blocked the rejoin after a second quick drop and the player sat on "Reconnecting…"
      // (audit I10). A leave lost this way is retried by hand: we rejoin with the name we kept.
      joinInFlightRef.current = false;
      leavePendingRef.current = false;
```

In `joinWithName`, add `keepErrorRef.current = false;` next to `setErrorMessage(null);`.

Replace `leave()` with:

```ts
  function leave() {
    // GameTable hides Leave mid-hand; this guard is the same rule for any other caller. The
    // pending check makes a double-click one leave (audit M30).
    if (state?.table?.handInProgress || leavePendingRef.current || !socketRef.current) {
      return;
    }
    leavePendingRef.current = true;
    socketRef.current.emit('leave', (result: LeaveResult) => {
      leavePendingRef.current = false;
      if (!result.ok) {
        // The seat is still ours (a hand started first): stay, and say why.
        setErrorMessage(result.message);
        return;
      }
      forgetLastName();
      displayNameRef.current = null;
      joinedRef.current = false;
      setDisplayName(null);
      setErrorMessage(null);
      // The unseated state already arrived and was held back by leavePendingRef.
      if (statusRef.current === 'at-table') {
        setStatus('entering-name');
      }
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=@poker-blackjack/frontend` then `npm run typecheck`
Expected: all PASS, typecheck clean. The integration tests in `src/integration/` run against a real
server and must still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/socket docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "fix(frontend): rejoin after two quick drops, leave on server confirmation, handle kicks (audit I10, I11, I6)"
```

---

### Task 6: Admin panel: remove a player, act for the player who is up, turn clock (I6 UI)

**Files:**
- Modify: `packages/frontend/src/socket/SocketContext.tsx`, `packages/frontend/src/components/AdminPanel.tsx`
- Modify: `packages/frontend/src/components/{AdminPanel,AdminEntry,JoinScreen,Lobby}.test.tsx` (the `SocketContextValue` literals)
- Test: `packages/frontend/src/components/AdminPanel.test.tsx`, `packages/frontend/src/socket/SocketContext.test.tsx`

**Interfaces:**
- Consumes: the `adminKick`, `adminForceAct` and `adminSetTurnClock` events (Tasks 3-4), and
  `AppStateView.turnClockSeconds`.
- Produces: `SocketContextValue.adminKick(displayName: string): void`, `adminForceAct(): void` and
  `adminSetTurnClock(seconds: number): void`.

- [ ] **Step 1: Write the failing tests**

In every `SocketContextValue` literal in `AdminPanel.test.tsx`, `AdminEntry.test.tsx`,
`JoinScreen.test.tsx` and `Lobby.test.tsx`, add next to `adminReleaseName: vi.fn(),`:

```ts
    adminKick: vi.fn(),
    adminForceAct: vi.fn(),
    adminSetTurnClock: vi.fn(),
```

Update the `makeHoldemPreflopState` import in `AdminPanel.test.tsx` to
`import { makeAppState, makeWaitingState, makeLobbyState, makeHoldemPreflopState } from '../fixtures/tableStateFixtures';`,
then add to its `describe('AdminPanel', …)`:

```ts
  describe('unsticking the table (audit I6)', () => {
    it('removes the selected player', () => {
      const value = renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.change(screen.getByLabelText('Player to remove'), { target: { value: 'bob' } });
      fireEvent.click(screen.getByRole('button', { name: /remove from table/i }));
      expect(value.adminKick).toHaveBeenCalledWith('bob');
    });

    it('offers no "Act for" between hands', () => {
      renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      expect(screen.queryByRole('button', { name: /^act for /i })).not.toBeInTheDocument();
    });

    it('acts for whoever is up mid-hand', () => {
      const state = makeAppState(makeHoldemPreflopState(), { isAdmin: true });
      const acting = state.table!.holdem!.actingPlayerId!;
      const value = renderWithSocket({ state });
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.click(screen.getByRole('button', { name: `Act for ${acting}` }));
      expect(value.adminForceAct).toHaveBeenCalled();
    });

    it('shows the current turn clock and saves a new one', () => {
      const value = renderWithSocket({
        state: makeAppState(makeWaitingState(), { isAdmin: true, turnClockSeconds: 45 }),
      });
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      const input = screen.getByLabelText('Turn clock (seconds, 0 = off)');
      expect(input).toHaveValue(45);
      fireEvent.change(input, { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: /save turn clock/i }));
      expect(value.adminSetTurnClock).toHaveBeenCalledWith(0);
    });
  });
```

In `SocketContext.test.tsx`, add `adminKick, adminForceAct, adminSetTurnClock` to the
`TestConsumer` destructuring, with these buttons:

```tsx
      <button onClick={() => adminKick('bob')}>admin-kick</button>
      <button onClick={() => adminForceAct()}>admin-force</button>
      <button onClick={() => adminSetTurnClock(30)}>admin-clock</button>
```

and add this test inside `describe('unsticking (audit I10, I11, I6)', …)`:

```ts
    it('sends the admin unsticking events, force-act with the latest actionSeq', () => {
      renderProvider();
      push('state', makeAppState(makeHoldemPreflopState({ actionSeq: 7 }), { isAdmin: true }));
      emitted.length = 0;
      act(() => screen.getByText('admin-kick').click());
      act(() => screen.getByText('admin-force').click());
      act(() => screen.getByText('admin-clock').click());
      expect(emitted).toEqual([
        { event: 'adminKick', payload: { displayName: 'bob' } },
        { event: 'adminForceAct', payload: { seq: 7 } },
        { event: 'adminSetTurnClock', payload: { seconds: 30 } },
      ]);
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/AdminPanel.test.tsx src/socket/SocketContext.test.tsx --root packages/frontend`
Expected: FAIL (missing functions and controls).

- [ ] **Step 3: Implement `SocketContext.tsx`**

In `SocketContextValue`, after `adminReleaseName`, add:

```ts
  // Unsticking a table (audit I6): free an idle player's seat, act once for whoever is up, and
  // set the turn clock (seconds, 0 = off).
  adminKick: (displayName: string) => void;
  adminForceAct: () => void;
  adminSetTurnClock: (seconds: number) => void;
```

After `adminReleaseName()`, add:

```ts
  function adminKick(name: string) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminKick', { displayName: name });
  }

  // Carries the actionSeq the admin saw, like a player's action, so a double-click acts once.
  function adminForceAct() {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminForceAct', { seq: latestActionSeqRef.current ?? undefined });
  }

  function adminSetTurnClock(seconds: number) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminSetTurnClock', { seconds });
  }
```

and add `adminKick, adminForceAct, adminSetTurnClock,` to the `value` object.

- [ ] **Step 4: Implement `AdminPanel.tsx`**

Add the three functions to the `useSocket()` destructuring. Add state after `releaseName`:

```ts
  const [kickName, setKickName] = useState('');
  const [turnClock, setTurnClock] = useState<FieldValue>(null);
```

After `startingBalanceValue`, add:

```ts
  const turnClockValue = turnClock ?? String(state.turnClockSeconds);
  // Who the table is waiting on mid-hand, for "Act for …".
  const actingName = !table.handInProgress
    ? null
    : table.gameMode === 'holdem'
      ? (table.holdem?.actingPlayerId ?? null)
      : table.activeSeatIndex !== null
        ? (table.seats[table.activeSeatIndex]?.displayName ?? null)
        : null;
```

After `handleReleaseName`, add:

```ts
  function handleKick(event: FormEvent) {
    event.preventDefault();
    if (kickName === '') {
      return;
    }
    adminKick(kickName);
    setKickName('');
  }

  function handleSetTurnClock(event: FormEvent) {
    event.preventDefault();
    const seconds = parseField(turnClockValue);
    if (seconds === null) {
      return;
    }
    adminSetTurnClock(seconds);
    setTurnClock(null);
  }
```

Insert this JSX directly before the "Release a name" form's comment:

```tsx
          {/* Unsticking the table (audit I6): an idle or vanished player can't hold everyone up. */}
          {actingName && (
            <button type="button" onClick={() => adminForceAct()} className="rounded bg-amber-600 px-2 py-1">
              Act for {actingName}
            </button>
          )}

          <form onSubmit={handleKick} className="flex flex-col gap-1">
            <p className="text-xs text-slate-400">
              Remove a player (mid-hand they fold or stand, then leave when the hand ends)
            </p>
            <select
              value={kickName}
              onChange={(event) => setKickName(event.target.value)}
              aria-label="Player to remove"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            >
              <option value="">Select player</option>
              {seatedNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-red-700 px-2 py-1">
              Remove from table
            </button>
          </form>

          <form onSubmit={handleSetTurnClock} className="flex flex-col gap-1">
            <input
              type="number"
              value={turnClockValue}
              onChange={(event) => setTurnClock(event.target.value)}
              aria-label="Turn clock (seconds, 0 = off)"
              placeholder="Turn clock (seconds, 0 = off)"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Save turn clock
            </button>
          </form>
```

The force-act button's accessible name is "Act for alice". The existing test's
`getByLabelText(/select player/i)` matches only the balance select, because the new one is labelled
"Player to remove".

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test --workspace=@poker-blackjack/frontend` then `npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "feat(frontend): admin panel can remove a player, act for whoever is up, set a turn clock (audit I6)"
```

---

### Task 7: Docs, handoff and final verification

**Files:**
- Modify: `docs/HOSTING.md` (the "Someone's phone died" troubleshooting entry, around line 141; add an entry)
- Modify: `HANDOFF.md` ("Next steps" item 1; the audit progress table)

- [ ] **Step 1: Update `docs/HOSTING.md`**

At the end of the "Someone's phone died / they closed the tab and came back later" entry, replace
`the seat itself is theirs until they explicitly leave.` with:

```markdown
  the seat itself is theirs until they leave or the admin removes them (next entry).
```

Add a new entry directly after it:

```markdown
- **The table is waiting on someone who isn't playing** (never clicked Ready, walked away mid-hand,
  or a seat left behind by a closed browser): open the **Admin panel**.
  - **Remove from table** frees their seat. Mid-hand, they fold or stand from then on and the seat
    is freed when the hand ends. They keep their name and balance, and can sit down again by typing
    their name.
  - **Act for <name>** folds (or checks, when there is nothing to call) or stands for whoever the
    table is waiting on, once.
  - **Turn clock** (seconds, 0 = off) does the same automatically for any player who takes longer
    than that on a turn. It resets to off when the server restarts, and players see no countdown
    yet.
```

- [ ] **Step 2: Full verification**

Run, from the repo root:
- `npm test --workspace=@poker-blackjack/server`
- `npm test --workspace=@poker-blackjack/frontend`
- `npm test --workspace=@poker-blackjack/game-engine`
- `npm run typecheck`

Expected: all green; record the three test counts (they were 278 server, 321 frontend and 133
game-engine before this item).

- [ ] **Step 3: Browser check (delegate to a subagent; never from the main thread)**

On an isolated server (port 3100, `.playtest-data/run/` data dir; see HANDOFF's safe playtest data
path), with up to four browser tabs (admin, alice, bob, cara), confirm and write the results
to `.playtest-data/run/item6-browser-check.md`:
1. alice clicks **Leave table** between hands → lands on the join screen without a reload (the
   "table stayed on screen" observation).
2. alice and bob Ready, cara idle → admin **Remove from table** cara → cara's tab shows "The admin
   removed you from the table." on the join screen, and the hand starts for alice and bob.
3. Mid-hand, admin **Act for <name>** → that player folds/checks/stands; the button names the next
   player.
4. Admin sets the turn clock to 10 → the player who is up is acted for after about 10 s; set back to 0.
5. Console clean in every tab.

- [ ] **Step 4: Update `HANDOFF.md`**

- In "Next steps", mark item 1 done (one line: what shipped, plus the commit range). Item 2,
  Plan B, becomes next. Add to Plan B's "things to check": "show the turn clock countdown
  (`turnClockSeconds` is in every state; the server sends no deadline yet)" and "decide whether
  Leave shows mid-hand for a player who isn't dealt in (the server allows it since item 6)".
- In the audit progress table, add a row for item 6 (I6, I10, I11, M30), with the commits and test counts.
- Under "Decisions worth knowing", add the "chosen without the user" list from this plan's Global
  Constraints.

- [ ] **Step 5: Commit**

```bash
git add docs/HOSTING.md HANDOFF.md docs/superpowers/plans/2026-10-02-unsticking-tables.md
git commit -m "docs: admin unsticking tools in HOSTING; item 6 handoff"
```

Then stop and ask the user before pushing or opening a PR.

---

## Not covered here

- **A turn countdown on screen.** It belongs in Plan B's HUD. When that is built, add a server
  deadline (e.g. `turnEndsInMs` on `TableStateView`) alongside it.
- **Leave mid-hand for a player who isn't dealt in.** The server allows it; the client still hides
  the button mid-hand.
- **"Deal now without the players who aren't ready"**: an alternative to removing an idle player.
  It was not requested, and removal covers it.
- **A ready timeout.** The admin removal covers the "never clicked Ready" case.
- **MIN-1** (`join` still outside the table lock) and MIN-2: they belong with I3, as before.
  `leave` now takes the lock, which closes the leave half of MIN-1.
- **A leave lost to a disconnect.** If a leave is lost because the connection dropped before the
  ack arrived, the client rejoins with its kept name on reconnect. If the server had already freed
  the seat, the player is seated again and has to leave again. This is rare and harmless.
