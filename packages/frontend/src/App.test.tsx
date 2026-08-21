import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import { makeWaitingState } from './fixtures/tableStateFixtures';

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

  it('shows the join screen before connecting', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /poker & blackjack/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('shows PokerTable once state arrives with gameMode holdem', async () => {
    render(<App />);
    // App.test.tsx's canonical fixture (per the task-8 brief) drives the
    // display-name input by setting `.value` and dispatching a raw 'input'
    // event. That bypasses React's controlled-input value tracker (React
    // installs its own instance-level setter to detect changes), so the
    // dispatched event is seen as a no-op and onChange never fires -- the
    // button stays disabled and the test can't proceed. userEvent.type
    // drives the DOM through the same native setter React expects, which is
    // also the established pattern in JoinScreen.test.tsx, so it's used here
    // instead.
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    act(() => {
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState({ gameMode: 'holdem' }));
    });
    expect(await screen.findByRole('button', { name: /leave table/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });
});
