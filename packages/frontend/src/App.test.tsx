import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import {
  makeAppState,
  makeLobbyState,
  makeWaitingState,
  makeHoldemPreflopState,
  makeBlackjackPlayingState,
} from './fixtures/tableStateFixtures';

const handlers = new Map<string, (...args: unknown[]) => void>();
const emitted: { event: string; payload: unknown }[] = [];
let disconnectCalls = 0;

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
    io: { on: () => {} },
  };
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket()) }));

describe('App', () => {
  beforeEach(() => {
    handlers.clear();
    emitted.length = 0;
    disconnectCalls = 0;
    sessionStorage.clear();
  });

  it('shows a connecting message before any state has arrived', () => {
    render(<App />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the Lobby (not the join screen or a table) once connected with no active game mode', () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeLobbyState());
    });
    expect(screen.getByText(/waiting for a game to start/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hit' })).not.toBeInTheDocument();
  });

  it('shows the join screen once connected without a known display name', () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
    });
    expect(screen.getByRole('heading', { name: /poker & blackjack/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows the actual error message and a reload option on a connection error, instead of a stuck "Connecting" state', () => {
    render(<App />);
    act(() => {
      handlers.get('error')?.({ message: 'Server unavailable' });
    });
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('shows PokerTable once seated at a holdem table', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState()));
    });
    expect(await screen.findByRole('button', { name: 'Fold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows the AdminPanel alongside the table once seated as an admin', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { isAdmin: true }));
    });
    expect(await screen.findByRole('button', { name: 'Fold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /admin panel/i })).toBeInTheDocument();
  });

  it("surfaces a rejected admin action inside the AdminPanel's own error surface", async () => {
    // A rejected admin action (server-side: adminAdjustBalance refused
    // because the target is mid-hand) arrives tagged `scope: 'admin'`, which
    // routes it to AdminPanel's own error surface rather than the shared
    // join/table channel that JoinScreen wires to its display-name input via
    // aria-describedby. Driven through the real 'error' event on the fake
    // socket, with the full tree mounted as in real usage.
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { isAdmin: true }));
    });
    await userEvent.click(await screen.findByRole('button', { name: /admin panel/i }));

    act(() => {
      handlers.get('error')?.({
        message: "Can't adjust -- bob is in an active hand",
        scope: 'admin',
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent("Can't adjust -- bob is in an active hand");
    // The join/table alert banner (GameTable's) must NOT have picked it up:
    // exactly one alert is on screen, and it is the admin panel's.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it("an admin can trigger adminSwitchMode from the running UI while a game is active", async () => {
    // Reachability regression: the mode-switch UI used to live only in
    // Lobby, which App renders only at status 'lobby' -- a status
    // SocketContext only reaches when NO mode is active, which is precisely
    // when Lobby's switch UI does not render. So adminSwitchMode had no path
    // from the real app at all. This drives the whole composed tree (real
    // SocketProvider, real fake-socket 'state' events) and asserts the
    // adminSwitchMode emit actually goes out over the socket.
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });

    await userEvent.click(await screen.findByRole('button', { name: /admin panel/i }));
    emitted.length = 0;
    await userEvent.click(screen.getByRole('button', { name: /switch to blackjack/i }));

    expect(emitted).toContainEqual({ event: 'adminSwitchMode', payload: { mode: 'blackjack' } });
  });

  it('a rejected admin action from an unseated admin does not destroy the session', async () => {
    // The admin unlocked the panel but never took a seat, so status is
    // 'entering-name'. A rejection used to disconnect the socket and replace
    // the whole app with the reload screen.
    render(<App />);
    act(() => {
      handlers.get('state')?.(
        makeAppState(makeWaitingState({ gameMode: 'holdem', seats: [] }), { isAdmin: true })
      );
    });
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();

    act(() => {
      handlers.get('error')?.({
        message: "Can't adjust -- alice is in an active hand",
        scope: 'admin',
      });
    });

    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument();
    expect(disconnectCalls).toBe(0);
  });

  it('shows BlackjackTable once seated at a blackjack table', async () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'blackjack' })));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeBlackjackPlayingState()));
    });
    expect(await screen.findByRole('button', { name: 'Hit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });
});
