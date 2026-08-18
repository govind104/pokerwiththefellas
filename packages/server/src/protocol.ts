import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import type { TableStateView } from './table';

export interface JoinPayload {
  displayName: string;
}

export interface ActionPayload {
  action: PlayerAction | HoldemAction;
  amount?: number;
}

export interface ErrorPayload {
  message: string;
}

export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  ready: () => void;
  action: (payload: ActionPayload) => void;
  leave: () => void;
}

export interface ServerToClientEvents {
  state: (state: TableStateView) => void;
  error: (payload: ErrorPayload) => void;
}
