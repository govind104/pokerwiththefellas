import { lazy, Suspense, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { SocketProvider, useSocket, type ConnectionStatus } from './socket/SocketContext';
import type { TableStateView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import { AdminEntry } from './components/AdminEntry';
import { AdminPanel } from './components/AdminPanel';
import { Lobby } from './components/Lobby';
import { JoinScreen } from './components/JoinScreen';
import { resolveServerUrl } from './serverUrl';
import { View3DBoundary } from './three/View3DBoundary';
import { FlatTable } from './table/FlatTable';
import { chooseTableLayout, readViewPref, useWindowSize, writeViewPref, type ViewPref } from './table/tableLayout';

// three.js is only fetched when a 3D table view (Blackjack or Hold'em) is actually shown.
const Blackjack3D = lazy(() => import('./three/Blackjack3D'));
const Poker3D = lazy(() => import('./three/Poker3D'));

// The same-origin fallback (page origin) is correct for `npm run play`
// (single process) and for `npm run dev` (vite.config.ts proxies
// /socket.io to the backend). There's no working default for a
// `vite preview`-style "serve the build standalone, no backend at the
// same origin" workflow -- not currently a workflow this repo has or
// documents, so not handled here.
const SERVER_URL = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location.origin);

function TableView({
  table,
  mySeatIndex,
  connectionStatus,
  errorMessage,
  actionPending,
  onReady,
  onAction,
  onLeave,
}: {
  table: TableStateView;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  actionPending: boolean;
  onReady: () => void;
  onAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  onLeave: () => void;
}) {
  const [pref, setPref] = useState<ViewPref>(readViewPref);
  // 3D failed this session (no WebGL, lost context, a three.js error): flat until a reload, and
  // the stored preference is left alone (Plan B spec §2.1 rule 2).
  const [failed, setFailed] = useState(false);
  const size = useWindowSize();
  const layout = chooseTableLayout({ ...size, pref, failed });
  const choose = (p: ViewPref) => {
    writeViewPref(p);
    setPref(p);
  };
  const adminControls = (
    <>
      <AdminEntry inline />
      <AdminPanel />
    </>
  );

  if (layout === 'overlay') {
    const sharedProps = {
      seats: table.seats,
      mySeatIndex,
      connectionStatus,
      handInProgress: table.handInProgress,
      errorMessage,
      actionPending,
      onReady,
      onLeave,
      turnClockRemainingMs: table.turnClockRemainingMs,
      controls: adminControls,
      onSwitchTo2D: () => choose('flat'),
      onUnsupported: () => setFailed(true),
    };
    return (
      <View3DBoundary onError={() => setFailed(true)}>
        <Suspense
          fallback={
            <main className="flex min-h-screen items-center justify-center bg-black text-fg-dim">
              <p>Pulling up a chair&hellip;</p>
            </main>
          }
        >
          {table.gameMode === 'holdem' ? (
            <Poker3D
              {...sharedProps}
              holdem={table.holdem}
              blinds={{
                buttonSeatIndex: table.buttonSeatIndex,
                smallBlindSeatIndex: table.smallBlindSeatIndex,
                bigBlindSeatIndex: table.bigBlindSeatIndex,
              }}
              onAction={onAction}
            />
          ) : (
            <Blackjack3D
              {...sharedProps}
              activeSeatIndex={table.activeSeatIndex}
              blackjackRounds={table.blackjackRounds}
              onAction={onAction}
            />
          )}
        </Suspense>
      </View3DBoundary>
    );
  }

  return (
    <FlatTable
      table={table}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      errorMessage={errorMessage}
      actionPending={actionPending}
      onReady={onReady}
      onAction={onAction}
      onLeave={onLeave}
      controls={
        <>
          {pref === 'flat' && (
            <button
              type="button"
              onClick={() => choose('3d')}
              className="rounded-md border border-wood-grain bg-surface px-2 py-1 font-utility text-xs text-parchment"
            >
              3D view
            </button>
          )}
          {adminControls}
        </>
      }
    />
  );
}

function AppContent() {
  const { status, state, errorMessage, actionPending, sendReady, sendAction, leave, takeOver } = useSocket();

  if (status === 'error') {
    // Reached only when an 'error' arrives before the connection has ever
    // proven healthy (no 'state' event has ever been received -- see
    // SocketContext's 'error' handler). In that one case the socket
    // disconnects itself and is not reconnected automatically, so there is
    // no in-app path back to a live connection and the only real recovery
    // is a full reload. Ordinary rejections on a healthy connection
    // (a refused join, an illegal action, a rejected admin action) never
    // land here.
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

  if (status === 'replaced') {
    // Another tab or device joined with our token and took the seat (audit C5). Nothing here
    // rejoins on its own, or the two tabs would keep taking the seat back from each other.
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-white">
        <p>{errorMessage ?? 'You opened the game in another tab or device.'}</p>
        <button type="button" onClick={takeOver} className="rounded-md bg-emerald-600 px-3 py-2 font-medium">
          Play here instead
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

  const atTable = (status === 'at-table' || status === 'reconnecting') && !!state.table;
  return (
    <>
      {!atTable && <AdminEntry />}
      {/* Off-table the panel is a fixed corner widget under the Admin label (it was fixed
          bottom-right before the HUD moved it into the at-table cluster); the cluster owns it at
          the table. */}
      {!atTable && (
        <div className="fixed right-2 top-9 z-50 w-64">
          <AdminPanel />
        </div>
      )}
      {status === 'lobby' && <Lobby />}
      {status === 'entering-name' && <JoinScreen />}
      {atTable && state.table && (
        <TableView
          table={state.table}
          mySeatIndex={state.mySeatIndex}
          connectionStatus={status}
          errorMessage={errorMessage ?? state.table.handStartError}
          actionPending={actionPending}
          onReady={sendReady}
          onAction={sendAction}
          onLeave={leave}
        />
      )}
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
