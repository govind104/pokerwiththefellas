import 'dotenv/config';
import { resolve } from 'node:path';
import { createServer } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore } from './gameConfigStore';
import type { StaticTableConfig } from './socketServer';
import type { GameConfigValues } from './gameConfigStore';

const staticConfig: StaticTableConfig = {
  // Friend-group-sized table: 6 seats for both game modes.
  seatCount: 6,
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 120_000),
  random: Math.random,
  staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined,
};

const configDefaults: GameConfigValues = {
  smallBlind: Number(process.env.SMALL_BLIND ?? 5),
  bigBlind: Number(process.env.BIG_BLIND ?? 10),
  blackjackDefaultBet: Number(process.env.BLACKJACK_DEFAULT_BET ?? 25),
  defaultStartingBalance: Number(process.env.DEFAULT_STARTING_BALANCE ?? 1000),
};

const gameConfigStore = new JsonGameConfigStore(process.env.GAME_CONFIG_PATH ?? './game-config.json', configDefaults);

// Fail fast rather than warn-and-continue. Under the empty-lobby design
// nothing can start without a successful admin login, so a server booted
// without a passphrase is not "degraded" -- it is unusable: it accepts
// connections and shows every client a permanent "waiting for a game to
// start", with the only diagnosis being a console line already scrolled off.
const adminPassphrase = process.env.ADMIN_PASSPHRASE;
if (!adminPassphrase) {
  console.error(
    'ADMIN_PASSPHRASE is not set. No game can ever be started without it, so refusing to start a server ' +
      'that would only ever show clients an empty lobby. Set ADMIN_PASSPHRASE and try again.'
  );
  process.exit(1);
}

async function main() {
  const currentConfig = await gameConfigStore.getConfig();
  const playerStore = new JsonPlayerStore(
    process.env.PLAYER_STORE_PATH ?? './balances.json',
    currentConfig.defaultStartingBalance
  );
  const handLog = new JsonlHandLog(process.env.HAND_LOG_PATH ?? './hand.jsonl');
  const port = Number(process.env.PORT ?? 3000);

  const { httpServer } = await createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase);
  httpServer.listen(port, () => {
    const { staticDir } = staticConfig;
    console.log(`Server listening on port ${port}${staticDir ? ` (serving frontend from ${staticDir})` : ''}`);
  });
}

// Without this, any rejection inside main() -- a non-ENOENT read failure in
// gameConfigStore.getConfig(), a listen/bind failure -- surfaces only as a
// bare unhandled-rejection stack trace with no indication that startup was
// what failed.
main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
