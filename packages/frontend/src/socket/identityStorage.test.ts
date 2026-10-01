import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_STORAGE_KEY,
  forgetLastName,
  readLastName,
  rememberIdentity,
  resetIdentityMemoryForTests,
  tokenFor,
} from './identityStorage';

describe('identityStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetIdentityMemoryForTests();
  });
  afterEach(() => vi.restoreAllMocks());

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

  it('keeps the token for this tab when storage is blocked (audit C5)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    rememberIdentity('alice', 'tok-a');
    expect(tokenFor('alice')).toBe('tok-a');
    expect(readLastName()).toBe('alice');
    forgetLastName();
    expect(readLastName()).toBeNull();
    expect(tokenFor('alice')).toBe('tok-a');
  });

  it('keeps the token for this tab when only writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    rememberIdentity('alice', 'tok-a');
    expect(tokenFor('alice')).toBe('tok-a');
  });

  it('finds a token under the name the server will normalise a typed name to', () => {
    rememberIdentity('Bob Smith', 'tok-b');
    expect(tokenFor('Bob  Smith')).toBe('tok-b');
    expect(tokenFor(`bob${String.fromCharCode(0x200b)} smith`)).toBe('tok-b');
    rememberIdentity('Carl  Jones', 'tok-c');
    expect(tokenFor('carl jones')).toBe('tok-c');
  });
});
