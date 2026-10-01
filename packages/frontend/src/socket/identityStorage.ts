import { nameKey, normaliseDisplayName } from '@poker-blackjack/server/src/names';

// The reconnect token for each name this browser has sat down under (audit C5), plus the name
// to rejoin with. localStorage, not sessionStorage: the token is the player's claim on their
// name and balance, so it has to outlive the tab. A name→token map rather than one token, so a
// shared laptop can hold several players. Every access is wrapped: storage can be blocked
// (private windows, site-data settings) and the game must still work. A blocked write is kept
// in memory for this tab, so a reconnect within it still presents the token instead of being
// refused as a claimed name; only a reload loses it.
export const IDENTITY_STORAGE_KEY = 'poker-blackjack:identity';

interface StoredIdentity {
  lastName: string | null;
  tokens: Record<string, string>;
}

// Set only while the last write failed, and then the authority: it was built from the stored
// value plus that write, so it is never behind. Cleared by the next write that succeeds, so a
// working localStorage (and a second tab writing to it) stays the source of truth.
let unpersisted: StoredIdentity | null = null;

function read(): StoredIdentity {
  if (unpersisted) {
    return unpersisted;
  }
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
    unpersisted = null;
  } catch {
    unpersisted = identity;
  }
}

// What the server will call this name once it normalises it, which is the key the tokens are
// stored under: a typed "Bob  Smith" must find the token saved for "Bob Smith".
function keyFor(displayName: string): string {
  return nameKey(normaliseDisplayName(displayName) ?? displayName);
}

export function readLastName(): string | null {
  return read().lastName;
}

export function tokenFor(displayName: string): string | undefined {
  const { tokens } = read();
  const key = keyFor(displayName);
  const token = Object.hasOwn(tokens, key) ? tokens[key] : undefined;
  return typeof token === 'string' ? token : undefined;
}

export function rememberIdentity(displayName: string, token: string): void {
  const identity = read();
  write({ lastName: displayName, tokens: { ...identity.tokens, [keyFor(displayName)]: token } });
}

export function forgetLastName(): void {
  write({ ...read(), lastName: null });
}

/** Test-only: drops the in-memory copy so a test that blocked storage does not leak into the next. */
export function resetIdentityMemoryForTests(): void {
  unpersisted = null;
}
