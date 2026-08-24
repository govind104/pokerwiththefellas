import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import type { AppStateView, GameMode } from './table';

export interface JoinPayload {
  displayName: string;
}

export interface ActionPayload {
  action: PlayerAction | HoldemAction;
  amount?: number;
}

export interface ErrorPayload {
  message: string;
  // Which error surface this belongs to. Absent means the default
  // join/table channel (JoinScreen's name field, GameTable's alert banner) --
  // deliberately optional so the many non-admin emitters (`join`, `ready`,
  // `action`, `leave`) need no change at all. Only the admin-action handlers
  // set `scope: 'admin'`, which routes the message to the admin panel's own
  // error surface instead of describing it to a screen reader as a problem
  // with the display-name input the admin never touched.
  scope?: 'admin';
}

export interface AdminLoginPayload {
  passphrase: string;
}

export interface AdminLoginResultPayload {
  success: boolean;
}

export interface StartGamePayload {
  mode: GameMode;
}

export interface AdjustBalancePayload {
  displayName: string;
  balance: number;
}

export interface SetBlindsPayload {
  smallBlind: number;
  bigBlind: number;
}

export interface SetDefaultBetPayload {
  blackjackDefaultBet: number;
}

export interface SetStartingBalancePayload {
  defaultStartingBalance: number;
}

export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  ready: () => void;
  action: (payload: ActionPayload) => void;
  leave: () => void;
  adminLogin: (payload: AdminLoginPayload) => void;
  adminStartGame: (payload: StartGamePayload) => void;
  adminSwitchMode: (payload: StartGamePayload) => void;
  adminAdjustBalance: (payload: AdjustBalancePayload) => void;
  adminSetBlinds: (payload: SetBlindsPayload) => void;
  adminSetDefaultBet: (payload: SetDefaultBetPayload) => void;
  adminSetStartingBalance: (payload: SetStartingBalancePayload) => void;
}

export interface ServerToClientEvents {
  state: (state: AppStateView) => void;
  error: (payload: ErrorPayload) => void;
  adminLoginResult: (payload: AdminLoginResultPayload) => void;
}
