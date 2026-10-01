import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonPlayerStore } from './playerStore';

describe('JsonPlayerStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'player-store-test-'));
    filePath = join(dir, 'balances.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the default starting balance for a name with no prior entry', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('alice')).resolves.toBe(1000);
  });

  it('round-trips a balance written with setBalance', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 1250);
    await expect(store.getBalance('alice')).resolves.toBe(1250);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const storeA = new JsonPlayerStore(filePath, 1000);
    await storeA.setBalance('bob', 750);

    const storeB = new JsonPlayerStore(filePath, 1000);
    await expect(storeB.getBalance('bob')).resolves.toBe(750);
  });

  it('keeps balances for different names independent', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 500);
    await store.setBalance('bob', 2000);
    await expect(store.getBalance('alice')).resolves.toBe(500);
    await expect(store.getBalance('bob')).resolves.toBe(2000);
  });

  it('falls back to default balances on a corrupted file instead of rejecting forever (I5)', async () => {
    // A truncated balances file (the artifact of a crash mid-write, before
    // writeAll became atomic) used to make readAll reject on every call,
    // permanently taking getBalance down for every player -- on the *durable
    // money file*, which had strictly weaker crash protection than the
    // transient hand log.
    await writeFile(filePath, '{"alice": 12', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('alice')).resolves.toBe(1000);
    expect(errorSpy).toHaveBeenCalled();

    // And it recovers: the next write replaces the corrupted file wholesale.
    // (setBalance reads the still-corrupted file first, hence the spy staying
    // in place until after it.)
    await store.setBalance('alice', 750);
    errorSpy.mockRestore();
    await expect(new JsonPlayerStore(filePath, 1000).getBalance('alice')).resolves.toBe(750);
  });

  it('preserves the corrupt file instead of letting the next write destroy it', async () => {
    // The durability half of the corruption story. Returning an empty map on
    // a parse failure keeps the service up, but the next setBalance then
    // writes {onlyThisPlayer} and the atomic rename drops it over the corrupt
    // file -- destroying every other player's balance AND the only bytes
    // anyone could have hand-recovered them from. Availability must not be
    // bought with silent, unrecoverable data loss.
    await writeFile(filePath, '{"alice": 1200, "bob": 8', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('alice')).resolves.toBe(1000);
    await store.setBalance('carol', 500);
    errorSpy.mockRestore();

    const files = (await readdir(dir)).sort();
    const corrupt = files.filter((f) => f.startsWith('balances.json.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(files).toContain('balances.json');

    // The fresh file holds only the new write...
    await expect(new JsonPlayerStore(filePath, 1000).getBalance('carol')).resolves.toBe(500);
    // ...and the original bytes survive verbatim for hand recovery.
    await expect(readFile(join(dir, corrupt[0]), 'utf-8')).resolves.toBe('{"alice": 1200, "bob": 8');
  });

  it('leaves no temp file behind after a write', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('alice', 1250);
    const files = await readdir(dir);
    expect(files).toEqual(['balances.json']);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'returns the default balance as a number for the reserved-looking name %j (C3)',
    async (displayName) => {
      // Pre-fix, readAll returned a plain {}, so `data["constructor"]` hit
      // Object.prototype and resolved to a *function* -- the `?? default`
      // never fired, getBalance returned a non-number, and every downstream
      // balance calculation for that player produced NaN, bricking the table
      // that player joined. A crafted display name was all it took.
      const store = new JsonPlayerStore(filePath, 1000);
      const balance = await store.getBalance(displayName);
      expect(typeof balance).toBe('number');
      expect(balance).toBe(1000);
    }
  );

  it('round-trips a reserved-looking display name without polluting other lookups', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await store.setBalance('__proto__', 500);
    await expect(store.getBalance('__proto__')).resolves.toBe(500);
    // The stored value must not leak into unrelated names via the prototype
    // chain -- neither in this instance nor in one reading the file fresh.
    await expect(store.getBalance('alice')).resolves.toBe(1000);
    await expect(new JsonPlayerStore(filePath, 1000).getBalance('alice')).resolves.toBe(1000);
  });

  it('does not lose an update when two different names are set concurrently', async () => {
    // Pre-fix, setBalance had no serialization: two concurrent calls could
    // both readAll() the same (empty) map before either had written, so the
    // second writeAll() silently clobbered the first -- reliably reproduced
    // (5/5 runs) via this exact concurrent-call shape against the class in
    // isolation, discovered while live-verifying Blackjack payouts (two
    // players' hand settlements, or an admin's adminAdjustBalance racing a
    // different player's settlement, both call setBalance independently).
    const store = new JsonPlayerStore(filePath, 1000);
    await Promise.all([store.setBalance('alice', 975), store.setBalance('bob', 1000)]);
    await expect(store.getBalance('alice')).resolves.toBe(975);
    await expect(store.getBalance('bob')).resolves.toBe(1000);
    // And the file itself must still be valid, not corrupted by two writers
    // interleaving into the shared `${filePath}.tmp` path (this was the
    // more severe pre-fix failure mode: 2/5 runs produced unparseable JSON,
    // not just a lost key).
    const raw = await readFile(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual({ alice: { name: 'alice', balance: 975 }, bob: { name: 'bob', balance: 1000 } });
  });

  it('setDefaultStartingBalance changes the value returned for names with no prior entry', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('alice')).resolves.toBe(1000);
    store.setDefaultStartingBalance(2000);
    await expect(store.getBalance('alice')).resolves.toBe(2000);
    // A name that already has a stored balance is unaffected.
    await store.setBalance('bob', 500);
    await expect(store.getBalance('bob')).resolves.toBe(500);
  });

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

    it('folds a v1 name with repeated spaces or invisible characters onto the name a join will look up', async () => {
      const zeroWidth = String.fromCharCode(0x200b);
      await writeFile(filePath, JSON.stringify({ 'Bob  Smith': 700, [`al${zeroWidth}ice`]: 900 }), 'utf-8');
      const store = new JsonPlayerStore(filePath, 1000);
      // Joins look names up already normalised, so this is the key every later join uses.
      await expect(store.getBalance('bob smith')).resolves.toBe(700);
      await expect(store.getBalance('alice')).resolves.toBe(900);
      await store.setBalance('alice', 950);
      expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({
        'bob smith': { name: 'Bob Smith', balance: 700 },
        alice: { name: 'alice', balance: 950 },
      });
    });

    it('keeps the larger balance when two v1 names differ only in case', async () => {
      await writeFile(filePath, JSON.stringify({ Bob: 700, bob: 900 }), 'utf-8');
      // Expected: the store logs which entry it kept.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new JsonPlayerStore(filePath, 1000);
      await expect(store.getBalance('BOB')).resolves.toBe(900);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
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

    it('treats a hand-edited, malformed tokenHash as unclaimed instead of throwing', async () => {
      // timingSafeEqual throws on a length mismatch, so without the shape guard a broken hash
      // would turn every join under that name into a server error.
      await writeFile(filePath, JSON.stringify({ alice: { name: 'alice', balance: 10, tokenHash: 'not-hex' } }), 'utf-8');
      const store = new JsonPlayerStore(filePath, 1000);
      await expect(store.checkToken('alice', 'anything')).resolves.toBe('unclaimed');
      await expect(store.checkToken('alice', undefined)).resolves.toBe('unclaimed');
    });

    it('lets a name with a malformed tokenHash be claimed again, keeping its balance', async () => {
      // Unclaimed must mean claimable: otherwise checkToken says "unclaimed", issueToken says
      // "already claimed", and the join fails with no way out.
      await writeFile(filePath, JSON.stringify({ alice: { name: 'alice', balance: 10, tokenHash: 'not-hex' } }), 'utf-8');
      const store = new JsonPlayerStore(filePath, 1000);
      const token = await store.issueToken('alice');
      expect(token).toHaveLength(43);
      await expect(store.checkToken('alice', token)).resolves.toBe('match');
      await expect(store.getBalance('alice')).resolves.toBe(10);
    });
  });
});
