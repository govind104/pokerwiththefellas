import { readFile, writeFile, appendFile } from 'node:fs/promises';

export interface HandLogEntry {
  type: string;
  data: unknown;
}

export interface HandLog {
  append(entry: HandLogEntry): Promise<void>;
  readAll(): Promise<HandLogEntry[]>;
  clear(): Promise<void>;
}

export class JsonlHandLog implements HandLog {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  // Concurrent submitAction calls can each reach this method while a
  // previous call's write is still in flight -- hand.act() runs fully
  // synchronously before either call awaits anything, so the in-memory
  // order is already correct, but two independent appendFile calls have no
  // guaranteed on-disk ordering relative to each other. Chaining onto
  // writeQueue -- and reassigning it synchronously here, NOT via `await`,
  // which would let a second call race the reassignment and defeat the
  // whole point -- guarantees writes land on disk in the same order they
  // were invoked, matching the order hand.act() calls happened in memory.
  append(entry: HandLogEntry): Promise<void> {
    const write = this.writeQueue.then(() =>
      appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
    );
    // Tracked separately from the returned promise: a failed write must not
    // permanently wedge every subsequent append (a .then() chained onto a
    // rejected promise never runs), while each caller still observes their
    // own write's real success/failure via the returned `write` promise.
    this.writeQueue = write.catch(() => {});
    return write;
  }

  async readAll(): Promise<HandLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HandLogEntry);
  }

  async clear(): Promise<void> {
    await writeFile(this.filePath, '', 'utf-8');
  }
}
