import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlHandLog, type HandLogEntry } from './handLog';

describe('JsonlHandLog', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hand-log-test-'));
    filePath = join(dir, 'hand.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty array when the log file does not exist yet', async () => {
    const log = new JsonlHandLog(filePath);
    await expect(log.readAll()).resolves.toEqual([]);
  });

  it('round-trips a single appended entry', async () => {
    const log = new JsonlHandLog(filePath);
    const entry: HandLogEntry = { type: 'hand_started', data: { foo: 'bar' } };
    await log.append(entry);
    await expect(log.readAll()).resolves.toEqual([entry]);
  });

  it('preserves append order across multiple entries', async () => {
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'a', data: 1 });
    await log.append({ type: 'b', data: 2 });
    await log.append({ type: 'c', data: 3 });
    await expect(log.readAll()).resolves.toEqual([
      { type: 'a', data: 1 },
      { type: 'b', data: 2 },
      { type: 'c', data: 3 },
    ]);
  });

  it('round-trips nested array/object data untouched', async () => {
    const log = new JsonlHandLog(filePath);
    const entry: HandLogEntry = {
      type: 'hand_started',
      data: { deck: [{ suit: 'clubs', rank: 'A' }, { suit: 'hearts', rank: '10' }], config: { smallBlind: 5 } },
    };
    await log.append(entry);
    await expect(log.readAll()).resolves.toEqual([entry]);
  });

  it('clear empties the log', async () => {
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'a', data: null });
    await log.clear();
    await expect(log.readAll()).resolves.toEqual([]);
  });

  it('supports appending again after a clear', async () => {
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'a', data: null });
    await log.clear();
    await log.append({ type: 'b', data: null });
    await expect(log.readAll()).resolves.toEqual([{ type: 'b', data: null }]);
  });
});
