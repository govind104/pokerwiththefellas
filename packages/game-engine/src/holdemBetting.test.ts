import { describe, it, expect } from 'vitest';
import { computeBettingContext, validateAction, chipsToCommit } from './holdemBetting';

describe('computeBettingContext', () => {
  it('computes toCall and minRaiseTo from current bet and last raise size', () => {
    // Facing a bet of 20 (e.g. the big blind), last raise size 20 (the BB itself), already put in 10 (small blind).
    const context = computeBettingContext(20, 20, 10, 980);
    expect(context).toEqual({ toCall: 10, minRaiseTo: 40, playerStack: 980, playerStreetContributed: 10 });
  });

  it('computes a zero toCall when the player has already matched the current bet', () => {
    const context = computeBettingContext(20, 20, 20, 980);
    expect(context.toCall).toBe(0);
  });
});

describe('validateAction', () => {
  it('always allows folding', () => {
    const context = computeBettingContext(20, 20, 0, 100);
    expect(() => validateAction(context, 'fold')).not.toThrow();
  });

  it('allows checking when there is nothing to call', () => {
    const context = computeBettingContext(0, 20, 0, 100);
    expect(() => validateAction(context, 'check')).not.toThrow();
  });

  it('rejects checking while facing a bet', () => {
    const context = computeBettingContext(20, 20, 0, 100);
    expect(() => validateAction(context, 'check')).toThrow('Cannot check while facing a bet');
  });

  it('rejects calling when there is nothing to call', () => {
    const context = computeBettingContext(0, 20, 0, 100);
    expect(() => validateAction(context, 'call')).toThrow('Cannot call when there is nothing to call');
  });

  it('allows calling when the player can afford it', () => {
    const context = computeBettingContext(20, 20, 0, 100);
    expect(() => validateAction(context, 'call')).not.toThrow();
  });

  it('rejects calling when the player cannot afford a full call', () => {
    const context = computeBettingContext(100, 20, 0, 30);
    expect(() => validateAction(context, 'call')).toThrow('Not enough chips to call in full — go all-in instead');
  });

  it('rejects a raise below the minimum', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise', 30)).toThrow('Raise must be to at least 40');
  });

  it('allows a raise at or above the minimum', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise', 40)).not.toThrow();
    expect(() => validateAction(context, 'raise', 100)).not.toThrow();
  });

  it('rejects a raise with no amount given', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise')).toThrow('Raise requires an amount');
  });

  it('rejects a raise the player cannot afford', () => {
    const context = computeBettingContext(20, 20, 0, 35);
    expect(() => validateAction(context, 'raise', 40)).toThrow('Not enough chips for that raise — go all-in instead');
  });

  it('allows going all-in with a positive stack', () => {
    const context = computeBettingContext(100, 20, 0, 30);
    expect(() => validateAction(context, 'all-in')).not.toThrow();
  });

  it('rejects going all-in with no chips left', () => {
    const context = computeBettingContext(20, 20, 20, 0);
    expect(() => validateAction(context, 'all-in')).toThrow('No chips left to go all-in with');
  });

  it('treats a raise from a zero current bet as opening a bet, with minRaiseTo equal to lastRaiseSize', () => {
    const context = computeBettingContext(0, 20, 0, 500);
    expect(context.minRaiseTo).toBe(20);
    expect(() => validateAction(context, 'raise', 20)).not.toThrow();
    expect(() => validateAction(context, 'raise', 10)).toThrow('Raise must be to at least 20');
  });

  it('rejects a non-finite raise amount', () => {
    const context = computeBettingContext(20, 20, 0, 500);
    expect(() => validateAction(context, 'raise', NaN)).toThrow('Raise amount must be a finite number');
    expect(() => validateAction(context, 'raise', Infinity)).toThrow('Raise amount must be a finite number');
  });

  it('allows a call that uses exactly the entire remaining stack', () => {
    const context = computeBettingContext(20, 20, 0, 20);
    expect(() => validateAction(context, 'call')).not.toThrow();
  });

  it('allows a raise that uses exactly the entire remaining stack', () => {
    const context = computeBettingContext(20, 20, 0, 40);
    expect(() => validateAction(context, 'raise', 40)).not.toThrow();
  });
});

describe('chipsToCommit', () => {
  it('commits nothing for fold or check', () => {
    const context = computeBettingContext(0, 20, 0, 100);
    expect(chipsToCommit(context, 'fold')).toBe(0);
    expect(chipsToCommit(context, 'check')).toBe(0);
  });

  it('commits exactly toCall for a call', () => {
    const context = computeBettingContext(20, 20, 5, 100);
    expect(chipsToCommit(context, 'call')).toBe(15);
  });

  it('commits amount minus what was already in for a raise', () => {
    const context = computeBettingContext(20, 20, 5, 100);
    expect(chipsToCommit(context, 'raise', 60)).toBe(55);
  });

  it('commits the entire remaining stack for all-in', () => {
    const context = computeBettingContext(20, 20, 5, 47);
    expect(chipsToCommit(context, 'all-in')).toBe(47);
  });
});
