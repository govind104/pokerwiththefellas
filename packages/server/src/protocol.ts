import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import type { AppStateView, GameMode } from './table';

export interface JoinPayload {
  displayName: string;
  /** From an earlier `identity` event; needed to sit down under a name that is already claimed. */
  token?: string;
}

export interface IdentityPayload {
  displayName: string;
  token: string;
}

// Lets the client tell a name conflict and a takeover apart from other join errors (audit C5).
export type ErrorCode = 'name-claimed' | 'replaced' | 'kicked';

export interface ActionPayload {
  action: PlayerAction | HoldemAction;
  amount?: number;
  /** The table's `actionSeq` when the player clicked; a stale one is rejected. Optional. */
  seq?: number;
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
  code?: ErrorCode;
}

export interface AdminLoginPayload {
  passphrase: string;
}

export interface AdminLoginResultPayload {
  success: boolean;
  /** On success: send back in the socket.io handshake `auth.adminToken` to stay admin after a reconnect. */
  adminToken?: string;
  /** Set when refused because of too many wrong passphrases. */
  retryAfterMs?: number;
}

export interface StartGamePayload {
  mode: GameMode;
}

export interface AdjustBalancePayload {
  displayName: string;
  balance: number;
}

export interface ReleaseNamePayload {
  displayName: string;
}

export interface KickPayload {
  displayName: string;
}

export interface AdminNoticePayload {
  message: string;
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

// The answer to `leave` (audit I11): the client forgets its name only once the server has freed
// the seat, because a hand can start between the click and the server seeing it.
export type LeaveResult = { ok: true } | { ok: false; message: string };

export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  ready: () => void;
  action: (payload: ActionPayload) => void;
  leave: (ack?: (result: LeaveResult) => void) => void;
  adminLogin: (payload: AdminLoginPayload) => void;
  adminStartGame: (payload: StartGamePayload) => void;
  adminSwitchMode: (payload: StartGamePayload) => void;
  adminAdjustBalance: (payload: AdjustBalancePayload) => void;
  adminReleaseName: (payload: ReleaseNamePayload) => void;
  adminKick: (payload: KickPayload) => void;
  adminSetBlinds: (payload: SetBlindsPayload) => void;
  adminSetDefaultBet: (payload: SetDefaultBetPayload) => void;
  adminSetStartingBalance: (payload: SetStartingBalancePayload) => void;
}

export interface ServerToClientEvents {
  state: (state: AppStateView) => void;
  error: (payload: ErrorPayload) => void;
  adminLoginResult: (payload: AdminLoginResultPayload) => void;
  identity: (payload: IdentityPayload) => void;
  adminNotice: (payload: AdminNoticePayload) => void;
}
