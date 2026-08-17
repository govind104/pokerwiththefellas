declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
  }
}
