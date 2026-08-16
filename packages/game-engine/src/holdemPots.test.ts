import { describe, it, expect } from 'vitest';
import { computePots } from './holdemPots';

describe('computePots', () => {
  it('creates a single pot when everyone contributed equally', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 300, eligiblePlayerIds: ['a', 'b', 'c'] }]);
  });

  it('builds a main pot plus two side pots for three uneven all-ins', () => {
    // Reference scenario: main pot 1200 (4x300), side pot 600 (3x200), side pot 800 (2x400).
    const pots = computePots([
      { playerId: 'p1', amount: 300, folded: false },
      { playerId: 'p2', amount: 500, folded: false },
      { playerId: 'p3', amount: 900, folded: false },
      { playerId: 'p4', amount: 900, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 1200, eligiblePlayerIds: ['p1', 'p2', 'p3', 'p4'] },
      { amount: 600, eligiblePlayerIds: ['p2', 'p3', 'p4'] },
      { amount: 800, eligiblePlayerIds: ['p3', 'p4'] },
    ]);
  });

  it('excludes a folded player from eligibility while still counting their chips toward pot size', () => {
    // P1 posts 100 then folds; P2 stays in for 100; P3 is all-in for 50.
    const pots = computePots([
      { playerId: 'p1', amount: 100, folded: true },
      { playerId: 'p2', amount: 100, folded: false },
      { playerId: 'p3', amount: 50, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligiblePlayerIds: ['p2', 'p3'] }, // layer 0-50, all 3 contributed, p1 excluded (folded)
      { amount: 100, eligiblePlayerIds: ['p2'] }, // layer 50-100, only p1 and p2 contributed, p1 excluded (folded)
    ]);
  });

  it('handles a four-way uneven all-in with one fold mixed in', () => {
    // p1 all-in 50 and stays; p2 contributes 200 then folds; p3 all-in 150 and stays; p4 contributes 200 and stays.
    const pots = computePots([
      { playerId: 'p1', amount: 50, folded: false },
      { playerId: 'p2', amount: 200, folded: true },
      { playerId: 'p3', amount: 150, folded: false },
      { playerId: 'p4', amount: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligiblePlayerIds: ['p1', 'p3', 'p4'] }, // layer 0-50, 4 contributors, p2 excluded
      { amount: 300, eligiblePlayerIds: ['p3', 'p4'] }, // layer 50-150, p1 drops out (only contributed 50), p2 excluded
      { amount: 100, eligiblePlayerIds: ['p4'] }, // layer 150-200, p3 drops out, p2 excluded
    ]);
  });

  it('ignores players who contributed nothing', () => {
    const pots = computePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 0, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 200, eligiblePlayerIds: ['a', 'b'] }]);
  });
});
