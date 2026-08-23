import { createServer } from './socketServer';
import { JsonPlayerStore } from './playerStore';
import { JsonlHandLog } from './handLog';
import type { TableConfig } from './table';

const gameMode = process.env.GAME_MODE === 'blackjack' ? 'blackjack' : 'holdem';

// Friend-group-sized table: 6 seats for both game modes.
const config: TableConfig = {
  gameMode,
  seatCount: 6,
  smallBlind: Number(process.env.SMALL_BLIND ?? 5),
  bigBlind: Number(process.env.BIG_BLIND ?? 10),
  blackjackDefaultBet: Number(process.env.BLACKJACK_DEFAULT_BET ?? 25),
  defaultStartingBalance: Number(process.env.DEFAULT_STARTING_BALANCE ?? 1000),
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 120_000),
  random: Math.random,
};

const playerStore = new JsonPlayerStore(
  process.env.PLAYER_STORE_PATH ?? './balances.json',
  config.defaultStartingBalance
);
const handLog = new JsonlHandLog(process.env.HAND_LOG_PATH ?? './hand.jsonl');
const port = Number(process.env.PORT ?? 3000);

createServer(config, playerStore, handLog).then(({ httpServer }) => {
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
