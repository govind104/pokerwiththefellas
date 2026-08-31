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

const CONFIG_KEYS: (keyof GameConfigValues)[] = [
  'smallBlind',
  'bigBlind',
  'blackjackDefaultBet',
  'defaultStartingBalance',
];

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// Drops any field that isn't a positive finite number instead of letting it
// through to a live hand. Valid-JSON-but-wrong-shape (a typo'd manual edit, a
// stray string) previously passed straight through getConfig()'s
// `{...defaults, ...stored}` merge unchecked, and only surfaced once a hand
// actually tried to start: HoldemHand's constructor throws, but
// Table.startHand's catch reverts silently with no broadcast, so every
// seated player's "Ready" button did nothing forever with no diagnosis
// anywhere but a server console line. Rejecting a bad value per-field at
// load time means one corrupted key degrades to its default instead of
// poisoning the whole file -- same "keep the app usable" philosophy as the
// corrupted-JSON handling below, just for a shape that's syntactically valid.
function sanitize(stored: Partial<GameConfigValues>, filePath: string): Partial<GameConfigValues> {
  const clean: Partial<GameConfigValues> = {};
  for (const key of CONFIG_KEYS) {
    const value = stored[key];
    if (value === undefined) continue;
    if (isPositiveFiniteNumber(value)) {
      clean[key] = value;
    } else {
      console.error(
        `GameConfigStore: config file at ${filePath} has an invalid value for "${key}" ` +
          `(${JSON.stringify(value)}), ignoring it and using the default instead.`
      );
    }
  }
  return clean;
}

export class JsonGameConfigStore implements GameConfigStore {
  // Same fix, same reason as JsonPlayerStore's queue/enqueue: setConfig's
  // read-modify-write had no serialization, and its write shares one
  // `${filePath}.tmp` path across calls. Two concurrent setConfig calls for
  // different fields -- e.g. adminSetBlinds and adminSetDefaultBet fired in
  // normal quick succession from the admin panel, or two co-admins each
  // changing a different setting -- reliably lost an update or corrupted
  // the file (confirmed via a direct isolated repro: 10/10 runs failed,
  // 8 lost updates, 2 unparseable JSON). Serializing getConfig/setConfig
  // through one chain closes it the same way it was closed there.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaults: GameConfigValues
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  private async readStored(): Promise<Partial<GameConfigValues>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new Error(
          `GAME_CONFIG_PATH is set to "${this.filePath}", but that path is a directory, not a file.`
        );
      }
      throw err;
    }
    try {
      return sanitize(JSON.parse(raw) as Partial<GameConfigValues>, this.filePath);
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

  // Not queued itself -- called both from getConfig() (which queues at the
  // public boundary) and from setConfig()'s own already-queued body. If
  // setConfig called the public getConfig() internally, that inner call
  // would try to enqueue onto a queue setConfig's own execution has already
  // claimed, deadlocking forever waiting on itself.
  private async getConfigUnqueued(): Promise<GameConfigValues> {
    const stored = await this.readStored();
    return { ...this.defaults, ...stored };
  }

  async getConfig(): Promise<GameConfigValues> {
    return this.enqueue(() => this.getConfigUnqueued());
  }

  async setConfig(update: Partial<GameConfigValues>): Promise<GameConfigValues> {
    return this.enqueue(async () => {
      const current = await this.getConfigUnqueued();
      const next = { ...current, ...update };
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
      await rename(tmpPath, this.filePath);
      return next;
    });
  }
}
