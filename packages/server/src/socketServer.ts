import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import sirv from 'sirv';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { Table, type TableConfig, type GameMode, type AppStateView } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';
import type { GameConfigStore, GameConfigValues } from './gameConfigStore';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  JoinPayload,
  ActionPayload,
  AdminLoginPayload,
  StartGamePayload,
} from './protocol';

export interface StaticTableConfig {
  seatCount: number;
  reconnectGraceMs: number;
  random: () => number;
  // Directory to serve the built frontend from (sirv, SPA fallback). Undefined
  // means API-only -- the two-port local dev workflow, where Vite serves the
  // frontend itself. Grouped here with the server's other startup-lifetime
  // settings rather than passed as a separate positional parameter, since it
  // has the same "fixed for the server's lifetime" shape as seatCount/
  // reconnectGraceMs/random and the previous bare 6th positional parameter
  // was the same type (string | undefined) as the adjacent adminPassphrase
  // parameter -- a transposition of the two would have compiled silently.
  staticDir?: string;
}

export interface CreateServerResult {
  httpServer: HttpServer;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  getTable: () => Table | null;
}

// Defense in depth alongside JsonPlayerStore's null-prototype balance map:
// the design spec requires malformed or unexpected socket payloads to be
// rejected before reaching the engine at all, and a display name arriving off
// the wire is entirely attacker-controlled. The 32-character bound is a
// judgment call, not a spec requirement.
function isValidDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 32;
}

// Same "reject malformed payloads before they reach anything durable"
// rationale as isValidDisplayName. These matter more than ordinary input
// hygiene because every value guarded here is written straight through to a
// file that survives a restart: a NaN/undefined/negative big blind persists
// into game-config.json and poisons every future hand, and a bad balance
// persists into balances.json. `Number.isFinite` rejects NaN and both
// infinities; `typeof === 'number'` rejects the string/undefined/null cases
// a hand-rolled client could send (note that `Number('') === 0`, which is
// exactly the coercion that made an empty admin input a silent zero).
function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// A balance of 0 is a legitimate, reachable game state (a busted player has
// exactly that), so unlike the config values above, zero is allowed here --
// only negatives and non-numbers are rejected.
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isGameMode(value: unknown): value is GameMode {
  return value === 'holdem' || value === 'blackjack';
}

export async function createServer(
  staticConfig: StaticTableConfig,
  gameConfigStore: GameConfigStore,
  playerStore: PlayerStore,
  handLog: HandLog,
  adminPassphrase: string | undefined
): Promise<CreateServerResult> {
  const { staticDir } = staticConfig;
  if (staticDir && !existsSync(staticDir)) {
    // sirv() walks the directory synchronously at construction time and
    // throws a bare ENOENT/scandir error with no indication of what to do
    // about it. This is a real, documented path (.env.example's STATIC_DIR
    // comment describes running the server standalone), not a contrived
    // edge case -- most likely cause is starting the server before ever
    // running the frontend build.
    throw new Error(
      `STATIC_DIR is set to "${staticDir}", but that directory does not exist. ` +
        'Build the frontend first (npm run build --workspace=@poker-blackjack/frontend), ' +
        'or use "npm run play" to build and start in one step.'
    );
  }
  const httpServer = createHttpServer(staticDir ? sirv(staticDir, { single: true }) : undefined);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  const seatBySocketId = new Map<string, number>();
  const adminSocketIds = new Set<string>();
  let table: Table | null = null;
  let currentMode: GameMode | null = null;
  // Mirrors the config store's current values so every `state` broadcast can
  // carry them synchronously (broadcast() must not await anything -- it is
  // called from Table's onStateChange callback deep inside hand handling).
  // Kept in step with the store by refreshing it from every read and every
  // write below; the store remains the source of truth.
  let currentConfig: GameConfigValues = await gameConfigStore.getConfig();
  // Narrows the check-then-await window in adminStartGame/adminSwitchMode:
  // two rapid clicks (or two admin sockets) could otherwise both pass their
  // `table` check and both build a table, with the second silently
  // discarding the first. A single boolean, not a real mutex -- the handlers
  // it guards are the only writers of `table`/`currentMode`.
  let modeChangeInFlight = false;

  async function buildTableConfig(mode: GameMode): Promise<TableConfig> {
    const values = await gameConfigStore.getConfig();
    currentConfig = values;
    return {
      gameMode: mode,
      seatCount: staticConfig.seatCount,
      smallBlind: values.smallBlind,
      bigBlind: values.bigBlind,
      blackjackDefaultBet: values.blackjackDefaultBet,
      defaultStartingBalance: values.defaultStartingBalance,
      reconnectGraceMs: staticConfig.reconnectGraceMs,
      random: staticConfig.random,
    };
  }

  function buildAppStateView(socketId: string | null, seatIndex: number | null): AppStateView {
    return {
      mode: currentMode,
      isAdmin: socketId !== null && adminSocketIds.has(socketId),
      table: table ? table.getStateForSeat(seatIndex) : null,
      smallBlind: currentConfig.smallBlind,
      bigBlind: currentConfig.bigBlind,
      blackjackDefaultBet: currentConfig.blackjackDefaultBet,
      defaultStartingBalance: currentConfig.defaultStartingBalance,
    };
  }

  const broadcast = () => {
    for (const [socketId, socket] of io.sockets.sockets) {
      socket.emit('state', buildAppStateView(socketId, seatBySocketId.get(socketId) ?? null));
    }
  };

  function createTable(config: TableConfig): Table {
    return new Table(config, { playerStore, handLog, onStateChange: broadcast });
  }

  // Startup recovery: an unfinished hand from before a restart must resume
  // into its own mode automatically -- there is no choice to offer the admin
  // here, the mode is simply whatever was already being played. Peeking the
  // hand log's first entry (the same discriminant Table.recoverFromLog uses
  // internally) lets this decision happen before any Table exists, which the
  // empty-lobby-until-admin-picks design requires. An empty or unrecognized
  // log leaves currentMode/table both null -- a genuine fresh lobby.
  const startupEntries = await handLog.readAll();
  const startupMode: GameMode | null =
    startupEntries[0]?.type === 'holdem_hand_started'
      ? 'holdem'
      : startupEntries[0]?.type === 'blackjack_hand_started'
        ? 'blackjack'
        : null;

  if (startupMode) {
    currentMode = startupMode;
    table = createTable(await buildTableConfig(startupMode));
    // recoverFromLog() must complete before the connection handler below is
    // registered, and before any caller of createServer() calls
    // httpServer.listen(). This is more than a documented startup-ordering
    // nicety: Table.recoverFromLog's own catch block (on a corrupted log)
    // does a wholesale reset of every seat to null, which is only safe
    // because no socket-to-seat mapping can exist yet at that point.
    await table.recoverFromLog();
  }

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    // A fresh connection needs to see the current lobby/table state
    // immediately, before it does anything -- otherwise the frontend has no
    // way to know whether to show the lobby, a join screen, or a table.
    socket.emit('state', buildAppStateView(null, null));

    socket.on('join', async (payload: JoinPayload) => {
      if (!table) {
        socket.emit('error', { message: 'No game is active yet' });
        return;
      }
      if (!isValidDisplayName(payload?.displayName)) {
        socket.emit('error', { message: 'Invalid display name' });
        return;
      }
      try {
        const existingSeatIndex = table.reconnect(payload.displayName);
        const seatIndex = existingSeatIndex ?? (await table.join(payload.displayName));
        const previousSeatIndex = seatBySocketId.get(socket.id);
        if (previousSeatIndex !== undefined && previousSeatIndex !== seatIndex) {
          // This socket already held a different seat -- e.g. it sent an
          // earlier `join` that resolved after this one started. Release the
          // stale seat properly instead of silently orphaning it.
          table.disconnect(previousSeatIndex);
        }
        if (!socket.connected) {
          // The socket disconnected while this join's await was in flight --
          // don't register a mapping nothing will ever clean up; instead mark
          // the seat disconnected immediately so it follows the normal
          // reconnect/grace-window/timeout path instead of becoming a
          // permanent connected:true orphan that can never be reached again.
          table.disconnect(seatIndex);
          return;
        }
        seatBySocketId.set(socket.id, seatIndex);
        broadcast();
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('ready', async () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        await table.setReady(seatIndex);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('action', async (payload: ActionPayload) => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        await table.submitAction(seatIndex, payload.action, payload.amount);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('leave', () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined || !table) {
        socket.emit('error', { message: 'Not seated' });
        return;
      }
      try {
        table.leave(seatIndex);
        seatBySocketId.delete(socket.id);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('adminLogin', (payload: AdminLoginPayload) => {
      const success = !!adminPassphrase && payload?.passphrase === adminPassphrase;
      if (success) {
        adminSocketIds.add(socket.id);
      }
      socket.emit('adminLoginResult', { success });
      if (success) {
        broadcast();
      }
    });

    // Every admin handler below rejects through this helper rather than a
    // bare socket.emit('error', ...): the `scope: 'admin'` discriminant is
    // what lets the client route the message to the admin panel's own error
    // surface instead of the display-name field's (see protocol.ts).
    function rejectAdmin(message: string): void {
      socket.emit('error', { message, scope: 'admin' });
    }

    function isAdmin(): boolean {
      if (adminSocketIds.has(socket.id)) {
        return true;
      }
      rejectAdmin('Admin only');
      return false;
    }

    socket.on('adminStartGame', async (payload: StartGamePayload) => {
      if (!isAdmin()) return;
      if (!isGameMode(payload?.mode)) {
        rejectAdmin('Invalid game mode');
        return;
      }
      if (table || modeChangeInFlight) {
        rejectAdmin('A game is already active -- use switch instead');
        return;
      }
      modeChangeInFlight = true;
      try {
        // Config first, then both pieces of mode state together: assigning
        // `currentMode` before this await left a window where any broadcast
        // (a disconnect timer firing, another socket's action) would report
        // the new mode alongside the *old* table's state view.
        const nextConfig = await buildTableConfig(payload.mode);
        currentMode = payload.mode;
        table = createTable(nextConfig);
      } finally {
        modeChangeInFlight = false;
      }
      broadcast();
    });

    socket.on('adminSwitchMode', async (payload: StartGamePayload) => {
      if (!isAdmin()) return;
      if (!isGameMode(payload?.mode)) {
        rejectAdmin('Invalid game mode');
        return;
      }
      if (!table) {
        rejectAdmin('No game active -- use start instead');
        return;
      }
      if (table.handInProgress) {
        rejectAdmin("Can't switch modes while a hand is in progress");
        return;
      }
      if (modeChangeInFlight) {
        rejectAdmin('A mode change is already in progress');
        return;
      }
      modeChangeInFlight = true;
      try {
        // Same ordering rationale as adminStartGame above. Seat semantics
        // differ between Poker and Blackjack, so nothing meaningful carries
        // over -- everyone (including players who were already seated)
        // rejoins the new table fresh. A returning player with a remembered
        // display name auto-rejoins via the frontend's own logic (Task 6)
        // the moment this broadcast reports the new mode; nobody needs to
        // retype anything they'd already typed once tonight.
        const nextConfig = await buildTableConfig(payload.mode);
        seatBySocketId.clear();
        currentMode = payload.mode;
        table = createTable(nextConfig);
      } finally {
        modeChangeInFlight = false;
      }
      broadcast();
    });

    socket.on('adminAdjustBalance', async (payload) => {
      if (!isAdmin()) return;
      if (!isValidDisplayName(payload?.displayName)) {
        rejectAdmin('Invalid display name');
        return;
      }
      if (!isNonNegativeNumber(payload?.balance)) {
        rejectAdmin('Balance must be a number of 0 or more');
        return;
      }
      const seat = table?.seats.find((s) => s?.displayName === payload.displayName);
      if (seat && table!.handInProgress) {
        rejectAdmin(`Can't adjust -- ${payload.displayName} is in an active hand`);
        return;
      }
      await playerStore.setBalance(payload.displayName, payload.balance);
      table?.setSeatBalance(payload.displayName, payload.balance);
      broadcast();
    });

    socket.on('adminSetBlinds', async (payload) => {
      if (!isAdmin()) return;
      if (!isPositiveNumber(payload?.smallBlind) || !isPositiveNumber(payload?.bigBlind)) {
        rejectAdmin('Blinds must be positive numbers');
        return;
      }
      currentConfig = await gameConfigStore.setConfig({
        smallBlind: payload.smallBlind,
        bigBlind: payload.bigBlind,
      });
      table?.updateConfig({ smallBlind: payload.smallBlind, bigBlind: payload.bigBlind });
      broadcast();
    });

    socket.on('adminSetDefaultBet', async (payload) => {
      if (!isAdmin()) return;
      if (!isPositiveNumber(payload?.blackjackDefaultBet)) {
        rejectAdmin('Default bet must be a positive number');
        return;
      }
      currentConfig = await gameConfigStore.setConfig({
        blackjackDefaultBet: payload.blackjackDefaultBet,
      });
      table?.updateConfig({ blackjackDefaultBet: payload.blackjackDefaultBet });
      broadcast();
    });

    socket.on('adminSetStartingBalance', async (payload) => {
      if (!isAdmin()) return;
      if (!isPositiveNumber(payload?.defaultStartingBalance)) {
        rejectAdmin('Starting balance must be a positive number');
        return;
      }
      currentConfig = await gameConfigStore.setConfig({
        defaultStartingBalance: payload.defaultStartingBalance,
      });
      playerStore.setDefaultStartingBalance(payload.defaultStartingBalance);
      broadcast();
    });

    socket.on('disconnect', () => {
      adminSocketIds.delete(socket.id);
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex !== undefined && table) {
        table.disconnect(seatIndex);
        seatBySocketId.delete(socket.id);
      }
    });
  });

  return {
    httpServer,
    io,
    getTable: () => table,
  };
}
