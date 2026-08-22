import type { ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Button } from './Button';

export interface GameTableProps {
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  errorMessage?: string | null;
  onReady: () => void;
  onLeave: () => void;
  railSlot?: ReactNode;
  bottomCenterSlot?: ReactNode;
  children: ReactNode;
}

export function GameTable({
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  errorMessage,
  onReady,
  onLeave,
  railSlot,
  bottomCenterSlot,
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
      <div className="relative flex h-[min(75vh,42rem)] w-[min(90vw,54rem)] items-center justify-center rounded-full border-[10px] border-wood bg-gradient-to-br from-wood to-wood-dark shadow-[inset_0_0_60px_20px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(120%_100%_at_50%_30%,var(--felt-hi)_0%,var(--felt)_100%)] shadow-[inset_0_10px_30px_rgba(0,0,0,0.45)]">
          <div className="flex h-full flex-col items-center justify-center gap-2">{children}</div>
        </div>
        {railSlot && (
          <div data-testid="player-rail" className="absolute bottom-2 left-2 flex flex-col gap-1.5">
            {railSlot}
          </div>
        )}
        {bottomCenterSlot && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
            {bottomCenterSlot}
          </div>
        )}
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
