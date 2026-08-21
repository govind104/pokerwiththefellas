import { SocketProvider, useSocket } from './socket/SocketContext';
import { JoinScreen } from './components/JoinScreen';
import { PokerTable } from './components/PokerTable';
import { BlackjackTable } from './components/BlackjackTable';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

function AppContent() {
  const { status, state, displayName, sendReady, sendAction, leave } = useSocket();

  if (!state || status === 'entering-name' || status === 'connecting' || status === 'error') {
    return <JoinScreen />;
  }

  const mySeatIndex = state.seats.find((s) => s.displayName === displayName)?.seatIndex ?? null;
  const sharedProps = {
    seats: state.seats,
    mySeatIndex,
    connectionStatus: status,
    handInProgress: state.handInProgress,
    onReady: sendReady,
    onLeave: leave,
  };

  return state.gameMode === 'holdem' ? (
    <PokerTable {...sharedProps} holdem={state.holdem} onAction={sendAction} />
  ) : (
    <BlackjackTable
      {...sharedProps}
      activeSeatIndex={state.activeSeatIndex}
      blackjackRounds={state.blackjackRounds}
      onAction={sendAction}
    />
  );
}

function App() {
  return (
    <SocketProvider serverUrl={SERVER_URL}>
      <AppContent />
    </SocketProvider>
  );
}

export default App;
