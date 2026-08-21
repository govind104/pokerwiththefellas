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

export function makeHoldemSettledState(overrides: Partial<TableStateView> = {}): TableStateView {
  const holdem: HoldemView = {
    street: 'settled',
    communityCards: [
      { suit: 'clubs', rank: '2' },
      { suit: 'diamonds', rank: '7' },
      { suit: 'hearts', rank: 'Q' },
      { suit: 'spades', rank: 'J' },
      { suit: 'clubs', rank: '9' },
    ],
    actingPlayerId: null,
    pots: [{ amount: 30, eligiblePlayerIds: ['alice', 'bob', 'carol'] }],
    results: [
      { playerId: 'alice', payout: 20 },
      { playerId: 'bob', payout: -20 },
      { playerId: 'carol', payout: 0 },
    ],
    players: [
      {
        playerId: 'alice',
        stack: 1010,
        streetContributed: 0,
        folded: false,
        isAllIn: false,
        holeCards: [
          { suit: 'spades', rank: 'A' },
          { suit: 'hearts', rank: 'K' },
        ],
      },
      {
        playerId: 'bob',
        stack: 980,
        streetContributed: 0,
        folded: false,
        isAllIn: false,
        holeCards: [
          { suit: 'clubs', rank: '3' },
          { suit: 'diamonds', rank: '4' },
        ],
      },
      {
        playerId: 'carol',
        stack: 1000,
        streetContributed: 0,
        folded: false,
        isAllIn: false,
        holeCards: [
          { suit: 'hearts', rank: '5' },
          { suit: 'spades', rank: '6' },
        ],
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
      makeSeat({ seatIndex: 0, displayName: 'alice', balance: 1010 }),
      makeSeat({ seatIndex: 1, displayName: 'bob', balance: 980 }),
      makeSeat({ seatIndex: 2, displayName: 'carol', balance: 1000 }),
    ],
    ...overrides,
  };
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

export function makeBlackjackSplitHandState(overrides: Partial<TableStateView> = {}): TableStateView {
  return makeBlackjackPlayingState({
    activeSeatIndex: 0,
    blackjackRounds: {
      0: {
        phase: 'playing',
        playerHands: [
          { cards: [{ suit: 'clubs', rank: '8' }, { suit: 'diamonds', rank: '2' }], bet: 25, doubled: false, done: true },
          { cards: [{ suit: 'clubs', rank: '8' }, { suit: 'hearts', rank: '5' }], bet: 25, doubled: false, done: false },
        ],
        dealerUpcard: { suit: 'spades', rank: '6' },
        dealerCards: null,
        results: null,
      },
    },
    ...overrides,
  });
}

export function makeBlackjackSettledState(overrides: Partial<TableStateView> = {}): TableStateView {
  return makeBlackjackPlayingState({
    activeSeatIndex: null,
    blackjackRounds: {
      0: {
        phase: 'settled',
        playerHands: [
          {
            cards: [
              { suit: 'clubs', rank: '10' },
              { suit: 'diamonds', rank: '7' },
              { suit: 'hearts', rank: '9' },
            ],
            bet: 25,
            doubled: false,
            done: true,
          },
          {
            cards: [
              { suit: 'spades', rank: 'A' },
              { suit: 'hearts', rank: 'K' },
            ],
            bet: 25,
            doubled: false,
            done: true,
          },
        ],
        dealerUpcard: { suit: 'hearts', rank: '9' },
        dealerCards: [
          { suit: 'hearts', rank: '9' },
          { suit: 'clubs', rank: 'K' },
        ],
        results: [
          { outcome: 'bust', payout: -25 },
          { outcome: 'blackjack', payout: 37 },
        ],
      },
    },
    ...overrides,
  });
}
