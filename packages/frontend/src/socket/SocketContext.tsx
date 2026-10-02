import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ErrorPayload,
  AdminLoginResultPayload,
  IdentityPayload,
  AdminNoticePayload,
  LeaveResult,
} from '@poker-blackjack/server/src/protocol';
import type { AppStateView, GameMode } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';
import { forgetLastName, readLastName, rememberIdentity, tokenFor } from './identityStorage';

export type ConnectionStatus =
  | 'connecting'
  | 'lobby'
  | 'entering-name'
  | 'at-table'
  | 'reconnecting'
  | 'replaced'
  | 'error';

// The admin session token (audit M11). sessionStorage, not localStorage: admin rights should end
// with the tab, unlike a player's name claim, which is meant to outlive it.
export const ADMIN_TOKEN_STORAGE_KEY = 'poker-blackjack:adminToken';

// Server's reply to an action sent with an out-of-date seq (table.ts). Harmless -- the
// click was a duplicate or raced a state change -- so it is not shown to the player.
const STALE_ACTION_ERROR = 'That action has already been handled (the table moved on)';

// Minimum time the action buttons stay disabled after a click, even if the table has already
// moved on. On a LAN the server's reply often lands inside a double-click (Windows' default
// window is 500 ms), and the second click would then go out with the new, valid seq. Also
// covers most of a 3D card deal (0.35-0.7 s).
export const MIN_ACTION_LOCKOUT_MS = 600;

export interface SocketContextValue {
  status: ConnectionStatus;
  state: AppStateView | null;
  errorMessage: string | null;
  // Admin *login* failures only (rendered by AdminEntry).
  adminErrorMessage: string | null;
  // Admin *action* rejections -- balance/blinds/bet/starting-balance/mode
  // switch (rendered by AdminPanel). Deliberately a third field rather than
  // a reuse of adminErrorMessage: the two surfaces are never mounted at the
  // same time (AdminEntry collapses to a plain "Admin" badge once the login
  // succeeds, which is exactly when AdminPanel appears), so sharing one
  // field would mean a login error and an action error could only ever be
  // told apart by which component happened to be mounted.
  adminActionErrorMessage: string | null;
  // The server's confirmation of an admin action that has no state change to show for itself
  // (e.g. a released name). Cleared when the next admin action is sent.
  adminNoticeMessage: string | null;
  displayName: string | null;
  isAdmin: boolean;
  joinWithName: (displayName: string) => void;
  sendReady: () => void;
  // True from sending an action until the table moves on (a state with a new actionSeq, and at
  // least MIN_ACTION_LOCKOUT_MS since the click) or the server rejects it; the table buttons
  // stay disabled meanwhile so a double-click cannot send the action twice.
  actionPending: boolean;
  sendAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  leave: () => void;
  adminLogin: (passphrase: string) => void;
  adminStartGame: (mode: GameMode) => void;
  adminSwitchMode: (mode: GameMode) => void;
  adminAdjustBalance: (displayName: string, balance: number) => void;
  adminSetBlinds: (smallBlind: number, bigBlind: number) => void;
  adminSetDefaultBet: (blackjackDefaultBet: number) => void;
  adminSetStartingBalance: (defaultStartingBalance: number) => void;
  // Frees a name that another player's token holds, so its owner can rejoin without it (audit C5).
  adminReleaseName: (displayName: string) => void;
  // Unsticking a table (audit I6): free an idle player's seat, act once for whoever is up, and
  // set the turn clock (seconds, 0 = off).
  adminKick: (displayName: string) => void;
  adminForceAct: () => void;
  adminSetTurnClock: (seconds: number) => void;
  // From the 'replaced' screen: join again with our token, which moves the seat back to this tab.
  takeOver: () => void;
}

export const SocketContext = createContext<SocketContextValue | null>(null);

export function useSocket(): SocketContextValue {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return value;
}

export function SocketProvider({ serverUrl, children }: { serverUrl: string; children: ReactNode }) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const displayNameRef = useRef<string | null>(null);
  const statusRef = useRef<ConnectionStatus>('connecting');
  const joinedRef = useRef(false);
  // Tracks whether we were seated as of the *previous* processed 'state'
  // event -- distinct from joinedRef, which is a one-shot "have we ever
  // sent a join" flag that does NOT reset across a table reset (e.g. an
  // admin mode switch clears every seat but leaves joinedRef untouched).
  // Comparing this event's mySeated against the prior one lets the handler
  // notice exactly the seated -> unseated transition caused by a reset, so
  // it can rejoin even though joinedRef is stale from the old incarnation.
  const wasSeatedRef = useRef(false);
  // True from the moment any of the three `join`-emitting call sites below
  // fires until the attempt resolves -- seated (mySeated true), the mode
  // resets to null, or a rejection arrives (the 'error' handler clears it
  // unconditionally, not just for join-related errors, since any error
  // means the connection is no longer usefully "mid-join"). All three sites
  // check it before emitting, not just the auto-rejoin branch below: a mode
  // switch's seat-clearing broadcast is not the only 'state' event a
  // rejoining client sees before its own join is processed server-side --
  // every OTHER player's join succeeding in the same burst re-broadcasts to
  // everyone, including us, still unseated -- and a transport-level
  // reconnect (socket.io.on('reconnect') below) can land in the same
  // window a mode-switch rejoin is already in flight. Without gating every
  // site on this flag, either source can fire a second `join` for a name we
  // already hold: with our token the server treats it as a no-op takeover of
  // our own seat, without it the join is refused as a claimed name (audit
  // C5), and neither has to happen at all.
  const joinInFlightRef = useRef(false);
  // True once any 'state' event has ever arrived, which is the signal that
  // the connection is established and healthy. Only an 'error' arriving
  // *before* that (a connection-level failure -- the server refused us, or
  // something went wrong before it could even send the welcome snapshot) is
  // fatal enough to justify tearing the socket down and showing the reload
  // screen. Every error after it -- a rejected join, an illegal action, a
  // rejected admin action -- is an ordinary rejection of one request and
  // must leave the session completely untouched.
  const hasEverReceivedStateRef = useRef(false);
  // Set when another tab or device took our seat with the same token. Blocks every automatic
  // rejoin: otherwise two tabs would take the seat back from each other forever (audit C5).
  const replacedRef = useRef(false);
  // True from sending `leave` until the server answers it. While it is set, an unseated state is
  // our own leave landing, not a reason to rejoin; the name is forgotten only on a confirmed leave,
  // because a hand can start between the click and the server seeing it (audit I11).
  const leavePendingRef = useRef(false);
  // Set when the admin removed us (audit I6): the reason stays on the join screen until the player
  // joins again, instead of being cleared by the next broadcast like an in-game error.
  const keepErrorRef = useRef(false);
  // The table's actionSeq as of the latest 'state' event, and the one we last sent an
  // action against. Refs, not state: sendAction must see the value at click time.
  const latestActionSeqRef = useRef<number | null>(null);
  const sentActionSeqRef = useRef<number | null>(null);
  const actionSentAtRef = useRef(0);
  const actionUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [state, setState] = useState<AppStateView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminErrorMessage, setAdminErrorMessage] = useState<string | null>(null);
  const [adminActionErrorMessage, setAdminActionErrorMessage] = useState<string | null>(null);
  const [adminNoticeMessage, setAdminNoticeMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Every join carries the token we hold for the name, if any: that is what proves a returning
  // player is the one who claimed it (audit C5).
  function emitJoin(socket: Socket<ServerToClientEvents, ClientToServerEvents>, name: string) {
    socket.emit('join', { displayName: name, token: tokenFor(name) });
  }

  useEffect(() => {
    const storedName = readLastName();
    if (storedName) {
      displayNameRef.current = storedName;
      setDisplayName(storedName);
    }

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
      // A function, so each reconnect sends the token as it is then (audit M11).
      auth: (cb) => {
        let adminToken: string | null = null;
        try {
          adminToken = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
        } catch {
          // storage blocked: log in again after a reconnect
        }
        cb(adminToken ? { adminToken } : {});
      },
    });
    socketRef.current = socket;

    socket.on('state', (nextState: AppStateView) => {
      hasEverReceivedStateRef.current = true;
      setState(nextState);
      if (!keepErrorRef.current) {
        setErrorMessage(null);
      }
      const actionSeq = nextState.table?.actionSeq ?? null;
      latestActionSeqRef.current = actionSeq;
      if (actionSeq === null || actionSeq !== sentActionSeqRef.current) {
        clearTimeout(actionUnlockTimerRef.current);
        const lockoutLeft = MIN_ACTION_LOCKOUT_MS - (Date.now() - actionSentAtRef.current);
        if (lockoutLeft > 0) {
          actionUnlockTimerRef.current = setTimeout(() => setActionPending(false), lockoutLeft);
        } else {
          setActionPending(false);
        }
      }

      // The server's socket→seat map is the only reliable answer (audit I9): matching names let a
      // rejected join adopt the other player's seat view. Frames sent while our own join is being
      // processed can carry our name in the seats with mySeatIndex still null (Table.join and
      // reconnect broadcast before the socket is mapped); the joinInFlightRef branch below is what
      // keeps those from reading as a rejection or triggering a second join.
      const mySeatIndex = nextState.mySeatIndex ?? null;
      const mySeated = mySeatIndex !== null;
      const wasSeated = wasSeatedRef.current;
      wasSeatedRef.current = mySeated;

      if (mySeated) {
        joinedRef.current = true;
        joinInFlightRef.current = false;
        replacedRef.current = false;
        setStatus('at-table');
        // Take the server's spelling of our name (the seat holds the canonical one).
        const seatName = nextState.table?.seats[mySeatIndex]?.displayName ?? null;
        if (seatName !== null && seatName !== displayNameRef.current) {
          displayNameRef.current = seatName;
          setDisplayName(seatName);
        }
      } else if (nextState.mode === null) {
        joinedRef.current = false;
        joinInFlightRef.current = false;
        setStatus('lobby');
      } else if (replacedRef.current) {
        setStatus('replaced');
      } else if (leavePendingRef.current) {
        // Our own leave landing before its ack: wait for the ack (leave() below) to decide.
      } else if (joinInFlightRef.current) {
        // Our own auto-rejoin below is already awaiting the server's
        // response -- this broadcast is some OTHER change (another player's
        // join in the same burst, a ready toggle, anything) landing before
        // ours does. Not seated yet is expected; there is nothing new to
        // decide here, and re-running the branches below would incorrectly
        // read as "not seated, no rejoin in progress" and reset state that's
        // still legitimately in flight.
      } else if (displayNameRef.current && (!joinedRef.current || wasSeated)) {
        // A mode just became active (server start already resumed one, a
        // fresh admin start, or an admin switch) and we already know our
        // name from a prior session -- rejoin automatically instead of
        // making a returning player retype it. The `wasSeated` half of this
        // guard covers a returning player who was seated at the *previous*
        // table incarnation: an admin mode switch clears every seat and
        // broadcasts fresh state, so `mySeated` just flipped to false even
        // though `joinedRef.current` is still true from before the switch.
        // Without checking `wasSeated` here, that stale `true` would block
        // this branch and fall through to 'entering-name'.
        joinedRef.current = true;
        joinInFlightRef.current = true;
        emitJoin(socket, displayNameRef.current);
      } else {
        joinedRef.current = false;
        setStatus('entering-name');
      }
    });

    socket.on('adminLoginResult', ({ success, adminToken, retryAfterMs }: AdminLoginResultPayload) => {
      // Deliberately separate from `errorMessage` (join/table errors, read by
      // JoinScreen): AdminEntry and JoinScreen can be mounted simultaneously,
      // and a failed admin passphrase attempt must not appear to be a failed
      // name-join too. See adminErrorMessage below.
      if (success) {
        setAdminErrorMessage(null);
        if (adminToken) {
          try {
            sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
          } catch {
            // storage blocked: admin rights end at the next reconnect, as before
          }
        }
      } else if (retryAfterMs) {
        setAdminErrorMessage(`Too many wrong passphrases. Try again in ${Math.ceil(retryAfterMs / 1000)} s.`);
      } else {
        setAdminErrorMessage('Incorrect admin passphrase');
      }
    });

    socket.on('identity', ({ displayName: name, token }: IdentityPayload) => {
      rememberIdentity(name, token);
      displayNameRef.current = name;
      setDisplayName(name);
    });

    socket.on('adminNotice', ({ message }: AdminNoticePayload) => {
      setAdminNoticeMessage(message);
    });

    socket.on('error', (payload: ErrorPayload) => {
      setActionPending(false);
      if (payload.message === STALE_ACTION_ERROR) {
        return;
      }
      // Admin-action rejections get their own surface: routing them through
      // `errorMessage` would render them inside JoinScreen's form, wired via
      // aria-describedby to the display-name input the admin never touched.
      // The server tags them (protocol.ts's ErrorPayload.scope) rather than
      // the client guessing from an in-flight heuristic, so this stays exact
      // regardless of what else is happening on the connection.
      if (payload.scope === 'admin') {
        setAdminActionErrorMessage(payload.message);
        return;
      }
      // Deliberately no special-casing of "already seated" here (the one code
      // handled specially, `replaced` just below, is sent by the server when
      // another tab or device took this seat over with our token, not guessed
      // from client state). An earlier version of this handler tried to
      // swallow it when `status` was
      // already 'at-table', reasoning that meant our own join must have
      // already succeeded. That reasoning doesn't hold: the auto-rejoin
      // branch above never calls setStatus, so `status` sits on its *stale*
      // pre-mode-switch 'at-table' value for the entire window a rejoin is
      // in flight -- which is exactly when a genuine rejection (a different
      // client actually holding this name) can also arrive. Swallowing on
      // that signal hid real failures, not just harmless echoes. Now that
      // every `join`-emit site is gated on joinInFlightRef (see its
      // declaration above), our own client can't produce a self-duplicate
      // to swallow in the first place -- so any "already seated" error that
      // does arrive for our name is a genuine conflict and must reach the
      // player like any other rejection.
      if (payload.code === 'replaced') {
        replacedRef.current = true;
        joinedRef.current = false;
        joinInFlightRef.current = false;
        setErrorMessage(payload.message);
        setStatus('replaced');
        return;
      }
      if (payload.code === 'kicked') {
        // Like a confirmed leave, but the reason is shown. The token is kept, so typing the name
        // again sits back down with the same balance (audit I6).
        forgetLastName();
        displayNameRef.current = null;
        setDisplayName(null);
        joinedRef.current = false;
        joinInFlightRef.current = false;
        keepErrorRef.current = true;
        setErrorMessage(payload.message);
        setStatus('entering-name');
        return;
      }
      const wasJoining = joinInFlightRef.current;
      joinInFlightRef.current = false;
      setErrorMessage(payload.message);
      // Fatal only before the connection has ever proven healthy. This used
      // to key off `statusRef.current !== 'at-table'`, which was correct
      // back when a failed `join` was the only non-at-table error producer,
      // but became a session-killer once admin actions could be rejected
      // while the admin sits in 'entering-name'/'lobby': the client would
      // disconnect itself and show a permanent reload screen in response to
      // an ordinary, expected rejection.
      if (!hasEverReceivedStateRef.current) {
        setStatus('error');
        socket.disconnect();
        socketRef.current = null;
      } else if (wasJoining) {
        // A refused join must not be retried on the next reload (audit I9).
        forgetLastName();
        displayNameRef.current = null;
        setDisplayName(null);
        setStatus('entering-name');
      } else if (statusRef.current === 'connecting') {
        // The 'state' handler's auto-rejoin branch (first-time-tonight or
        // post-admin-switch) emits `join` without ever touching `status`, so
        // if that join is what just got rejected, `status` is still sitting
        // on its initial 'connecting' value. App.tsx's connecting screen
        // doesn't read `errorMessage`, so left alone this would strand the
        // user on a bare "Connecting..." with the rejection recorded but
        // never shown. Send them to 'entering-name' instead, where
        // JoinScreen does render `errorMessage` and lets them retry.
        setStatus('entering-name');
      }
    });

    socket.on('disconnect', () => {
      // A pending action may never be answered, and a restarted server can come back with
      // the same actionSeq we sent, which would otherwise leave the buttons disabled.
      sentActionSeqRef.current = null;
      setActionPending(false);
      // A join or leave sent before the drop may never be answered. Left set, joinInFlightRef
      // blocked the rejoin after a second quick drop and the player sat on "Reconnecting…"
      // (audit I10). A leave lost this way is retried by hand: we rejoin with the name we kept.
      joinInFlightRef.current = false;
      leavePendingRef.current = false;
      if (statusRef.current === 'at-table') {
        setStatus('reconnecting');
      }
    });

    socket.io.on('reconnect', () => {
      joinedRef.current = false;
      const name = displayNameRef.current;
      // The guard matters when a transport-level reconnect and a
      // mode-switch-triggered auto-rejoin (the 'state' handler above) land
      // in the same window -- e.g. a flaky connection dropping right as an
      // admin switches modes. Without it, both sites would independently
      // decide nothing is in flight yet and each emit their own `join` for
      // the same name.
      if (name && !joinInFlightRef.current && !replacedRef.current) {
        joinInFlightRef.current = true;
        emitJoin(socket, name);
      }
    });

    return () => {
      clearTimeout(actionUnlockTimerRef.current);
      socket.disconnect();
    };
    // Runs once on mount: opens the connection immediately (so lobby/table
    // state can be observed before a display name is known) and tears the
    // socket down on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A rejected table action (illegal move, "not your turn") is only news for a moment.
  // Any state broadcast already clears it; this covers a quiet table where nothing
  // else happens. Only while seated: join-form errors must stay until the player retries.
  useEffect(() => {
    if (!errorMessage || status !== 'at-table') return;
    const timer = setTimeout(() => setErrorMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [errorMessage, status]);

  function joinWithName(name: string) {
    displayNameRef.current = name;
    setDisplayName(name);
    setErrorMessage(null);
    keepErrorRef.current = false;
    replacedRef.current = false;
    joinedRef.current = true;
    joinInFlightRef.current = true;
    if (socketRef.current) emitJoin(socketRef.current, name);
  }

  function takeOver() {
    const name = displayNameRef.current ?? readLastName();
    if (!name || !socketRef.current) return;
    replacedRef.current = false;
    joinedRef.current = true;
    joinInFlightRef.current = true;
    setErrorMessage(null);
    emitJoin(socketRef.current, name);
  }

  function sendReady() {
    socketRef.current?.emit('ready');
  }

  function sendAction(action: PlayerAction | HoldemAction, amount?: number) {
    sentActionSeqRef.current = latestActionSeqRef.current;
    actionSentAtRef.current = Date.now();
    clearTimeout(actionUnlockTimerRef.current);
    setActionPending(true);
    socketRef.current?.emit('action', { action, amount, seq: latestActionSeqRef.current ?? undefined });
  }

  function leave() {
    // GameTable hides Leave mid-hand; this guard is the same rule for any other caller. The
    // pending check makes a double-click one leave (audit M30).
    if (state?.table?.handInProgress || leavePendingRef.current || !socketRef.current) {
      return;
    }
    leavePendingRef.current = true;
    socketRef.current.emit('leave', (result: LeaveResult) => {
      leavePendingRef.current = false;
      // Another tab took the seat while this leave was queued: the replaced screen owns the
      // session now. The ack (a refusal, since this socket no longer holds the seat) must not
      // forget the name or clear the replaced message, or "Play here instead" (takeOver) has
      // nothing to rejoin with (audit I11, I9). replacedRef resets on a seated state, join or
      // takeOver.
      if (replacedRef.current) {
        return;
      }
      // A refusal while the latest state still shows us seated (a hand just started): stay, and
      // say why. A kicked reason is never overwritten by the leave refusal (audit I6).
      if (!result.ok && wasSeatedRef.current) {
        if (!keepErrorRef.current) {
          setErrorMessage(result.message);
        }
        return;
      }
      // Confirmed, or refused after the server already showed us unseated (a mode switch or kick
      // landed first). That unseated state was held back by leavePendingRef, and the server has
      // no seat to hold, so dropping the name is safe (audit I11).
      forgetLastName();
      displayNameRef.current = null;
      joinedRef.current = false;
      setDisplayName(null);
      if (!keepErrorRef.current) {
        setErrorMessage(null);
      }
      if (statusRef.current === 'at-table') {
        setStatus('entering-name');
      }
    });
  }

  function adminLogin(passphrase: string) {
    setAdminErrorMessage(null);
    socketRef.current?.emit('adminLogin', { passphrase });
  }

  // Cleared when a new admin action is sent rather than on every incoming
  // 'state' event: a rejected admin action produces no broadcast of its own,
  // so clearing on 'state' would make the message vanish the moment any
  // unrelated player acted. Tying it to the next admin attempt keeps a
  // rejection readable until the admin actually does something about it.
  function adminStartGame(mode: GameMode) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminStartGame', { mode });
  }

  function adminSwitchMode(mode: GameMode) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminSwitchMode', { mode });
  }

  function adminAdjustBalance(name: string, balance: number) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminAdjustBalance', { displayName: name, balance });
  }

  function adminSetBlinds(smallBlind: number, bigBlind: number) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminSetBlinds', { smallBlind, bigBlind });
  }

  function adminSetDefaultBet(blackjackDefaultBet: number) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminSetDefaultBet', { blackjackDefaultBet });
  }

  function adminSetStartingBalance(defaultStartingBalance: number) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminSetStartingBalance', { defaultStartingBalance });
  }

  function adminReleaseName(name: string) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminReleaseName', { displayName: name });
  }

  function adminKick(name: string) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminKick', { displayName: name });
  }

  // Carries the actionSeq the admin saw, like a player's action, so a double-click acts once.
  function adminForceAct() {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminForceAct', { seq: latestActionSeqRef.current ?? undefined });
  }

  function adminSetTurnClock(seconds: number) {
    setAdminActionErrorMessage(null);
    setAdminNoticeMessage(null);
    socketRef.current?.emit('adminSetTurnClock', { seconds });
  }

  const value: SocketContextValue = {
    status,
    state,
    errorMessage,
    adminErrorMessage,
    adminActionErrorMessage,
    adminNoticeMessage,
    displayName,
    actionPending,
    isAdmin: state?.isAdmin ?? false,
    joinWithName,
    sendReady,
    sendAction,
    leave,
    adminLogin,
    adminStartGame,
    adminSwitchMode,
    adminAdjustBalance,
    adminSetBlinds,
    adminSetDefaultBet,
    adminSetStartingBalance,
    adminReleaseName,
    adminKick,
    adminForceAct,
    adminSetTurnClock,
    takeOver,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
