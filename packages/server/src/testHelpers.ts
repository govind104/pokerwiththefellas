import type { Socket as ClientSocket } from 'socket.io-client';
import type { AppStateView, GameMode } from './table';
import type { StaticTableConfig } from './socketServer';
import type { GameConfigValues } from './gameConfigStore';

// Shared across socketServer.test.ts, integration.test.ts, and
// integration-resilience.test.ts -- all three spin up a real createServer()
// instance behind a real HTTP+socket.io listener and need the same
// lobby/admin bootstrapping to get from "server just started" to "a game is
// active" before their actual test assertions can begin.
export const ADMIN_PASSPHRASE = 'test-passphrase';

// Default createServer() boot config shared by socketServer.test.ts's three
// describe blocks (previously each copy-pasted its own identical literal).
// Never mutated by any test -- JsonGameConfigStore only spreads `defaults`,
// it doesn't write into it -- so a single shared object is safe to reuse
// across describes.
export const DEFAULT_STATIC_CONFIG: StaticTableConfig = { seatCount: 8, reconnectGraceMs: 50, random: Math.random };
export const DEFAULT_GAME_CONFIG: GameConfigValues = {
  smallBlind: 5,
  bigBlind: 10,
  blackjackDefaultBet: 25,
  defaultStartingBalance: 1000,
};

export function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

export function waitForState(socket: ClientSocket, predicate: (state: AppStateView) => boolean): Promise<AppStateView> {
  return new Promise((resolve) => {
    const handler = (state: AppStateView) => {
      if (predicate(state)) {
        socket.off('state', handler);
        resolve(state);
      }
    };
    socket.on('state', handler);
  });
}

// Logs in as admin and starts a game on a fresh (lobby-state) server, then
// waits for that client to see the resulting active table -- the equivalent
// of what every test in these files could previously assume createServer()
// already gave them for free. Returns nothing; callers already have `server`
// and use `server.getTable()!` to inspect the resulting Table directly.
export async function startGameAsAdmin(socket: ClientSocket, mode: GameMode): Promise<void> {
  socket.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
  await waitForEvent(socket, 'adminLoginResult');
  const started = waitForState(socket, (s) => s.mode === mode);
  socket.emit('adminStartGame', { mode });
  await started;
}

// Every socket now receives a "welcome" `state` event the instant it
// connects (a lobby/table snapshot pushed from the `connection` handler in
// socketServer.ts, added alongside this task's admin/lobby work), and every
// state-mutating action broadcasts at least once -- sometimes twice, once
// from inside Table's own onStateChange callback and again from the
// handler that awaited it. That means a bare `socket.once('state', ...)`
// immediately after `emit('join')`/`emit('ready')` is no longer a reliable
// "this finished" signal: it can resolve on the pre-join welcome snapshot
// (or some other stale broadcast) instead of the state produced by the
// action just sent, letting a same-socket follow-up action (most commonly
// `ready` sent right after `join`) race ahead of the server actually having
// recorded the seat -- the join handler's `seatBySocketId.set(...)` happens
// only after an `await` on the player store, so a fast-arriving `ready`
// can find nothing there yet, get silently answered with an ignored
// 'Not seated' error, and never flip the seat's ready flag -- hanging any
// later predicate that waits on both players being ready. `waitForSeated`
// and `waitForReady` wait for the actual condition instead of "some state
// event arrived", closing that race regardless of how many extra `state`
// broadcasts fire in between.
export function waitForSeated(socket: ClientSocket, displayName: string): Promise<AppStateView> {
  return waitForState(socket, (s) => s.table?.seats.some((seat) => seat?.displayName === displayName) ?? false);
}

export function waitForReady(socket: ClientSocket, displayName: string): Promise<AppStateView> {
  return waitForState(
    socket,
    (s) => s.table?.seats.find((seat) => seat?.displayName === displayName)?.ready === true
  );
}

// For the reconnect-to-an-existing-seat path specifically: the seat (and its
// displayName) already exists in the table's state the instant a
// reconnecting socket connects -- welcome snapshot included -- just with
// `connected: false`. So `waitForSeated` above (which only checks the name
// is present) would resolve on that same racy welcome snapshot without ever
// observing the reconnect actually complete. This waits for the seat to
// flip to `connected: true` instead.
export function waitForConnected(socket: ClientSocket, displayName: string): Promise<AppStateView> {
  return waitForState(
    socket,
    (s) => s.table?.seats.find((seat) => seat?.displayName === displayName)?.connected === true
  );
}
