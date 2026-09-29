import { describe, it, expect } from 'vitest';
import { BlackjackRound, SharedDealer } from './blackjackRound';
import { Card } from './deck';

function card(rank: Card['rank'], suit: Card['suit'] = 'spades'): Card {
  return { rank, suit };
}

// Shared shoe order: the dealer's two cards first, then each round is
// constructed in turn and takes its own two cards, then hits come off the top.
function table(shoe: Card[], bets: number[]) {
  const dealer = new SharedDealer({ shoe });
  const rounds = bets.map((b) => new BlackjackRound(b, { dealer }));
  return { dealer, rounds };
}

describe('SharedDealer', () => {
  it('deals the dealer first and every round from the same shoe', () => {
    // Dealer: 9, 8. P0: 10, 7. P1: 6, 5.
    const { dealer, rounds } = table([card('9'), card('8'), card('10'), card('7'), card('6'), card('5')], [10, 10]);
    expect(dealer.getUpcard()).toEqual(card('9'));
    expect(rounds[0].playerHands[0].cards).toEqual([card('10'), card('7')]);
    expect(rounds[1].playerHands[0].cards).toEqual([card('6'), card('5')]);
    // Every round sees the same dealer.
    expect(rounds[0].getDealerUpcard()).toEqual(rounds[1].getDealerUpcard());
  });

  it('does not settle a round when only that player is finished', () => {
    const { rounds } = table([card('9'), card('8'), card('10'), card('7'), card('6'), card('5')], [10, 10]);
    rounds[0].act('stand');
    expect(rounds[0].playingComplete).toBe(true);
    expect(rounds[0].phase).toBe('playing');
    expect(rounds[0].results).toEqual([]);
    expect(rounds[1].playingComplete).toBe(false);
  });

  it('refuses to play the dealer while a player is still to act', () => {
    const { dealer, rounds } = table([card('9'), card('8'), card('10'), card('7'), card('6'), card('5')], [10, 10]);
    rounds[0].act('stand');
    expect(() => dealer.playAndSettle(rounds)).toThrow(/still to act/);
  });

  it('plays the dealer once after the last player and settles everyone against the same hand', () => {
    // Dealer: 6, 5 (11) draws 10 -> 21. P0: 10, 9 (19). P1: 10, 8 (18). Hit card for dealer: 10.
    const { dealer, rounds } = table(
      [card('6'), card('5'), card('10'), card('9'), card('10'), card('8'), card('10', 'hearts')],
      [10, 20]
    );
    rounds[0].act('stand');
    rounds[1].act('stand');
    dealer.playAndSettle(rounds);
    expect(dealer.getCards()).toEqual([card('6'), card('5'), card('10', 'hearts')]);
    expect(rounds[0].phase).toBe('settled');
    expect(rounds[1].phase).toBe('settled');
    expect(rounds[0].results).toEqual([{ outcome: 'lose', payout: -10 }]);
    expect(rounds[1].results).toEqual([{ outcome: 'lose', payout: -20 }]);
  });

  it('lets a later player hit off the same shoe the dealer draws from', () => {
    // Dealer: 10, 6 (16, must draw). P0: 10, 8 (18) stands. P1: 5, 5 (10) hits -> gets 4 (14), stands.
    // Remaining shoe: 4 (P1's hit), then 3 (dealer's draw -> 19).
    const { dealer, rounds } = table(
      [card('10'), card('6'), card('10'), card('8'), card('5'), card('5'), card('4'), card('3')],
      [10, 10]
    );
    rounds[0].act('stand');
    rounds[1].act('hit');
    expect(rounds[1].playerHands[0].cards[2]).toEqual(card('4'));
    rounds[1].act('stand');
    dealer.playAndSettle(rounds);
    expect(dealer.getCards()).toEqual([card('10'), card('6'), card('3')]);
    expect(rounds[0].results).toEqual([{ outcome: 'lose', payout: -10 }]); // 18 vs 19
    expect(rounds[1].results).toEqual([{ outcome: 'lose', payout: -10 }]); // 14 vs 19
  });

  it('does not draw for the dealer when every player has busted', () => {
    // Dealer: 6, 5 (11) -- shoe has NO further cards, so a dealer draw would throw.
    // P0: 10, 6 hits K -> bust. P1: 10, 7 hits Q -> bust.
    const { dealer, rounds } = table(
      [card('6'), card('5'), card('10'), card('6'), card('10'), card('7'), card('K'), card('Q')],
      [10, 10]
    );
    rounds[0].act('hit');
    rounds[1].act('hit');
    expect(rounds[0].hasLiveHand()).toBe(false);
    dealer.playAndSettle(rounds);
    expect(dealer.getCards()).toHaveLength(2);
    expect(rounds[0].results).toEqual([{ outcome: 'bust', payout: -10 }]);
    expect(rounds[1].results).toEqual([{ outcome: 'bust', payout: -10 }]);
  });

  it('still draws for the dealer when at least one player is live, even if others bust', () => {
    // Dealer: 6, 5 (11) draws 4 -> 15, draws 9 -> 24 bust. P0 busts, P1 stands on 17 and wins.
    const { dealer, rounds } = table(
      [card('6'), card('5'), card('10'), card('6'), card('10'), card('7'), card('K'), card('4'), card('9')],
      [10, 10]
    );
    rounds[0].act('hit'); // bust
    rounds[1].act('stand');
    dealer.playAndSettle(rounds);
    expect(rounds[0].results).toEqual([{ outcome: 'bust', payout: -10 }]);
    expect(rounds[1].results).toEqual([{ outcome: 'win', payout: 10 }]);
  });

  it('treats a table of naturals as already complete and settles on demand', () => {
    // Dealer: 9, 8 (17). P0: A, K (blackjack). P1: A, Q (blackjack).
    const { dealer, rounds } = table([card('9'), card('8'), card('A'), card('K'), card('A'), card('Q')], [10, 10]);
    expect(rounds.every((r) => r.playingComplete)).toBe(true);
    dealer.playAndSettle(rounds);
    expect(rounds[0].results).toEqual([{ outcome: 'blackjack', payout: 15 }]);
    expect(rounds[1].results).toEqual([{ outcome: 'blackjack', payout: 15 }]);
  });

  it('leaves a standalone round (no shared dealer) settling by itself, as before', () => {
    const round = new BlackjackRound(10, { shoe: [card('10'), card('9'), card('10'), card('8')] });
    round.act('stand');
    expect(round.phase).toBe('settled');
  });
});
