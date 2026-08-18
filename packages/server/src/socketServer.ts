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
      try {
        const existingSeatIndex = table.reconnect(payload.displayName);
        const seatIndex = existingSeatIndex ?? (await table.join(payload.displayName));
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
