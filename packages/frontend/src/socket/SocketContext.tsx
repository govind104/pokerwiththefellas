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
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [state, setState] = useState<AppStateView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
      if (!success) {
        setErrorMessage('Incorrect admin passphrase');
      }
    });

    socket.on('error', (payload: ErrorPayload) => {
      setErrorMessage(payload.message);
      // statusRef (not the closed-over `status`) is read here deliberately --
      // this handler is registered once per mount and would otherwise always
      // see the status from that moment, never any status reached afterward
      // (e.g. at-table), incorrectly kicking a connected player into the
      // error screen on any later in-game rejection.
      if (statusRef.current !== 'at-table') {
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
    socketRef.current?.emit('adminLogin', { passphrase });
  }

  function adminStartGame(mode: GameMode) {
    socketRef.current?.emit('adminStartGame', { mode });
  }

  function adminSwitchMode(mode: GameMode) {
    socketRef.current?.emit('adminSwitchMode', { mode });
  }

  function adminAdjustBalance(name: string, balance: number) {
    socketRef.current?.emit('adminAdjustBalance', { displayName: name, balance });
  }

  function adminSetBlinds(smallBlind: number, bigBlind: number) {
    socketRef.current?.emit('adminSetBlinds', { smallBlind, bigBlind });
  }

  function adminSetDefaultBet(blackjackDefaultBet: number) {
    socketRef.current?.emit('adminSetDefaultBet', { blackjackDefaultBet });
  }

  function adminSetStartingBalance(defaultStartingBalance: number) {
    socketRef.current?.emit('adminSetStartingBalance', { defaultStartingBalance });
  }

  const value: SocketContextValue = {
    status,
    state,
    errorMessage,
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
