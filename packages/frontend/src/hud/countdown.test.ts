import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { secondsLeft, useCountdown } from './countdown';

describe('secondsLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(secondsLeft(10_000, 0, 0)).toBe(10);
    expect(secondsLeft(10_000, 0, 2_100)).toBe(8);
    expect(secondsLeft(1_000, 0, 5_000)).toBe(0);
  });
});

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down locally from when the value arrived, restarts on a new value, and stops on null', () => {
    const { result, rerender } = renderHook(({ ms }: { ms: number | null }) => useCountdown(ms), { initialProps: { ms: 10_000 } as { ms: number | null } });
    expect(result.current).toBe(10);
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(result.current).toBe(8);
    rerender({ ms: 30_000 });
    expect(result.current).toBe(30);
    rerender({ ms: null });
    expect(result.current).toBeNull();
  });

  // Consecutive turns usually carry exactly the configured clock, so the value alone cannot tell
  // the hook a new turn began; the table's actionSeq is the reset key.
  it('restarts when the same value arrives again under a new key', () => {
    const { result, rerender } = renderHook(
      ({ ms, resetKey }: { ms: number | null; resetKey: number }) => useCountdown(ms, resetKey),
      { initialProps: { ms: 10_000, resetKey: 1 } as { ms: number | null; resetKey: number } },
    );
    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    expect(result.current).toBe(6);
    rerender({ ms: 10_000, resetKey: 1 }); // the same view again: keeps counting
    expect(result.current).toBe(6);
    rerender({ ms: 10_000, resetKey: 2 }); // next turn, same ms: starts over
    expect(result.current).toBe(10);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(result.current).toBe(9);
  });
});
