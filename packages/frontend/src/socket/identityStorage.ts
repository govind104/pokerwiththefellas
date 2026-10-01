import { nameKey } from '@poker-blackjack/server/src/names';

// The reconnect token for each name this browser has sat down under (audit C5), plus the name
// to rejoin with. localStorage, not sessionStorage: the token is the player's claim on their
// name and balance, so it has to outlive the tab. A name→token map rather than one token, so a
// shared laptop can hold several players. Every access is wrapped: storage can be blocked
// (private windows, site-data settings) and the game must still work, just without memory.
export const IDENTITY_STORAGE_KEY = 'poker-blackjack:identity';

interface StoredIdentity {
  lastName: string | null;
  tokens: Record<string, string>;
}

function read(): StoredIdentity {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null) {
      const { lastName, tokens } = parsed as Partial<StoredIdentity>;
      return {
        lastName: typeof lastName === 'string' ? lastName : null,
        tokens: typeof tokens === 'object' && tokens !== null ? tokens : {},
      };
    }
  } catch {
    // fall through to empty
  }
  return { lastName: null, tokens: {} };
}

function write(identity: StoredIdentity): void {
  try {
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // storage blocked: nothing to remember with
  }
}

export function readLastName(): string | null {
  return read().lastName;
}

export function tokenFor(displayName: string): string | undefined {
  const { tokens } = read();
  const key = nameKey(displayName);
  const token = Object.hasOwn(tokens, key) ? tokens[key] : undefined;
  return typeof token === 'string' ? token : undefined;
}

export function rememberIdentity(displayName: string, token: string): void {
  const identity = read();
  write({ lastName: displayName, tokens: { ...identity.tokens, [nameKey(displayName)]: token } });
}

export function forgetLastName(): void {
  write({ ...read(), lastName: null });
}
