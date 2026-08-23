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
};

const configDefaults: GameConfigValues = {
  smallBlind: Number(process.env.SMALL_BLIND ?? 5),
  bigBlind: Number(process.env.BIG_BLIND ?? 10),
  blackjackDefaultBet: Number(process.env.BLACKJACK_DEFAULT_BET ?? 25),
  defaultStartingBalance: Number(process.env.DEFAULT_STARTING_BALANCE ?? 1000),
};

const gameConfigStore = new JsonGameConfigStore(process.env.GAME_CONFIG_PATH ?? './game-config.json', configDefaults);

const adminPassphrase = process.env.ADMIN_PASSPHRASE;
if (!adminPassphrase) {
  console.warn('ADMIN_PASSPHRASE is not set -- admin controls are unreachable until it is.');
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
    console.log(`Server listening on port ${port}`);
  });
}

main();
