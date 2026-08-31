import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonGameConfigStore, type GameConfigValues } from './gameConfigStore';

describe('JsonGameConfigStore', () => {
  let dir: string;
  let filePath: string;
  const defaults: GameConfigValues = {
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'game-config-store-test-'));
    filePath = join(dir, 'game-config.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the constructor defaults when no file exists yet', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    await expect(store.getConfig()).resolves.toEqual(defaults);
  });

  it('round-trips a partial update, leaving other fields at their defaults', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    const result = await store.setConfig({ smallBlind: 50, bigBlind: 100 });
    expect(result).toEqual({ ...defaults, smallBlind: 50, bigBlind: 100 });
    await expect(store.getConfig()).resolves.toEqual({ ...defaults, smallBlind: 50, bigBlind: 100 });
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const storeA = new JsonGameConfigStore(filePath, defaults);
    await storeA.setConfig({ defaultStartingBalance: 2000 });

    const storeB = new JsonGameConfigStore(filePath, defaults);
    await expect(storeB.getConfig()).resolves.toEqual({ ...defaults, defaultStartingBalance: 2000 });
  });

  it('accumulates successive partial updates', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    await store.setConfig({ smallBlind: 50 });
    await store.setConfig({ bigBlind: 100 });
    await expect(store.getConfig()).resolves.toEqual({ ...defaults, smallBlind: 50, bigBlind: 100 });
  });

  it('falls back to defaults on a corrupted file instead of rejecting forever', async () => {
    await writeFile(filePath, '{"smallBlind": 5', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = new JsonGameConfigStore(filePath, defaults);
    await expect(store.getConfig()).resolves.toEqual(defaults);
    expect(errorSpy).toHaveBeenCalled();

    await store.setConfig({ smallBlind: 20 });
    errorSpy.mockRestore();
    await expect(new JsonGameConfigStore(filePath, defaults).getConfig()).resolves.toEqual({
      ...defaults,
      smallBlind: 20,
    });
  });

  it('preserves the corrupt file instead of letting the next write destroy it', async () => {
    await writeFile(filePath, '{"smallBlind": 5, "bigBlind": 1', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = new JsonGameConfigStore(filePath, defaults);
    await store.getConfig();
    await store.setConfig({ smallBlind: 15 });
    errorSpy.mockRestore();

    const files = (await readdir(dir)).sort();
    const corrupt = files.filter((f) => f.startsWith('game-config.json.corrupt-'));
    expect(corrupt).toHaveLength(1);
    expect(files).toContain('game-config.json');
  });

  it('leaves no temp file behind after a write', async () => {
    const store = new JsonGameConfigStore(filePath, defaults);
    await store.setConfig({ smallBlind: 15 });
    const files = await readdir(dir);
    expect(files).toEqual(['game-config.json']);
  });

  it('does not lose an update when two different fields are set concurrently', async () => {
    // Same class of bug as JsonPlayerStore's, same fix. setConfig's
    // read-modify-write had no serialization: two concurrent calls (e.g.
    // adminSetBlinds and adminSetDefaultBet fired in normal quick
    // succession from the admin panel) could both read the same starting
    // config before either had written, so the second write silently
    // dropped the first's change. Reproduced directly against this class
    // in isolation: 10/10 runs failed (8 lost updates, 2 unparseable JSON)
    // before the fix, 10/10 clean after.
    const store = new JsonGameConfigStore(filePath, defaults);
    await Promise.all([
      store.setConfig({ smallBlind: 50, bigBlind: 100 }),
      store.setConfig({ blackjackDefaultBet: 250 }),
    ]);
    await expect(store.getConfig()).resolves.toEqual({
      ...defaults,
      smallBlind: 50,
      bigBlind: 100,
      blackjackDefaultBet: 250,
    });
  });
});
