import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ErrorPayload,
} from '@poker-blackjack/server/src/protocol';
import type { TableStateView } from '@poker-blackjack/server/src/table';
import type { PlayerAction, HoldemAction } from '@poker-blackjack/game-engine';

export type ConnectionStatus = 'entering-name' | 'connecting' | 'at-table' | 'reconnecting' | 'error';

export const DISPLAY_NAME_STORAGE_KEY = 'poker-blackjack:displayName';

export interface SocketContextValue {
  status: ConnectionStatus;
  state: TableStateView | null;
  errorMessage: string | null;
  displayName: string | null;
  connect: (displayName: string) => void;
  sendReady: () => void;
  sendAction: (action: PlayerAction | HoldemAction, amount?: number) => void;
  leave: () => void;
}

export const SocketContext = createContext<SocketContextValue | null>(null);

export function useSocket(): SocketContextValue {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return value;
}

export function SocketProvider({
  serverUrl,
  children,
}: {
  serverUrl: string;
  children: ReactNode;
}) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const displayNameRef = useRef<string | null>(null);
  const statusRef = useRef<ConnectionStatus>('entering-name');
  // Guards the 'disconnect' handler below: socket.io-client's disconnect()
  // fires this socket's own 'disconnect' handler synchronously, before
  // returning to the caller -- so a leave() in progress would otherwise race
  // its own setStatus('entering-name') against the handler's
  // setStatus('reconnecting'), landing on whichever happened to run last.
  // Setting this ref (not state) at the very start of leave() makes the
  // handler's early-return unconditionally correct regardless of batching or
  // call order. Reset on every fresh connect() so a later, unrelated
  // disconnect (e.g. the server going away) still surfaces normally.
  const leavingRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>('entering-name');
  const [state, setState] = useState<TableStateView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const storedName = sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
    if (storedName) {
      connect(storedName);
    }
    return () => {
      socketRef.current?.disconnect();
    };
    // Runs once on mount: resumes a prior session's seat after a page reload,
    // and tears the socket down on unmount. `connect` intentionally is not a
    // dependency -- it must not re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connect(name: string) {
    leavingRef.current = false;
    displayNameRef.current = name;
    setDisplayName(name);
    setErrorMessage(null);
    setStatus('connecting');

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { displayName: name });
    });

    socket.on('state', (nextState) => {
      setState(nextState);
      setStatus('at-table');
      sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
      // A fresh state push means the table has moved on (an action was
      // accepted, another player acted, etc.) -- any previously-shown
      // in-game error is now stale and is superseded by this update.
      setErrorMessage(null);
    });

    socket.on('error', (payload: ErrorPayload) => {
      setErrorMessage(payload.message);
      // statusRef (not the closed-over `status`) is read here deliberately --
      // this handler is registered once per connect() call and would otherwise
      // always see the status from the moment connect() ran, never any status
      // reached afterward (e.g. at-table), incorrectly kicking a connected
      // player into the error screen on any later in-game rejection.
      if (statusRef.current !== 'at-table') {
        setStatus('error');
        socket.disconnect();
        socketRef.current = null;
      }
    });

    socket.on('disconnect', () => {
      if (leavingRef.current) {
        return;
      }
      if (statusRef.current === 'at-table') {
        setStatus('reconnecting');
      }
    });

    socket.io.on('reconnect', () => {
      const name = displayNameRef.current;
      if (name) {
        socket.emit('join', { displayName: name });
      }
    });
  }

  function sendReady() {
    socketRef.current?.emit('ready');
  }

  function sendAction(action: PlayerAction | HoldemAction, amount?: number) {
    socketRef.current?.emit('action', { action, amount });
  }

  function leave() {
    // Defense in depth alongside GameTable's own !handInProgress button gate:
    // the server rejects `leave` mid-hand ('Cannot leave while a hand is in
    // progress', table.ts) and this function has no way to await that
    // rejection (no ack protocol) before it has already torn the socket and
    // session down -- so refuse locally, before emitting anything, whenever
    // we already know a hand is in progress. This keeps the session-resume
    // key and local state intact for the one caller path we can't otherwise
    // protect against a lost/rejected leave.
    if (state?.handInProgress) {
      return;
    }
    leavingRef.current = true;
    socketRef.current?.emit('leave');
    socketRef.current?.disconnect();
    socketRef.current = null;
    sessionStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    setState(null);
    setErrorMessage(null);
    setDisplayName(null);
    setStatus('entering-name');
  }

  const value: SocketContextValue = {
    status,
    state,
    errorMessage,
    displayName,
    connect,
    sendReady,
    sendAction,
    leave,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
