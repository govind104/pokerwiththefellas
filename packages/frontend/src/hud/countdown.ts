import { useEffect, useState } from 'react';

// The server sends the time left when it built the view; the client counts down from the moment
// that view arrived, so the host's and players' clocks never need to agree (Plan B spec §3 item 3).
export function secondsLeft(remainingMs: number, receivedAt: number, now: number): number {
  return Math.max(0, Math.ceil((remainingMs - (now - receivedAt)) / 1000));
}

// `resetKey` is the table's actionSeq: consecutive turns usually carry exactly the configured clock
// (the same ms), so the value alone cannot tell a new turn from a repeat of the same view.
export function useCountdown(remainingMs: number | null, resetKey: number | null = null): number | null {
  const [state, setState] = useState(() => {
    const t = Date.now();
    return { ms: remainingMs, key: resetKey, at: t, now: t };
  });
  if (state.ms !== remainingMs || state.key !== resetKey) {
    // A new value or a new turn from the server restarts the countdown from now.
    const t = Date.now();
    setState({ ms: remainingMs, key: resetKey, at: t, now: t });
  }
  useEffect(() => {
    if (remainingMs === null) return;
    const id = setInterval(() => setState((s) => ({ ...s, now: Date.now() })), 250);
    return () => clearInterval(id);
  }, [remainingMs, resetKey]);
  return remainingMs === null ? null : secondsLeft(remainingMs, state.at, state.now);
}
