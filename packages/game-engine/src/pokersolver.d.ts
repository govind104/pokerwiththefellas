declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    /** The cards that make the hand, best first; `value` is A K Q J T 9…2 (a wheel straight's ace is '1'). */
    cards: { value: string; suit: string }[];
  }
}
