import { describe, it, expect } from 'vitest';
import { BlackjackRound } from './index';

describe('package public API', () => {
  it('exports a constructible BlackjackRound from the package entry point', () => {
    const round = new BlackjackRound(100, { deckCount: 1 });
    expect(round).toBeInstanceOf(BlackjackRound);
    expect(round.playerHands).toHaveLength(1);
  });
});
