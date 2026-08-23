import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { Table, type TableConfig, type GameMode, type AppStateView } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';
import type { GameConfigStore } from './gameConfigStore';
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

export async function createServer(
  staticConfig: StaticTableConfig,
  gameConfigStore: GameConfigStore,
  playerStore: PlayerStore,
  handLog: HandLog,
  adminPassphrase: string | undefined
): Promise<CreateServerResult> {
  const httpServer = createHttpServer();
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  const seatBySocketId = new Map<string, number>();
  const adminSocketIds = new Set<string>();
  let table: Table | null = null;
  let currentMode: GameMode | null = null;

  async function buildTableConfig(mode: GameMode): Promise<TableConfig> {
    const values = await gameConfigStore.getConfig();
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

  const broadcast = () => {
    for (const [socketId, socket] of io.sockets.sockets) {
      const seatIndex = seatBySocketId.get(socketId) ?? null;
      const view: AppStateView = {
        mode: currentMode,
        isAdmin: adminSocketIds.has(socketId),
        table: table ? table.getStateForSeat(seatIndex) : null,
      };
      socket.emit('state', view);
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
    socket.emit('state', {
      mode: currentMode,
      isAdmin: false,
      table: table ? table.getStateForSeat(null) : null,
    });

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

    socket.on('adminStartGame', async (payload: StartGamePayload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      if (table) {
        socket.emit('error', { message: 'A game is already active -- use switch instead' });
        return;
      }
      currentMode = payload.mode;
      table = createTable(await buildTableConfig(payload.mode));
      broadcast();
    });

    socket.on('adminSwitchMode', async (payload: StartGamePayload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      if (!table) {
        socket.emit('error', { message: 'No game active -- use start instead' });
        return;
      }
      if (table.handInProgress) {
        socket.emit('error', { message: "Can't switch modes while a hand is in progress" });
        return;
      }
      // Seat semantics differ between Poker and Blackjack, so nothing
      // meaningful carries over -- everyone (including players who were
      // already seated) rejoins the new table fresh. A returning player with
      // a remembered display name auto-rejoins via the frontend's own logic
      // (Task 6) the moment this broadcast reports the new mode; nobody
      // needs to retype anything they'd already typed once tonight.
      seatBySocketId.clear();
      currentMode = payload.mode;
      table = createTable(await buildTableConfig(payload.mode));
      broadcast();
    });

    socket.on('adminAdjustBalance', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      const seat = table?.seats.find((s) => s?.displayName === payload.displayName);
      if (seat && table!.handInProgress) {
        socket.emit('error', { message: `Can't adjust -- ${payload.displayName} is in an active hand` });
        return;
      }
      await playerStore.setBalance(payload.displayName, payload.balance);
      if (seat) {
        seat.balance = payload.balance;
      }
      broadcast();
    });

    socket.on('adminSetBlinds', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      await gameConfigStore.setConfig({ smallBlind: payload.smallBlind, bigBlind: payload.bigBlind });
      table?.updateConfig({ smallBlind: payload.smallBlind, bigBlind: payload.bigBlind });
      broadcast();
    });

    socket.on('adminSetDefaultBet', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      await gameConfigStore.setConfig({ blackjackDefaultBet: payload.blackjackDefaultBet });
      table?.updateConfig({ blackjackDefaultBet: payload.blackjackDefaultBet });
      broadcast();
    });

    socket.on('adminSetStartingBalance', async (payload) => {
      if (!adminSocketIds.has(socket.id)) {
        socket.emit('error', { message: 'Admin only' });
        return;
      }
      await gameConfigStore.setConfig({ defaultStartingBalance: payload.defaultStartingBalance });
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
