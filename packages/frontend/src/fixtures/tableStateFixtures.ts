import type {
  TableStateView,
  SeatView,
  HoldemView,
  BlackjackRoundView,
} from '@poker-blackjack/server/src/table';

export function makeSeat(overrides: Partial<SeatView> = {}): SeatView {
  return {
    seatIndex: 0,
    displayName: 'alice',
    balance: 1000,
    connected: true,
    ready: true,
    ...overrides,
  };
}

export function makeWaitingState(overrides: Partial<TableStateView> = {}): TableStateView {
  return {
    gameMode: 'holdem',
    handInProgress: false,
    activeSeatIndex: null,
    blackjackRounds: null,
    holdem: null,
    seats: [
      makeSeat({ seatIndex: 0, displayName: 'alice', ready: false }),
      makeSeat({ seatIndex: 1, displayName: 'bob', ready: false }),
    ],
    ...overrides,
  };
}

export function makeHoldemPreflopState(overrides: Partial<TableStateView> = {}): TableStateView {
  const holdem: HoldemView = {
    street: 'preflop',
    communityCards: [],
    actingPlayerId: 'alice',
    pots: [{ amount: 15, eligiblePlayerIds: ['alice', 'bob'] }],
    results: null,
    players: [
      {
        playerId: 'alice',
        stack: 990,
        streetContributed: 10,
        folded: false,
        isAllIn: false,
        holeCards: [
          { suit: 'spades', rank: 'A' },
          { suit: 'hearts', rank: 'K' },
        ],
      },
      {
        playerId: 'bob',
        stack: 995,
        streetContributed: 5,
        folded: false,
        isAllIn: false,
        holeCards: null,
      },
    ],
  };
  return {
    gameMode: 'holdem',
    handInProgress: true,
    activeSeatIndex: null,
    blackjackRounds: null,
    holdem,
    seats: [
      makeSeat({ seatIndex: 0, displayName: 'alice', balance: 990 }),
      makeSeat({ seatIndex: 1, displayName: 'bob', balance: 995 }),
    ],
    ...overrides,
  };
}

export function makeHoldemMyTurnState(overrides: Partial<TableStateView> = {}): TableStateView {
  return makeHoldemPreflopState({
    holdem: {
      street: 'preflop',
      communityCards: [],
      actingPlayerId: 'alice',
      pots: [{ amount: 15, eligiblePlayerIds: ['alice', 'bob'] }],
      results: null,
      players: [
        {
          playerId: 'alice',
          stack: 990,
          streetContributed: 10,
          folded: false,
          isAllIn: false,
          holeCards: [
            { suit: 'spades', rank: 'A' },
            { suit: 'hearts', rank: 'K' },
          ],
        },
        {
          playerId: 'bob',
          stack: 995,
          streetContributed: 5,
          folded: false,
          isAllIn: false,
          holeCards: null,
        },
      ],
    },
    ...overrides,
  });
}

export function makeBlackjackPlayingState(overrides: Partial<TableStateView> = {}): TableStateView {
  const blackjackRounds: Record<number, BlackjackRoundView> = {
    0: {
      phase: 'playing',
      playerHands: [
        {
          cards: [
            { suit: 'clubs', rank: '10' },
            { suit: 'diamonds', rank: '7' },
          ],
          bet: 25,
          doubled: false,
          done: false,
        },
      ],
      dealerUpcard: { suit: 'hearts', rank: '9' },
      dealerCards: null,
      results: null,
    },
  };
  return {
    gameMode: 'blackjack',
    handInProgress: true,
    activeSeatIndex: 0,
    blackjackRounds,
    holdem: null,
    seats: [makeSeat({ seatIndex: 0, displayName: 'alice', balance: 975 })],
    ...overrides,
  };
}
