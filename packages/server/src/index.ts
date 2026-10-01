import 'dotenv/config';
import { resolve } from 'node:path';
import { createServer } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import { JsonGameConfigStore } from './gameConfigStore';
import { logUnhandledRejections } from './processSafetyNet';
import { readEnvConfig, type EnvConfig } from './envConfig';
import type { StaticTableConfig } from './socketServer';

logUnhandledRejections();

let envConfig: EnvConfig;
try {
  envConfig = readEnvConfig(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const { configDefaults } = envConfig;

const staticConfig: StaticTableConfig = {
  // Friend-group-sized table: 6 seats for both game modes.
  seatCount: 6,
  reconnectGraceMs: envConfig.reconnectGraceMs,
  random: Math.random,
};

const gameConfigStore = new JsonGameConfigStore(process.env.GAME_CONFIG_PATH ?? './game-config.json', configDefaults);

async function main() {
  const currentConfig = await gameConfigStore.getConfig();
  const playerStore = new JsonPlayerStore(
    process.env.PLAYER_STORE_PATH ?? './balances.json',
    currentConfig.defaultStartingBalance
  );
  const handLog = new JsonlHandLog(process.env.HAND_LOG_PATH ?? './hand.jsonl');
  const { port, host, allowedOrigins, adminPassphrase } = envConfig;
  const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;

  const { httpServer, io } = await createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase, {
    staticDir,
    allowedOrigins,
  });
  httpServer.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}${staticDir ? ` (serving frontend from ${staticDir})` : ''}`);
  });

  // Without this, Ctrl+C (or a service manager's stop signal) just hard-kills
  // the process mid-request with no chance for in-flight sockets to close
  // cleanly. io.close() alone is correct here -- see CreateServerResult's
  // doc comment: it already cascades to closing httpServer, and calling
  // httpServer.close() as well would throw ERR_SERVER_NOT_RUNNING.
  function shutdown(signal: string) {
    console.log(`${signal} received, shutting down...`);
    io.close(() => {
      console.log('Server shut down cleanly.');
      process.exit(0);
    });
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Without this, any rejection inside main() -- a non-ENOENT read failure in
// gameConfigStore.getConfig(), a listen/bind failure -- surfaces only as a
// bare unhandled-rejection stack trace with no indication that startup was
// what failed.
main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
