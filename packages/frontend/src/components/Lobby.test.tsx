import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Lobby } from './Lobby';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { makeLobbyState, makeAppState, makeWaitingState } from '../fixtures/tableStateFixtures';

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value: SocketContextValue = {
    status: 'lobby',
    state: makeLobbyState(),
    errorMessage: null,
    adminErrorMessage: null,
    adminActionErrorMessage: null,
    displayName: null,
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
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <Lobby />
    </SocketContext.Provider>
  );
  return value;
}

describe('Lobby', () => {
  it('shows a waiting message and no mode picker for a non-admin with no active mode', () => {
    renderWithSocket({ state: makeLobbyState() });
    expect(screen.getByText(/waiting for a game to start/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start poker night/i })).not.toBeInTheDocument();
  });

  it('shows the mode picker for an admin with no active mode', () => {
    const value = renderWithSocket({ isAdmin: true, state: makeLobbyState({ isAdmin: true }) });
    fireEvent.click(screen.getByRole('button', { name: /start poker night/i }));
    expect(value.adminStartGame).toHaveBeenCalledWith('holdem');
  });

  it('shows switch buttons (not start buttons) for an admin when a mode is already active', () => {
    const value = renderWithSocket({
      isAdmin: true,
      state: makeAppState(makeWaitingState(), { isAdmin: true }),
    });
    expect(screen.queryByRole('button', { name: /start blackjack night/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /switch to blackjack/i }));
    expect(value.adminSwitchMode).toHaveBeenCalledWith('blackjack');
  });

  it("disables the button for whichever mode is already active", () => {
    renderWithSocket({ isAdmin: true, state: makeAppState(makeWaitingState(), { isAdmin: true }) });
    expect(screen.getByRole('button', { name: /switch to poker/i })).toBeDisabled();
  });
});
