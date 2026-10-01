import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_STORAGE_KEY, forgetLastName, readLastName, rememberIdentity, tokenFor } from './identityStorage';

describe('identityStorage', () => {
  beforeEach(() => localStorage.clear());

  it('is empty at first', () => {
    expect(readLastName()).toBeNull();
    expect(tokenFor('alice')).toBeUndefined();
  });

  it('remembers a token per name, case-insensitively, and the last name used', () => {
    rememberIdentity('Alice', 'tok-a');
    rememberIdentity('bob', 'tok-b');
    expect(tokenFor('ALICE')).toBe('tok-a');
    expect(tokenFor('bob')).toBe('tok-b');
    expect(readLastName()).toBe('bob');
  });

  it('forgetLastName keeps the tokens', () => {
    rememberIdentity('alice', 'tok-a');
    forgetLastName();
    expect(readLastName()).toBeNull();
    expect(tokenFor('alice')).toBe('tok-a');
  });

  it('survives garbage in storage', () => {
    localStorage.setItem(IDENTITY_STORAGE_KEY, '{not json');
    expect(readLastName()).toBeNull();
    rememberIdentity('alice', 'tok-a');
    expect(tokenFor('alice')).toBe('tok-a');
  });

  it('ignores inherited keys', () => {
    expect(tokenFor('constructor')).toBeUndefined();
  });
});
