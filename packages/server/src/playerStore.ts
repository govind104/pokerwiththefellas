import { readFile, writeFile, rename } from 'node:fs/promises';

export interface PlayerStore {
  getBalance(displayName: string): Promise<number>;
  setBalance(displayName: string, balance: number): Promise<void>;
}

type BalanceMap = Record<string, number>;

export class JsonPlayerStore implements PlayerStore {
  constructor(
    private readonly filePath: string,
    private readonly defaultStartingBalance: number
  ) {}

  private async readAll(): Promise<BalanceMap> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.create(null) as BalanceMap;
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
    const data = await this.readAll();
    return data[displayName] ?? this.defaultStartingBalance;
  }

  async setBalance(displayName: string, balance: number): Promise<void> {
    const data = await this.readAll();
    data[displayName] = balance;
    await this.writeAll(data);
  }
}
