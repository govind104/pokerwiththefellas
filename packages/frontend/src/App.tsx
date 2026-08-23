import { MotionConfig } from 'framer-motion';
import { SocketProvider, useSocket } from './socket/SocketContext';
import { JoinScreen } from './components/JoinScreen';
import { PokerTable } from './components/PokerTable';
import { BlackjackTable } from './components/BlackjackTable';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

function AppContent() {
  const { status, state, errorMessage, displayName, sendReady, sendAction, leave } = useSocket();

  // `state` is the top-level AppStateView (`{ mode, isAdmin, table }`), not
  // the table view itself -- `table` is null both before any socket state
  // has arrived and whenever the lobby has no active game (mode: null).
  // Falling back to JoinScreen in the latter case is a minimal stopgap, not
  // real lobby UI: building the actual "no game active yet" / admin-start
  // experience is a separate, later task's scope.
  const table = state?.table ?? null;
  if (!table || status === 'entering-name' || status === 'connecting' || status === 'error') {
    return <JoinScreen />;
  }

  const mySeatIndex =
    table.seats.find((s) => s.displayName !== null && s.displayName === displayName)?.seatIndex ?? null;
  const sharedProps = {
    seats: table.seats,
    mySeatIndex,
    connectionStatus: status,
    handInProgress: table.handInProgress,
    errorMessage,
    onReady: sendReady,
    onLeave: leave,
  };

  return table.gameMode === 'holdem' ? (
    <PokerTable {...sharedProps} holdem={table.holdem} onAction={sendAction} />
  ) : (
    <BlackjackTable
      {...sharedProps}
      activeSeatIndex={table.activeSeatIndex}
      blackjackRounds={table.blackjackRounds}
      onAction={sendAction}
    />
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
