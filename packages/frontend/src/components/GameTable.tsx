import type { ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from './Button';

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
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-bg p-8 font-body text-fg">
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
      <div className="relative flex h-[28rem] w-[36rem] items-center justify-center rounded-full border-[10px] border-wood bg-gradient-to-br from-wood to-wood-dark shadow-[inset_0_0_60px_20px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(120%_100%_at_50%_30%,var(--felt-hi)_0%,var(--felt)_100%)] shadow-[inset_0_10px_30px_rgba(0,0,0,0.45)]">
          {seats.map((seat, i) => {
            const angle = (i / seats.length) * 2 * Math.PI;
            const x = 50 + 42 * Math.cos(angle);
            const y = 50 + 42 * Math.sin(angle);
            const isActive = seat.seatIndex === activeSeatIndex;
            return (
              <div
                key={seat.seatIndex}
                data-testid={`seat-${seat.seatIndex}`}
                data-active={isActive ? 'true' : 'false'}
                className={`absolute flex flex-col items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? 'border-brass-bright bg-surface-raised text-parchment seat-active-glow'
                    : 'border-wood-grain bg-surface text-fg-dim'
                }`}
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              >
                <span className="font-semibold text-parchment">{seat.displayName ?? 'Empty seat'}</span>
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
          <div className="flex h-full flex-col items-center justify-center gap-2">{children}</div>
        </div>
      </div>
      {mySeat && !handInProgress && !mySeat.ready && (
        <Button variant="primary" size="md" onClick={onReady} className="mt-4 font-medium">
          Ready
        </Button>
      )}
      {!handInProgress && (
        <button onClick={onLeave} className="mt-2 text-sm text-fg-dim underline hover:text-parchment">
          Leave table
        </button>
      )}
    </div>
  );
}
