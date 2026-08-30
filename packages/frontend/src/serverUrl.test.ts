import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './serverUrl';

describe('resolveServerUrl', () => {
  it('uses the explicit server URL when set, ignoring the page origin', () => {
    expect(resolveServerUrl('http://localhost:3000', 'http://100.64.1.2:5173')).toBe('http://localhost:3000');
  });

  it('falls back to the page origin when no explicit server URL is set', () => {
    expect(resolveServerUrl(undefined, 'http://100.64.1.2:8080')).toBe('http://100.64.1.2:8080');
  });
});
