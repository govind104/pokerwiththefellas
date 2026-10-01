# Identity and Exposure (audit item 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix audit findings C5, I7, I9, M8 and M11 from
`docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md` §3: a display name is owned by
the browser that first sat down under it, the client learns its seat from the server, names are
normalised, the server is reachable only through Tailscale, and admin access is harder to guess and
survives a reconnect.

**Architecture:** Server side, a new `names.ts` normalises names and gives a case-insensitive key;
`JsonPlayerStore` moves to a v2 `balances.json` that keeps each name's balance and a SHA-256 hash of
its reconnect token in one atomic file; `socketServer.ts` checks the token on `join`, sends the token
back in a new `identity` event, puts `mySeatIndex` in every per-socket state, lets a valid token take
over a seat held by another socket, and adds an admin "release name". Admin login gets a per-IP
attempt limiter, a constant-time compare and an in-memory admin session token that the client sends
in the socket.io handshake `auth` on every reconnect. `envConfig.ts` adds `HOST` (default
`127.0.0.1`), `ALLOWED_ORIGINS` and the passphrase rules; socket.io's `cors: '*'` is replaced by an
Origin check in `allowRequest`. Client side, `SocketContext` keeps `{ lastName, tokens }` in
localStorage, trusts `mySeatIndex`, and gains a `replaced` status.

**Tech Stack:** TypeScript, Node `node:crypto`, socket.io 4.8 (server + client), React 18, Vitest,
Testing Library.

## Global Constraints

Decisions made with the user on 2026-10-01 (do not change without asking):
- Reconnect tokens are kept in the browser's **localStorage**, as a name→token map plus the last
  name used, under the key `poker-blackjack:identity`.
- A name that has a balance but no token (every existing player on first run, any name after an
  admin release) is **claimed by the first join** under it.
- Tokens **never expire**. The admin's "Release name" forgets a name's token and keeps its balance.
- A join with the **correct token** for a seat that is still connected **takes the seat over**; the
  old socket is unmapped and told `code: 'replaced'`, and that client must not auto-rejoin.
- The server binds to **`HOST`, default `127.0.0.1`**; the documented setup is Tailscale Serve.

Other constraints:
- Every task is test-first. When a new test passes at once (coverage for code that already works),
  temporarily remove the code it guards and watch it fail, then restore it.
- Names: at most 32 characters after normalisation (the existing server bound).
- Tokens: 32 random bytes, base64url (43 characters). Only `sha256(token)` in hex is written to disk.
  Server accepts a `token` only if it is a string of at most 128 characters; anything else is treated
  as no token.
- Admin passphrase: refuse to boot if unset, equal to `change-me` (any case, trimmed), or shorter
  than 8 characters.
- Admin login limit: 5 wrong passphrases from one address → locked for 60 s, then 5 more.
- Admin session tokens live in server memory only (a restart logs every admin out) and are kept in the
  client's **sessionStorage** under `poker-blackjack:adminToken` (one tab, gone when it closes).
- Run commands from the repo root. Tests: `npm test --workspace=@poker-blackjack/server` and
  `npm test --workspace=@poker-blackjack/frontend`; a single file:
  `npx vitest run <path> --root packages/<pkg>`. Typecheck: `npm run typecheck`.
- Ask the user before every commit (`git add` + `git commit` steps below are run only after a yes).
  Never push.
- Code comments: match the surrounding files (they explain *why*, and cite the audit ID).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/server/src/names.ts` | create | `normaliseDisplayName`, `nameKey`, `sameName`, `MAX_DISPLAY_NAME_LENGTH` |
| `packages/server/src/names.test.ts` | create | |
| `packages/server/src/playerStore.ts` | modify | v2 file format, `IdentityStore` (`checkToken`, `issueToken`, `releaseName`) |
| `packages/server/src/table.ts` | modify | case-insensitive name matching, `connectedSeatIndexOf`, `mySeatIndex` on `AppStateView` |
| `packages/server/src/protocol.ts` | modify | `token` on join, `identity`, `code` on errors, `adminReleaseName`, `adminNotice`, admin login result fields |
| `packages/server/src/socketServer.ts` | modify | token check, takeover, `mySeatIndex`, release, admin login limit + session token, Origin check |
| `packages/server/src/loginLimiter.ts` | create | per-key failure counter with lockout |
| `packages/server/src/originCheck.ts` | create | `isAllowedOrigin(headers, allowedOrigins)` |
| `packages/server/src/envConfig.ts` | modify | `host`, `allowedOrigins`, `adminPassphrase` |
| `packages/server/src/index.ts` | modify | listen on `host`; passphrase check moves to envConfig |
| `packages/server/src/testHelpers.ts` | modify | `joinAndGetToken` |
| `packages/frontend/src/socket/identityStorage.ts` | create | localStorage name→token map |
| `packages/frontend/src/socket/SocketContext.tsx` | modify | token on join, `mySeatIndex`, `replaced`, admin token, notices |
| `packages/frontend/src/App.tsx` | modify | `mySeatIndex` from the server; `replaced` screen |
| `packages/frontend/src/components/JoinScreen.tsx` | modify | `maxLength` |
| `packages/frontend/src/components/AdminPanel.tsx` | modify | "Release a name" form + notice |
| `packages/frontend/vite.config.ts` | modify | proxy to `127.0.0.1` |
| `packages/server/.env.example`, `docs/HOSTING.md`, `README.md`, `.gitignore`, `scripts/playtest/bots.cjs`, `HANDOFF.md` | modify | docs and tooling |

---

### Task 1: Name normalisation (M8)

**Files:**
- Create: `packages/server/src/names.ts`, `packages/server/src/names.test.ts`
- Modify: `packages/server/src/table.ts` (`adminSetBalance` ~197, `join` ~218 and ~233, `reconnect` ~340)
- Modify: `packages/server/src/socketServer.ts` (`isValidDisplayName` ~52, `join` handler ~216, `adminAdjustBalance` ~406)
- Modify: `packages/frontend/src/components/JoinScreen.tsx` (~26)
- Test: `packages/server/src/table.test.ts`, `packages/server/src/socketServer.test.ts`, `packages/frontend/src/components/JoinScreen.test.tsx`

**Interfaces:**
- Produces: `normaliseDisplayName(raw: unknown): string | null`, `nameKey(name: string): string`,
  `sameName(a: string | null | undefined, b: string): boolean`, `MAX_DISPLAY_NAME_LENGTH = 32`.
  Importable from the frontend as `@poker-blackjack/server/src/names` (pure TS, no Node imports).

- [x] **Step 1: Write the failing unit tests** — `packages/server/src/names.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normaliseDisplayName, nameKey, sameName, MAX_DISPLAY_NAME_LENGTH } from './names';

describe('normaliseDisplayName (audit M8)', () => {
  it.each([
    ['  alice  ', 'alice'],
    ['ali​ce', 'alice'], // zero-width space
    ['‮evil', 'evil'], // right-to-left override
    ['a\u0007b', 'ab'], // control character
    ['a \t\n  b', 'a b'],
    ['Ｂｏｂ', 'Bob'], // full-width letters (NFKC)
    ['Bob', 'Bob'], // case is kept for display
  ])('normalises %j to %j', (raw, expected) => {
    expect(normaliseDisplayName(raw)).toBe(expected);
  });

  it.each([[''], ['   '], ['​​'], [42], [null], [undefined], [{}], ['x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)]])(
    'rejects %j',
    (raw) => {
      expect(normaliseDisplayName(raw)).toBeNull();
    }
  );

  it('accepts a name of exactly the maximum length', () => {
    expect(normaliseDisplayName('x'.repeat(MAX_DISPLAY_NAME_LENGTH))).toBe('x'.repeat(MAX_DISPLAY_NAME_LENGTH));
  });
});

describe('nameKey / sameName', () => {
  it('ignores case', () => {
    expect(nameKey('Bob')).toBe(nameKey('bob'));
    expect(sameName('ALICE', 'alice')).toBe(true);
  });

  it('treats null and different names as different', () => {
    expect(sameName(null, 'alice')).toBe(false);
    expect(sameName('alice', 'alicia')).toBe(false);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/names.test.ts --root packages/server`
Expected: FAIL, cannot resolve `./names`.

- [x] **Step 3: Implement** — `packages/server/src/names.ts`

```ts
// A display name is the only identity players see, so two names that look the same must be the
// same player (audit M8): "Bob" and "bob", or "alice" with a zero-width space in it, used to be
// separate accounts with separate balances. Pure TypeScript with no Node imports: the frontend
// imports it too, so both sides fold a name the same way.

export const MAX_DISPLAY_NAME_LENGTH = 32;

/** The name as it will be shown and stored, or null if nothing usable is left. */
export function normaliseDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4 * MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }
  const cleaned = raw
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    // Unicode "Other": control characters, format characters (zero-width and bidi marks),
    // private-use and unassigned code points.
    .replace(/\p{C}/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (cleaned.length === 0 || cleaned.length > MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }
  return cleaned;
}

/** Case-insensitive key: two names with the same key are the same player. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

export function sameName(a: string | null | undefined, b: string): boolean {
  return a !== null && a !== undefined && nameKey(a) === nameKey(b);
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npx vitest run src/names.test.ts --root packages/server`
Expected: PASS.

- [x] **Step 5: Failing table and socket tests**

Add to `packages/server/src/table.test.ts`, inside `describe('Table seats')` (`makeTable` is the file's factory, ~line 187):

```ts
it('treats names that differ only in case as the same player (audit M8)', async () => {
  const { table } = makeTable();
  await table.join('Bob');
  await expect(table.join('bob')).rejects.toThrow('already seated');
  table.disconnect(0);
  expect(table.reconnect('BOB')).toBe(0);
});
```

Add to `packages/server/src/socketServer.test.ts`, in the first `describe('socketServer')`:

```ts
it('stores the normalised name, not the raw one (audit M8)', async () => {
  const admin = connect();
  await startGameAsAdmin(admin, 'holdem');
  const socket = connect();
  socket.emit('join', { displayName: '  ali​ce ' });
  const state = await waitForSeated(socket, 'alice');
  expect(state.table!.seats[0]?.displayName).toBe('alice');
});
```

Add to `packages/frontend/src/components/JoinScreen.test.tsx`:

```ts
it('limits the name input to the server maximum (audit M8)', () => {
  renderWithContext();
  expect(screen.getByLabelText(/display name/i)).toHaveAttribute('maxLength', '32');
});
```

Run: `npm test --workspace=@poker-blackjack/server` and
`npx vitest run src/components/JoinScreen.test.tsx --root packages/frontend`
Expected: the three new tests FAIL (second `join` succeeds; seat name is `'  ali​ce '`; no maxLength).

- [x] **Step 6: Wire it in**

`table.ts`: `import { sameName } from './names';` and replace each exact name comparison:
- `adminSetBalance`: `this.seats.find((s) => sameName(s?.displayName, displayName))`
- `join` (both checks): `this.seats.some((s) => sameName(s?.displayName, displayName))`
- `reconnect`: `this.seats.find((s) => s !== null && sameName(s.displayName, displayName) && !s.connected)`

Leave the Hold'em `playerId` comparisons (`actingPlayerId === seat.displayName`) alone: `playerId`
is always copied from the seat's own `displayName`, so they are already exact.

`socketServer.ts`: delete `isValidDisplayName` and its comment; `import { normaliseDisplayName } from './names';`.
In `join`:

```ts
const displayName = normaliseDisplayName(payload?.displayName);
if (!displayName) {
  socket.emit('error', { message: 'Invalid display name' });
  return;
}
```

and use `displayName` (not `payload.displayName`) in the `reconnect`/`join` calls. Same in
`adminAdjustBalance`: `const displayName = normaliseDisplayName(payload?.displayName); if (!displayName) { rejectAdmin('Invalid display name'); return; }`
and pass `displayName` to the error message and `table.adminSetBalance`.

`JoinScreen.tsx`: `import { MAX_DISPLAY_NAME_LENGTH } from '@poker-blackjack/server/src/names';` and add
`maxLength={MAX_DISPLAY_NAME_LENGTH}` to the `<input id="displayName">`.

- [x] **Step 7: Run all tests, typecheck and the frontend build**

Run: `npm test` then `npm run typecheck` then `npm run build --workspace=@poker-blackjack/frontend`
Expected: all PASS; the build proves the frontend can bundle the server's `names.ts`.
If the build cannot resolve the import, move `names.ts` to `packages/game-engine/src/names.ts`,
export it from the engine's index, and import it from `@poker-blackjack/game-engine` on both sides.

- [x] **Step 8: Commit (after the user says yes)**

```bash
git add packages/server/src/names.ts packages/server/src/names.test.ts packages/server/src/table.ts packages/server/src/table.test.ts packages/server/src/socketServer.ts packages/server/src/socketServer.test.ts packages/frontend/src/components/JoinScreen.tsx packages/frontend/src/components/JoinScreen.test.tsx
git commit -m "fix: normalise display names and match them case-insensitively (audit M8)"
```

---

### Task 2: Player store v2 with name tokens (C5, storage)

**Files:**
- Modify: `packages/server/src/playerStore.ts`
- Test: `packages/server/src/playerStore.test.ts` (existing test at ~142 asserts the v1 file shape)

**Interfaces:**
- Consumes: `nameKey` from Task 1.
- Produces:

```ts
export type TokenCheck = 'match' | 'unclaimed' | 'mismatch';
export interface IdentityStore {
  checkToken(displayName: string, token: string | undefined): Promise<TokenCheck>;
  issueToken(displayName: string): Promise<string>; // rejects if the name already has a token
  releaseName(displayName: string): Promise<boolean>; // false if the name was never stored
}
export class JsonPlayerStore implements PlayerStore, IdentityStore
```

`PlayerStore` itself does not change, so the table tests' fakes are untouched.

On-disk v2 format (`balances.json`): `{ "<nameKey>": { "name": "Bob", "balance": 975, "tokenHash": "<64 hex>" } }`;
`balance` and `tokenHash` are optional. A v1 file (`{ "Bob": 975 }`) is read as v2; the first time
one is read it is copied to `balances.json.v1-backup` (never overwritten).

- [x] **Step 1: Write the failing tests** — append to `playerStore.test.ts` (inside the existing `describe`)

```ts
describe('v2 format and name tokens (audit C5)', () => {
  it('looks names up case-insensitively', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('Bob', 640);
    await expect(store.getBalance('bob')).resolves.toBe(640);
  });

  it('reads a v1 file, keeps a backup of it, and writes v2', async () => {
    await writeFile(filePath, JSON.stringify({ Bob: 700, alice: 900 }), 'utf-8');
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('bob')).resolves.toBe(700);
    await store.setBalance('alice', 950);
    expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({
      bob: { name: 'Bob', balance: 700 },
      alice: { name: 'alice', balance: 950 },
    });
    expect(JSON.parse(await readFile(`${filePath}.v1-backup`, 'utf-8'))).toEqual({ Bob: 700, alice: 900 });
  });

  it('keeps the larger balance when two v1 names differ only in case', async () => {
    await writeFile(filePath, JSON.stringify({ Bob: 700, bob: 900 }), 'utf-8');
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('BOB')).resolves.toBe(900);
  });

  it('reports a name with no token as unclaimed, whether or not it has a balance', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.checkToken('nobody', undefined)).resolves.toBe('unclaimed');
    await store.setBalance('alice', 500);
    await expect(store.checkToken('alice', 'anything')).resolves.toBe('unclaimed');
  });

  it('issues a token that then matches, case-insensitively, and nothing else does', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    const token = await store.issueToken('Alice');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(store.checkToken('alice', token)).resolves.toBe('match');
    await expect(store.checkToken('alice', 'wrong')).resolves.toBe('mismatch');
    await expect(store.checkToken('alice', undefined)).resolves.toBe('mismatch');
  });

  it('refuses to issue a second token for a claimed name', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.issueToken('alice');
    await expect(store.issueToken('ALICE')).rejects.toThrow('already claimed');
  });

  it('writes only a hash of the token, and keeps it across instances', async () => {
    const token = await new JsonPlayerStore(filePath, 1000).issueToken('alice');
    expect(await readFile(filePath, 'utf-8')).not.toContain(token);
    await expect(new JsonPlayerStore(filePath, 1000).checkToken('alice', token)).resolves.toBe('match');
  });

  it('does not change the balance when a token is issued', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 333);
    await store.issueToken('alice');
    await expect(store.getBalance('alice')).resolves.toBe(333);
  });

  it('releasing a name forgets its token and keeps its balance', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 420);
    const token = await store.issueToken('alice');
    await expect(store.releaseName('Alice')).resolves.toBe(true);
    await expect(store.checkToken('alice', token)).resolves.toBe('unclaimed');
    await expect(store.getBalance('alice')).resolves.toBe(420);
  });

  it('releasing a name that was never stored returns false', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.releaseName('ghost')).resolves.toBe(false);
  });
});
```

Update the existing assertion at ~line 144 from `{ alice: 975, bob: 1000 }` to
`{ alice: { name: 'alice', balance: 975 }, bob: { name: 'bob', balance: 1000 } }`.

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/playerStore.test.ts --root packages/server`
Expected: FAIL (`checkToken is not a function`, v1 shape on disk).

- [x] **Step 3: Implement** — in `playerStore.ts`

Imports: `import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';`,
add `copyFile` and `constants` (`import { constants } from 'node:fs';`) to the fs imports,
`import { nameKey } from './names';`.

Add after `PlayerStore`:

```ts
export type TokenCheck = 'match' | 'unclaimed' | 'mismatch';

// Who owns a display name (audit C5). The first browser to sit down under a name gets a random
// token and keeps it; from then on only that token can take the seat or reconnect to it. A name
// with no token (new, from before tokens existed, or released by the admin) is claimed by the
// next join. Kept in the balances file so a balance and its owner are written atomically together.
export interface IdentityStore {
  checkToken(displayName: string, token: string | undefined): Promise<TokenCheck>;
  /** Binds a new token to a name that has none and returns it; rejects if the name has one. */
  issueToken(displayName: string): Promise<string>;
  /** Forgets the name's token and keeps its balance. False if the name was never stored. */
  releaseName(displayName: string): Promise<boolean>;
}

interface PlayerRecord {
  name: string;
  balance?: number;
  tokenHash?: string;
}

type PlayerMap = Record<string, PlayerRecord>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

Replace `type BalanceMap` with `PlayerMap` throughout. `class JsonPlayerStore implements PlayerStore, IdentityStore`,
add `private v1BackupDone = false;`.

In `readAll`, replace the `JSON.parse` + `Object.assign` block (keep the comment about the
null-prototype object and the whole corrupt-file `catch`):

```ts
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // ... existing corrupt-file handling unchanged (rename aside, return empty map) ...
    }
    return this.toPlayerMap(parsed);
  }

  // Reads both formats. v1 was `{ "<raw name>": balance }`, keyed by the exact name typed, so
  // "Bob" and "bob" could both exist; v2 is keyed by nameKey. The first v1 read is copied aside
  // first, because the next write replaces it with v2 and a v1 case collision keeps only one entry.
  private async toPlayerMap(parsed: unknown): Promise<PlayerMap> {
    const data = Object.create(null) as PlayerMap;
    if (typeof parsed !== 'object' || parsed === null) {
      return data;
    }
    let sawV1 = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') {
        sawV1 = true;
        const k = nameKey(key);
        const existing = data[k];
        if (existing && (existing.balance ?? 0) >= value) {
          console.warn(`PlayerStore: "${key}" (${value}) and "${existing.name}" are now one player; keeping ${existing.balance}`);
          continue;
        }
        if (existing) {
          console.warn(`PlayerStore: "${existing.name}" (${existing.balance}) and "${key}" are now one player; keeping ${value}`);
        }
        data[k] = { name: key, balance: value };
      } else if (typeof value === 'object' && value !== null && typeof (value as PlayerRecord).name === 'string') {
        const record = value as PlayerRecord;
        data[key] = {
          name: record.name,
          ...(typeof record.balance === 'number' ? { balance: record.balance } : {}),
          ...(typeof record.tokenHash === 'string' ? { tokenHash: record.tokenHash } : {}),
        };
      }
    }
    if (sawV1 && !this.v1BackupDone) {
      try {
        await copyFile(this.filePath, `${this.filePath}.v1-backup`, constants.COPYFILE_EXCL);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          console.error(`PlayerStore: could not back up the old balances file:`, err);
        }
      }
      this.v1BackupDone = true;
    }
    return data;
  }
```

(The corrupt-file branch keeps returning `Object.create(null) as PlayerMap` directly.)

Replace `getBalance`/`setBalance` and add the three identity methods:

```ts
  async getBalance(displayName: string): Promise<number> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      return data[nameKey(displayName)]?.balance ?? this.defaultStartingBalance;
    });
  }

  async setBalance(displayName: string, balance: number): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      const k = nameKey(displayName);
      data[k] = { ...data[k], name: data[k]?.name ?? displayName, balance };
      await this.writeAll(data);
    });
  }

  async checkToken(displayName: string, token: string | undefined): Promise<TokenCheck> {
    return this.enqueue(async () => {
      const stored = (await this.readAll())[nameKey(displayName)]?.tokenHash;
      if (!stored) {
        return 'unclaimed';
      }
      if (token === undefined) {
        return 'mismatch';
      }
      return timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(hashToken(token), 'hex')) ? 'match' : 'mismatch';
    });
  }

  async issueToken(displayName: string): Promise<string> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      const k = nameKey(displayName);
      if (data[k]?.tokenHash) {
        throw new Error(`"${displayName}" is already claimed`);
      }
      const token = randomBytes(32).toString('base64url');
      data[k] = { ...data[k], name: data[k]?.name ?? displayName, tokenHash: hashToken(token) };
      await this.writeAll(data);
      return token;
    });
  }

  async releaseName(displayName: string): Promise<boolean> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      const record = data[nameKey(displayName)];
      if (!record) {
        return false;
      }
      delete record.tokenHash;
      await this.writeAll(data);
      return true;
    });
  }
```

A stored `tokenHash` that is not 64 hex characters would make `timingSafeEqual` throw on a length
mismatch; guard it: `if (!stored || !/^[0-9a-f]{64}$/.test(stored)) return 'unclaimed';` — a
hand-edited, broken hash then behaves like a released name (logged by nobody, by design: the host
edited the file).

- [x] **Step 4: Run to verify they pass**

Run: `npx vitest run src/playerStore.test.ts --root packages/server` then `npm test --workspace=@poker-blackjack/server`
Expected: PASS (including the existing null-prototype and corrupt-file tests).

- [x] **Step 5: Commit (after the user says yes)**

```bash
git add packages/server/src/playerStore.ts packages/server/src/playerStore.test.ts
git commit -m "feat(server): v2 balances file with per-name reconnect tokens (audit C5)"
```

---

### Task 3: Token-checked join, `mySeatIndex`, takeover and release (C5, I9 server side)

**Files:**
- Modify: `packages/server/src/protocol.ts`, `packages/server/src/table.ts` (`AppStateView` ~92, new method near `reconnect` ~339), `packages/server/src/socketServer.ts`, `packages/server/src/testHelpers.ts`
- Test: `packages/server/src/socketServer.test.ts`, `packages/server/src/integration-resilience.test.ts`, `packages/server/src/table.test.ts`

**Interfaces:**
- Consumes: Task 1 `normaliseDisplayName`, `sameName`; Task 2 `IdentityStore`, `TokenCheck`.
- Produces (protocol.ts):

```ts
export interface JoinPayload {
  displayName: string;
  /** From an earlier `identity` event; needed to sit down under a name that is already claimed. */
  token?: string;
}
export interface IdentityPayload {
  displayName: string;
  token: string;
}
export type ErrorCode = 'name-claimed' | 'replaced';
// ErrorPayload gains: code?: ErrorCode;
export interface ReleaseNamePayload {
  displayName: string;
}
export interface AdminNoticePayload {
  message: string;
}
// ClientToServerEvents gains: adminReleaseName: (payload: ReleaseNamePayload) => void;
// ServerToClientEvents gains: identity: (payload: IdentityPayload) => void;
//                             adminNotice: (payload: AdminNoticePayload) => void;
```

- `AppStateView` gains `mySeatIndex: number | null` (this socket's seat; null if it has none).
- `Table.connectedSeatIndexOf(displayName: string): number | null`.
- `createServer(staticConfig, gameConfigStore, playerStore: PlayerStore & IdentityStore, handLog, adminPassphrase, options)`.
- testHelpers: `joinAndGetToken(socket: ClientSocket, displayName: string): Promise<string>`.

- [x] **Step 1: Table method, failing test** — `table.test.ts`

```ts
it('connectedSeatIndexOf finds a connected seat by name, ignoring case', async () => {
  const { table } = makeTable();
  await table.join('alice');
  expect(table.connectedSeatIndexOf('ALICE')).toBe(0);
  table.disconnect(0);
  expect(table.connectedSeatIndexOf('alice')).toBeNull();
  expect(table.connectedSeatIndexOf('bob')).toBeNull();
});
```

Run: `npx vitest run src/table.test.ts --root packages/server` → FAIL (not a function). Then add to `Table`, next to `reconnect`:

```ts
  connectedSeatIndexOf(displayName: string): number | null {
    return this.seats.find((s) => s !== null && s.connected && sameName(s.displayName, displayName))?.seatIndex ?? null;
  }
```

Re-run → PASS.

- [x] **Step 2: Test helper** — `testHelpers.ts`

```ts
import type { IdentityPayload } from './protocol';

// Joins and resolves with the reconnect token the server sends back (audit C5). Any test that
// sits a second socket down under a name already claimed must pass this token in its `join`.
export async function joinAndGetToken(socket: ClientSocket, displayName: string): Promise<string> {
  const identity = waitForEvent<IdentityPayload>(socket, 'identity');
  socket.emit('join', { displayName });
  return (await identity).token;
}
```

- [x] **Step 3: Write the failing socket tests** — new `describe` in `socketServer.test.ts`, reusing the
first describe's `beforeEach`/`afterEach`/`connect` (put it inside `describe('socketServer')` so it
shares them). Add `waitForConnected` and `joinAndGetToken` to the testHelpers import, and
`import type { ErrorPayload } from './protocol';`.

```ts
describe('identity (audit C5, I9)', () => {
  async function seatAliceAndDrop(): Promise<string> {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice = connect();
    const token = await joinAndGetToken(alice, 'alice');
    const dropped = waitForState(admin, (s) => s.table?.seats[0]?.connected === false);
    alice.disconnect();
    await dropped;
    return token;
  }

  it('sends the joining socket a token and its normalised name', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice = connect();
    const identity = waitForEvent<{ displayName: string; token: string }>(alice, 'identity');
    alice.emit('join', { displayName: ' alice ' });
    expect(await identity).toEqual({ displayName: 'alice', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  });

  it("refuses a disconnected player's seat to anyone without the token", async () => {
    await seatAliceAndDrop();
    const mallory = connect();
    const error = waitForEvent<ErrorPayload>(mallory, 'error');
    mallory.emit('join', { displayName: 'ALICE' });
    expect(await error).toMatchObject({ code: 'name-claimed' });
    expect(server.getTable()!.seats[0]?.connected).toBe(false);
  });

  it('gives the seat back to the token holder', async () => {
    const token = await seatAliceAndDrop();
    const back = connect();
    const reconnected = waitForConnected(back, 'alice');
    back.emit('join', { displayName: 'alice', token });
    const state = await reconnected;
    expect(state.mySeatIndex).toBe(0);
  });

  it('tells each socket its own seat, and null to one without a seat', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice = connect();
    await joinAndGetToken(alice, 'alice');
    const bob = connect();
    const bobSeated = waitForState(bob, (s) => s.mySeatIndex === 1);
    const aliceSees = waitForState(alice, (s) => s.mySeatIndex === 0 && s.table?.seats[1]?.displayName === 'bob');
    const adminSees = waitForState(admin, (s) => s.table?.seats[1]?.displayName === 'bob');
    bob.emit('join', { displayName: 'bob' });
    await bobSeated;
    await aliceSees;
    expect((await adminSees).mySeatIndex).toBeNull();
  });

  it('a rejected join on a connected name leaves the socket unseated (I9)', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const ann = connect();
    await joinAndGetToken(ann, 'ann');
    const eve = connect();
    const error = waitForEvent<ErrorPayload>(eve, 'error');
    eve.emit('join', { displayName: 'ann' });
    await error;
    const next = waitForState(eve, () => true);
    admin.emit('adminSetBlinds', { smallBlind: 5, bigBlind: 10 }); // any broadcast
    expect((await next).mySeatIndex).toBeNull();
  });

  it('the token holder takes over a seat still held by another socket', async () => {
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const oldTab = connect();
    const token = await joinAndGetToken(oldTab, 'alice');
    const replaced = waitForEvent<ErrorPayload>(oldTab, 'error');
    const oldTabUnseated = waitForState(oldTab, (s) => s.mySeatIndex === null);
    const newTab = connect();
    const newTabSeated = waitForState(newTab, (s) => s.mySeatIndex === 0);
    newTab.emit('join', { displayName: 'alice', token });
    await newTabSeated;
    expect(await replaced).toMatchObject({ code: 'replaced' });
    await oldTabUnseated;
    const notSeated = waitForEvent<ErrorPayload>(oldTab, 'error');
    oldTab.emit('ready');
    expect((await notSeated).message).toBe('Not seated');
    expect(server.getTable()!.seats[0]?.connected).toBe(true);
  });

  it('claims a pre-token (v1) balance on first join', async () => {
    // Overwrites the balances file this describe's beforeEach store points at; the store reads
    // the file on every call, so the next getBalance sees it.
    await writeFile(join(dir, 'balances.json'), JSON.stringify({ alice: 777 }), 'utf-8');
    const admin = connect();
    await startGameAsAdmin(admin, 'holdem');
    const alice = connect();
    await joinAndGetToken(alice, 'alice');
    expect(server.getTable()!.seats[0]?.balance).toBe(777);
  });

  it('admin release lets the next join take a claimed name, balance included', async () => {
    await seatAliceAndDrop();
    await server.getTable()!.adminSetBalance('alice', 640);
    const admin = connect(); // a second admin socket; the first is inside seatAliceAndDrop
    admin.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
    await waitForEvent(admin, 'adminLoginResult');
    const notice = waitForEvent<{ message: string }>(admin, 'adminNotice');
    admin.emit('adminReleaseName', { displayName: 'Alice' });
    expect((await notice).message).toContain('Alice'); // case is kept for display
    const newDevice = connect();
    const token = await joinAndGetToken(newDevice, 'alice');
    expect(token).toHaveLength(43);
    expect(server.getTable()!.seats[0]).toMatchObject({ connected: true, balance: 640 });
  });

  it('release is admin-only and rejects a name that never played', async () => {
    const player = connect();
    const denied = waitForEvent<ErrorPayload>(player, 'error');
    player.emit('adminReleaseName', { displayName: 'alice' });
    expect(await denied).toEqual({ message: 'Admin only', scope: 'admin' });

    const admin = connect();
    admin.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
    await waitForEvent(admin, 'adminLoginResult');
    const unknown = waitForEvent<ErrorPayload>(admin, 'error');
    admin.emit('adminReleaseName', { displayName: 'ghost' });
    expect((await unknown).message).toContain('ghost');
  });
});
```

Run: `npx vitest run src/socketServer.test.ts --root packages/server`
Expected: the new tests FAIL (no `identity` event, no `mySeatIndex`, mallory gets the seat).

- [x] **Step 4: Implement protocol and `AppStateView`**

Apply the protocol.ts additions from **Interfaces** above (with a one-line *why* comment on `code`:
"lets the client tell a name conflict and a takeover apart from other join errors").
In `table.ts` add to `AppStateView`, after `table`:

```ts
  /** This socket's seat, from the server's socket→seat map (audit I9: the client used to guess
   *  by matching names, so a rejected join could adopt someone else's seat). */
  mySeatIndex: number | null;
```

In `socketServer.ts` `buildAppStateView` add `mySeatIndex: seatIndex,`. Change the parameter type
to `playerStore: PlayerStore & IdentityStore` (import `IdentityStore` as a type).

- [x] **Step 5: Implement the join handler** — replace the `try` block of `socket.on('join')`:

```ts
      const token = typeof payload?.token === 'string' && payload.token.length <= 128 ? payload.token : undefined;
      const joinedTable = table;
      try {
        const tokenCheck = await playerStore.checkToken(displayName, token);
        if (tokenCheck === 'mismatch') {
          socket.emit('error', {
            message: `"${displayName}" belongs to another player. If it's yours, ask the admin to release the name.`,
            code: 'name-claimed',
          });
          return;
        }
        if (table !== joinedTable) {
          socket.emit('error', { message: 'The game changed while you were joining -- please join again' });
          return;
        }
        // The token proves this is the same player, so a seat still held by another socket (a
        // second tab, or a phone whose old connection has not timed out yet) moves to this one.
        const heldSeatIndex = tokenCheck === 'match' ? joinedTable.connectedSeatIndexOf(displayName) : null;
        if (heldSeatIndex !== null) {
          for (const [otherSocketId, otherSeatIndex] of seatBySocketId) {
            if (otherSeatIndex === heldSeatIndex && otherSocketId !== socket.id) {
              seatBySocketId.delete(otherSocketId);
              io.sockets.sockets
                .get(otherSocketId)
                ?.emit('error', { message: 'You opened the game in another tab or device.', code: 'replaced' });
            }
          }
        }
        const seatIndex =
          heldSeatIndex ?? joinedTable.reconnect(displayName) ?? (await joinedTable.join(displayName));
        if (table !== joinedTable) {
          socket.emit('error', { message: 'The game changed while you were joining -- please join again' });
          return;
        }
        // ... the existing previousSeatIndex and !socket.connected blocks, unchanged ...
        seatBySocketId.set(socket.id, seatIndex);
        const seatName = joinedTable.seats[seatIndex]!.displayName;
        let identityToken = token;
        if (tokenCheck === 'unclaimed') {
          try {
            identityToken = await playerStore.issueToken(seatName);
          } catch (err) {
            // The player is seated either way; without a token the name stays unclaimed and
            // the next join under it claims it.
            console.error(`Could not issue a token for "${seatName}":`, err);
            identityToken = undefined;
          }
        }
        if (identityToken !== undefined) {
          socket.emit('identity', { displayName: seatName, token: identityToken });
        }
        broadcast();
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
```

The `table !== joinedTable` check after `checkToken` replaces nothing; the existing one after
`join` stays. Use `joinedTable` (not `table`) in the `previousSeatIndex`/`!socket.connected` blocks
(they are the same object after the check; this just reads clearly).

- [x] **Step 6: Implement `adminReleaseName`** — after `adminAdjustBalance`:

```ts
    socket.on('adminReleaseName', adminHandler(async (payload: ReleaseNamePayload) => {
      if (!isAdmin()) return;
      const displayName = normaliseDisplayName(payload?.displayName);
      if (!displayName) {
        rejectAdmin('Invalid display name');
        return;
      }
      // Balance is kept; only the token goes, so a player who lost their browser data can
      // claim their name (and chips) again from a new device.
      if (!(await playerStore.releaseName(displayName))) {
        rejectAdmin(`No player named "${displayName}" has played here`);
        return;
      }
      socket.emit('adminNotice', {
        message: `Released "${displayName}": the next person to join under that name gets it, with its balance.`,
      });
    }));
```

- [x] **Step 7: Update existing tests that sit a name down twice**

Run: `npm test --workspace=@poker-blackjack/server`. Every failure with
`belongs to another player` is a test that rejoins a claimed name without its token. Fix each by
taking the token from the first join and passing it on the second:
- `integration-resilience.test.ts` ~62-90: replace `alice.emit('join', { displayName: 'alice' }); await waitForSeated(alice, 'alice');`
  with `const aliceToken = await joinAndGetToken(alice, 'alice');` and the reconnect emit with
  `aliceReconnect.emit('join', { displayName: 'alice', token: aliceToken });`.
- `integration-resilience.test.ts` ~150-185 (crash recovery): same for bob (`bobToken`); the token
  survives the restart because it is in `balances.json`.
- Any `socketServer.test.ts` test that rejoins after `adminSwitchMode` with the same socket: pass the token likewise.
- `ControllablePlayerStore` (`socketServer.test.ts` ~461) must implement `IdentityStore`:

```ts
  private tokens = new Map<string, string>();
  async checkToken(displayName: string, token: string | undefined): Promise<TokenCheck> {
    const stored = this.tokens.get(displayName.toLowerCase());
    if (stored === undefined) return 'unclaimed';
    return token === stored ? 'match' : 'mismatch';
  }
  async issueToken(displayName: string): Promise<string> {
    const token = `token-${displayName.toLowerCase()}`;
    this.tokens.set(displayName.toLowerCase(), token);
    return token;
  }
  async releaseName(displayName: string): Promise<boolean> {
    return this.tokens.delete(displayName.toLowerCase());
  }
```

(`class ControllablePlayerStore implements PlayerStore, IdentityStore`; import the two types.)
Do not change what any existing test asserts; only how it rejoins.

- [x] **Step 8: Run everything**

Run: `npm test --workspace=@poker-blackjack/server` and `npm run typecheck`
Expected: PASS. (The frontend typecheck may now fail on `mySeatIndex` missing from fixtures; that is Task 6. If so, run only `npm run typecheck --workspace=@poker-blackjack/server` here.)
Check the takeover test guards something: comment out the `for` loop that unmaps the old socket and
confirm "the token holder takes over" fails; restore.

- [x] **Step 9: Commit (after the user says yes)**

```bash
git add packages/server/src
git commit -m "fix(server): reconnect tokens, server-sent mySeatIndex, seat takeover and admin name release (audit C5, I9)"
```

---

### Task 4: Admin login limit, constant-time compare, admin session that survives reconnects (I7 part, M11)

**Files:**
- Create: `packages/server/src/loginLimiter.ts`, `packages/server/src/loginLimiter.test.ts`
- Modify: `packages/server/src/protocol.ts` (`AdminLoginResultPayload`), `packages/server/src/socketServer.ts` (`adminLogin` ~294, `connection` ~205, `CreateServerOptions` ~34)
- Test: `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AttemptLimiter {
  retryAfterMs(key: string): number; // 0 = may try now
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
}
export function createAttemptLimiter(options?: { maxFailures?: number; lockoutMs?: number; now?: () => number }): AttemptLimiter;
// protocol.ts
export interface AdminLoginResultPayload {
  success: boolean;
  /** On success: send back in the socket.io handshake `auth.adminToken` to stay admin after a reconnect. */
  adminToken?: string;
  /** Set when refused because of too many wrong passphrases. */
  retryAfterMs?: number;
}
// CreateServerOptions gains: adminLoginLimiter?: AttemptLimiter;
```

- [x] **Step 1: Failing limiter tests** — `loginLimiter.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createAttemptLimiter } from './loginLimiter';

describe('createAttemptLimiter (audit I7)', () => {
  function setup() {
    let time = 1_000_000;
    const limiter = createAttemptLimiter({ maxFailures: 3, lockoutMs: 60_000, now: () => time });
    return { limiter, advance: (ms: number) => (time += ms) };
  }

  it('allows attempts until the limit, then locks for the lockout', () => {
    const { limiter, advance } = setup();
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(60_000);
    advance(59_000);
    expect(limiter.retryAfterMs('a')).toBe(1_000);
    advance(1_000);
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('counts each key separately', () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure('a');
    expect(limiter.retryAfterMs('b')).toBe(0);
  });

  it('a success clears the count', () => {
    const { limiter } = setup();
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    limiter.recordSuccess('a');
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
  });
});
```

Run: `npx vitest run src/loginLimiter.test.ts --root packages/server` → FAIL (module missing).

- [x] **Step 2: Implement** — `loginLimiter.ts`

```ts
// Brute-force guard for the admin passphrase (audit I7: 5000 wrong guesses were answered in
// 198 ms). Keyed by client address. Behind Tailscale Serve every client arrives from 127.0.0.1,
// so the limit is effectively shared by everyone; that is acceptable, since only the host logs in.
export interface AttemptLimiter {
  /** 0 if an attempt may be made now, otherwise the milliseconds until one may. */
  retryAfterMs(key: string): number;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
}

export function createAttemptLimiter({
  maxFailures = 5,
  lockoutMs = 60_000,
  now = Date.now,
}: { maxFailures?: number; lockoutMs?: number; now?: () => number } = {}): AttemptLimiter {
  const entries = new Map<string, { failures: number; lockedUntil: number }>();
  return {
    retryAfterMs(key) {
      const entry = entries.get(key);
      return entry ? Math.max(0, entry.lockedUntil - now()) : 0;
    },
    recordFailure(key) {
      const entry = entries.get(key) ?? { failures: 0, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= maxFailures) {
        entry.failures = 0;
        entry.lockedUntil = now() + lockoutMs;
      }
      entries.set(key, entry);
    },
    recordSuccess(key) {
      entries.delete(key);
    },
  };
}
```

Run → PASS.

- [x] **Step 3: Failing server tests** — in `socketServer.test.ts`. This needs its own server so it
can inject a limiter with a fake clock; add a new top-level `describe` with the same
`beforeEach`/`afterEach` shape as `describe('socketServer')`, passing
`{ adminLoginLimiter: createAttemptLimiter({ maxFailures: 3, lockoutMs: 60_000, now: () => clock }) }`
as the sixth `createServer` argument, with `let clock = 0;` reset in `beforeEach`.

```ts
describe('admin login (audit I7, M11)', () => {
  // ... beforeEach/afterEach/connect as described above ...

  it('locks out after too many wrong passphrases, even for the right one', async () => {
    const socket = connect();
    for (let i = 0; i < 3; i++) {
      socket.emit('adminLogin', { passphrase: 'wrong' });
      expect(await waitForEvent(socket, 'adminLoginResult')).toEqual({ success: false });
    }
    socket.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
    expect(await waitForEvent(socket, 'adminLoginResult')).toEqual({ success: false, retryAfterMs: 60_000 });
    clock += 60_000;
    socket.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
    expect(await waitForEvent(socket, 'adminLoginResult')).toMatchObject({ success: true });
  });

  it('rejects a non-string passphrase without throwing', async () => {
    const socket = connect();
    socket.emit('adminLogin', { passphrase: 42 as unknown as string });
    expect(await waitForEvent(socket, 'adminLoginResult')).toEqual({ success: false });
  });

  it('a new connection that presents the admin token is admin from its first state', async () => {
    const first = connect();
    first.emit('adminLogin', { passphrase: ADMIN_PASSPHRASE });
    const { adminToken } = await waitForEvent<{ success: boolean; adminToken: string }>(first, 'adminLoginResult');
    expect(adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const second = ioClient(`http://localhost:${port}`, { transports: ['websocket'], auth: { adminToken } });
    clients.push(second);
    expect((await waitForEvent<AppStateView>(second, 'state')).isAdmin).toBe(true);
  });

  it('an unknown admin token gives no admin rights', async () => {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], auth: { adminToken: 'made-up' } });
    clients.push(socket);
    expect((await waitForEvent<AppStateView>(socket, 'state')).isAdmin).toBe(false);
  });
});
```

Run: `npx vitest run src/socketServer.test.ts --root packages/server` → FAIL.

- [x] **Step 4: Implement** — `socketServer.ts`

Imports: `import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';`,
`import { createAttemptLimiter, type AttemptLimiter } from './loginLimiter';`.
Add `adminLoginLimiter?: AttemptLimiter;` to `CreateServerOptions` with a comment ("injectable so
tests can drive the lockout clock"). In `createServer`:

```ts
  const { staticDir, adminLoginLimiter = createAttemptLimiter() } = options;
  // ...
  // Admin session tokens, issued on a successful login and sent back by the client in the
  // handshake `auth` on every (re)connect, so a wifi blip no longer logs the admin out (audit
  // M11). Memory only: a server restart logs every admin out, which is fine.
  const adminTokens = new Set<string>();
```

Module-level helper:

```ts
// Constant-time, so the reply time doesn't reveal how much of a guess was right.
function passphraseMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
```

At the top of the `connection` handler, before the welcome emit:

```ts
    const resumeToken: unknown = socket.handshake.auth?.adminToken;
    if (typeof resumeToken === 'string' && adminTokens.has(resumeToken)) {
      adminSocketIds.add(socket.id);
    }
    socket.emit('state', buildAppStateView(socket.id, null));
```

(Changing the welcome's first argument from `null` to `socket.id` is what makes `isAdmin` true there.)

Replace the `adminLogin` handler:

```ts
    socket.on('adminLogin', (payload: AdminLoginPayload) => {
      const clientKey = socket.handshake.address;
      const retryAfterMs = adminLoginLimiter.retryAfterMs(clientKey);
      if (retryAfterMs > 0) {
        socket.emit('adminLoginResult', { success: false, retryAfterMs });
        return;
      }
      if (!adminPassphrase || !passphraseMatches(payload?.passphrase, adminPassphrase)) {
        adminLoginLimiter.recordFailure(clientKey);
        socket.emit('adminLoginResult', { success: false });
        return;
      }
      adminLoginLimiter.recordSuccess(clientKey);
      adminSocketIds.add(socket.id);
      const adminToken = randomBytes(32).toString('base64url');
      adminTokens.add(adminToken);
      socket.emit('adminLoginResult', { success: true, adminToken });
      broadcast();
    });
```

Update `AdminLoginResultPayload` in protocol.ts as in **Interfaces**.

- [x] **Step 5: Run and check**

Run: `npm test --workspace=@poker-blackjack/server`
Expected: PASS. Existing tests that assert `adminLoginResult` equals `{ success: true }` exactly
must change to `toMatchObject({ success: true })` (they are not wrong, the payload grew).

- [x] **Step 6: Commit (after the user says yes)**

```bash
git add packages/server/src
git commit -m "fix(server): rate-limit admin login and keep admin rights across reconnects (audit I7, M11)"
```

---

### Task 5: Bind address, Origin check, passphrase rules (I7)

**Files:**
- Create: `packages/server/src/originCheck.ts`, `packages/server/src/originCheck.test.ts`
- Modify: `packages/server/src/envConfig.ts`, `packages/server/src/envConfig.test.ts`, `packages/server/src/index.ts`, `packages/server/src/socketServer.ts` (`new SocketIOServer` ~120, `CreateServerOptions`), `packages/frontend/vite.config.ts`, `packages/server/.env.example`
- Test: `packages/server/src/socketServer.test.ts`

**Interfaces:**
- Produces: `isAllowedOrigin(headers: IncomingHttpHeaders, allowedOrigins: readonly string[]): boolean`;
  `EnvConfig` gains `host: string; allowedOrigins: string[]; adminPassphrase: string`;
  `CreateServerOptions` gains `allowedOrigins?: string[]` (default `[]`).

- [x] **Step 1: Failing Origin tests** — `originCheck.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from './originCheck';

describe('isAllowedOrigin (audit I7)', () => {
  it('allows a request with no Origin (same-origin polling, bots, tests)', () => {
    expect(isAllowedOrigin({ host: 'localhost:3000' }, [])).toBe(true);
  });

  it('allows an Origin whose host matches the Host header, ignoring case', () => {
    expect(isAllowedOrigin({ origin: 'http://LocalHost:5173', host: 'localhost:5173' }, [])).toBe(true);
  });

  it('allows an Origin matching X-Forwarded-Host (a reverse proxy such as Tailscale Serve)', () => {
    expect(
      isAllowedOrigin({ origin: 'https://box.tail1.ts.net', host: '127.0.0.1:3000', 'x-forwarded-host': 'box.tail1.ts.net' }, [])
    ).toBe(true);
  });

  it('allows an Origin listed in ALLOWED_ORIGINS', () => {
    expect(isAllowedOrigin({ origin: 'https://box.tail1.ts.net', host: '127.0.0.1:3000' }, ['https://box.tail1.ts.net'])).toBe(true);
  });

  it.each([['http://evil.example'], ['null'], ['not a url']])('refuses Origin %j', (origin) => {
    expect(isAllowedOrigin({ origin, host: 'localhost:3000' }, [])).toBe(false);
  });
});
```

Run: `npx vitest run src/originCheck.test.ts --root packages/server` → FAIL.

- [x] **Step 2: Implement** — `originCheck.ts`

```ts
import type { IncomingHttpHeaders } from 'node:http';

// Replaces socket.io's `cors: { origin: '*' }` (audit I7), which let any web page a player had
// open drive the game through their browser. A browser always sends Origin on a WebSocket
// handshake and on any cross-site request, so a missing Origin is a same-origin polling request
// or a non-browser client (the playtest bots, the tests), and is allowed.
export function isAllowedOrigin(headers: IncomingHttpHeaders, allowedOrigins: readonly string[]): boolean {
  const origin = headers.origin;
  if (origin === undefined) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = headers['x-forwarded-host'];
  const hosts = [headers.host, ...(Array.isArray(forwarded) ? forwarded : [forwarded])];
  return hosts.some((host) => host !== undefined && host.toLowerCase() === originHost);
}
```

Run → PASS.

- [x] **Step 3: Failing socket test** — in `socketServer.test.ts`, a new top-level `describe` that
starts its own server with `{ allowedOrigins: ['https://box.tail1.ts.net'] }` (same setup shape as
the first describe):

```ts
describe('origin check (audit I7)', () => {
  // ... beforeEach/afterEach as in describe('socketServer'), passing { allowedOrigins: ['https://box.tail1.ts.net'] } ...

  function connectWithOrigin(origin: string, transport: 'websocket' | 'polling'): Promise<'connected' | 'refused'> {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: [transport],
      extraHeaders: { origin },
      reconnection: false,
    });
    clients.push(socket);
    return new Promise((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('connect_error', () => resolve('refused'));
    });
  }

  it.each(['websocket', 'polling'] as const)('refuses a cross-site page (%s)', async (transport) => {
    expect(await connectWithOrigin('http://evil.example', transport)).toBe('refused');
  });

  it('accepts its own origin and a listed one', async () => {
    expect(await connectWithOrigin(`http://localhost:${port}`, 'websocket')).toBe('connected');
    expect(await connectWithOrigin('https://box.tail1.ts.net', 'websocket')).toBe('connected');
  });
});
```

Run → FAIL (evil origin connects).

- [x] **Step 4: Implement in `socketServer.ts`**

```ts
  const { staticDir, adminLoginLimiter = createAttemptLimiter(), allowedOrigins = [] } = options;
  // ...
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    // No `cors` option: socket.io then sends no CORS headers, so a cross-site page can't use
    // HTTP polling, and allowRequest refuses its WebSocket handshake (audit I7).
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers, allowedOrigins)),
  });
```

Add `allowedOrigins?: string[];` to `CreateServerOptions` with a one-line comment pointing at
`ALLOWED_ORIGINS`. Run → PASS.

- [x] **Step 5: Failing env tests** — `envConfig.test.ts`

Add `const BASE = { ADMIN_PASSPHRASE: 'a-good-passphrase' };`, spread it into every existing
`readEnvConfig({...})` call, and add `host: '127.0.0.1', allowedOrigins: [], adminPassphrase: 'a-good-passphrase'`
to the two existing `toEqual` expectations. New tests:

```ts
  it('reads HOST and ALLOWED_ORIGINS', () => {
    const config = readEnvConfig({ ...BASE, HOST: '100.64.0.7', ALLOWED_ORIGINS: ' https://box.tail1.ts.net , http://localhost:5173 ' });
    expect(config.host).toBe('100.64.0.7');
    expect(config.allowedOrigins).toEqual(['https://box.tail1.ts.net', 'http://localhost:5173']);
  });

  it('refuses an ALLOWED_ORIGINS entry that is not a bare origin', () => {
    expect(() => readEnvConfig({ ...BASE, ALLOWED_ORIGINS: 'https://box.tail1.ts.net/game' })).toThrow('ALLOWED_ORIGINS');
  });

  it.each([
    [undefined, 'not set'],
    ['   ', 'not set'],
    ['change-me', 'change-me'],
    [' Change-Me ', 'change-me'],
    ['short', 'at least 8'],
  ])('refuses ADMIN_PASSPHRASE %j', (value, message) => {
    expect(() => readEnvConfig({ ADMIN_PASSPHRASE: value })).toThrow(message);
  });
```

Run: `npx vitest run src/envConfig.test.ts --root packages/server` → FAIL.

- [x] **Step 6: Implement in `envConfig.ts`**

Add the three fields to `EnvConfig`, and before the `problems.length` check:

```ts
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
```

Return `{ port, host, reconnectGraceMs, configDefaults, allowedOrigins, adminPassphrase }`. Run → PASS.

- [x] **Step 7: `index.ts`**

Delete the `adminPassphrase` block (lines ~31-43, its job moved into `readEnvConfig`). Then:

```ts
  const { port, host, allowedOrigins, adminPassphrase } = envConfig;
  // ...
  const { httpServer, io } = await createServer(staticConfig, gameConfigStore, playerStore, handLog, adminPassphrase, {
    staticDir,
    allowedOrigins,
  });
  httpServer.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}${staticDir ? ` (serving frontend from ${staticDir})` : ''}`);
  });
```

- [x] **Step 8: Vite proxy and `.env.example`**

`vite.config.ts`: change the target to `` `http://127.0.0.1:${BACKEND_PORT}` `` and add to the comment:
"127.0.0.1, not localhost: the server binds to 127.0.0.1 by default, and Node may resolve localhost
to ::1 first." The Vite dev server keeps the browser's Host header (no `changeOrigin`), so the
Origin check passes.

`packages/server/.env.example`: replace `ADMIN_PASSPHRASE=change-me` with

```
# Required, at least 8 characters. Give it only to whoever runs the game: it can rewrite
# balances and release names. The server refuses to start without it or with "change-me".
ADMIN_PASSPHRASE=
```

and add under the optional block:

```
# Address to listen on. The default (127.0.0.1) is right with Tailscale Serve; see docs/HOSTING.md.
# HOST=127.0.0.1
# Extra page origins allowed to connect, comma-separated, only if friends get "connection refused"
# through Tailscale Serve. Example: https://my-pc.tail1234.ts.net
# ALLOWED_ORIGINS=
```

- [x] **Step 9: Run everything**

Run: `npm test` and `npm run typecheck --workspace=@poker-blackjack/server`
Expected: PASS.

- [x] **Step 10: Commit (after the user says yes)**

```bash
git add packages/server/src packages/server/.env.example packages/frontend/vite.config.ts
git commit -m "fix(server): bind to 127.0.0.1 by default, check Origin, refuse weak passphrases (audit I7)"
```

---

### Task 6: Client identity: tokens, `mySeatIndex`, takeover, admin session (C5, I9, M11 client side)

**Files:**
- Create: `packages/frontend/src/socket/identityStorage.ts`, `packages/frontend/src/socket/identityStorage.test.ts`
- Modify: `packages/frontend/src/socket/SocketContext.tsx`, `packages/frontend/src/App.tsx` (`TableView` ~50-70, `AppContent` ~142-195), `packages/frontend/src/fixtures/tableStateFixtures.ts` (`makeAppState` ~290, `makeLobbyState` ~303)
- Test: `packages/frontend/src/socket/SocketContext.test.tsx`, `packages/frontend/src/App.test.tsx`, every test file with a `makeSocketValue` helper (find them with `grep -rln "makeSocketValue\|SocketContextValue" packages/frontend/src`)

**Interfaces:**
- Consumes: protocol additions from Tasks 3 and 4; `nameKey` from Task 1.
- Produces (identityStorage.ts):

```ts
export const IDENTITY_STORAGE_KEY = 'poker-blackjack:identity';
export function readLastName(): string | null;
export function tokenFor(displayName: string): string | undefined;
export function rememberIdentity(displayName: string, token: string): void; // sets the token and lastName
export function forgetLastName(): void; // keeps every token
```

- `ConnectionStatus` gains `'replaced'`.
- `SocketContextValue` gains `adminNoticeMessage: string | null`, `adminReleaseName: (displayName: string) => void`,
  `takeOver: () => void`. `DISPLAY_NAME_STORAGE_KEY` is removed (the name now lives in the identity record).
- `ADMIN_TOKEN_STORAGE_KEY = 'poker-blackjack:adminToken'` (exported from SocketContext.tsx).
- `TableView` prop `displayName` is replaced by `mySeatIndex: number | null`.

- [x] **Step 1: Failing storage tests** — `identityStorage.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_STORAGE_KEY, forgetLastName, readLastName, rememberIdentity, tokenFor } from './identityStorage';

describe('identityStorage', () => {
  beforeEach(() => localStorage.clear());

  it('is empty at first', () => {
    expect(readLastName()).toBeNull();
    expect(tokenFor('alice')).toBeUndefined();
  });

  it('remembers a token per name, case-insensitively, and the last name used', () => {
    rememberIdentity('Alice', 'tok-a');
    rememberIdentity('bob', 'tok-b');
    expect(tokenFor('ALICE')).toBe('tok-a');
    expect(tokenFor('bob')).toBe('tok-b');
    expect(readLastName()).toBe('bob');
  });

  it('forgetLastName keeps the tokens', () => {
    rememberIdentity('alice', 'tok-a');
    forgetLastName();
    expect(readLastName()).toBeNull();
    expect(tokenFor('alice')).toBe('tok-a');
  });

  it('survives garbage in storage', () => {
    localStorage.setItem(IDENTITY_STORAGE_KEY, '{not json');
    expect(readLastName()).toBeNull();
    rememberIdentity('alice', 'tok-a');
    expect(tokenFor('alice')).toBe('tok-a');
  });

  it('ignores inherited keys', () => {
    expect(tokenFor('constructor')).toBeUndefined();
  });
});
```

Run: `npx vitest run src/socket/identityStorage.test.ts --root packages/frontend` → FAIL.

- [x] **Step 2: Implement** — `identityStorage.ts`

```ts
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
```

Run → PASS. (If `Object.hasOwn` fails typecheck because of the frontend `lib` setting, use
`Object.prototype.hasOwnProperty.call(tokens, key)`.)

- [x] **Step 3: Fixtures** — `tableStateFixtures.ts`: add `mySeatIndex: null,` to the objects built by
`makeAppState` and `makeLobbyState`, before `...overrides`.

- [x] **Step 4: Failing SocketContext tests**

In `SocketContext.test.tsx`:
- import `{ io } from 'socket.io-client'`, `IDENTITY_STORAGE_KEY` and `ADMIN_TOKEN_STORAGE_KEY`; drop `DISPLAY_NAME_STORAGE_KEY`.
- `beforeEach`: add `localStorage.clear();`.
- `TestConsumer`: also read `adminNoticeMessage`, `takeOver`, `adminReleaseName`; render
  `<p data-testid="adminNotice">{adminNoticeMessage ?? 'none'}</p>`,
  `<button onClick={() => takeOver()}>take-over</button>`,
  `<button onClick={() => adminReleaseName('bob')}>admin-release</button>`.
- Helpers at the top of the describe:

```ts
function renderProvider() {
  render(
    <SocketProvider serverUrl="http://localhost:3000">
      <TestConsumer />
    </SocketProvider>
  );
}
function push(event: string, payload?: unknown) {
  act(() => {
    handlers.get(event)?.(payload);
  });
}
function storeIdentity(lastName: string | null, tokens: Record<string, string>) {
  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify({ lastName, tokens }));
}
```

New tests (a new `describe('identity (audit C5, I9, M11)')` inside the provider describe):

```ts
it('is not at the table just because a connected seat has our name (I9)', async () => {
  renderProvider();
  push('state', makeAppState(makeWaitingState()));
  act(() => screen.getByText('join').click());
  push('state', makeAppState(makeWaitingState())); // seats[0] is a connected 'alice', but not us
  push('error', { message: '"alice" belongs to another player.', code: 'name-claimed' });
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
});

it('is at the table when the server says which seat is ours', async () => {
  renderProvider();
  push('state', makeAppState(makeWaitingState()));
  act(() => screen.getByText('join').click());
  push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
});

it('rejoins with the stored name and its token', () => {
  storeIdentity('alice', { alice: 'tok-a' });
  renderProvider();
  push('state', makeAppState(makeWaitingState({ seats: [] })));
  expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
});

it('stores the token and name from an identity event', () => {
  renderProvider();
  push('identity', { displayName: 'Alice', token: 'tok-new' });
  expect(JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY)!)).toEqual({ lastName: 'Alice', tokens: { alice: 'tok-new' } });
  expect(screen.getByTestId('name')).toHaveTextContent('Alice');
});

it('a rejected join forgets the last name but keeps the tokens', async () => {
  storeIdentity('alice', { alice: 'tok-a' });
  renderProvider();
  push('state', makeAppState(makeWaitingState({ seats: [] })));
  push('error', { message: '"alice" belongs to another player.', code: 'name-claimed' });
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('entering-name'));
  expect(JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY)!)).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
});

it('when replaced, shows the replaced status and does not rejoin on its own', async () => {
  storeIdentity('alice', { alice: 'tok-a' });
  renderProvider();
  push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
  push('error', { message: 'You opened the game in another tab or device.', code: 'replaced' });
  push('state', makeAppState(makeWaitingState()));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('replaced'));
  act(() => ioManagerHandlers.get('reconnect')?.());
  expect(emitted.filter((e) => e.event === 'join')).toHaveLength(0); // seated from the first state, never rejoined
});

it('takeOver rejoins with the token', () => {
  storeIdentity('alice', { alice: 'tok-a' });
  renderProvider();
  push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
  push('error', { message: 'You opened the game in another tab or device.', code: 'replaced' });
  emitted.length = 0;
  act(() => screen.getByText('take-over').click());
  expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
});

it('leave forgets the last name and keeps the token', () => {
  storeIdentity('alice', { alice: 'tok-a' });
  renderProvider();
  push('state', makeAppState(makeWaitingState(), { mySeatIndex: 0 }));
  act(() => screen.getByText('leave').click());
  expect(JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY)!)).toEqual({ lastName: null, tokens: { alice: 'tok-a' } });
});

it('keeps the admin token for this tab and sends it on every connect (M11)', () => {
  renderProvider();
  push('adminLoginResult', { success: true, adminToken: 'adm-1' });
  expect(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)).toBe('adm-1');
  const options = vi.mocked(io).mock.calls[0][1] as { auth: (cb: (data: object) => void) => void };
  const cb = vi.fn();
  options.auth(cb);
  expect(cb).toHaveBeenCalledWith({ adminToken: 'adm-1' });
});

it('explains a login lockout', async () => {
  renderProvider();
  push('adminLoginResult', { success: false, retryAfterMs: 42_100 });
  await waitFor(() => expect(screen.getByTestId('adminError')).toHaveTextContent('Try again in 43 s'));
});

it('shows an admin notice until the next admin action', async () => {
  renderProvider();
  push('state', makeAppState(makeWaitingState(), { isAdmin: true }));
  push('adminNotice', { message: 'Released "bob"' });
  await waitFor(() => expect(screen.getByTestId('adminNotice')).toHaveTextContent('Released "bob"'));
  act(() => screen.getByText('admin-release').click());
  expect(screen.getByTestId('adminNotice')).toHaveTextContent('none');
  expect(emitted).toContainEqual({ event: 'adminReleaseName', payload: { displayName: 'bob' } });
});
```

Existing tests: every `makeAppState(...)` that is meant to seat us gets `{ mySeatIndex: 0 }` (or the
right index) in its overrides, and every `sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name)`
becomes `storeIdentity(name, {})`; assertions on that key read `IDENTITY_STORAGE_KEY`'s `lastName`.
Do not change what they assert otherwise.

Run: `npx vitest run src/socket/SocketContext.test.tsx --root packages/frontend` → new tests FAIL.

- [x] **Step 5: Implement in `SocketContext.tsx`**

1. Imports: `IdentityPayload`, `AdminNoticePayload` types from protocol; `{ forgetLastName, readLastName, rememberIdentity, tokenFor } from './identityStorage'`.
   Replace `DISPLAY_NAME_STORAGE_KEY` with `export const ADMIN_TOKEN_STORAGE_KEY = 'poker-blackjack:adminToken';`.
   `ConnectionStatus` adds `'replaced'`.
2. New ref + state: `const replacedRef = useRef(false);` (comment: "set when another tab or device
   took our seat with the same token; blocks every automatic rejoin, or two tabs would take the seat
   back and forth forever"), `const [adminNoticeMessage, setAdminNoticeMessage] = useState<string | null>(null);`.
3. Add a helper inside the component and use it at all three `join` emit sites:

```ts
  function emitJoin(socket: Socket<ServerToClientEvents, ClientToServerEvents>, name: string) {
    socket.emit('join', { displayName: name, token: tokenFor(name) });
  }
```

4. Mount effect: `const storedName = readLastName();` replaces the sessionStorage read. Create the socket with

```ts
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
      // A function, so each reconnect sends the token as it is then (audit M11).
      auth: (cb) => {
        let adminToken: string | null = null;
        try {
          adminToken = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
        } catch {
          // storage blocked: log in again after a reconnect
        }
        cb(adminToken ? { adminToken } : {});
      },
    });
```

5. `state` handler: replace the `mySeated` computation and its long comment with

```ts
      // The server's socket→seat map is the only reliable answer (audit I9): matching names let a
      // rejected join adopt the other player's seat view.
      const mySeatIndex = nextState.mySeatIndex ?? null;
      const mySeated = mySeatIndex !== null;
```

   In the `if (mySeated)` branch: drop the sessionStorage write; set `replacedRef.current = false;`
   and take the server's spelling of our name:

```ts
        const seatName = nextState.table?.seats[mySeatIndex]?.displayName ?? null;
        if (seatName !== null && seatName !== displayNameRef.current) {
          displayNameRef.current = seatName;
          setDisplayName(seatName);
        }
```

   Insert, right after the `else if (nextState.mode === null)` branch:

```ts
      } else if (replacedRef.current) {
        setStatus('replaced');
```

   and change the auto-rejoin emit to `emitJoin(socket, displayNameRef.current);`.
6. New listeners:

```ts
    socket.on('identity', ({ displayName: name, token }: IdentityPayload) => {
      rememberIdentity(name, token);
      displayNameRef.current = name;
      setDisplayName(name);
    });

    socket.on('adminNotice', ({ message }: AdminNoticePayload) => {
      setAdminNoticeMessage(message);
    });
```

7. `adminLoginResult` handler:

```ts
    socket.on('adminLoginResult', ({ success, adminToken, retryAfterMs }: AdminLoginResultPayload) => {
      if (success) {
        setAdminErrorMessage(null);
        if (adminToken) {
          try {
            sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
          } catch {
            // storage blocked: admin rights end at the next reconnect, as before
          }
        }
      } else if (retryAfterMs) {
        setAdminErrorMessage(`Too many wrong passphrases. Try again in ${Math.ceil(retryAfterMs / 1000)} s.`);
      } else {
        setAdminErrorMessage('Incorrect admin passphrase');
      }
    });
```

   (keep the existing comment about why this is separate from `errorMessage`).
8. `error` handler, after the admin-scope early return:

```ts
      if (payload.code === 'replaced') {
        replacedRef.current = true;
        joinedRef.current = false;
        joinInFlightRef.current = false;
        setErrorMessage(payload.message);
        setStatus('replaced');
        return;
      }
      const wasJoining = joinInFlightRef.current;
      joinInFlightRef.current = false;
      setErrorMessage(payload.message);
      if (!hasEverReceivedStateRef.current) {
        // ... existing fatal branch unchanged ...
      } else if (wasJoining) {
        // A refused join must not be retried on the next reload (audit I9).
        forgetLastName();
        displayNameRef.current = null;
        setDisplayName(null);
        setStatus('entering-name');
      } else if (statusRef.current === 'connecting') {
        setStatus('entering-name');
      }
```

   (the old unconditional `joinInFlightRef.current = false; setErrorMessage(...)` lines are replaced
   by the two above; keep the long "Deliberately no special-casing" comment.)
9. `socket.io.on('reconnect')`: `if (name && !joinInFlightRef.current && !replacedRef.current)` and use `emitJoin(socket, name)`.
10. `joinWithName(name)`: set `replacedRef.current = false;` and use `emitJoin(socketRef.current, name)` (guard null).
11. `leave()`: replace `sessionStorage.removeItem(DISPLAY_NAME_STORAGE_KEY)` with `forgetLastName()`.
12. New functions and context values:

```ts
  function takeOver() {
    const name = displayNameRef.current ?? readLastName();
    if (!name || !socketRef.current) return;
    replacedRef.current = false;
    joinedRef.current = true;
    joinInFlightRef.current = true;
    setErrorMessage(null);
    emitJoin(socketRef.current, name);
  }

  function adminReleaseName(name: string) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminReleaseName', { displayName: name });
  }
```

   Every other `admin*` sender also calls `setAdminNoticeMessage(null)` next to its existing
   `setAdminActionErrorMessage(null)`. Add `adminNoticeMessage`, `adminReleaseName`, `takeOver` to
   `SocketContextValue` (with a doc comment each) and to `value`.

- [x] **Step 6: Failing App test, then App.tsx**

In `App.test.tsx` (it renders the real `App` over the file's fake socket; add `localStorage.clear();`
to its `beforeEach`, and give every test state that should seat us `{ mySeatIndex: 0 }`):

```ts
it('offers to play here after another tab took the seat (audit C5)', () => {
  localStorage.setItem('poker-blackjack:identity', JSON.stringify({ lastName: 'alice', tokens: { alice: 'tok-a' } }));
  render(<App />);
  act(() => {
    handlers.get('state')?.(makeAppState(makeWaitingState({ gameMode: 'holdem' }), { mySeatIndex: 0 }));
    handlers.get('error')?.({ message: 'You opened the game in another tab or device.', code: 'replaced' });
  });
  expect(screen.getByText('You opened the game in another tab or device.')).toBeInTheDocument();
  emitted.length = 0;
  fireEvent.click(screen.getByRole('button', { name: 'Play here instead' }));
  expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice', token: 'tok-a' } });
});
```

(import `fireEvent` from Testing Library if the file doesn't already.)

Run → FAIL. Then in `App.tsx`:
- `TableView`: replace the `displayName` prop with `mySeatIndex: number | null` and delete the name-matching `const mySeatIndex = ...`.
- `AppContent`: take `takeOver` from `useSocket()`, pass `mySeatIndex={state.mySeatIndex}` instead of `displayName={displayName}`
  (drop `displayName` from the destructure if now unused), and add before the `return (<>`:

```tsx
  if (status === 'replaced') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-white">
        <p>{errorMessage ?? 'You opened the game in another tab or device.'}</p>
        <button type="button" onClick={takeOver} className="rounded-md bg-emerald-600 px-3 py-2 font-medium">
          Play here instead
        </button>
      </main>
    );
  }
```

- [x] **Step 7: Fix the other `SocketContextValue` fakes**

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`. Each `makeSocketValue` (AdminPanel.test,
and any others) gains `adminNoticeMessage: null, adminReleaseName: vi.fn(), takeOver: vi.fn(),`.
Any test that rendered `TableView`/`GameTable` with a `displayName` to pick the player's seat now
passes `mySeatIndex` instead.

- [x] **Step 8: Run everything**

Run: `npm test`, `npm run typecheck`, `npm run build --workspace=@poker-blackjack/frontend`
Expected: PASS. The frontend integration tests (`src/integration/*.integration.test.tsx`) run the
real server, so they also cover the token round trip end to end; they must pass unchanged.
Guard check: in the `state` handler, temporarily put back a name match for `mySeated` and confirm
"is not at the table just because a connected seat has our name" fails; restore.

- [x] **Step 9: Commit (after the user says yes)**

```bash
git add packages/frontend/src
git commit -m "fix(frontend): reconnect tokens, server-sent seat, takeover screen and admin session (audit C5, I9, M11)"
```

---

### Task 7: Admin "Release a name" form

**Files:**
- Modify: `packages/frontend/src/components/AdminPanel.tsx`
- Test: `packages/frontend/src/components/AdminPanel.test.tsx`

**Interfaces:**
- Consumes: `adminReleaseName`, `adminNoticeMessage` from Task 6.

- [x] **Step 1: Failing tests** — `AdminPanel.test.tsx` (the file's `renderWithSocket` returns the mocked value)

```ts
it('releases a typed name (audit C5)', () => {
  const { adminReleaseName } = renderWithSocket();
  fireEvent.change(screen.getByLabelText('Name to release'), { target: { value: 'bob' } });
  fireEvent.click(screen.getByRole('button', { name: 'Release name' }));
  expect(adminReleaseName).toHaveBeenCalledWith('bob');
});

it('does not send a blank name', () => {
  const { adminReleaseName } = renderWithSocket();
  fireEvent.click(screen.getByRole('button', { name: 'Release name' }));
  expect(adminReleaseName).not.toHaveBeenCalled();
});

it('shows the server notice', () => {
  renderWithSocket({ adminNoticeMessage: 'Released "bob": the next person...' });
  expect(screen.getByRole('status')).toHaveTextContent('Released "bob"');
});
```

Run: `npx vitest run src/components/AdminPanel.test.tsx --root packages/frontend` → FAIL.

- [x] **Step 2: Implement** — in `AdminPanel.tsx`: take `adminReleaseName` and `adminNoticeMessage`
from `useSocket()`, add `const [releaseName, setReleaseName] = useState('');` with the other state,
and a handler:

```ts
  function handleReleaseName(event: FormEvent) {
    event.preventDefault();
    if (releaseName.trim().length === 0) {
      return;
    }
    adminReleaseName(releaseName);
    setReleaseName('');
  }
```

After the balance form:

```tsx
          {/* A free-text field, not the seated-player list: the player who needs this has lost
              their token, so they usually can't sit down (audit C5). */}
          <form onSubmit={handleReleaseName} className="flex flex-col gap-1">
            <p className="text-xs text-slate-400">Release a name (player lost their browser data)</p>
            <input
              value={releaseName}
              onChange={(event) => setReleaseName(event.target.value)}
              aria-label="Name to release"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Release name
            </button>
          </form>
```

and, next to where `adminActionErrorMessage` is rendered, the notice:

```tsx
          {adminNoticeMessage && (
            <p role="status" className="text-xs text-emerald-300">
              {adminNoticeMessage}
            </p>
          )}
```

- [x] **Step 3: Run** `npx vitest run src/components/AdminPanel.test.tsx --root packages/frontend` → PASS; then `npm test --workspace=@poker-blackjack/frontend`.

- [x] **Step 4: Commit (after the user says yes)**

```bash
git add packages/frontend/src/components/AdminPanel.tsx packages/frontend/src/components/AdminPanel.test.tsx
git commit -m "feat(frontend): admin can release a name for a player who lost their token (audit C5)"
```

---

### Task 8: Hosting docs, bots and handoff

**Files:**
- Modify: `docs/HOSTING.md`, `README.md` (only lines that give the `http://<host>:3000` link or describe identity), `.gitignore`, `scripts/playtest/bots.cjs` (~29-31), `HANDOFF.md`, `docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md` (status of the five findings)

No code tests; the checks are the steps below.

- [x] **Step 1: Bots keep their token** — `bots.cjs`, replace line ~31:

```js
  // The server now ties a name to a token (audit C5): keep the one it sends, so a bot that
  // reconnects after a server restart gets its own seat back.
  let token;
  s.on('identity', (id) => {
    token = id.token;
  });
  s.on('connect', () => s.emit('join', { displayName: name, token }));
```

Bots connect to `http://127.0.0.1:<port>`, which still works with the new default `HOST`.

- [x] **Step 2: `.gitignore`** — under `balances.json`, add `balances.json.*` (covers
`.v1-backup`, `.tmp` and `.corrupt-<ts>`, audit §7).

- [x] **Step 3: `docs/HOSTING.md`** — change these parts (keep the rest):
- **One-time setup (host), step 3:** set `ADMIN_PASSPHRASE` to at least 8 characters, keep it to
  yourself (or whoever runs the game); it can change balances and release names. Do not share it with
  the group. The server refuses `change-me`.
- **New one-time step:** turn on HTTPS certificates for the tailnet in the Tailscale admin console
  (DNS page, "HTTPS Certificates") and, after the first `npm run play`, run
  `tailscale serve --bg http://127.0.0.1:3000` once. Friends then use `https://<your-machine>.<tailnet>.ts.net`
  (no port). `tailscale serve status` shows it; `tailscale serve --https=443 off` turns it off.
- **Firewall:** delete the "allow node.exe for Private networks" step. The server listens only on
  127.0.0.1, so the OS firewall has nothing to open; Tailscale Serve carries the traffic.
- **Each friend:** prefer sharing the one machine (Tailscale admin console, Machines, "Share") over
  inviting them to the tailnet; an invite with the default access rules lets them reach every device
  on it. (Mark this as the audit's inference; it is not tested here.)
- **Starting a session:** share the `https://...ts.net` link instead of `http://<hostname>:3000`.
- **New section "Names and balances":** a name belongs to the browser that first sat down under it.
  The same browser gets back in automatically; another browser or device can't use that name. A
  player who clears their browser data or changes device asks the admin to use **Release a name**
  in the admin panel (their balance is kept) and then joins again. Names ignore capitals ("Bob" and
  "bob" are one player). Upgrading from an older version: the first person to join under each
  existing name claims it; `balances.json.v1-backup` keeps the old file.
- **Troubleshooting, new entries:** "Friends can't connect": check `tailscale serve status`, that
  they use the `https://` link, and, if the browser console shows the socket refused, add the link's
  origin to `ALLOWED_ORIGINS` in `.env` (e.g. `ALLOWED_ORIGINS=https://my-pc.tail1234.ts.net`) and
  restart. "The server won't start: ADMIN_PASSPHRASE ...": set a passphrase of at least 8 characters
  that is not `change-me`. "You opened the game in another tab or device": click **Play here instead**.
- Update the existing troubleshooting entry the `table.ts` reconnect comment points at (a disconnected
  seat is reclaimable indefinitely): it is now reclaimable by the same browser only.
- Also update the comment above `Table.reconnect` (`table.ts` ~330-338) to say the name match is
  only reached after `socketServer` has checked the token.

- [x] **Step 4: `README.md`** — `grep -n "3000\|display name\|passphrase" README.md`; update any line
that gives the `http://` link or says the passphrase is shared, to match HOSTING.md.

- [x] **Step 5: Audit report and HANDOFF**
- In the audit report §3, add to the **Status** line of C5, I7 and I9, and to the M8 and M11 table
  rows: `FIXED on audit/2026-10-01-full-audit (item 5); browser pass and Tailscale Serve check pending`.
- `HANDOFF.md`: add a row to the "Done" table for this work (commits, findings, a one-paragraph
  summary of the token design and its decisions from **Global Constraints**), add the decisions to
  "Decisions worth knowing", and set **Next step** to: browser pass over items 1-5 (delegated), the
  live Tailscale Serve check (Host/X-Forwarded-Host or `ALLOWED_ORIGINS`), then §8 item 6.

- [x] **Step 6: Commit (after the user says yes)**

```bash
git add docs/HOSTING.md README.md .gitignore scripts/playtest/bots.cjs HANDOFF.md docs/superpowers/playtests/2026-10-01-full-audit-and-playtest.md packages/server/src/table.ts
git commit -m "docs: hosting behind Tailscale Serve, name ownership, admin passphrase (audit C5, I7)"
```

---

### Task 9: Final verification

- [x] **Step 1:** `npm test` — all green; record the test count (530 before this plan).
- [x] **Step 2:** `npm run typecheck` — clean.
- [x] **Step 3:** `npm run build --workspace=@poker-blackjack/frontend` — succeeds.
- [x] **Step 4:** `git status` — nothing unexpected (no `balances.json*`, no `.env`).
- [x] **Step 5 (delegated, not in the main thread):** a browser pass by a subagent against
  `npm run play` (started through `preview_start` with a `.claude/launch.json` entry), writing findings
  to `.playtest-data/audit/browser-pass-item5.md`: join, reload (same seat), second tab (takeover
  screen, "Play here instead"), different name in a private window under a claimed name (refused,
  join form shows), admin login, reload as admin (still admin), wrong passphrase ×5 (lockout message),
  release a name and reclaim it. Also confirm with `Get-NetTCPConnection -LocalPort 3000 -State Listen`
  that the server listens on 127.0.0.1 only.
- [ ] **Step 6 (user, needs the real host):** `tailscale serve --bg http://127.0.0.1:3000`, open the
  `https://...ts.net` link from another tailnet device, confirm the socket connects. If it is refused,
  set `ALLOWED_ORIGINS` and record which header Serve sends in HANDOFF.

## Not covered here

- MIN-1 to MIN-4 from the `8d7eacd` review (leave/rejoin during an admin balance write, a write on
  a retired table, a dropped join leaving "Reconnecting…", no lock timeout): they belong with I3/I6/I10.
- I10 and I11 (`joinInFlightRef` survives a disconnect; leave racing a hand start): §8 item 6.
- Rejecting markup-like names: the audit found escaping safe everywhere, so it is not done.
