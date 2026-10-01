import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { nameKey } from './names';

export interface PlayerStore {
  getBalance(displayName: string): Promise<number>;
  setBalance(displayName: string, balance: number): Promise<void>;
  setDefaultStartingBalance(balance: number): void;
}

export type TokenCheck = 'match' | 'unclaimed' | 'mismatch';

// Who owns a display name (audit C5). The first browser to sit down under a name gets a random
// token and keeps it; from then on only that token can take the seat or reconnect to it. A name
// with no token (new, from before tokens existed, or released by the admin) is claimed by the
// next join. Kept in the balances file so a balance and its owner are written atomically together.
export interface IdentityStore {
  checkToken(displayName: string, token: string | undefined): Promise<TokenCheck>;
  /** Binds a new token to a name that has none and returns it; rejects if the name has one. */
  issueToken(displayName: string): Promise<string>;
  /** Forgets the name's token and keeps its balance. False if the name was never stored. */
  releaseName(displayName: string): Promise<boolean>;
}

interface PlayerRecord {
  name: string;
  balance?: number;
  tokenHash?: string;
}

type PlayerMap = Record<string, PlayerRecord>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class JsonPlayerStore implements PlayerStore, IdentityStore {
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
  private v1BackupDone = false;

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

  private async readAll(): Promise<PlayerMap> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.create(null) as PlayerMap;
      }
      if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new Error(
          `PLAYER_STORE_PATH is set to "${this.filePath}", but that path is a directory, not a file.`
        );
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
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
      return Object.create(null) as PlayerMap;
    }
    return this.toPlayerMap(parsed);
  }

  // Reads both formats. v1 was `{ "<raw name>": balance }`, keyed by the exact name typed, so
  // "Bob" and "bob" could both exist; v2 is keyed by nameKey. The first v1 read is copied aside
  // first, because the next write replaces it with v2 and a v1 case collision keeps only one entry.
  private async toPlayerMap(parsed: unknown): Promise<PlayerMap> {
    // Null-prototype object: a plain {} would let a displayName like "constructor"/"toString"/
    // "__proto__" resolve to an inherited Object.prototype member instead of `undefined`, so
    // `data[k]?.balance ?? default` could return a non-number and brick any table that player joins (C3).
    const data = Object.create(null) as PlayerMap;
    if (typeof parsed !== 'object' || parsed === null) {
      return data;
    }
    let sawV1 = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') {
        sawV1 = true;
        const k = nameKey(key);
        const existing = data[k];
        if (existing && (existing.balance ?? 0) >= value) {
          console.warn(`PlayerStore: "${key}" (${value}) and "${existing.name}" are now one player; keeping ${existing.balance}`);
          continue;
        }
        if (existing) {
          console.warn(`PlayerStore: "${existing.name}" (${existing.balance}) and "${key}" are now one player; keeping ${value}`);
        }
        data[k] = { name: key, balance: value };
      } else if (typeof value === 'object' && value !== null && typeof (value as PlayerRecord).name === 'string') {
        const record = value as PlayerRecord;
        data[key] = {
          name: record.name,
          ...(typeof record.balance === 'number' ? { balance: record.balance } : {}),
          // A hand-edited, broken hash behaves like a released name: dropped here so checkToken
          // says 'unclaimed' and issueToken can claim it, instead of the two disagreeing.
          ...(typeof record.tokenHash === 'string' && /^[0-9a-f]{64}$/.test(record.tokenHash)
            ? { tokenHash: record.tokenHash }
            : {}),
        };
      }
    }
    if (sawV1 && !this.v1BackupDone) {
      try {
        await copyFile(this.filePath, `${this.filePath}.v1-backup`, constants.COPYFILE_EXCL);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          console.error(`PlayerStore: could not back up the old balances file:`, err);
        }
      }
      this.v1BackupDone = true;
    }
    return data;
  }

  private async writeAll(data: PlayerMap): Promise<void> {
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
      return data[nameKey(displayName)]?.balance ?? this.defaultStartingBalance;
    });
  }

  async setBalance(displayName: string, balance: number): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      const k = nameKey(displayName);
      data[k] = { ...data[k], name: data[k]?.name ?? displayName, balance };
      await this.writeAll(data);
    });
  }

  async checkToken(displayName: string, token: string | undefined): Promise<TokenCheck> {
    return this.enqueue(async () => {
      const stored = (await this.readAll())[nameKey(displayName)]?.tokenHash;
      if (!stored) {
        return 'unclaimed';
      }
      if (token === undefined) {
        return 'mismatch';
      }
      return timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(hashToken(token), 'hex')) ? 'match' : 'mismatch';
    });
  }

  async issueToken(displayName: string): Promise<string> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      const k = nameKey(displayName);
      if (data[k]?.tokenHash) {
        throw new Error(`"${displayName}" is already claimed`);
      }
      const token = randomBytes(32).toString('base64url');
      data[k] = { ...data[k], name: data[k]?.name ?? displayName, tokenHash: hashToken(token) };
      await this.writeAll(data);
      return token;
    });
  }

  async releaseName(displayName: string): Promise<boolean> {
    return this.enqueue(async () => {
      const data = await this.readAll();
      const record = data[nameKey(displayName)];
      if (!record) {
        return false;
      }
      delete record.tokenHash;
      await this.writeAll(data);
      return true;
    });
  }

  setDefaultStartingBalance(balance: number): void {
    this.defaultStartingBalance = balance;
  }
}
