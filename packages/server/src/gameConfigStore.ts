import { readFile, writeFile, rename } from 'node:fs/promises';

export interface GameConfigValues {
  smallBlind: number;
  bigBlind: number;
  blackjackDefaultBet: number;
  defaultStartingBalance: number;
}

export interface GameConfigStore {
  getConfig(): Promise<GameConfigValues>;
  setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues>;
}

export class JsonGameConfigStore implements GameConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly defaults: GameConfigValues
  ) {}

  private async readStored(): Promise<Partial<GameConfigValues>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
    try {
      return JSON.parse(raw) as Partial<GameConfigValues>;
    } catch (err) {
      // Same rationale as JsonPlayerStore: this file is durable admin state,
      // not a cache. A parse failure that rejected forever would brick every
      // admin config read; degrading to defaults keeps the app usable, and
      // moving the corrupt bytes aside (not deleting them) means the next
      // write can't silently destroy the only copy of whatever was there.
      console.error(`GameConfigStore: config file at ${this.filePath} is corrupted, treating as empty:`, err);
      try {
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch (renameErr) {
        console.error(
          `GameConfigStore: failed to move the corrupted config file at ${this.filePath} aside; it may be overwritten by the next write:`,
          renameErr
        );
      }
      return {};
    }
  }

  async getConfig(): Promise<GameConfigValues> {
    const stored = await this.readStored();
    return { ...this.defaults, ...stored };
  }

  async setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues> {
    const current = await this.getConfig();
    const next = { ...current, ...update };
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    await rename(tmpPath, this.filePath);
    return next;
  }
}
