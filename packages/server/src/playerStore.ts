import { readFile, writeFile, rename } from 'node:fs/promises';

export interface PlayerStore {
  getBalance(displayName: string): Promise<number>;
  setBalance(displayName: string, balance: number): Promise<void>;
  setDefaultStartingBalance(balance: number): void;
}

type BalanceMap = Record<string, number>;

export class JsonPlayerStore implements PlayerStore {
  // Serializes every read-modify-write (and getBalance's own read) through
  // one chain -- same pattern JsonlHandLog's writeQueue already uses, for
  // the same reason. Without this, two setBalance calls for different
  // players (e.g. adminAdjustBalance racing a hand's own settlement for
  // someone else) can both call readAll() before either has written, so the
  // second writeAll() silently clobbers the first. Worse: both writes also
  // share ONE `${filePath}.tmp` path (see writeAll below), so a genuine
  // interleave can corrupt the tmp file's bytes before either rename()
  // lands, not just lose an update -- confirmed by a direct concurrent-call
  // repro against this class in isolation (no game, no sockets): 5/5 runs
  // failed, 3 as a silent lost update and 2 as outright unparseable JSON.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private defaultStartingBalance: number
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    // Tracked separately from the returned promise, same reasoning as
    // JsonlHandLog.append: one failed read/write must not permanently wedge
    // every later call (a .then() chained onto a rejected promise never
    // runs), while each caller still observes their own operation's real
    // success/failure via the returned `result` promise.
    this.queue = result.catch(() => {});
    return result;
  }

  private async readAll(): Promise<BalanceMap> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.create(null) as BalanceMap;
      }
      if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new Error(
          `PLAYER_STORE_PATH is set to "${this.filePath}", but that path is a directory, not a file.`
        );
      }
      throw err;
    }
    try {
      const parsed = JSON.parse(raw) as BalanceMap;
      // Copy onto a null-prototype object: a plain {} would let a
      // displayName like "constructor"/"toString"/"__proto__" resolve to an
      // inherited Object.prototype member instead of `undefined`, so
      // `data[displayName] ?? default` would never fire and getBalance would
      // return a function, not a number -- silently bricking any table that
      // player joins. This closes that regardless of how the caller looks
      // the value up.
      return Object.assign(Object.create(null) as BalanceMap, parsed);
    } catch (err) {
      // This is the durable money file: a parse failure that rejected forever
      // would take down getBalance for every player permanently. Treating it
      // as empty degrades to default balances instead, matching the crash
      // tolerance the transient hand log already has.
      console.error(`PlayerStore: balances file at ${this.filePath} is corrupted, treating as empty:`, err);
      // Preserve the corrupt bytes before returning empty. Without this, the
      // very next setBalance reads this empty map, adds the one player being
      // written, and writeAll's atomic rename drops a fresh file over the
      // corrupt one -- destroying every other player's balance AND the only
      // copy anyone could have hand-recovered them from. Degrading
      // availability must not silently cost durability.
      //
      // Best-effort: a failed rename must not stop us returning the empty map,
      // matching the "recovery cleanup must not itself throw" pattern used in
      // Table.recoverFromLog's and startHand's catch blocks.
      try {
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch (renameErr) {
        console.error(
          `PlayerStore: failed to move the corrupted balances file at ${this.filePath} aside; it may be overwritten by the next write:`,
          renameErr
        );
      }
      return Object.create(null) as BalanceMap;
    }
  }

  private async writeAll(data: BalanceMap): Promise<void> {
    // Temp-file-then-rename: rename is atomic on both NTFS and POSIX
    // filesystems, so a crash mid-write can never leave a truncated or
    // partially-written balances file behind.
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  async getBalance(displayName: string): Promise<number> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      return data[displayName] ?? this.defaultStartingBalance;
    });
  }

  async setBalance(displayName: string, balance: number): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      data[displayName] = balance;
      await this.writeAll(data);
    });
  }

  setDefaultStartingBalance(balance: number): void {
    this.defaultStartingBalance = balance;
  }
}
