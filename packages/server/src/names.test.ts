import { describe, it, expect } from 'vitest';
import { normaliseDisplayName, nameKey, sameName, MAX_DISPLAY_NAME_LENGTH } from './names';

describe('normaliseDisplayName (audit M8)', () => {
  it.each([
    ['  alice  ', 'alice'],
    ['ali\u200Bce', 'alice'], // zero-width space
    ['\u202Eevil', 'evil'], // right-to-left override
    ['a\u0007b', 'ab'], // control character
    ['a \t\n  b', 'a b'],
    ['\uFF22\uFF4F\uFF42', 'Bob'], // full-width letters (NFKC)
    ['Bob', 'Bob'], // case is kept for display
  ])('normalises %j to %j', (raw, expected) => {
    expect(normaliseDisplayName(raw)).toBe(expected);
  });

  it.each([[''], ['   '], ['\u200B\u200B'], [42], [null], [undefined], [{}], ['x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)]])(
    'rejects %j',
    (raw) => {
      expect(normaliseDisplayName(raw)).toBeNull();
    }
  );

  it('accepts a name of exactly the maximum length', () => {
    expect(normaliseDisplayName('x'.repeat(MAX_DISPLAY_NAME_LENGTH))).toBe('x'.repeat(MAX_DISPLAY_NAME_LENGTH));
  });
});

describe('nameKey / sameName', () => {
  it('ignores case', () => {
    expect(nameKey('Bob')).toBe(nameKey('bob'));
    expect(sameName('ALICE', 'alice')).toBe(true);
  });

  it('treats null and different names as different', () => {
    expect(sameName(null, 'alice')).toBe(false);
    expect(sameName('alice', 'alicia')).toBe(false);
  });
});
