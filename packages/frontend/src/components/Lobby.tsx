import { useSocket } from '../socket/SocketContext';

export function Lobby() {
  const { state, isAdmin, adminStartGame, adminSwitchMode } = useSocket();
  const mode = state?.mode ?? null;

  function choose(target: 'holdem' | 'blackjack') {
    if (mode === null) {
      adminStartGame(target);
    } else {
      adminSwitchMode(target);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-white">
      <h1 className="text-2xl font-semibold">Poker &amp; Blackjack</h1>
      {mode === null ? (
        <p className="text-slate-300">Waiting for a game to start&hellip;</p>
      ) : (
        <p className="text-slate-300">
          A {mode === 'holdem' ? 'Poker' : 'Blackjack'} game is active &mdash; switch below if you&apos;d like.
        </p>
      )}

      {isAdmin && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => choose('holdem')}
            disabled={mode === 'holdem'}
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium disabled:opacity-50"
          >
            {mode === null ? 'Start Poker Night' : 'Switch to Poker'}
          </button>
          <button
            type="button"
            onClick={() => choose('blackjack')}
            disabled={mode === 'blackjack'}
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium disabled:opacity-50"
          >
            {mode === null ? 'Start Blackjack Night' : 'Switch to Blackjack'}
          </button>
        </div>
      )}
    </main>
  );
}
