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
    // Player 1: drives the real App component through the DOM.
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    // Player 2: a second real socket.io-client connection (not through React --
    // this is the same "opponent" role packages/server's own tests use).
    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    // Wait for alice's real App instance to reflect bob's join before moving
    // on: the server broadcasts a fresh `state` to alice's socket the moment
    // bob's side of the wire progresses, and this findBy* query (like
    // userEvent's own clicks) is act-wrapped by testing-library, so it settles
    // that state update instead of leaving it to land as an unwrapped one
    // later.
    await within(screen.getByTestId('seat-1')).findByText('bob');

    bobSocket.emit('ready');
    await within(screen.getByTestId('seat-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('hole-cards-0').querySelectorAll('img')).toHaveLength(2);
    });
    // Own hole cards are real card images; the opponent's are face-down.
    expect(screen.getAllByRole('img', { name: /face-down/i }).length).toBeGreaterThan(0);
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
    await within(screen.getByTestId('seat-1')).findByText('bob');

    bobSocket.emit('ready');
    await within(screen.getByTestId('seat-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    // On the first hand, seat 0 (alice) is the button/small blind and acts
    // first preflop in this heads-up table (see table.ts's nextButtonSeatIndex
    // / holdemHand.ts's heads-up firstToActIndex = buttonIndex) -- alice's own
    // action controls appear once the server confirms it's her turn.
    await screen.findByRole('button', { name: /^call$/i });
    expect(screen.getByTestId('seat-0').className).toMatch(/bg-amber-500/);

    // The wire payload this proves: SocketContext.sendAction emits
    // { action: 'call', amount: undefined } over the real socket, the server
    // (table.ts submitAction -> HoldemHand.act) applies it, and pushes a
    // fresh `state` back that moves the acting player on to bob.
    await userEvent.click(screen.getByRole('button', { name: /^call$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('seat-1').className).toMatch(/bg-amber-500/);
    });
    expect(screen.getByTestId('seat-0').className).not.toMatch(/bg-amber-500/);
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
    await within(screen.getByTestId('seat-1')).findByText('bob');

    bobSocket.emit('ready');
    await within(screen.getByTestId('seat-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    // Alice (small blind, first to act preflop heads-up) still owes the
    // difference to the big blind -- checking here is illegal
    // ('Cannot check while facing a bet', holdemBetting.ts) and the server
    // rejects it via an `error` event instead of a `state` update.
    await screen.findByRole('button', { name: /^check$/i });
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot check while facing a bet/i);
  });
});
