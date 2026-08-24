import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ErrorPayload,
  AdminLoginResultPayload,
} from '@poker-blackjack/server/src/protocol';
import type { AppStateView, GameMode } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';

export type ConnectionStatus = 'connecting' | 'lobby' | 'entering-name' | 'at-table' | 'reconnecting' | 'error';

export const DISPLAY_NAME_STORAGE_KEY = 'poker-blackjack:displayName';

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
  displayName: string | null;
  isAdmin: boolean;
  joinWithName: (displayName: string) => void;
  sendReady: () => void;
  sendAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  leave: () => void;
  adminLogin: (passphrase: string) => void;
  adminStartGame: (mode: GameMode) => void;
  adminSwitchMode: (mode: GameMode) => void;
  adminAdjustBalance: (displayName: string, balance: number) => void;
  adminSetBlinds: (smallBlind: number, bigBlind: number) => void;
  adminSetDefaultBet: (blackjackDefaultBet: number) => void;
  adminSetStartingBalance: (defaultStartingBalance: number) => void;
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
  // True once any 'state' event has ever arrived, which is the signal that
  // the connection is established and healthy. Only an 'error' arriving
  // *before* that (a connection-level failure -- the server refused us, or
  // something went wrong before it could even send the welcome snapshot) is
  // fatal enough to justify tearing the socket down and showing the reload
  // screen. Every error after it -- a rejected join, an illegal action, a
  // rejected admin action -- is an ordinary rejection of one request and
  // must leave the session completely untouched.
  const hasEverReceivedStateRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [state, setState] = useState<AppStateView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminErrorMessage, setAdminErrorMessage] = useState<string | null>(null);
  const [adminActionErrorMessage, setAdminActionErrorMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const storedName = sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
    if (storedName) {
      displayNameRef.current = storedName;
      setDisplayName(storedName);
    }

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl);
    socketRef.current = socket;

    socket.on('state', (nextState: AppStateView) => {
      hasEverReceivedStateRef.current = true;
      setState(nextState);
      setErrorMessage(null);

      // displayNameRef.current guard matters here specifically because a
      // fresh table's unclaimed seats also carry `displayName: null` (see
      // Table's seat initialization in table.ts) -- without it, the very
      // first "welcome" broadcast a socket receives on connect (added
      // alongside the lobby/admin work; see socketServer.ts's `connection`
      // handler), which arrives before any join and thus while
      // displayNameRef.current is still null, would spuriously match an
      // empty seat's `displayName === null` and report this brand-new,
      // not-yet-named socket as already seated.
      const mySeated =
        displayNameRef.current !== null &&
        (nextState.table?.seats.some((s) => s.displayName === displayNameRef.current) ?? false);
      const wasSeated = wasSeatedRef.current;
      wasSeatedRef.current = mySeated;

      if (mySeated) {
        joinedRef.current = true;
        setStatus('at-table');
        if (displayNameRef.current) {
          sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayNameRef.current);
        }
      } else if (nextState.mode === null) {
        joinedRef.current = false;
        setStatus('lobby');
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
        socket.emit('join', { displayName: displayNameRef.current });
      } else {
        joinedRef.current = false;
        setStatus('entering-name');
      }
    });

    socket.on('adminLoginResult', ({ success }: AdminLoginResultPayload) => {
      // Deliberately separate from `errorMessage` (join/table errors, read by
      // JoinScreen): AdminEntry and JoinScreen can be mounted simultaneously,
      // and a failed admin passphrase attempt must not appear to be a failed
      // name-join too. See adminErrorMessage below.
      if (!success) {
        setAdminErrorMessage('Incorrect admin passphrase');
      } else {
        setAdminErrorMessage(null);
      }
    });

    socket.on('error', (payload: ErrorPayload) => {
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
      }
    });

    socket.on('disconnect', () => {
      if (statusRef.current === 'at-table') {
        setStatus('reconnecting');
      }
    });

    socket.io.on('reconnect', () => {
      joinedRef.current = false;
      const name = displayNameRef.current;
      if (name) {
        socket.emit('join', { displayName: name });
      }
    });

    return () => {
      socket.disconnect();
    };
    // Runs once on mount: opens the connection immediately (so lobby/table
    // state can be observed before a display name is known) and tears the
    // socket down on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinWithName(name: string) {
    displayNameRef.current = name;
    setDisplayName(name);
    setErrorMessage(null);
    joinedRef.current = true;
    socketRef.current?.emit('join', { displayName: name });
  }

  function sendReady() {
    socketRef.current?.emit('ready');
  }

  function sendAction(action: PlayerAction | HoldemAction, amount?: number) {
    socketRef.current?.emit('action', { action, amount });
  }

  function leave() {
    // Defense in depth alongside GameTable's own !handInProgress button gate:
    // the server rejects `leave` mid-hand and this function has no way to
    // await that rejection (no ack protocol) before it has already cleared
    // local session state -- so refuse locally whenever we already know a
    // hand is in progress.
    if (state?.table?.handInProgress) {
      return;
    }
    socketRef.current?.emit('leave');
    sessionStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    displayNameRef.current = null;
    joinedRef.current = false;
    setDisplayName(null);
    setErrorMessage(null);
    // The socket itself stays connected -- leaving a table returns to the
    // lobby/join screen, it does not disconnect from the server. The next
    // 'state' broadcast (triggered by the server's own leave handling) sets
    // status to 'lobby' or 'entering-name' as appropriate.
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
    socketRef.current?.emit('adminStartGame', { mode });
  }

  function adminSwitchMode(mode: GameMode) {
    setAdminActionErrorMessage(null);
    socketRef.current?.emit('adminSwitchMode', { mode });
  }

  function adminAdjustBalance(name: string, balance: number) {
    setAdminActionErrorMessage(null);
    socketRef.current?.emit('adminAdjustBalance', { displayName: name, balance });
  }

  function adminSetBlinds(smallBlind: number, bigBlind: number) {
    setAdminActionErrorMessage(null);
    socketRef.current?.emit('adminSetBlinds', { smallBlind, bigBlind });
  }

  function adminSetDefaultBet(blackjackDefaultBet: number) {
    setAdminActionErrorMessage(null);
    socketRef.current?.emit('adminSetDefaultBet', { blackjackDefaultBet });
  }

  function adminSetStartingBalance(defaultStartingBalance: number) {
    setAdminActionErrorMessage(null);
    socketRef.current?.emit('adminSetStartingBalance', { defaultStartingBalance });
  }

  const value: SocketContextValue = {
    status,
    state,
    errorMessage,
    adminErrorMessage,
    adminActionErrorMessage,
    displayName,
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
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
