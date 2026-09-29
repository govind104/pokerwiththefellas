import type { BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { Card, PlayerHand } from '@poker-blackjack/game-engine';
import { blackjackAvailability } from './blackjackActions';

const c = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ rank, suit });
const hand = (cards: Card[], bet = 25, done = false): PlayerHand => ({ cards, bet, doubled: false, done });
const round = (hands: PlayerHand[]): BlackjackRoundView => ({
  phase: 'playing',
  playerHands: hands,
  dealerUpcard: c('K'),
  dealerCards: null,
  results: null,
});

describe('blackjackAvailability', () => {
  it('allows Double on two cards and Split only on a pair', () => {
    expect(blackjackAvailability(round([hand([c('7'), c('4')])]), 1000)).toEqual({ double: true, split: false });
    expect(blackjackAvailability(round([hand([c('8'), c('8', 'hearts')])]), 1000)).toEqual({ double: true, split: true });
  });

  it('treats any two ten-value cards as a pair, like the engine', () => {
    expect(blackjackAvailability(round([hand([c('K'), c('10')])]), 1000).split).toBe(true);
  });

  it('blocks both once the hand has three cards', () => {
    expect(blackjackAvailability(round([hand([c('2'), c('3'), c('4')])]), 1000)).toEqual({ double: false, split: false });
  });

  it('allows Split only once per round (a second hand means it was already used)', () => {
    const r = round([hand([c('8'), c('8', 'hearts')]), hand([c('8', 'clubs'), c('8', 'diamonds')])]);
    expect(blackjackAvailability(r, 1000).split).toBe(false);
    expect(blackjackAvailability(r, 1000).double).toBe(true);
  });

  it('requires the balance to cover another copy of the active hand’s bet on top of what is already staked', () => {
    const r = round([hand([c('8'), c('8', 'hearts')], 25)]);
    expect(blackjackAvailability(r, 49)).toEqual({ double: false, split: false });
    expect(blackjackAvailability(r, 50)).toEqual({ double: true, split: true });
  });

  it('is all false when there is nothing to act on', () => {
    expect(blackjackAvailability(undefined, 1000)).toEqual({ double: false, split: false });
    expect(blackjackAvailability(round([hand([c('7'), c('4')], 25, true)]), 1000)).toEqual({ double: false, split: false });
  });
});
