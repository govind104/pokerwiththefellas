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

  it('setDefaultStartingBalance changes the value returned for names with no prior entry', async () => {
    const store = new JsonPlayerStore(filePath, 1000);
    await expect(store.getBalance('alice')).resolves.toBe(1000);
    store.setDefaultStartingBalance(2000);
    await expect(store.getBalance('alice')).resolves.toBe(2000);
    // A name that already has a stored balance is unaffected.
    await store.setBalance('bob', 500);
    await expect(store.getBalance('bob')).resolves.toBe(500);
  });
});
