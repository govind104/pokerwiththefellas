import type { ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';

export interface GameTableProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  seatContent?: Partial<Record<number, ReactNode>>;
  children: ReactNode;
}

export function GameTable({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  seatContent,
  children,
}: GameTableProps) {
  const mySeat = mySeatIndex !== null ? (seats.find((s) => s.seatIndex === mySeatIndex) ?? null) : null;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-emerald-900 p-8 text-white">
      <div className="absolute top-4 flex flex-col items-center gap-2">
        {connectionStatus === 'reconnecting' && (
          <div role="status" className="rounded-md bg-amber-600 px-4 py-2 font-medium">
            Reconnecting…
          </div>
        )}
        {errorMessage && (
          <div role="alert" className="rounded-md bg-red-600 px-4 py-2 font-medium">
            {errorMessage}
          </div>
        )}
      </div>
      <div className="relative flex h-[28rem] w-[36rem] items-center justify-center rounded-full border-4 border-emerald-700 bg-emerald-800">
        {seats.map((seat, i) => {
          const angle = (i / seats.length) * 2 * Math.PI;
          const x = 50 + 42 * Math.cos(angle);
          const y = 50 + 42 * Math.sin(angle);
          const isActive = seat.seatIndex === activeSeatIndex;
          return (
            <div
              key={seat.seatIndex}
              data-testid={`seat-${seat.seatIndex}`}
              className={`absolute flex flex-col items-center gap-1 rounded-md px-2 py-1 text-xs ${
                isActive ? 'bg-amber-500 text-black' : 'bg-emerald-950/70'
              }`}
              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <span className="font-semibold">{seat.displayName ?? 'Empty seat'}</span>
              {seat.displayName && (
                <>
                  <span>{seat.balance} chips</span>
                  <span>{seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected'}</span>
                  {seatContent?.[seat.seatIndex]}
                </>
              )}
            </div>
          );
        })}
        <div className="flex flex-col items-center gap-2">{children}</div>
      </div>
      {mySeat && !handInProgress && !mySeat.ready && (
        <button onClick={onReady} className="mt-4 rounded-md bg-emerald-600 px-4 py-2 font-medium">
          Ready
        </button>
      )}
      {!handInProgress && (
        <button onClick={onLeave} className="mt-2 text-sm text-slate-300 underline">
          Leave table
        </button>
      )}
    </div>
  );
}
