import type { GameConfigValues } from './gameConfigStore';

export interface EnvConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  adminPassphrase: string;
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

  // Bound to loopback by default: the documented setup puts Tailscale Serve in front, so only
  // tailnet devices reach the game. Listening on every interface exposed the server, and its
  // admin login, to the whole home network (audit I7).
  const host = env.HOST?.trim() || '127.0.0.1';

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of allowedOrigins) {
    let valid = false;
    try {
      valid = new URL(entry).origin === entry;
    } catch {
      valid = false;
    }
    if (!valid) {
      problems.push(`ALLOWED_ORIGINS entry "${entry}" must be an origin such as https://my-pc.tail1234.ts.net (no path or trailing slash)`);
    }
  }

  // Missing used to be the only refusal; .env.example's "change-me" booted fine (audit I7).
  const adminPassphrase = env.ADMIN_PASSPHRASE ?? '';
  if (adminPassphrase.trim() === '') {
    problems.push('ADMIN_PASSPHRASE is not set. No game can be started without it.');
  } else if (adminPassphrase.trim().toLowerCase() === 'change-me') {
    problems.push('ADMIN_PASSPHRASE is still the example value "change-me". Choose your own.');
  } else if (adminPassphrase.length < 8) {
    problems.push('ADMIN_PASSPHRASE must be at least 8 characters.');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid settings in the environment or .env file:\n- ${problems.join('\n- ')}`);
  }
  return { port, host, reconnectGraceMs, configDefaults, allowedOrigins, adminPassphrase };
}
