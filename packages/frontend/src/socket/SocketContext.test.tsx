import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket, SocketProvider, DISPLAY_NAME_STORAGE_KEY } from './SocketContext';
import { makeWaitingState, makeHoldemPreflopState } from '../fixtures/tableStateFixtures';

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
  const { status, state, errorMessage, displayName, connect, leave } = useSocket();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="state">{state ? state.gameMode : 'none'}</p>
      <p data-testid="error">{errorMessage ?? 'none'}</p>
      <p data-testid="name">{displayName ?? 'none'}</p>
      <button onClick={() => connect('alice')}>connect</button>
      <button onClick={() => leave()}>leave</button>
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

  it('starts in entering-name with no stored name', () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
  });

  it('connects, joins, and reaches at-table on a state event', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      screen.getByText('connect').click();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');

    act(() => {
      handlers.get('connect')?.();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });

    act(() => {
      handlers.get('state')?.(makeWaitingState());
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(screen.getByTestId('state')).toHaveTextContent('holdem');
    expect(screen.getByTestId('name')).toHaveTextContent('alice');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });

  it('an error while connecting moves to error and disconnects the socket', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      screen.getByText('connect').click();
    });
    act(() => {
      handlers.get('error')?.({ message: 'Invalid display name' });
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('Invalid display name');
    expect(disconnectCalls).toBe(1);
  });

  it('an error while at-table stays at-table and does not disconnect', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
    });
    act(() => {
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");
    expect(disconnectCalls).toBe(0);
  });

  it('disconnect while at-table moves to reconnecting, and the manager reconnect event re-joins', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
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

  it('resumes a stored display name on mount without a manual connect() call', () => {
    sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, 'carol');
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');
    expect(screen.getByTestId('name')).toHaveTextContent('carol');
  });

  it('a fresh state event clears a previously-shown in-game error', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");

    act(() => {
      handlers.get('state')?.(makeWaitingState());
    });
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('leave() while no hand is in progress emits leave, disconnects, and resets to entering-name', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toContainEqual({ event: 'leave', payload: undefined });
    expect(disconnectCalls).toBe(1);
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
  });

  it('leave() while a hand is in progress is a no-op, preserving the session (defense in depth alongside the UI gate)', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeHoldemPreflopState()); // handInProgress: true
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    emitted.length = 0;
    act(() => {
      screen.getByText('leave').click();
    });

    expect(emitted).toEqual([]);
    expect(disconnectCalls).toBe(0);
    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });

  it('does not transiently show reconnecting when disconnect fires synchronously during leave()', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      // Real socket.io-client's disconnect() fires this socket's own
      // 'disconnect' handler synchronously before returning -- the fake
      // socket here doesn't do that automatically, so simulate the ordering
      // explicitly to exercise the leavingRef guard.
      screen.getByText('leave').click();
      handlers.get('disconnect')?.();
    });

    expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
  });

  it('resets the leaving guard on a fresh connect so a later disconnect still shows reconnecting', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      screen.getByText('leave').click();
      handlers.get('disconnect')?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('entering-name');

    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('disconnect')?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');
  });
});
