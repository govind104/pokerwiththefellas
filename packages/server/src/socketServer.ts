import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { statSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import sirv from 'sirv';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { normaliseDisplayName } from './names';
import { createAttemptLimiter, type AttemptLimiter } from './loginLimiter';
import { isAllowedOrigin } from './originCheck';
import { Table, type TableConfig, type GameMode, type AppStateView } from './table';
import type { PlayerStore, IdentityStore } from './playerStore';
import type { HandLog } from './handLog';
import type { GameConfigStore, GameConfigValues } from './gameConfigStore';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  JoinPayload,
  ActionPayload,
  AdminLoginPayload,
  StartGamePayload,
  ReleaseNamePayload,
} from './protocol';

export interface StaticTableConfig {
  seatCount: number;
  reconnectGraceMs: number;
  random: () => number;
}

export interface CreateServerResult {
  httpServer: HttpServer;
  // socket.io's Server#close() unconditionally closes the underlying
  // httpServer too -- they are not two independently-closeable resources
  // despite being handed back separately here. Shut down with io.close()
  // alone; calling httpServer.close() afterward throws ERR_SERVER_NOT_RUNNING.
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  getTable: () => Table | null;
}

export interface CreateServerOptions {
  // Directory to serve the built frontend from (sirv, SPA fallback). Undefined
  // means API-only -- the two-port local dev workflow, where Vite serves the
  // frontend itself. A separate options object rather than a 6th positional
  // parameter: a bare `string | undefined` there would sit directly next to
  // `adminPassphrase` (the same type), and a transposition of the two would
  // have compiled silently. It's also its own object rather than folded into
  // StaticTableConfig -- that interface is otherwise pure table/game setup
  // (seatCount, reconnectGraceMs, random), and staticDir is purely an
  // HTTP-serving concern with nothing to do with the Table it configures.
  staticDir?: string;
  // Brute-force guard for adminLogin (audit I7). Injectable so tests can drive the lockout clock.
  adminLoginLimiter?: AttemptLimiter;
  // Extra page origins allowed to connect, beyond the server's own host (index.ts passes ALLOWED_ORIGINS).
  allowedOrigins?: string[];
}

// Same "reject malformed payloads before they reach anything durable"
// rationale as normaliseDisplayName. These matter more than ordinary input
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

// Constant-time, so the reply time doesn't reveal how much of a guess was right (audit I7).
// Hashing first gives both buffers the same length, which timingSafeEqual requires.
function passphraseMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function isGameMode(value: unknown): value is GameMode {
  return value === 'holdem' || value === 'blackjack';
}

export async function createServer(
  staticConfig: StaticTableConfig,
  gameConfigStore: GameConfigStore,
  playerStore: PlayerStore & IdentityStore,
  handLog: HandLog,
  adminPassphrase: string | undefined,
  options: CreateServerOptions = {}
): Promise<CreateServerResult> {
  const { staticDir, adminLoginLimiter = createAttemptLimiter(), allowedOrigins = [] } = options;
  if (staticDir) {
    // sirv() walks the directory synchronously at construction time and
    // throws a bare, unhelpful error with no indication of what to do about
    // it -- ENOENT/scandir if the path is missing, ENOTDIR if it exists but
    // isn't a directory. This is a real, documented path (.env.example's
    // STATIC_DIR comment describes running the server standalone), not a
    // contrived edge case -- most likely cause is starting the server
    // before ever running the frontend build. statSync (not existsSync) so
    // a permission error (EACCES) surfaces as itself instead of being
    // silently reported as "does not exist" -- existsSync returns false for
    // any internal error, not just a missing path, which would send an
    // operator toward rebuilding the frontend when the real problem is
    // unreadable-but-present.
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(staticDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `STATIC_DIR is set to "${staticDir}", but that directory does not exist. ` +
            'Build the frontend first (npm run build --workspace=@poker-blackjack/frontend), ' +
            'or use "npm run play" to build and start in one step.'
        );
      }
      throw new Error(`STATIC_DIR is set to "${staticDir}", but it could not be read: ${(err as Error).message}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`STATIC_DIR is set to "${staticDir}", but that path is not a directory.`);
    }
  }
  const httpServer = createHttpServer(staticDir ? sirv(staticDir, { single: true }) : undefined);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    // No `cors` option: socket.io then sends no CORS headers, so a cross-site page can't use
    // HTTP polling, and allowRequest refuses its WebSocket handshake (audit I7).
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers, allowedOrigins)),
  });

  const seatBySocketId = new Map<string, number>();
  const adminSocketIds = new Set<string>();
  // Admin session tokens, issued on a successful login and sent back by the client in the
  // handshake `auth` on every (re)connect, so a wifi blip no longer logs the admin out (audit
  // M11). Memory only: a server restart logs every admin out, which is fine.
  const adminTokens = new Set<string>();
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
      mySeatIndex: seatIndex,
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
    await table.recoverFromLog(startupEntries);
  }

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    // A fresh connection needs to see the current lobby/table state
    // immediately, before it does anything -- otherwise the frontend has no
    // way to know whether to show the lobby, a join screen, or a table.
    // A client that reconnects presents its admin token in the handshake; honour it before the
    // welcome state so isAdmin is already true in the first state it sees (audit M11).
    const resumeToken: unknown = socket.handshake.auth?.adminToken;
    if (typeof resumeToken === 'string' && adminTokens.has(resumeToken)) {
      adminSocketIds.add(socket.id);
    }
    socket.emit('state', buildAppStateView(socket.id, null));

    socket.on('join', async (payload: JoinPayload) => {
      if (!table) {
        socket.emit('error', { message: 'No game is active yet' });
        return;
      }
      const displayName = normaliseDisplayName(payload?.displayName);
      if (!displayName) {
        socket.emit('error', { message: 'Invalid display name' });
        return;
      }
      // An admin mode switch can replace `table` while join() is awaiting. The seat index it
      // returns belongs to the old table; mapping it on the new one would hand this socket
      // whoever sits at that index there (their cards, their turn).
      const joinedTable = table;
      // Bounded so a hostile client cannot make the store hash an arbitrarily large string.
      const token = typeof payload?.token === 'string' && payload.token.length <= 128 ? payload.token : undefined;
      try {
        // Every path that seats this socket (a new seat, a reconnect, a takeover) comes after
        // this check, so a name that belongs to someone else never gets a seat (audit C5).
        const tokenCheck = await playerStore.checkToken(displayName, token);
        if (tokenCheck === 'mismatch') {
          socket.emit('error', {
            message: `"${displayName}" belongs to another player. If it's yours, ask the admin to release the name.`,
            code: 'name-claimed',
          });
          return;
        }
        if (table !== joinedTable) {
          socket.emit('error', { message: 'The game changed while you were joining -- please join again' });
          return;
        }
        // The token proves this is the same player, so a seat still held by another socket (a
        // second tab, or a phone whose old connection has not timed out yet) moves to this one.
        const heldSeatIndex = tokenCheck === 'match' ? joinedTable.connectedSeatIndexOf(displayName) : null;
        if (heldSeatIndex !== null) {
          // The new tab dropped during the token check: leave the old tab on its seat. Nothing
          // awaits between here and the seat mapping below, so this check cannot go stale.
          if (!socket.connected) {
            return;
          }
          for (const [otherSocketId, otherSeatIndex] of seatBySocketId) {
            if (otherSeatIndex === heldSeatIndex && otherSocketId !== socket.id) {
              seatBySocketId.delete(otherSocketId);
              io.sockets.sockets
                .get(otherSocketId)
                ?.emit('error', { message: 'You opened the game in another tab or device.', code: 'replaced' });
            }
          }
        }
        const seatIndex =
          heldSeatIndex ?? joinedTable.reconnect(displayName) ?? (await joinedTable.join(displayName));
        if (table !== joinedTable) {
          socket.emit('error', { message: 'The game changed while you were joining -- please join again' });
          return;
        }
        const previousSeatIndex = seatBySocketId.get(socket.id);
        if (previousSeatIndex !== undefined && previousSeatIndex !== seatIndex) {
          // This socket already held a different seat -- e.g. it sent an
          // earlier `join` that resolved after this one started. Release the
          // stale seat properly instead of silently orphaning it.
          joinedTable.disconnect(previousSeatIndex);
        }
        if (!socket.connected) {
          // The socket disconnected while this join's await was in flight --
          // don't register a mapping nothing will ever clean up; instead mark
          // the seat disconnected immediately so it follows the normal
          // reconnect/grace-window/timeout path instead of becoming a
          // permanent connected:true orphan that can never be reached again.
          joinedTable.disconnect(seatIndex);
          return;
        }
        seatBySocketId.set(socket.id, seatIndex);
        const seatName = joinedTable.seats[seatIndex]!.displayName;
        let identityToken = token;
        if (tokenCheck === 'unclaimed') {
          try {
            identityToken = await playerStore.issueToken(seatName);
          } catch (err) {
            // The player is seated either way; without a token the name stays unclaimed and
            // the next join under it claims it.
            console.error(`Could not issue a token for "${seatName}":`, err);
            identityToken = undefined;
          }
        }
        if (identityToken !== undefined) {
          socket.emit('identity', { displayName: seatName, token: identityToken });
        }
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
        await table.submitAction(seatIndex, payload.action, payload.amount, payload.seq);
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
      const clientKey = socket.handshake.address;
      const retryAfterMs = adminLoginLimiter.retryAfterMs(clientKey);
      if (retryAfterMs > 0) {
        socket.emit('adminLoginResult', { success: false, retryAfterMs });
        return;
      }
      if (!adminPassphrase || !passphraseMatches(payload?.passphrase, adminPassphrase)) {
        adminLoginLimiter.recordFailure(clientKey);
        socket.emit('adminLoginResult', { success: false });
        return;
      }
      adminLoginLimiter.recordSuccess(clientKey);
      adminSocketIds.add(socket.id);
      const adminToken = randomBytes(32).toString('base64url');
      adminTokens.add(adminToken);
      socket.emit('adminLoginResult', { success: true, adminToken });
      broadcast();
    });

    // Every admin handler below rejects through this helper rather than a
    // bare socket.emit('error', ...): the `scope: 'admin'` discriminant is
    // what lets the client route the message to the admin panel's own error
    // surface instead of the display-name field's (see protocol.ts).
    function rejectAdmin(message: string): void {
      socket.emit('error', { message, scope: 'admin' });
    }

    // socket.io ignores a handler's returned promise, so a rejection inside an async admin
    // handler (e.g. a Windows file lock on balances.json or game-config.json) would be
    // unhandled -- and Node exits on that, disconnecting every player (audit C4).
    function adminHandler<T extends unknown[]>(handler: (...args: T) => Promise<void>): (...args: T) => void {
      return (...args) => {
        handler(...args).catch((err: unknown) => {
          console.error('Admin handler failed:', err);
          rejectAdmin(err instanceof Error ? err.message : String(err));
        });
      };
    }

    function isAdmin(): boolean {
      if (adminSocketIds.has(socket.id)) {
        return true;
      }
      rejectAdmin('Admin only');
      return false;
    }

    socket.on('adminStartGame', adminHandler(async (payload: StartGamePayload) => {
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
    }));

    socket.on('adminSwitchMode', adminHandler(async (payload: StartGamePayload) => {
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
        const oldTable = table;
        const nextConfig = await buildTableConfig(payload.mode);
        // Re-check after the await: the last Ready can start a hand while the config loads.
        // From the check to retire() there is no await, so no hand can start in between, and
        // a hand start already queued on the old table's lock becomes a no-op once retired.
        if (oldTable.handInProgress) {
          rejectAdmin("Can't switch modes while a hand is in progress");
          return;
        }
        oldTable.retire();
        seatBySocketId.clear();
        currentMode = payload.mode;
        table = createTable(nextConfig);
      } finally {
        modeChangeInFlight = false;
      }
      broadcast();
    }));

    socket.on('adminAdjustBalance', adminHandler(async (payload) => {
      if (!isAdmin()) return;
      const displayName = normaliseDisplayName(payload?.displayName);
      if (!displayName) {
        rejectAdmin('Invalid display name');
        return;
      }
      if (!isNonNegativeNumber(payload?.balance)) {
        rejectAdmin('Balance must be a number of 0 or more');
        return;
      }
      if (!table) {
        // Balance corrections only make sense for someone actually at the table right now
        // (an unconditional write used to create orphaned balances.json entries).
        rejectAdmin(`No player named "${displayName}" is currently seated`);
        return;
      }
      // Table does the seated / no-hand checks and the write under its lock, so a hand
      // cannot start between the check and the write.
      try {
        await table.adminSetBalance(displayName, payload.balance);
      } catch (err) {
        rejectAdmin((err as Error).message);
        return;
      }
      broadcast();
    }));

    socket.on('adminReleaseName', adminHandler(async (payload: ReleaseNamePayload) => {
      if (!isAdmin()) return;
      const displayName = normaliseDisplayName(payload?.displayName);
      if (!displayName) {
        rejectAdmin('Invalid display name');
        return;
      }
      // Balance is kept; only the token goes, so a player who lost their browser data can
      // claim their name (and chips) again from a new device (audit C5).
      if (!(await playerStore.releaseName(displayName))) {
        rejectAdmin(`No player named "${displayName}" has played here`);
        return;
      }
      socket.emit('adminNotice', {
        message: `Released "${displayName}": the next person to join under that name gets it, with its balance.`,
      });
    }));

    socket.on('adminSetBlinds', adminHandler(async (payload) => {
      if (!isAdmin()) return;
      if (!isPositiveNumber(payload?.smallBlind) || !isPositiveNumber(payload?.bigBlind)) {
        rejectAdmin('Blinds must be positive numbers');
        return;
      }
      if (!Number.isInteger(payload.smallBlind) || !Number.isInteger(payload.bigBlind)) {
        rejectAdmin('Blinds must be whole numbers');
        return;
      }
      if (payload.smallBlind > payload.bigBlind) {
        // HoldemHand refuses this pair, so saving it stopped every hand from starting (audit I4).
        rejectAdmin("The small blind can't be larger than the big blind");
        return;
      }
      currentConfig = await gameConfigStore.setConfig({
        smallBlind: payload.smallBlind,
        bigBlind: payload.bigBlind,
      });
      table?.updateConfig({ smallBlind: payload.smallBlind, bigBlind: payload.bigBlind });
      broadcast();
    }));

    socket.on('adminSetDefaultBet', adminHandler(async (payload) => {
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
    }));

    socket.on('adminSetStartingBalance', adminHandler(async (payload) => {
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
    }));

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
