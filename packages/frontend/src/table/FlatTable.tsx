import type { ReactNode } from 'react';
import type { TableStateView } from '@poker-blackjack/server/src/table';
import type { HoldemAction, PlayerAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { HoldemHud } from '../hud/HoldemHud';
import { BlackjackHud } from '../hud/BlackjackHud';
import { Banners } from './Banners';

// The flat view (Plan B spec P3): the HUD in one column on plain felt, with no 3D scene. Used
// when 3D fails, when the window is too narrow, or by choice; the integration tests play here.

export interface FlatTableProps {
  table: TableStateView;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  errorMessage?: string | null;
  actionPending: boolean;
  onReady: () => void;
  onAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  onLeave: () => void;
  controls: ReactNode;
}

export function FlatTable({ table, mySeatIndex, connectionStatus, errorMessage, actionPending, onReady, onAction, onLeave, controls }: FlatTableProps) {
  const hasHand = table.gameMode === 'holdem' ? !!table.holdem : !!table.blackjackRounds;
  return (
    <main className="relative min-h-screen bg-[radial-gradient(ellipse_at_50%_40%,#2f5133_0%,#1d3420_55%,#0f1d11_100%)] font-body text-fg">
      <div className="fixed left-3 top-3 z-40 flex flex-wrap items-start gap-2">{controls}</div>
      <Banners connectionStatus={connectionStatus} errorMessage={errorMessage} />
      {!hasHand && <p className="pt-16 text-center font-utility text-sm text-fg-dim">Waiting for hand to start…</p>}
      {table.gameMode === 'holdem' ? (
        <HoldemHud
          layout="column"
          seats={table.seats}
          mySeatIndex={mySeatIndex}
          handInProgress={table.handInProgress}
          holdem={table.holdem}
          blinds={{
            buttonSeatIndex: table.buttonSeatIndex,
            smallBlindSeatIndex: table.smallBlindSeatIndex,
            bigBlindSeatIndex: table.bigBlindSeatIndex,
          }}
          turnClockRemainingMs={table.turnClockRemainingMs}
          actionPending={actionPending}
          onAction={onAction}
          onReady={onReady}
          onLeave={onLeave}
        />
      ) : (
        <BlackjackHud
          layout="column"
          seats={table.seats}
          mySeatIndex={mySeatIndex}
          activeSeatIndex={table.activeSeatIndex}
          handInProgress={table.handInProgress}
          blackjackRounds={table.blackjackRounds}
          turnClockRemainingMs={table.turnClockRemainingMs}
          actionPending={actionPending}
          onAction={onAction}
          onReady={onReady}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}
