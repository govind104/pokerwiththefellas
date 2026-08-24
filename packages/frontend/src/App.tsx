import { MotionConfig } from 'framer-motion';
import { SocketProvider, useSocket, type ConnectionStatus } from './socket/SocketContext';
import type { TableStateView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import { AdminEntry } from './components/AdminEntry';
import { AdminPanel } from './components/AdminPanel';
import { Lobby } from './components/Lobby';
import { JoinScreen } from './components/JoinScreen';
import { PokerTable } from './components/PokerTable';
import { BlackjackTable } from './components/BlackjackTable';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

function TableView({
  table,
  displayName,
  connectionStatus,
  errorMessage,
  onReady,
  onAction,
  onLeave,
}: {
  table: TableStateView;
  displayName: string | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  onReady: () => void;
  onAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  onLeave: () => void;
}) {
  const mySeatIndex =
    table.seats.find((s) => s.displayName !== null && s.displayName === displayName)?.seatIndex ?? null;
  const sharedProps = {
    seats: table.seats,
    mySeatIndex,
    connectionStatus,
    handInProgress: table.handInProgress,
    errorMessage,
    onReady,
    onLeave,
  };

  return table.gameMode === 'holdem' ? (
    <PokerTable {...sharedProps} holdem={table.holdem} onAction={onAction} />
  ) : (
    <BlackjackTable
      {...sharedProps}
      activeSeatIndex={table.activeSeatIndex}
      blackjackRounds={table.blackjackRounds}
      onAction={onAction}
    />
  );
}

function AppContent() {
  const { status, state, errorMessage, displayName, sendReady, sendAction, leave } = useSocket();

  if (status === 'error') {
    // The socket disconnects itself and is not reconnected automatically
    // when an 'error' event arrives (see SocketContext's 'error' handler) --
    // there is no in-app path back to a live connection, so the only real
    // recovery is a full reload.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-white">
        <p>{errorMessage ?? 'Something went wrong.'}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-emerald-600 px-3 py-2 font-medium"
        >
          Reload
        </button>
      </main>
    );
  }

  if (status === 'connecting' || !state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <p>Connecting&hellip;</p>
      </main>
    );
  }

  return (
    <>
      <AdminEntry />
      {status === 'lobby' && <Lobby />}
      {status === 'entering-name' && <JoinScreen />}
      {(status === 'at-table' || status === 'reconnecting') && state.table && (
        <TableView
          table={state.table}
          displayName={displayName}
          connectionStatus={status}
          errorMessage={errorMessage}
          onReady={sendReady}
          onAction={sendAction}
          onLeave={leave}
        />
      )}
      <AdminPanel />
    </>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SocketProvider serverUrl={SERVER_URL}>
        <AppContent />
      </SocketProvider>
    </MotionConfig>
  );
}

export default App;
