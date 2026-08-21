import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, appendFile, writeFile } from 'node:fs/promises';
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

  it('preserves invocation order under concurrent appends instead of racing on disk', async () => {
    // Each trial issues its 'a' append call before its 'b' append call, but
    // neither is awaited before the next is issued -- exactly the shape of
    // two overlapping Table.submitAction calls both reaching
    // handLog.append() (e.g. a client acting before its state broadcast
    // arrives, or the grace-window auto-act timer firing mid-append for
    // another seat). A bare, unserialized appendFile has no guarantee the
    // underlying disk writes land in call order; many trials fired
    // concurrently make that reordering observable if it can happen at all,
    // rather than relying on a single pair to get unlucky.
    const log = new JsonlHandLog(filePath);
    const trials = 25;
    const calls: Promise<void>[] = [];
    for (let i = 0; i < trials; i++) {
      calls.push(log.append({ type: 'a', data: i }));
      calls.push(log.append({ type: 'b', data: i }));
    }
    await Promise.all(calls);

    const entries = await log.readAll();
    for (let i = 0; i < trials; i++) {
      const aIndex = entries.findIndex((e) => e.type === 'a' && e.data === i);
      const bIndex = entries.findIndex((e) => e.type === 'b' && e.data === i);
      expect(aIndex).toBeGreaterThanOrEqual(0);
      expect(bIndex).toBeGreaterThanOrEqual(0);
      expect(aIndex).toBeLessThan(bIndex);
    }
  });

  it('serializes clear() against a concurrently-issued append instead of racing it (I2)', async () => {
    // The production race: settleHoldem sets handInProgress = false and only
    // then awaits its own handLog.clear(), so the next hand's
    // `hand_started` append can be issued while that clear is still in
    // flight. Pre-fix, clear() bypassed the write queue entirely with a bare
    // writeFile, so the truncate could land *after* the new hand's append and
    // silently wipe the only record of a hand that is actually being played.
    //
    // Both orderings are pinned below. This one is the real-world shape:
    // clear issued first, append issued second, neither awaited -- the final
    // state must be exactly the appended entry, never an empty log. Repeated
    // trials on a fresh file each time, following the concurrent-append test
    // above, so a reordering that only happens some of the time is still
    // caught rather than depending on one pair getting unlucky.
    const trials = 25;
    for (let i = 0; i < trials; i++) {
      const trialPath = join(dir, `race-forward-${i}.jsonl`);
      const log = new JsonlHandLog(trialPath);
      await log.append({ type: 'previous_hand', data: i });

      const clearPromise = log.clear();
      const appendPromise = log.append({ type: 'hand_started', data: i });
      await Promise.all([clearPromise, appendPromise]);

      await expect(log.readAll()).resolves.toEqual([{ type: 'hand_started', data: i }]);
    }
  });

  it('applies a clear() issued after an in-flight append, not before it', async () => {
    // The mirror ordering, and the one that fails deterministically against
    // the pre-fix code: append issued first, clear issued second, neither
    // awaited. Pre-fix, clear()'s writeFile was dispatched synchronously
    // while append()'s appendFile was still only queued as a microtask, so
    // the truncate ran first and the entry survived a clear that was issued
    // after it. Post-fix the queue forces the real invocation order.
    const log = new JsonlHandLog(filePath);
    const appendPromise = log.append({ type: 'stale', data: 1 });
    const clearPromise = log.clear();
    await Promise.all([appendPromise, clearPromise]);

    await expect(log.readAll()).resolves.toEqual([]);
  });

  it('preserves invocation order across a mixed append/clear/append sequence', async () => {
    const log = new JsonlHandLog(filePath);
    const calls = [
      log.append({ type: 'a', data: 1 }),
      log.clear(),
      log.append({ type: 'b', data: 2 }),
      log.append({ type: 'c', data: 3 }),
    ];
    await Promise.all(calls);

    await expect(log.readAll()).resolves.toEqual([
      { type: 'b', data: 2 },
      { type: 'c', data: 3 },
    ]);
  });

  it('drops a torn trailing line instead of discarding the whole hand (I7)', async () => {
    // A process killed mid-appendFile leaves a truncated final line. Pre-fix
    // that threw out of readAll and took every preceding, fully-written entry
    // with it -- contradicting the design spec's guarantee that a crash loses
    // at most the single in-flight action.
    const log = new JsonlHandLog(filePath);
    await log.append({ type: 'hand_started', data: { players: ['alice', 'bob'] } });
    await log.append({ type: 'action', data: { playerId: 'alice', action: 'call' } });
    // Written directly, bypassing append(): this stands in for bytes that
    // already reached disk half-written, not anything JsonlHandLog produces.
    await appendFile(filePath, '{"type":"action","data":{"playerId":"bo', 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(log.readAll()).resolves.toEqual([
      { type: 'hand_started', data: { players: ['alice', 'bob'] } },
      { type: 'action', data: { playerId: 'alice', action: 'call' } },
    ]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still throws on a malformed interior line rather than replaying around it', async () => {
    // Deliberately NOT tolerated: an unparseable line with well-formed lines
    // after it means data that was fully written got corrupted, so replaying
    // the remainder would reconstruct a different hand than the one played.
    // Table.recoverFromLog's catch handles this by discarding the log.
    await writeFile(
      filePath,
      '{"type":"a","data":1}\nthis is not json\n{"type":"c","data":3}\n',
      'utf-8'
    );
    const log = new JsonlHandLog(filePath);
    await expect(log.readAll()).rejects.toThrow();
  });
});
