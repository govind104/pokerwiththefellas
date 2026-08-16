export interface PlayerContribution {
  playerId: string;
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export function computePots(contributions: PlayerContribution[]): Pot[] {
  const levels = Array.from(new Set(contributions.map((c) => c.amount).filter((a) => a > 0))).sort(
    (a, b) => a - b
  );

  const pots: Pot[] = [];
  let previousLevel = 0;

  for (const level of levels) {
    const contributingPlayers = contributions.filter((c) => c.amount >= level);
    const eligiblePlayerIds = contributingPlayers.filter((c) => !c.folded).map((c) => c.playerId);

    if (eligiblePlayerIds.length > 0) {
      const amount = (level - previousLevel) * contributingPlayers.length;
      pots.push({ amount, eligiblePlayerIds });
    }

    previousLevel = level;
  }

  return pots;
}
