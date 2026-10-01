import { describe, it, expect } from 'vitest';
import { createAttemptLimiter } from './loginLimiter';

describe('createAttemptLimiter (audit I7)', () => {
  function setup() {
    let time = 1_000_000;
    const limiter = createAttemptLimiter({ maxFailures: 3, lockoutMs: 60_000, now: () => time });
    return { limiter, advance: (ms: number) => (time += ms) };
  }

  it('allows attempts until the limit, then locks for the lockout', () => {
    const { limiter, advance } = setup();
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(60_000);
    advance(59_000);
    expect(limiter.retryAfterMs('a')).toBe(1_000);
    advance(1_000);
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('counts each key separately', () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure('a');
    expect(limiter.retryAfterMs('b')).toBe(0);
  });

  it('a success clears the count', () => {
    const { limiter } = setup();
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    limiter.recordSuccess('a');
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
  });
});
