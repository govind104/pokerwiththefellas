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

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    emit: () => {},
    disconnect: () => {},
    io: { on: () => {} },
  };
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket()) }));

describe('App', () => {
  beforeEach(() => {
    handlers.clear();
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

  it('surfaces a rejected admin action (e.g. adjusting a balance mid-hand) as an alert banner alongside the AdminPanel', async () => {
    // Regression coverage for the finding that AdminPanel.tsx never reads
    // errorMessage/adminErrorMessage itself: a rejected admin action (the
    // server emits a plain 'error' event, e.g. adminAdjustBalance rejected
    // because the target is in an active hand -- see socketServer.ts) sets
    // SocketContext's `errorMessage` (NOT `adminErrorMessage`, which is
    // reserved for admin-login failures). That only becomes visible because
    // GameTable renders `errorMessage` as a role="alert" banner and is always
    // mounted alongside AdminPanel whenever there's an active table. This
    // test drives the real 'error' event through the fake socket to prove
    // that end-to-end path, with both components mounted as they are in
    // real usage.
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { isAdmin: true }));
    });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('state')?.(makeAppState(makeHoldemPreflopState(), { isAdmin: true }));
    });
    expect(await screen.findByRole('button', { name: /admin panel/i })).toBeInTheDocument();

    act(() => {
      handlers.get('error')?.({ message: "Can't adjust -- bob is in an active hand" });
    });

    expect(screen.getByRole('alert')).toHaveTextContent("Can't adjust -- bob is in an active hand");
    // AdminPanel itself is still mounted alongside the alert -- the coverage
    // is that the *system* (AdminPanel + GameTable via App/SocketContext
    // wiring) surfaces the error, not that AdminPanel renders it itself.
    expect(screen.getByRole('button', { name: /admin panel/i })).toBeInTheDocument();
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
