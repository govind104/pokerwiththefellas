import { useEffect, useState } from 'react';

// The server sends the time left when it built the view; the client counts down from the moment
// that view arrived, so the host's and players' clocks never need to agree (Plan B spec §3 item 3).
export function secondsLeft(remainingMs: number, receivedAt: number, now: number): number {
  return Math.max(0, Math.ceil((remainingMs - (now - receivedAt)) / 1000));
}

export function useCountdown(remainingMs: number | null): number | null {
  const [state, setState] = useState(() => ({ ms: remainingMs, at: Date.now(), now: Date.now() }));
  if (state.ms !== remainingMs) {
    // A new value from the server restarts the countdown from now.
    const t = Date.now();
    setState({ ms: remainingMs, at: t, now: t });
  }
  useEffect(() => {
    if (remainingMs === null) return;
    const id = setInterval(() => setState((s) => ({ ...s, now: Date.now() })), 250);
    return () => clearInterval(id);
  }, [remainingMs]);
  return remainingMs === null ? null : secondsLeft(remainingMs, state.at, state.now);
}
