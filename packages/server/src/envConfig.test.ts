import { describe, it, expect } from 'vitest';
import { readEnvConfig } from './envConfig';

describe('readEnvConfig (audit I4)', () => {
  it('uses the defaults when nothing is set, and treats a blank value as unset', () => {
    expect(readEnvConfig({ SMALL_BLIND: '', RECONNECT_GRACE_MS: '  ' })).toEqual({
      port: 3000,
      reconnectGraceMs: 120_000,
      configDefaults: { smallBlind: 5, bigBlind: 10, blackjackDefaultBet: 25, defaultStartingBalance: 1000 },
    });
  });

  it('reads valid values', () => {
    expect(
      readEnvConfig({
        PORT: '8080',
        RECONNECT_GRACE_MS: '30000',
        SMALL_BLIND: '10',
        BIG_BLIND: '20',
        BLACKJACK_DEFAULT_BET: '50',
        DEFAULT_STARTING_BALANCE: '2000',
      })
    ).toEqual({
      port: 8080,
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
      expect(() => readEnvConfig({ [name]: value })).toThrow(name);
    });
  }

  it('refuses a small blind larger than the big blind', () => {
    expect(() => readEnvConfig({ SMALL_BLIND: '50', BIG_BLIND: '10' })).toThrow(/SMALL_BLIND.*BIG_BLIND/);
  });
});
