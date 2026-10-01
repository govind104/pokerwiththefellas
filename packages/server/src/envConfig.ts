import type { GameConfigValues } from './gameConfigStore';

export interface EnvConfig {
  port: number;
  reconnectGraceMs: number;
  configDefaults: GameConfigValues;
}

// `Number(process.env.X ?? d)` accepted anything: SMALL_BLIND=abc became NaN and stopped every
// hand from starting, and a blank or negative RECONNECT_GRACE_MS became a 1 ms timer that
// auto-acted for anyone who disconnected (audit I4). Read every value strictly and refuse to
// start on a bad one, the same as a missing ADMIN_PASSPHRASE.
export function readEnvConfig(env: Record<string, string | undefined>): EnvConfig {
  const problems: string[] = [];

  function wholeNumber(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0 || value > max) {
      problems.push(`${name} must be a whole number from 1 to ${max} (got "${raw}")`);
      return fallback;
    }
    return value;
  }

  const port = wholeNumber('PORT', 3000, 65535);
  const reconnectGraceMs = wholeNumber('RECONNECT_GRACE_MS', 120_000);
  const configDefaults: GameConfigValues = {
    smallBlind: wholeNumber('SMALL_BLIND', 5),
    bigBlind: wholeNumber('BIG_BLIND', 10),
    blackjackDefaultBet: wholeNumber('BLACKJACK_DEFAULT_BET', 25),
    defaultStartingBalance: wholeNumber('DEFAULT_STARTING_BALANCE', 1000),
  };
  if (configDefaults.smallBlind > configDefaults.bigBlind) {
    problems.push(
      `SMALL_BLIND (${configDefaults.smallBlind}) can't be larger than BIG_BLIND (${configDefaults.bigBlind})`
    );
  }
  if (problems.length > 0) {
    throw new Error(`Invalid settings in the environment or .env file:\n- ${problems.join('\n- ')}`);
  }
  return { port, reconnectGraceMs, configDefaults };
}
