import { readFile, writeFile } from 'node:fs/promises';

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
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as BalanceMap;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
  }

  private async writeAll(data: BalanceMap): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
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
