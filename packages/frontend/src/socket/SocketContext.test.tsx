import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket, SocketProvider, DISPLAY_NAME_STORAGE_KEY } from './SocketContext';
import { makeWaitingState } from '../fixtures/tableStateFixtures';

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
  const { status, state, errorMessage, displayName, connect } = useSocket();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="state">{state ? state.gameMode : 'none'}</p>
      <p data-testid="error">{errorMessage ?? 'none'}</p>
      <p data-testid="name">{displayName ?? 'none'}</p>
      <button onClick={() => connect('alice')}>connect</button>
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
});
