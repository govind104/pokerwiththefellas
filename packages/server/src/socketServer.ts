import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { Table, type TableConfig } from './table';
import type { PlayerStore } from './playerStore';
import type { HandLog } from './handLog';
import type { ClientToServerEvents, ServerToClientEvents, JoinPayload, ActionPayload } from './protocol';

export interface CreateServerResult {
  httpServer: HttpServer;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  table: Table;
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
  config: TableConfig,
  playerStore: PlayerStore,
  handLog: HandLog
): Promise<CreateServerResult> {
  const httpServer = createHttpServer();
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  const seatBySocketId = new Map<string, number>();

  const broadcast = () => {
    for (const [socketId, socket] of io.sockets.sockets) {
      const seatIndex = seatBySocketId.get(socketId) ?? null;
      socket.emit('state', table.getStateForSeat(seatIndex));
    }
  };

  const table = new Table(config, { playerStore, handLog, onStateChange: broadcast });
  await table.recoverFromLog();

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    socket.on('join', async (payload: JoinPayload) => {
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
        socket.emit('state', table.getStateForSeat(seatIndex));
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('ready', async () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex === undefined) {
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
      if (seatIndex === undefined) {
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
      if (seatIndex === undefined) {
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

    socket.on('disconnect', () => {
      const seatIndex = seatBySocketId.get(socket.id);
      if (seatIndex !== undefined) {
        table.disconnect(seatIndex);
        seatBySocketId.delete(socket.id);
      }
    });
  });

  return { httpServer, io, table };
}
