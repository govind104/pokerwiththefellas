import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import type { LeaveResult } from '@poker-blackjack/server/src/protocol';
import { useSocket, SocketProvider, ADMIN_TOKEN_STORAGE_KEY } from './SocketContext';
import { IDENTITY_STORAGE_KEY } from './identityStorage';
import { makeAppState, makeLobbyState, makeWaitingState, makeHoldemPreflopState, makeSeat } from '../fixtures/tableStateFixtures';

// A minimal fake socket.io-client: enough surface for SocketContext to drive
// (emit/on/disconnect, plus the nested `.io` manager used for the 'reconnect' event)
// without a real network connection. Tests trigger server pushes by calling the
// captured handlers directly.
const handlers = new Map<string, (...args: unknown[]) => void>();
const ioManagerHandlers = new Map<string, (...args: unknown[]) => void>();
const emitted: { event: string; payload: unknown }[] = [];
let disconnectCalls = 0;

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
    io: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        ioManagerHandlers.set(event, handler);
      },
    },
  };
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket()),
}));

function TestConsumer() {
  const {
    status,
    state,
    errorMessage,
    adminErrorMessage,
    adminActionErrorMessage,
    displayName,
    isAdmin,
    joinWithName,
    leave,
    adminLogin,
    adminAdjustBalance,
    adminNoticeMessage,
    adminReleaseName,
    takeOver,
  } = useSocket();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="mode">{state?.mode ?? 'none'}</p>
      <p data-testid="error">{errorMessage ?? 'none'}</p>
      <p data-testid="adminError">{adminErrorMessage ?? 'none'}</p>
      <p data-testid="adminActionError">{adminActionErrorMessage ?? 'none'}</p>
      <p data-testid="name">{displayName ?? 'none'}</p>
      <p data-testid="isAdmin">{String(isAdmin)}</p>
      <button onClick={() => joinWithName('alice')}>join</button>
      <button onClick={() => leave()}>leave</button>
      <button onClick={() => adminLogin('secret')}>admin-login</button>
      <button onClick={() => adminAdjustBalance('bob', 500)}>admin-adjust</button>
      <p data-testid="adminNotice">{adminNoticeMessage ?? 'none'}</p>
      <button onClick={() => takeOver()}>take-over</button>
      <button onClick={() => adminReleaseName('bob')}>admin-release</button>
    </div>
  );
}

function renderProvider() {
  render(
    <SocketProvider serverUrl="http://localhost:3000">
      <TestConsumer />
    </SocketProvider>
  );
}

function push(event: string, payload?: unknown) {
  act(() => {
    handlers.get(event)?.(payload);
  });
}

function storeIdentity(lastName: string | null, tokens: Record<string, string>) {
  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify({ lastName, tokens }));
}

function storedIdentity() {
  return JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) ?? 'null');
}

function answerLeave(result: LeaveResult) {
  const sent = emitted.find((e) => e.event === 'leave');
  if (!sent) throw new Error('no leave was emitted');
  act(() => {
    (sent.payload as (r: LeaveResult) => void)(result);
  });
}

describe('SocketProvider', () => {
  beforeEach(() => {
    handlers.clear();
    ioManagerHandlers.clear();
    emitted.length = 0;
    disconnectCalls = 0;
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connects immediately on mount and starts in connecting', () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');
  });

  it('moves to lobby when the initial state reports no active mode', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeLobbyState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('lobby'));
  });

  it('moves to entering-name when a mode is active but no name is known yet', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
    expect(emitted.find((e) => e.event === 'join')).toBeUndefined();
  });

  it('joinWithName emits join and reaching at-table on a state event that seats us', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));

    act(() => {
      screen.getByText('join').click();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });

    push('identity', { displayName: 'alice', token: 'tok-a' }); // the server sends this before the seating broadcast
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 })); // seats[0] is 'alice' per the fixture
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(screen.getByTestId('mode')).toHaveTextContent('holdem');
    expect(screen.getByTestId('name')).toHaveTextContent('alice');
    expect(storedIdentity().lastName).toBe('alice');
  });

  it('auto-rejoins with a remembered name once a mode becomes active, without a manual joinWithName call', async () => {
    storeIdentity('alice', {});
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('name')).toHaveTextContent('alice');

    act(() => {
      handlers.get('state')?.(makeLobbyState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('lobby'));

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] }))); // mode active, not yet seated
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
  });

  it('a successful auto-rejoin still reaches at-table once the server confirms the seat', async () => {
    // Companion to the two auto-rejoin tests above: verifies the *success*
    // path is untouched by the 'connecting'-stuck fix below -- the fix only
    // adds a status transition inside the 'error' handler's non-fatal
    // branch, so a rejoin that the server accepts must behave exactly as
    // before, landing on 'at-table' once the follow-up 'state' seats us.
    storeIdentity('alice', {});
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      // First-ever state event already has an active mode -- the auto-rejoin
      // branch fires immediately, before status ever leaves 'connecting'.
      handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] })));
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 })); // seats[0] is 'alice' per the fixture
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(screen.getByTestId('name')).toHaveTextContent('alice');
  });

  it('a cold reconnect whose seat still exists but is marked disconnected still emits join, rather than treating the stale name match as already seated', async () => {
    // Regression test: a fresh socket (page reload, new tab -- anything that
    // isn't the same io() instance resuming, which socket.io.on('reconnect')
    // already handles separately) can receive a first-ever 'state' broadcast
    // where its own seat already exists from before, still connected:false
    // because the server hasn't cleared the grace-window timer yet. A name
    // match alone used to satisfy `mySeated` here, short-circuiting straight
    // to 'at-table' and skipping the `join` emit below -- stranding the
    // player behind the server's auto-check/auto-fold timeout forever, with
    // no visible sign anything was wrong.
    storeIdentity('alice', {});
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      handlers.get('state')?.(
        makeAppState(
          makeWaitingState({
            seats: [makeSeat({ seatIndex: 0, displayName: 'alice', connected: false, ready: true })],
          })
        )
      );
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
    expect(screen.getByTestId('status')).not.toHaveTextContent('at-table');

    act(() => {
      handlers.get('state')?.(
        makeAppState(
          makeWaitingState({
            seats: [makeSeat({ seatIndex: 0, displayName: 'alice', connected: true, ready: true })],
          }),
          { mySeatIndex: 0 }
        )
      );
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
  });

  it('auto-rejoins with the remembered name after an admin mode switch clears seats, without landing on entering-name', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    // Get seated first, the same way a normal player would.
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 })); // seats[0] is 'alice' per the fixture
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    // Simulate the broadcast an admin's adminSwitchMode produces: seats are
    // cleared and a (possibly new) mode is immediately active again -- see
    // socketServer.ts's adminSwitchMode handler, which calls
    // seatBySocketId.clear() then rebuilds the table before broadcasting.
    // joinedRef was left `true` from the original join above; the bug was
    // that this stale flag blocked the rejoin branch, dropping the player
    // onto 'entering-name' instead of auto-rejoining.
    emitted.length = 0;
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack', seats: [] })));
    });

    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
    expect(screen.getByTestId('status')).not.toHaveTextContent('entering-name');
  });

  it('an intermediate broadcast that arrives while our own post-mode-switch rejoin is still pending does not trigger a second join', async () => {
    // Regression test for the real mechanism behind a stray "already seated"
    // error seen live: after the mode-switch broadcast below, our rejoin's
    // `join` is in flight but not yet resolved. A mode switch reseats
    // several players in the same burst, and each OTHER player's join
    // succeeding re-broadcasts to everyone -- including us, still unseated.
    // That intermediate broadcast has wasSeated=false (only the one event
    // right after the reset had it true) and joinedRef already true, so
    // before joinInFlightRef existed it fell through to the final
    // 'entering-name' branch, which reset joinedRef to false -- and that
    // reset alone made the NEXT broadcast satisfy the rejoin condition
    // again, firing a second `join` for a name we already hold. The
    // server's duplicate-name guard rejects the loser of that race, but the
    // player only ever sees a confusing "already seated" error over a
    // request they never made.
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    emitted.length = 0;
    act(() => {
      // The mode-switch broadcast itself: seats cleared, our rejoin fires.
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack', seats: [] })));
    });
    expect(emitted).toEqual([{ event: 'join', payload: { displayName: 'alice' } }]);

    act(() => {
      // An intermediate broadcast: some other seat filled in, we're still
      // not seated because our own join hasn't landed yet.
      handlers.get('state')?.(
        makeAppState(
          makeWaitingState({
            gameMode: 'blackjack',
            seats: [makeSeat({ seatIndex: 0, displayName: 'dave' })],
          })
        )
      );
    });
    expect(emitted).toEqual([{ event: 'join', payload: { displayName: 'alice' } }]);
    expect(screen.getByTestId('status')).not.toHaveTextContent('entering-name');

    act(() => {
      // Our own join finally lands.
      handlers.get('state')?.(
        makeAppState(
          makeWaitingState({
            gameMode: 'blackjack',
            seats: [
              makeSeat({ seatIndex: 0, displayName: 'dave' }),
              makeSeat({ seatIndex: 1, displayName: 'alice' }),
            ],
          }),
          { mySeatIndex: 1 }
        )
      );
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(emitted).toEqual([{ event: 'join', payload: { displayName: 'alice' } }]);
  });

  it('adminLogin emits adminLogin, and isAdmin reflects a successful state broadcast', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('admin-login').click();
    });
    expect(emitted).toContainEqual({ event: 'adminLogin', payload: { passphrase: 'secret' } });

    act(() => {
      handlers.get('state')?.(makeLobbyState({ isAdmin: true }));
    });
    await waitFor(() => expect(screen.getByTestId('isAdmin')).toHaveTextContent('true'));
  });

  it('a failed adminLoginResult surfaces an admin-scoped error message, leaving the join/table error untouched', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('adminLoginResult')?.({ success: false });
    });
    await waitFor(() => expect(screen.getByTestId('adminError')).toHaveTextContent('Incorrect admin passphrase'));
    // AdminEntry and JoinScreen can be mounted at the same time -- a failed
    // admin passphrase attempt must never also read as a failed name-join.
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('a join/table error does not surface as an admin error', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");
    expect(screen.getByTestId('adminError')).toHaveTextContent('none');
  });

  it('an error while at-table stays at-table and does not disconnect', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");
    expect(disconnectCalls).toBe(0);
  });

  it('a genuine "already seated" rejection still surfaces even while status is stuck on a stale at-table value mid-rejoin', async () => {
    // Regression test for a real gap: an earlier version of the error
    // handler swallowed "already seated" whenever `status === 'at-table'`,
    // reasoning that meant our own join had already succeeded. That's
    // wrong -- the auto-rejoin branch never calls setStatus, so `status`
    // sits on its *stale* pre-mode-switch value for the entire window a
    // rejoin is in flight. A genuine rejection (a different client actually
    // holding this name) arriving in that exact window was being silently
    // discarded instead of shown. It must now reach the player like any
    // other rejection.
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    // Mode switch: seats clear, our rejoin fires, but `status` never moves
    // off its stale 'at-table' value while the rejoin is in flight.
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack', seats: [] })));
    });
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');

    act(() => {
      handlers.get('error')?.({ message: '"alice" is already seated' });
    });
    expect(screen.getByTestId('error')).toHaveTextContent('"alice" is already seated');
  });

  it('no self-duplicate join is possible in the first place: a transport reconnect landing while a mode-switch rejoin is in flight does not double-emit', async () => {
    // Companion to the "intermediate broadcast" test above, covering the
    // other join-emit site: socket.io.on('reconnect') used to emit
    // unconditionally, so if it fired in the same window a mode-switch
    // auto-rejoin was already pending, both sites would independently
    // decide nothing was in flight and each emit their own `join` for the
    // same name. It now checks joinInFlightRef first.
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    emitted.length = 0;
    act(() => {
      // Mode switch fires our rejoin; it's still unresolved.
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack', seats: [] })));
    });
    expect(emitted).toEqual([{ event: 'join', payload: { displayName: 'alice' } }]);

    act(() => {
      // A transport-level reconnect lands in the same window.
      ioManagerHandlers.get('reconnect')?.();
    });
    expect(emitted).toEqual([{ event: 'join', payload: { displayName: 'alice' } }]);
  });

  it('an "already seated" error before reaching at-table still surfaces normally (a genuine name conflict)', async () => {
    // Companion to the tests above: a real conflict -- someone else
    // already holds this name -- happens before the rejecting socket is
    // seated, so it must still reach the player.
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] })));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));

    act(() => {
      screen.getByText('join').click();
      handlers.get('error')?.({ message: '"alice" is already seated' });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
    expect(screen.getByTestId('error')).toHaveTextContent('"alice" is already seated');
  });

  describe('error fatality is scoped to a connection that never became healthy', () => {
    it('an error arriving before any state event is still fatal: it disconnects and shows the reload screen', async () => {
      // The original reason the teardown existed -- a `join` (or connection
      // handshake) that failed before the client ever saw a healthy
      // connection. There is no in-app way back from that, so the reload
      // screen is correct here and must not regress.
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      act(() => {
        handlers.get('error')?.({ message: 'Server unavailable' });
      });
      expect(screen.getByTestId('status')).toHaveTextContent('error');
      expect(screen.getByTestId('error')).toHaveTextContent('Server unavailable');
      expect(disconnectCalls).toBe(1);
    });

    it('a rejected admin action while NOT seated keeps the socket connected and the status unchanged', async () => {
      // The bug: an admin who unlocked the panel but has not taken a seat
      // sits in 'entering-name'. A perfectly ordinary rejection ("Can't
      // adjust -- alice is in an active hand") used to disconnect that
      // socket and strand the admin on a permanent reload screen.
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] }), { isAdmin: true }));
      });
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));

      act(() => {
        screen.getByText('admin-adjust').click();
        handlers.get('error')?.({
          message: "Can't adjust -- alice is in an active hand",
          scope: 'admin',
        });
      });

      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(disconnectCalls).toBe(0);
      expect(screen.getByTestId('adminActionError')).toHaveTextContent(
        "Can't adjust -- alice is in an active hand"
      );
    });

    it('a rejected join on a healthy connection surfaces inline without tearing the session down', async () => {
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] })));
      });
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));

      act(() => {
        handlers.get('error')?.({ message: '"alice" is already seated' });
      });

      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('error')).toHaveTextContent('"alice" is already seated');
      expect(disconnectCalls).toBe(0);
    });

    it('a rejected auto-rejoin that fires before status ever leaves connecting lands on entering-name instead of stalling', async () => {
      // Regression case: the 'state' handler's auto-rejoin branch (a
      // remembered name plus a mode that's already active) emits `join`
      // without ever calling setStatus. When that first-ever 'state' event
      // is itself what triggers the auto-rejoin, `status` is still sitting
      // on its initial 'connecting' value when the join goes out.
      // `hasEverReceivedStateRef.current` is already true by the time the
      // rejection comes back (that state event is what set it), so the
      // 'error' handler takes the non-fatal branch -- previously that branch
      // only set `errorMessage` and never touched `status`, leaving the user
      // stuck on App.tsx's bare "Connecting..." screen (which doesn't read
      // `errorMessage`) with no way to see the rejection or retry.
      storeIdentity('alice', {});
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      expect(screen.getByTestId('status')).toHaveTextContent('connecting');

      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState({ seats: [] })));
      });
      expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
      // Confirms the premise: the auto-rejoin branch really does leave
      // status on 'connecting' rather than advancing it itself.
      expect(screen.getByTestId('status')).toHaveTextContent('connecting');

      act(() => {
        handlers.get('error')?.({ message: '"alice" is already seated' });
      });

      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('error')).toHaveTextContent('"alice" is already seated');
      expect(disconnectCalls).toBe(0);
    });
  });

  describe('admin-action errors have their own channel', () => {
    it('routes a scope:"admin" error away from the join/table error field', async () => {
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      act(() => {
        screen.getByText('join').click();
        handlers.get('state')?.(makeAppState(makeWaitingState(), { isAdmin: true, mySeatIndex: 0 }));
      });
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

      act(() => {
        handlers.get('error')?.({ message: 'Blinds must be positive numbers', scope: 'admin' });
      });

      expect(screen.getByTestId('adminActionError')).toHaveTextContent('Blinds must be positive numbers');
      // Neither the join/table channel (JoinScreen's name field) nor the
      // admin *login* channel (AdminEntry) may pick this up.
      expect(screen.getByTestId('error')).toHaveTextContent('none');
      expect(screen.getByTestId('adminError')).toHaveTextContent('none');
    });

    it('an untagged join/table error does not land in the admin-action channel', async () => {
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      act(() => {
        screen.getByText('join').click();
        handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      });
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

      act(() => {
        handlers.get('error')?.({ message: "It is not alice's turn" });
      });
      expect(screen.getByTestId('adminActionError')).toHaveTextContent('none');
    });

    it('sending a new admin action clears the previous rejection', async () => {
      render(
        <SocketProvider serverUrl="http://localhost:3000">
          <TestConsumer />
        </SocketProvider>
      );
      act(() => {
        handlers.get('state')?.(makeAppState(makeWaitingState(), { isAdmin: true }));
      });
      act(() => {
        handlers.get('error')?.({ message: 'Blinds must be positive numbers', scope: 'admin' });
      });
      expect(screen.getByTestId('adminActionError')).toHaveTextContent('Blinds must be positive numbers');

      act(() => {
        screen.getByText('admin-adjust').click();
      });
      expect(screen.getByTestId('adminActionError')).toHaveTextContent('none');
    });
  });

  it('disconnect while at-table moves to reconnecting, and the manager reconnect event re-joins', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('disconnect')?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');

    emitted.length = 0;
    act(() => {
      ioManagerHandlers.get('reconnect')?.();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
  });

  it('a fresh state event clears a previously-shown in-game error', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('leave() while no hand is in progress emits leave and clears the session', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('identity')?.({ displayName: 'alice', token: 'tok-a' });
      handlers.get('state')?.(makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(storedIdentity().lastName).toBe('alice');

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted.filter((e) => e.event === 'leave')).toHaveLength(1);
    expect(storedIdentity().lastName).toBe('alice'); // not until the server confirms
    answerLeave({ ok: true });
    expect(disconnectCalls).toBe(0); // the socket itself stays connected -- we're still in the lobby, not gone
    expect(storedIdentity().lastName).toBeNull();
    expect(screen.getByTestId('name')).toHaveTextContent('none');
  });

  it('leave() while a hand is in progress is a no-op, preserving the session (defense in depth alongside the UI gate)', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('join').click();
      handlers.get('identity')?.({ displayName: 'alice', token: 'tok-a' });
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { mySeatIndex: 0 })); // handInProgress: true
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toEqual([]);
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(storedIdentity().lastName).toBe('alice');
  });

  describe('identity (audit C5, I9, M11)', () => {
    it('is not at the table just because a connected seat has our name (I9)', async () => {
      renderProvider();
      push('state', makeAppState(makeWaitingState()));
      act(() => screen.getByText('join').click());
      push('state', makeAppState(makeWaitingState())); // seats[0] is a connected 'alice', but not us
      push('error', { message: '"alice" belongs to another player.', code: 'name-claimed' });
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
    });

    it('is at the table when the server says which seat is ours', async () => {
      renderProvider();
      push('state', makeAppState(makeWaitingState()));
      act(() => screen.getByText('join').click());
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    });

    // The server broadcasts from Table.join / reconnect before it maps the socket to the seat, and
    // on a fresh join the frame with our mySeatIndex only follows the token's disk write. Those
    // transient frames have our name in the seats but mySeatIndex null. They must not read as a
    // rejection, and must not fire a second `join`: a tokenless duplicate for a name the server has
    // just claimed would come back as 'name-claimed' and show the player an error.
    it('a transient null-mySeatIndex frame during a fresh join is neither an error nor a second join', async () => {
      renderProvider();
      push('state', makeAppState(makeWaitingState({ seats: [] })));
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
      act(() => screen.getByText('join').click());

      push('state', makeAppState(makeWaitingState())); // alice is in the seats, mySeatIndex still null
      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('error')).toHaveTextContent('none');
      // A second one (another player's broadcast, say): the first must not have re-armed the
      // auto-rejoin, or this is where the duplicate join would go out.
      push('state', makeAppState(makeWaitingState()));
      expect(emitted.filter((e) => e.event === 'join')).toHaveLength(1);

      push('identity', { displayName: 'alice', token: 'tok-new' });
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
      expect(screen.getByTestId('error')).toHaveTextContent('none');
      expect(emitted.filter((e) => e.event === 'join')).toHaveLength(1);
    });

    it('a transient null-mySeatIndex frame while rejoining after a transport reconnect does not send a second join', async () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
      push('disconnect');
      expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');

      emitted.length = 0;
      act(() => ioManagerHandlers.get('reconnect')?.());
      push('state', makeAppState(makeWaitingState())); // Table.reconnect broadcast: name present, socket not mapped yet
      expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
      expect(screen.getByTestId('error')).toHaveTextContent('none');
      expect(emitted.filter((e) => e.event === 'join')).toEqual([
        { event: 'join', payload: { displayName: 'alice', token: 'tok-a' } },
      ]);
    });

    it('a transient null-mySeatIndex frame while a page-load rejoin is pending does not send a second join', async () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push(
        'state',
        makeAppState(makeWaitingState({ seats: [makeSeat({ seatIndex: 0, displayName: 'alice', connected: false })] }))
      );
      expect(emitted.filter((e) => e.event === 'join')).toHaveLength(1);

      expect(screen.getByTestId('status')).toHaveTextContent('connecting');

      push('state', makeAppState(makeWaitingState())); // Table.reconnect marked the seat connected; socket not mapped yet
      push('state', makeAppState(makeWaitingState())); // and another broadcast before the mapping lands
      expect(screen.getByTestId('status')).toHaveTextContent('connecting');
      expect(emitted.filter((e) => e.event === 'join')).toHaveLength(1);
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
      expect(screen.getByTestId('error')).toHaveTextContent('none');
      expect(emitted.filter((e) => e.event === 'join')).toHaveLength(1);
    });

    it('rejoins with the stored name and its token', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState({ seats: [] })));
      expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
    });

    it('stores the token and name from an identity event', () => {
      renderProvider();
      push('identity', { displayName: 'Alice', token: 'tok-new' });
      expect(storedIdentity()).toEqual({ lastName: 'Alice', tokens: { alice: 'tok-new' } });
      expect(screen.getByTestId('name')).toHaveTextContent('Alice');
    });

    it('a rejected join forgets the last name but keeps the tokens', async () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState({ seats: [] })));
      push('error', { message: '"alice" belongs to another player.', code: 'name-claimed' });
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
      expect(storedIdentity()).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
    });

    it('when replaced, shows the replaced status and does not rejoin on its own', async () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      push('error', { message: 'You opened the game in another tab or device.', code: 'replaced' });
      push('state', makeAppState(makeWaitingState()));
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('replaced'));
      act(() => ioManagerHandlers.get('reconnect')?.());
      expect(emitted.filter((e) => e.event === 'join')).toHaveLength(0); // seated from the first state, never rejoined
    });

    it('takeOver rejoins with the token', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      push('error', { message: 'You opened the game in another tab or device.', code: 'replaced' });
      emitted.length = 0;
      act(() => screen.getByText('take-over').click());
      expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
    });

    it('leave forgets the last name and keeps the token', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      answerLeave({ ok: true });
      expect(storedIdentity()).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
    });

    it('keeps the admin token for this tab and sends it on every connect (M11)', () => {
      renderProvider();
      push('adminLoginResult', { success: true, adminToken: 'adm-1' });
      expect(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)).toBe('adm-1');
      const options = vi.mocked(io).mock.calls[0][1] as { auth: (cb: (data: object) => void) => void };
      const cb = vi.fn();
      options.auth(cb);
      expect(cb).toHaveBeenCalledWith({ adminToken: 'adm-1' });
    });

    it('explains a login lockout', async () => {
      renderProvider();
      push('adminLoginResult', { success: false, retryAfterMs: 42_100 });
      await waitFor(() => expect(screen.getByTestId('adminError')).toHaveTextContent('Try again in 43 s'));
    });

    it('shows an admin notice until the next admin action', async () => {
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { isAdmin: true }));
      push('adminNotice', { message: 'Released "bob"' });
      await waitFor(() => expect(screen.getByTestId('adminNotice')).toHaveTextContent('Released "bob"'));
      act(() => screen.getByText('admin-release').click());
      expect(screen.getByTestId('adminNotice')).toHaveTextContent('none');
      expect(emitted).toContainEqual({ event: 'adminReleaseName', payload: { displayName: 'bob' } });
    });
  });

  describe('unsticking (audit I10, I11, I6)', () => {
    it('rejoins after a second drop that lands before the first rejoin was answered (I10)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      expect(screen.getByTestId('status')).toHaveTextContent('at-table');

      push('disconnect');
      act(() => ioManagerHandlers.get('reconnect')?.()); // first rejoin goes out, then is lost
      push('disconnect');
      emitted.length = 0;
      act(() => ioManagerHandlers.get('reconnect')?.());
      expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
    });

    it('keeps its name when the server refuses the leave because a hand just started (I11)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('state', makeAppState(makeHoldemPreflopState(), { mySeatIndex: 0 }));
      answerLeave({ ok: false, message: 'Cannot leave while a hand you are in is in progress' });

      expect(screen.getByTestId('status')).toHaveTextContent('at-table');
      expect(screen.getByTestId('name')).toHaveTextContent('alice');
      expect(screen.getByTestId('error')).toHaveTextContent('Cannot leave while a hand you are in is in progress');
      expect(storedIdentity().lastName).toBe('alice');
    });

    it('does not rejoin on the unseated state that arrives before the leave is confirmed (I11)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      emitted.length = 0;
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      expect(emitted.filter((e) => e.event === 'join')).toEqual([]);
    });

    it('lands on the join screen once the leave is confirmed (I11)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      answerLeave({ ok: true });
      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('name')).toHaveTextContent('none');
    });

    it('a second leave click while the first is unanswered sends nothing (M30)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      act(() => screen.getByText('leave').click());
      expect(emitted.filter((e) => e.event === 'leave')).toHaveLength(1);
    });

    it('when kicked, shows why on the join screen, forgets the name, keeps the token and does not rejoin (I6)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      push('error', { message: 'The admin removed you from the table.', code: 'kicked' });
      emitted.length = 0;
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));

      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('error')).toHaveTextContent('The admin removed you from the table.');
      expect(screen.getByTestId('name')).toHaveTextContent('none');
      expect(storedIdentity()).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
      expect(emitted.filter((e) => e.event === 'join')).toEqual([]);
    });

    it('when leave is refused after the server already unseated us, treats it like ok:true (I11 racing mode switch)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      answerLeave({ ok: false, message: 'Not seated' });
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));

      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(screen.getByTestId('name')).toHaveTextContent('none');
      expect(storedIdentity()).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
      expect(emitted.filter((e) => e.event === 'join')).toEqual([]);
    });

    it('a kick that lands before a refused leave ack keeps its reason on the join screen (I6)', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('error', { message: 'The admin removed you from the table.', code: 'kicked' });
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      answerLeave({ ok: false, message: 'Not seated' });

      expect(screen.getByTestId('error')).toHaveTextContent('The admin removed you from the table.');
      expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
      expect(emitted.filter((e) => e.event === 'join')).toEqual([]);
    });

    it('a kicked error message is not overwritten by a later leave ok:false ack', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('error', { message: 'The admin removed you from the table.', code: 'kicked' });
      expect(screen.getByTestId('error')).toHaveTextContent('The admin removed you from the table.');
      answerLeave({ ok: false, message: 'Not seated' });

      expect(screen.getByTestId('error')).toHaveTextContent('The admin removed you from the table.');
    });

    it('a leave pending when the connection drops does not block a leave after reconnecting', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());
      push('disconnect');
      act(() => ioManagerHandlers.get('reconnect')?.());
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      act(() => screen.getByText('leave').click());

      expect(emitted.filter((e) => e.event === 'leave')).toHaveLength(2);
    });

    it('an ordinary error after rejoining following a kick is cleared by the next state, like any other', () => {
      storeIdentity('alice', { alice: 'tok-a' });
      renderProvider();
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      push('error', { message: 'The admin removed you from the table.', code: 'kicked' });
      push('state', makeAppState(makeWaitingState({ seats: [] }), { mySeatIndex: null }));
      expect(screen.getByTestId('error')).toHaveTextContent('The admin removed you from the table.');

      act(() => screen.getByText('join').click());
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      push('error', { message: 'Not your turn' });
      expect(screen.getByTestId('error')).toHaveTextContent('Not your turn');
      push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
      expect(screen.getByTestId('error')).toHaveTextContent('none');
    });
  });
});
