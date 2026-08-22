import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import { setupIntegrationServer } from './integrationTestServer';

// Mirrors packages/server/src/integration.test.ts's own setup pattern -- see
// integrationTestServer.ts for the shared fixture this and
// blackjack.integration.test.tsx both use.
function buildConfig(): TableConfig {
  return {
    gameMode: 'holdem',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 120_000,
    random: Math.random,
  };
}

const ctx = setupIntegrationServer(buildConfig, 'frontend-poker-integration-');

describe('Poker end-to-end via App', () => {
  it('two players join, ready up, and see the hand start with correct hole-card visibility', async () => {
    const { App } = ctx;
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    // Wait for alice's real App instance to reflect bob's join before moving
    // on -- see the module doc comment above for why this findBy* sync point
    // (act-wrapped by testing-library) matters here.
    await within(screen.getByTestId('player-info-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-info-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('my-hand').querySelectorAll('img')).toHaveLength(2);
    });
    // My own hole cards are real card images; the opponent gets no card
    // element at all mid-hand (their rail row is identity/status only).
    expect(screen.getByTestId('player-info-1').querySelector('img, svg[role="img"]')).not.toBeInTheDocument();
  });

  it('sendAction round-trips: calling advances the acting player from alice to bob', async () => {
    const { App } = ctx;
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    await within(screen.getByTestId('player-info-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-info-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    // On the first hand, seat 0 (alice) is the button/small blind and acts
    // first preflop in this heads-up table -- her own action controls
    // appearing is the turn signal (she has no rail row to carry
    // data-active, since the rail only lists opponents).
    await screen.findByRole('button', { name: /^call$/i });

    // The wire payload this proves: SocketContext.sendAction emits
    // { action: 'call', amount: undefined } over the real socket, the server
    // applies it, and pushes a fresh `state` back that moves the acting
    // player on to bob.
    await userEvent.click(screen.getByRole('button', { name: /^call$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('player-info-1')).toHaveAttribute('data-active', 'true');
    });
    // It's no longer alice's turn, so her action controls should be gone.
    expect(screen.queryByRole('button', { name: /^call$/i })).not.toBeInTheDocument();
  });

  it('an illegal action (checking while facing a bet) surfaces the error banner', async () => {
    const { App } = ctx;
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    await within(screen.getByTestId('player-info-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-info-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    // Alice (small blind, first to act preflop heads-up) still owes the
    // difference to the big blind -- checking here is illegal and the
    // server rejects it via an `error` event instead of a `state` update.
    await screen.findByRole('button', { name: /^check$/i });
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot check while facing a bet/i);
  });
});
