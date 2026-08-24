import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket, SocketProvider, DISPLAY_NAME_STORAGE_KEY } from './SocketContext';
import { makeAppState, makeLobbyState, makeWaitingState, makeHoldemPreflopState } from '../fixtures/tableStateFixtures';

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
    </div>
  );
}

describe('SocketProvider', () => {
  beforeEach(() => {
    handlers.clear();
    ioManagerHandlers.clear();
    emitted.length = 0;
    disconnectCalls = 0;
    sessionStorage.clear();
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

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState())); // seats[0] is 'alice' per the fixture
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(screen.getByTestId('mode')).toHaveTextContent('holdem');
    expect(screen.getByTestId('name')).toHaveTextContent('alice');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });

  it('auto-rejoins with a remembered name once a mode becomes active, without a manual joinWithName call', async () => {
    sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, 'alice');
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

  it('auto-rejoins with the remembered name after an admin mode switch clears seats, without landing on entering-name', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    // Get seated first, the same way a normal player would.
    act(() => {
      screen.getByText('join').click();
      handlers.get('state')?.(makeAppState(makeWaitingState())); // seats[0] is 'alice' per the fixture
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');

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
      handlers.get('state')?.(makeAppState(makeWaitingState()));
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
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");
    expect(disconnectCalls).toBe(0);
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
        handlers.get('state')?.(makeAppState(makeWaitingState(), { isAdmin: true }));
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
        handlers.get('state')?.(makeAppState(makeWaitingState()));
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
      handlers.get('state')?.(makeAppState(makeWaitingState()));
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
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");

    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState()));
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
      handlers.get('state')?.(makeAppState(makeWaitingState()));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toContainEqual({ event: 'leave', payload: undefined });
    expect(disconnectCalls).toBe(0); // the socket itself stays connected -- we're still in the lobby, not gone
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBeNull();
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
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState())); // handInProgress: true
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toEqual([]);
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });
});
