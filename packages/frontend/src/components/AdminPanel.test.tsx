import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminPanel } from './AdminPanel';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';
import { makeAppState, makeWaitingState, makeLobbyState } from '../fixtures/tableStateFixtures';

function makeSocketValue(overrides: Partial<SocketContextValue> = {}): SocketContextValue {
  return {
    status: 'at-table',
    state: makeAppState(makeWaitingState(), { isAdmin: true }),
    errorMessage: null,
    adminErrorMessage: null,
    adminActionErrorMessage: null,
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
}

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value = makeSocketValue(overrides);
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
        value={makeSocketValue({ isAdmin: false, state: makeAppState(makeWaitingState()) })}
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

  describe('current-value prefill', () => {
    it('prefills the config inputs from the broadcast state instead of starting blank', () => {
      renderWithSocket({
        state: makeAppState(makeWaitingState(), {
          isAdmin: true,
          smallBlind: 25,
          bigBlind: 50,
          defaultStartingBalance: 3000,
        }),
      });
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      expect(screen.getByLabelText('Small blind')).toHaveValue(25);
      expect(screen.getByLabelText('Big blind')).toHaveValue(50);
      expect(screen.getByLabelText('Starting balance for new joiners')).toHaveValue(3000);
    });

    it("prefills the balance field with the selected player's current balance", () => {
      renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      expect(screen.getByLabelText('New balance')).toHaveValue(null);
      fireEvent.change(screen.getByLabelText(/select player/i), { target: { value: 'bob' } });
      // makeWaitingState seats alice and bob at 1000 each.
      expect(screen.getByLabelText('New balance')).toHaveValue(1000);
    });
  });

  describe('empty numeric fields are "no change", never a zero', () => {
    // Number('') === 0, so the old Number.isNaN-only guards let an emptied
    // field submit a 0: a zeroed player balance, a persisted 0 big blind, or
    // every future joiner starting on 0 chips.
    it('does not submit an emptied balance field', () => {
      const value = renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.change(screen.getByLabelText(/select player/i), { target: { value: 'alice' } });
      fireEvent.change(screen.getByLabelText('New balance'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save balance/i }));
      expect(value.adminAdjustBalance).not.toHaveBeenCalled();
    });

    it('does not submit an emptied blind field', () => {
      const value = renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.change(screen.getByLabelText('Big blind'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save blinds/i }));
      expect(value.adminSetBlinds).not.toHaveBeenCalled();
    });

    it('does not submit an emptied default-bet field', () => {
      const value = renderWithSocket({
        state: makeAppState(makeWaitingState({ gameMode: 'blackjack' }), { isAdmin: true }),
      });
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.change(screen.getByLabelText('Default bet'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save default bet/i }));
      expect(value.adminSetDefaultBet).not.toHaveBeenCalled();
    });

    it('does not submit an emptied starting-balance field', () => {
      const value = renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.change(screen.getByLabelText('Starting balance for new joiners'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save starting balance/i }));
      expect(value.adminSetStartingBalance).not.toHaveBeenCalled();
    });
  });

  describe('mode switching', () => {
    it('offers a switch to the other mode and calls adminSwitchMode', () => {
      const value = renderWithSocket();
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.click(screen.getByRole('button', { name: /switch to blackjack/i }));
      expect(value.adminSwitchMode).toHaveBeenCalledWith('blackjack');
    });

    it('offers the reverse switch from a blackjack table', () => {
      const value = renderWithSocket({
        state: makeAppState(makeWaitingState({ gameMode: 'blackjack' }), { isAdmin: true }),
      });
      fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
      fireEvent.click(screen.getByRole('button', { name: /switch to poker/i }));
      expect(value.adminSwitchMode).toHaveBeenCalledWith('holdem');
    });
  });

  it('renders an admin-action rejection in its own error surface', () => {
    renderWithSocket({ adminActionErrorMessage: "Can't adjust -- alice is in an active hand" });
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }));
    expect(screen.getByRole('alert')).toHaveTextContent("Can't adjust -- alice is in an active hand");
  });
});
