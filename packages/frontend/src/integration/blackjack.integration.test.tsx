import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import { setupIntegrationServer } from './integrationTestServer';

// Mirrors packages/server/src/integration.test.ts's own setup pattern -- see
// integrationTestServer.ts for the shared fixture this and
// poker.integration.test.tsx both use.

// Same generator as packages/server/src/integration.test.ts's own
// makeDeterministicRandom (that file isn't exported from, so reimplemented
// here rather than reaching into its internals).
function makeDeterministicRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function buildConfig(): TableConfig {
  return {
    gameMode: 'blackjack',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 120_000,
    // NOT Math.random: Table.startHand deals blackjack seat-by-seat in seat
    // order (alice/seat 0 first), and BlackjackRound gives any two-card 21
    // `done: true` at construction, auto-settling the round before any
    // action. Once settled, Table's state view reveals the FULL dealer hand
    // instead of just the upcard (see packages/server/src/table.ts around
    // getStateForSeat's blackjack branch), which would make this test's
    // `dealer-hand` assertion below (expects exactly 1 card, i.e. upcard
    // only) fail on the ~1-in-20 hands where alice is dealt a natural. Seed 2
    // is verified (via a standalone script replaying Table.startHand's exact
    // buildShuffledDeck(6)-per-seat-in-order sequence against this test's own
    // config) to deal alice a 14 and bob a 19 -- neither a natural blackjack
    // -- so the round for seat 0 stays in 'playing' phase and only the
    // upcard is exposed, matching what this test asserts. This mirrors
    // packages/server/src/integration.test.ts's own reason for using a
    // seeded RNG instead of Math.random in its Blackjack test.
    //
    // random is re-created (not reused) on every call: setupIntegrationServer
    // invokes this factory fresh in each test's beforeEach, so a file with
    // more than one test still gets this exact seed-2 determinism per test
    // rather than one test consuming the shared generator's state and the
    // next test silently drawing from wherever seed 2 left off
    // (final-review Minor: RNG-sharing trap).
    random: makeDeterministicRandom(2),
  };
}

const ctx = setupIntegrationServer(buildConfig, 'frontend-blackjack-integration-');

describe('Blackjack end-to-end via App', () => {
  it('two players join and ready up, and each sees their own hand and the shared dealer up-card', async () => {
    const { App } = ctx;
    render(<App />);
    // SocketProvider opens its real socket the instant it mounts and starts
    // in 'connecting' status, which JoinScreen renders as a disabled input
    // ("Joining…" button) until the server's welcome `state` broadcast
    // arrives and moves status to 'entering-name' -- see SocketContext.tsx.
    // Typing into the field before that round-trip completes would be a
    // no-op against a disabled input, so wait for the enabled "Join table"
    // button first.
    await screen.findByRole('button', { name: /^join table$/i });
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /^join table$/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(ctx.serverUrl);
    ctx.bobSocket = bobSocket;
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    // Wait for alice's real App instance to reflect bob's join before moving
    // on -- see poker.integration.test.tsx for why this findBy* sync point
    // (act-wrapped by testing-library) matters here.
    await within(screen.getByTestId('player-1')).findByText('bob', { exact: false });

    bobSocket.emit('ready');
    await within(screen.getByTestId('player-1')).findByText(/^Ready$/);

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('player-0').querySelectorAll('img').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId('dealer-hand').querySelectorAll('img')).toHaveLength(1);
  });
});
