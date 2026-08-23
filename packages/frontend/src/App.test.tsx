import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import {
  makeAppState,
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

  // 'lobby' status is covered once Lobby.tsx exists -- see Task 8. App.tsx
  // references <Lobby /> without importing it yet (Task 8 adds that
  // import), so driving a 'state' event with mode: null here would hit an
  // unresolved reference at render time; that case is deferred to Task 8.

  it('shows the join screen once connected without a known display name', () => {
    render(<App />);
    act(() => {
      handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' })));
    });
    expect(screen.getByRole('heading', { name: /poker & blackjack/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
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
