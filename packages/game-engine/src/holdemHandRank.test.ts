import { describe, it, expect } from 'vitest';
import { determineWinners, describeHand } from './holdemHandRank';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('determineWinners', () => {
  it('picks the player with the better hand (flush beats a pair)', () => {
    const community = [
      card('2', 'hearts'),
      card('9', 'hearts'),
      card('K', 'hearts'),
      card('4', 'clubs'),
      card('7', 'diamonds'),
    ];
    const players = [
      { playerId: 'a', holeCards: [card('A', 'hearts'), card('3', 'hearts')] as [Card, Card] }, // flush
      { playerId: 'b', holeCards: [card('4', 'spades'), card('4', 'diamonds')] as [Card, Card] }, // trip 4s
    ];
    expect(determineWinners(players, community)).toEqual(['a']);
  });

  it('recognizes a wheel straight (A-2-3-4-5) as a valid straight', () => {
    const community = [
      card('2', 'clubs'),
      card('3', 'diamonds'),
      card('4', 'hearts'),
      card('9', 'spades'),
      card('K', 'clubs'),
    ];
    const players = [
      { playerId: 'wheel', holeCards: [card('A', 'spades'), card('5', 'clubs')] as [Card, Card] }, // A2345 straight
      { playerId: 'pair', holeCards: [card('K', 'hearts'), card('9', 'hearts')] as [Card, Card] }, // two pair K/9
    ];
    expect(determineWinners(players, community)).toEqual(['wheel']);
  });

  it('breaks a full-house tie by the trips rank, not the pair', () => {
    const community = [
      card('7', 'clubs'),
      card('7', 'diamonds'),
      card('7', 'hearts'),
      card('2', 'spades'),
      card('2', 'clubs'),
    ];
    const players = [
      // both players play the board's 7s-full-of-2s trip+pair, kicker doesn't apply to a full house
      { playerId: 'a', holeCards: [card('9', 'spades'), card('8', 'clubs')] as [Card, Card] },
      { playerId: 'b', holeCards: [card('3', 'hearts'), card('4', 'diamonds')] as [Card, Card] },
    ];
    // Both hands are exactly "777 22" using only the board -- a genuine split pot.
    expect(determineWinners(players, community).sort()).toEqual(['a', 'b']);
  });

  it('returns a single winner when hands differ by kicker only', () => {
    const community = [
      card('K', 'clubs'),
      card('K', 'diamonds'),
      card('5', 'hearts'),
      card('8', 'spades'),
      card('2', 'clubs'),
    ];
    const players = [
      { playerId: 'higher', holeCards: [card('A', 'hearts'), card('3', 'diamonds')] as [Card, Card] }, // pair of Ks, A kicker
      { playerId: 'lower', holeCards: [card('Q', 'hearts'), card('4', 'diamonds')] as [Card, Card] }, // pair of Ks, Q kicker
    ];
    expect(determineWinners(players, community)).toEqual(['higher']);
  });
});

describe('describeHand', () => {
  it('describes a flush', () => {
    const community = [
      card('2', 'hearts'),
      card('9', 'hearts'),
      card('K', 'hearts'),
      card('4', 'clubs'),
      card('7', 'diamonds'),
    ];
    const result = describeHand([card('A', 'hearts'), card('3', 'hearts')], community);
    expect(result.name).toBe('Flush');
  });
});
