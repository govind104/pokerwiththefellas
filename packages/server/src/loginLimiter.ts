// Brute-force guard for the admin passphrase (audit I7: 5000 wrong guesses were answered in
// 198 ms). Keyed by client address. Behind Tailscale Serve every client arrives from 127.0.0.1,
// so the limit is effectively shared by everyone; that is acceptable, since only the host logs in.
export interface AttemptLimiter {
  /** 0 if an attempt may be made now, otherwise the milliseconds until one may. */
  retryAfterMs(key: string): number;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
}

export function createAttemptLimiter({
  maxFailures = 5,
  lockoutMs = 60_000,
  now = Date.now,
}: { maxFailures?: number; lockoutMs?: number; now?: () => number } = {}): AttemptLimiter {
  const entries = new Map<string, { failures: number; lockedUntil: number }>();
  return {
    retryAfterMs(key) {
      const entry = entries.get(key);
      return entry ? Math.max(0, entry.lockedUntil - now()) : 0;
    },
    recordFailure(key) {
      const entry = entries.get(key) ?? { failures: 0, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= maxFailures) {
        entry.failures = 0;
        entry.lockedUntil = now() + lockoutMs;
      }
      entries.set(key, entry);
    },
    recordSuccess(key) {
      entries.delete(key);
    },
  };
}
