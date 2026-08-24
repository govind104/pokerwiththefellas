import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminPanel } from './AdminPanel';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { makeAppState, makeWaitingState, makeLobbyState } from '../fixtures/tableStateFixtures';

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value: SocketContextValue = {
    status: 'at-table',
    state: makeAppState(makeWaitingState(), { isAdmin: true }),
    errorMessage: null,
    adminErrorMessage: null,
    displayName: 'alice',
    isAdmin: true,
    joinWithName: vi.fn(),
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    adminLogin: vi.fn(),
    adminStartGame: vi.fn(),
    adminSwitchMode: vi.fn(),
    adminAdjustBalance: vi.fn(),
    adminSetBlinds: vi.fn(),
    adminSetDefaultBet: vi.fn(),
    adminSetStartingBalance: vi.fn(),
    ...overrides,
  };
  const { container } = render(
    <SocketContext.Provider value={value}>
      <AdminPanel />
    </SocketContext.Provider>
  );
  return { ...value, container };
}

describe('AdminPanel', () => {
  it('renders nothing when not admin', () => {
    const { container } = render(
      <SocketContext.Provider
        value={{
          status: 'at-table',
          state: makeAppState(makeWaitingState()),
          errorMessage: null,
          adminErrorMessage: null,
          displayName: 'alice',
          isAdmin: false,
          joinWithName: vi.fn(),
          sendReady: vi.fn(),
          sendAction: vi.fn(),
          leave: vi.fn(),
          adminLogin: vi.fn(),
          adminStartGame: vi.fn(),
          adminSwitchMode: vi.fn(),
          adminAdjustBalance: vi.fn(),
          adminSetBlinds: vi.fn(),
          adminSetDefaultBet: vi.fn(),
          adminSetStartingBalance: vi.fn(),
        }}
      >
        <AdminPanel />
      </SocketContext.Provider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when admin but no table is active', () => {
    const { container } = renderWithSocket({ state: makeLobbyState({ isAdmin: true }) });
    expect(container).toBeEmptyDOMElement();
  });

  it('toggles open, and submitting the balance form calls adminAdjustBalance with the selected player and entered value', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    fireEvent.change(screen.getByLabelText(/select player/i) ?? screen.getByRole('combobox'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('New balance'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /save balance/i }));
    expect(value.adminAdjustBalance).toHaveBeenCalledWith('alice', 5000);
  });

  it('shows blind fields for holdem and calls adminSetBlinds', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    fireEvent.change(screen.getByLabelText('Small blind'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Big blind'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /save blinds/i }));
    expect(value.adminSetBlinds).toHaveBeenCalledWith(50, 100);
    expect(screen.queryByLabelText('Default bet')).not.toBeInTheDocument();
  });

  it('shows the default-bet field for blackjack instead of blinds, and calls adminSetDefaultBet', () => {
    const value = renderWithSocket({
      state: makeAppState(makeWaitingState({ gameMode: 'blackjack' }), { isAdmin: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    expect(screen.queryByLabelText('Small blind')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Default bet'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /save default bet/i }));
    expect(value.adminSetDefaultBet).toHaveBeenCalledWith(40);
  });

  it('calls adminSetStartingBalance from its own form', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    fireEvent.change(screen.getByLabelText('Starting balance for new joiners'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: /save starting balance/i }));
    expect(value.adminSetStartingBalance).toHaveBeenCalledWith(2000);
  });
});
