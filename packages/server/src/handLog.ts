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
  constructor(private readonly filePath: string) {}

  async append(entry: HandLogEntry): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
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
