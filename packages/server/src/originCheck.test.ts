import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from './originCheck';

describe('isAllowedOrigin (audit I7)', () => {
  it('allows a request with no Origin (same-origin polling, bots, tests)', () => {
    expect(isAllowedOrigin({ host: 'localhost:3000' }, [])).toBe(true);
  });

  it('allows an Origin whose host matches the Host header, ignoring case', () => {
    expect(isAllowedOrigin({ origin: 'http://LocalHost:5173', host: 'localhost:5173' }, [])).toBe(true);
  });

  it('allows an Origin matching X-Forwarded-Host (a reverse proxy such as Tailscale Serve)', () => {
    expect(
      isAllowedOrigin({ origin: 'https://box.tail1.ts.net', host: '127.0.0.1:3000', 'x-forwarded-host': 'box.tail1.ts.net' }, [])
    ).toBe(true);
  });

  it('allows an Origin listed in ALLOWED_ORIGINS', () => {
    expect(isAllowedOrigin({ origin: 'https://box.tail1.ts.net', host: '127.0.0.1:3000' }, ['https://box.tail1.ts.net'])).toBe(true);
  });

  it.each([['http://evil.example'], ['null'], ['not a url']])('refuses Origin %j', (origin) => {
    expect(isAllowedOrigin({ origin, host: 'localhost:3000' }, [])).toBe(false);
  });
});
