import { describe, it, expect } from 'vitest';
import { readEnvConfig } from './envConfig';

const BASE = { ADMIN_PASSPHRASE: 'a-good-passphrase' };

describe('readEnvConfig (audit I4, I7)', () => {
  it('uses the defaults when nothing is set, and treats a blank value as unset', () => {
    expect(readEnvConfig({ ...BASE, SMALL_BLIND: '', RECONNECT_GRACE_MS: '  ' })).toEqual({
      port: 3000,
      host: '127.0.0.1',
      allowedOrigins: [],
      adminPassphrase: 'a-good-passphrase',
      reconnectGraceMs: 120_000,
      configDefaults: { smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25, defaultStartingBalance: 1000 },
    });
  });

  it('reads valid values', () => {
    expect(
      readEnvConfig({
        ...BASE,
        PORT: '8080',
        RECONNECT_GRACE_MS: '30000',
        SMALL_BLIND: '10',
        BIG_BLIND: '20',
        BLACKJACK_DEFAULT_BET: '50',
        DEFAULT_STARTING_BALANCE: '2000',
      })
    ).toEqual({
      port: 8080,
      host: '127.0.0.1',
      allowedOrigins: [],
      adminPassphrase: 'a-good-passphrase',
      reconnectGraceMs: 30_000,
      configDefaults: { smallBlind: 10, bigBlind: 20, blackjackDefaultBet: 50, defaultStartingBalance: 2000 },
    });
  });

  const invalid: Array<[string, string]> = [
    ['SMALL_BLIND', 'abc'],
    ['BIG_BLIND', '0.5'],
    ['BLACKJACK_DEFAULT_BET', '0'],
    ['DEFAULT_STARTING_BALANCE', '-100'],
    ['RECONNECT_GRACE_MS', '-5'],
    ['PORT', '99999'],
  ];
  for (const [name, value] of invalid) {
    it(`refuses ${name}=${value}, naming the variable`, () => {
      expect(() => readEnvConfig({ ...BASE, [name]: value })).toThrow(name);
    });
  }

  it('refuses a small blind larger than the big blind', () => {
    expect(() => readEnvConfig({ ...BASE, SMALL_BLIND: '50', BIG_BLIND: '10' })).toThrow(/SMALL_BLIND.*BIG_BLIND/);
  });

  it('reads HOST and ALLOWED_ORIGINS', () => {
    const config = readEnvConfig({ ...BASE, HOST: '100.64.0.7', ALLOWED_ORIGINS: ' https://box.tail1.ts.net , http://localhost:5173 ' });
    expect(config.host).toBe('100.64.0.7');
    expect(config.allowedOrigins).toEqual(['https://box.tail1.ts.net', 'http://localhost:5173']);
  });

  it('refuses an ALLOWED_ORIGINS entry that is not a bare origin', () => {
    expect(() => readEnvConfig({ ...BASE, ALLOWED_ORIGINS: 'https://box.tail1.ts.net/game' })).toThrow('ALLOWED_ORIGINS');
  });

  it.each([
    [undefined, 'not set'],
    ['   ', 'not set'],
    ['change-me', 'change-me'],
    [' Change-Me ', 'change-me'],
    ['short', 'at least 8'],
  ])('refuses ADMIN_PASSPHRASE %j', (value, message) => {
    expect(() => readEnvConfig({ ADMIN_PASSPHRASE: value })).toThrow(message);
  });
});
