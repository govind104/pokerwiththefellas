import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminEntry } from './AdminEntry';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';

function renderWithSocket(overrides: Partial<SocketContextValue> = {}) {
  const value: SocketContextValue = {
    status: 'lobby',
    state: null,
    errorMessage: null,
    adminErrorMessage: null,
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
      <AdminEntry />
    </SocketContext.Provider>
  );
  return value;
}

describe('AdminEntry', () => {
  it('shows an Admin button and no form initially', () => {
    renderWithSocket();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Admin passphrase')).not.toBeInTheDocument();
  });

  it('clicking Admin reveals the passphrase form, and submitting calls adminLogin', () => {
    const value = renderWithSocket();
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const input = screen.getByLabelText('Admin passphrase');
    fireEvent.change(input, { target: { value: 'let-me-in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(value.adminLogin).toHaveBeenCalledWith('let-me-in');
  });

  it('renders an unlocked indicator instead of the login form once isAdmin is true', () => {
    renderWithSocket({ isAdmin: true });
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows an admin-scoped error message from context after a failed login attempt', () => {
    renderWithSocket({ adminErrorMessage: 'Incorrect admin passphrase' });
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.getByText('Incorrect admin passphrase')).toBeInTheDocument();
  });

  it('does not show a join/table error as an admin error', () => {
    renderWithSocket({ errorMessage: 'Some join error', adminErrorMessage: null });
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.queryByText('Some join error')).not.toBeInTheDocument();
  });
});
