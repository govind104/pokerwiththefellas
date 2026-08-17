import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
});
