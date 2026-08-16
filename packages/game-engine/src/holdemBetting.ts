export type HoldemAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface BettingContext {
  toCall: number;
  minRaiseTo: number;
  playerStack: number;
  playerStreetContributed: number;
}

export function computeBettingContext(
  currentBet: number,
  lastRaiseSize: number,
  playerStreetContributed: number,
  playerStack: number
): BettingContext {
  return {
    toCall: currentBet - playerStreetContributed,
    minRaiseTo: currentBet + lastRaiseSize,
    playerStack,
    playerStreetContributed,
  };
}

export function validateAction(context: BettingContext, action: HoldemAction, amount?: number): void {
  switch (action) {
    case 'fold':
      return;
    case 'check':
      if (context.toCall !== 0) {
        throw new Error('Cannot check while facing a bet');
      }
      return;
    case 'call':
      if (context.toCall === 0) {
        throw new Error('Cannot call when there is nothing to call');
      }
      if (context.playerStack < context.toCall) {
        throw new Error('Not enough chips to call in full — go all-in instead');
      }
      return;
    case 'raise': {
      if (amount === undefined) {
        throw new Error('Raise requires an amount');
      }
      if (amount < context.minRaiseTo) {
        throw new Error(`Raise must be to at least ${context.minRaiseTo}`);
      }
      const additionalChipsNeeded = amount - context.playerStreetContributed;
      if (additionalChipsNeeded > context.playerStack) {
        throw new Error('Not enough chips for that raise — go all-in instead');
      }
      return;
    }
    case 'all-in':
      if (context.playerStack <= 0) {
        throw new Error('No chips left to go all-in with');
      }
      return;
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${exhaustiveCheck}`);
    }
  }
}

export function chipsToCommit(context: BettingContext, action: HoldemAction, amount?: number): number {
  switch (action) {
    case 'fold':
    case 'check':
      return 0;
    case 'call':
      return context.toCall;
    case 'raise':
      return (amount as number) - context.playerStreetContributed;
    case 'all-in':
      return context.playerStack;
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${exhaustiveCheck}`);
    }
  }
}
