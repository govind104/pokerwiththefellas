# Plan 4 (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser UI for Texas Hold'em Poker and Blackjack, talking to the
already-built Plan 3 Socket.IO server, running locally in development.

**Architecture:** A new `packages/frontend` npm workspace (Vite + React + TypeScript +
Tailwind CSS). A `SocketProvider`/`useSocket()` context owns the `socket.io-client`
connection and exposes the latest `TableStateView` pushed by the server. A pure,
game-agnostic `GameTable` layout component (seat ring, turn highlight, chip/ready
indicators, reconnect banner) is used by two thin game-specific components,
`PokerTable` and `BlackjackTable`, which derive their own per-game turn/seat-content
data from props and pass it into `GameTable`. `App.tsx` is the only component that
touches `useSocket()` directly; every other component is a pure function of props,
independently testable.

**Tech Stack:** Vite, React 18, TypeScript, Tailwind CSS, `socket.io-client`, Vitest,
React Testing Library.

**Design doc:** `docs/superpowers/specs/2026-08-21-plan4-frontend-design.md`

## Global Constraints

- No authentication UI — plain display names only, matching the server's current
  identity model exactly (design doc Section 1).
- No client-side game-selection UI — `state.gameMode` (read from the first `state`
  event) determines which game renders; there is no UI action that changes it (design
  doc Section 1).
- No routing library — the app is a single connection-state machine, not multiple
  routes (design doc Section 3.1).
- No external state management library — React Context + hooks only (design doc
  Section 3.3).
- The frontend takes `@poker-blackjack/server` as a **type-only** workspace
  dependency. The server package has no barrel export (`main` points at its runnable
  entry script, not a type barrel, unlike `@poker-blackjack/game-engine`); import
  protocol/view types via `@poker-blackjack/server/src/protocol` and
  `@poker-blackjack/server/src/table` (deep imports resolve fine — the server's
  `package.json` has no `exports` field restricting subpaths). Use `import type` only,
  everywhere, so no server runtime code is ever bundled.
- Vendored card assets: `Webisso/playing-cards` (MIT) only. Never vendor anything from
  `htdebeer/SVG-cards` (LGPL-2.1) — visual reference only, per the design doc.
- Match existing monorepo dependency versions where a shared dependency already exists:
  `vitest: ^3.0.0`, `typescript: ^5.7.0`, `socket.io-client: ^4.8.0` (all already used
  by `packages/server`).
- The server's default port is `3000` (`packages/server/src/index.ts`); the frontend's
  default `serverUrl` must match this.

## File Structure

```
packages/frontend/
  package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, vitest.config.ts,
  tailwind.config.ts, postcss.config.js, index.html, THIRD_PARTY_NOTICES.md
  src/
    main.tsx, App.tsx, App.test.tsx, index.css, vitest.setup.ts
    assets/cards/*.svg          (vendored, Task 3)
    fixtures/tableStateFixtures.ts   (shared TableStateView fixtures, Task 2)
    socket/SocketContext.tsx, SocketContext.test.tsx   (Task 2)
    components/
      Card.tsx, Card.test.tsx                    (Task 3)
      JoinScreen.tsx, JoinScreen.test.tsx         (Task 4)
      GameTable.tsx, GameTable.test.tsx           (Task 5)
      PokerTable.tsx, PokerTable.test.tsx         (Task 6)
      BlackjackTable.tsx, BlackjackTable.test.tsx (Task 7)
    integration/
      poker.integration.test.ts        (Task 9)
      blackjack.integration.test.ts    (Task 9)
```

Every component file has one clear responsibility: `GameTable` is pure layout (no game
logic, no `useSocket()`), `PokerTable`/`BlackjackTable` are pure functions of their game
view plus callbacks (no `useSocket()`), and `App.tsx` (Task 8) is the only place
`useSocket()` is called, keeping every other component trivially testable with plain
props.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/tsconfig.node.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/vitest.config.ts`
- Create: `packages/frontend/tailwind.config.ts`
- Create: `packages/frontend/postcss.config.js`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/src/index.css`
- Create: `packages/frontend/src/vitest.setup.ts`
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/src/App.test.tsx`

**Interfaces:**
- Produces: a working `packages/frontend` workspace picked up by the root `npm test`
  and `npm run typecheck` scripts (both already `--workspaces --if-present`, no root
  config change needed). A default-exported `App` component from `src/App.tsx`
  (rewritten in Task 8; this task's version is a static placeholder that is itself
  fully working and tested, not a stub).

- [ ] **Step 1: Create the workspace config files**

`packages/frontend/package.json`:

```json
{
  "name": "@poker-blackjack/frontend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.8.0"
  },
  "devDependencies": {
    "@poker-blackjack/server": "*",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.7.0",
    "vite": "^5.4.10",
    "vitest": "^3.0.0"
  }
}
```

`packages/frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`packages/frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "tailwind.config.ts", "postcss.config.js"]
}
```

`packages/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

`packages/frontend/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
  },
});
```

`packages/frontend/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

`packages/frontend/postcss.config.js`:

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`packages/frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Poker &amp; Blackjack</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/frontend/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`packages/frontend/src/vitest.setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

`packages/frontend/src/main.tsx`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 2: Install dependencies**

Run from the repo root: `npm install`
Expected: the new workspace is linked; `node_modules/@poker-blackjack/frontend` is a
symlink to `packages/frontend`.

- [ ] **Step 3: Write the failing test**

`packages/frontend/src/App.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the app heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /poker & blackjack/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend`
Expected: FAIL — `src/App.tsx` does not exist yet (module not found).

- [ ] **Step 5: Write the minimal implementation**

`packages/frontend/src/App.tsx`:

```typescript
function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
      <h1 className="text-2xl font-semibold">Poker &amp; Blackjack</h1>
    </main>
  );
}

export default App;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend`
Expected: PASS, 1/1.

- [ ] **Step 7: Verify the root scripts pick up the new workspace**

Run from the repo root: `npm test` and `npm run typecheck`
Expected: both commands run all three workspaces (`game-engine`, `server`,
`frontend`) and pass cleanly. If `typecheck` fails on the `@testing-library/jest-dom`
global types not being found, confirm `"types"` in `tsconfig.json` includes both
`"vitest/globals"` and `"@testing-library/jest-dom"` exactly as above.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend package-lock.json
git commit -m "feat(frontend): scaffold Vite + React + TypeScript + Tailwind workspace"
```

---

### Task 2: SocketContext and shared test fixtures

**Files:**
- Create: `packages/frontend/src/fixtures/tableStateFixtures.ts`
- Create: `packages/frontend/src/socket/SocketContext.tsx`
- Test: `packages/frontend/src/socket/SocketContext.test.tsx`

**Interfaces:**
- Consumes: `ClientToServerEvents`, `ServerToClientEvents`, `JoinPayload`,
  `ActionPayload`, `ErrorPayload` from `@poker-blackjack/server/src/protocol`;
  `TableStateView`, `SeatView`, `HoldemView`, `BlackjackRoundView`, `GameMode` from
  `@poker-blackjack/server/src/table`; `PlayerAction`, `HoldemAction` from
  `@poker-blackjack/game-engine`.
- Produces:
  - `export type ConnectionStatus = 'entering-name' | 'connecting' | 'at-table' | 'reconnecting' | 'error'`
  - `export const DISPLAY_NAME_STORAGE_KEY: string`
  - `export interface SocketContextValue { status: ConnectionStatus; state: TableStateView | null; errorMessage: string | null; displayName: string | null; connect: (displayName: string) => void; sendReady: () => void; sendAction: (action: PlayerAction | HoldemAction, amount?: number) => void; leave: () => void; }`
  - `export const SocketContext: React.Context<SocketContextValue | null>` (exported
    directly, not just via the hook, so later component tests can inject a test
    `SocketContextValue` without needing a real or mocked socket)
  - `export function useSocket(): SocketContextValue`
  - `export function SocketProvider({ serverUrl, children }: { serverUrl: string; children: ReactNode }): JSX.Element`
  - From `fixtures/tableStateFixtures.ts`: `makeSeat`, `makeWaitingState`,
    `makeHoldemPreflopState`, `makeBlackjackPlayingState` (all documented below;
    later tasks add more fixtures to this same file as their tests need them — this
    is expected incremental extension, not scope creep).

- [ ] **Step 1: Write the shared test fixtures**

`packages/frontend/src/fixtures/tableStateFixtures.ts`:

```typescript
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
```

- [ ] **Step 2: Write the failing test**

`packages/frontend/src/socket/SocketContext.test.tsx`:

```typescript
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket, SocketProvider, DISPLAY_NAME_STORAGE_KEY } from './SocketContext';
import { makeWaitingState } from '../fixtures/tableStateFixtures';

// A minimal fake socket.io-client: enough surface for SocketContext to drive
// (emit/on/disconnect, plus the nested `.io` manager used for the 'reconnect' event)
// without a real network connection. Tests trigger server pushes by calling the
// captured handlers directly.
const handlers = new Map<string, (...args: unknown[]) => void>();
const ioManagerHandlers = new Map<string, (...args: unknown[]) => void>();
const emitted: { event: string; payload: unknown }[] = [];
let disconnectCalls = 0;

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
    io: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        ioManagerHandlers.set(event, handler);
      },
    },
  };
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket()),
}));

function TestConsumer() {
  const { status, state, errorMessage, displayName, connect } = useSocket();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="state">{state ? state.gameMode : 'none'}</p>
      <p data-testid="error">{errorMessage ?? 'none'}</p>
      <p data-testid="name">{displayName ?? 'none'}</p>
      <button onClick={() => connect('alice')}>connect</button>
    </div>
  );
}

describe('SocketProvider', () => {
  beforeEach(() => {
    handlers.clear();
    ioManagerHandlers.clear();
    emitted.length = 0;
    disconnectCalls = 0;
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts in entering-name with no stored name', () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('entering-name');
  });

  it('connects, joins, and reaches at-table on a state event', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      screen.getByText('connect').click();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');

    act(() => {
      handlers.get('connect')?.();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });

    act(() => {
      handlers.get('state')?.(makeWaitingState());
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));
    expect(screen.getByTestId('state')).toHaveTextContent('holdem');
    expect(screen.getByTestId('name')).toHaveTextContent('alice');
    expect(sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY)).toBe('alice');
  });

  it('an error while connecting moves to error and disconnects the socket', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );

    act(() => {
      screen.getByText('connect').click();
    });
    act(() => {
      handlers.get('error')?.({ message: 'Invalid display name' });
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('Invalid display name');
    expect(disconnectCalls).toBe(1);
  });

  it('an error while at-table stays at-table and does not disconnect', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
    });
    act(() => {
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('error')?.({ message: "It is not alice's turn" });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('at-table');
    expect(screen.getByTestId('error')).toHaveTextContent("It is not alice's turn");
    expect(disconnectCalls).toBe(0);
  });

  it('disconnect while at-table moves to reconnecting, and the manager reconnect event re-joins', async () => {
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    act(() => {
      screen.getByText('connect').click();
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState());
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('at-table'));

    act(() => {
      handlers.get('disconnect')?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');

    emitted.length = 0;
    act(() => {
      ioManagerHandlers.get('reconnect')?.();
    });
    expect(emitted).toContainEqual({ event: 'join', payload: { displayName: 'alice' } });
  });

  it('resumes a stored display name on mount without a manual connect() call', () => {
    sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, 'carol');
    render(
      <SocketProvider serverUrl="http://localhost:3000">
        <TestConsumer />
      </SocketProvider>
    );
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');
    expect(screen.getByTestId('name')).toHaveTextContent('carol');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- SocketContext`
Expected: FAIL — `src/socket/SocketContext.tsx` does not exist yet.

- [ ] **Step 4: Write the implementation**

`packages/frontend/src/socket/SocketContext.tsx`:

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- SocketContext`
Expected: PASS, 6/6.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/socket packages/frontend/src/fixtures
git commit -m "feat(frontend): add SocketContext connection state machine and test fixtures"
```

---

### Task 3: Card component and vendored assets

**Files:**
- Create: `packages/frontend/src/assets/cards/*.svg` (vendored)
- Create: `packages/frontend/THIRD_PARTY_NOTICES.md`
- Create: `packages/frontend/src/components/Card.tsx`
- Test: `packages/frontend/src/components/Card.test.tsx`

**Interfaces:**
- Consumes: `Card as CardModel` type from `@poker-blackjack/game-engine`.
- Produces: `export interface CardProps { card?: CardModel; faceDown?: boolean }`,
  `export function Card(props: CardProps): JSX.Element`. Every later task that renders
  a card imports `Card` from `../components/Card`.

- [ ] **Step 1: Vendor the card SVGs**

```bash
git clone --depth 1 https://github.com/Webisso/playing-cards.git /tmp/playing-cards-src
```

Run `ls /tmp/playing-cards-src` and locate the directory containing the 52 (or 54,
if jokers are included) `.svg` files — inspect the actual repo structure and
filenames rather than assuming; the design research only confirmed the *pattern*
(`ace_of_spades.svg`-style naming), not the exact directory layout. Copy just the
`.svg` files into the new assets directory:

```bash
mkdir -p packages/frontend/src/assets/cards
cp /tmp/playing-cards-src/<the-svg-directory-you-found>/*.svg packages/frontend/src/assets/cards/
rm -rf /tmp/playing-cards-src
```

Verify: `ls packages/frontend/src/assets/cards | wc -l` — expect 52 card files (a
joker or two is fine to leave out or ignore, this app never uses them). **Record the
exact filename pattern you found** (e.g. confirm it really is
`<rank>_of_<suit>.svg` with `ace`/`jack`/`queen`/`king` spelled out for face cards
and bare digits for numbers) — Step 3 below assumes this pattern; adjust the mapping
table in `Card.tsx` if the real files differ.

- [ ] **Step 2: Write the attribution notice**

`packages/frontend/THIRD_PARTY_NOTICES.md`:

```markdown
# Third-party assets

## Playing card SVGs

Source: https://github.com/Webisso/playing-cards
License: MIT
Vendored into: `src/assets/cards/`

Copied verbatim, unmodified, as part of Plan 4 (frontend). See that repository's
LICENSE file for the full MIT license text.
```

- [ ] **Step 3: Write the failing test**

`packages/frontend/src/components/Card.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('renders a face-up card with an accessible name including rank and suit', () => {
    render(<Card card={{ suit: 'spades', rank: 'A' }} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName(/A.*spades/i);
  });

  it('renders a face-down placeholder when faceDown is true, even with a card given', () => {
    render(<Card card={{ suit: 'hearts', rank: 'K' }} faceDown />);
    expect(screen.getByRole('img', { name: /face-down/i })).toBeInTheDocument();
  });

  it('renders a face-down placeholder when no card is given at all', () => {
    render(<Card />);
    expect(screen.getByRole('img', { name: /face-down/i })).toBeInTheDocument();
  });

  it('renders a distinct image source for each of the 13 ranks', () => {
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
    const sources = ranks.map((rank) => {
      const { unmount } = render(<Card card={{ suit: 'clubs', rank }} />);
      const src = screen.getByRole('img').getAttribute('src');
      unmount();
      return src;
    });
    expect(new Set(sources).size).toBe(ranks.length);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- Card`
Expected: FAIL — `src/components/Card.tsx` does not exist yet.

- [ ] **Step 5: Write the implementation**

`packages/frontend/src/components/Card.tsx`:

```typescript
import type { Card as CardModel, Rank } from '@poker-blackjack/game-engine';

// Confirm this matches the actual vendored filenames from Task 3, Step 1 --
// adjust if the real pattern differs from `<name>_of_<suit>.svg`.
const RANK_FILE: Record<Rank, string> = {
  A: 'ace',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
};

function assetUrl(card: CardModel): string {
  return new URL(`../assets/cards/${RANK_FILE[card.rank]}_of_${card.suit}.svg`, import.meta.url).href;
}

export interface CardProps {
  card?: CardModel;
  faceDown?: boolean;
}

export function Card({ card, faceDown = false }: CardProps) {
  if (faceDown || !card) {
    return (
      <div
        role="img"
        aria-label="face-down card"
        className="h-24 w-16 rounded-md border border-slate-600 bg-slate-700"
      />
    );
  }
  return (
    <img
      src={assetUrl(card)}
      alt={`${card.rank} of ${card.suit}`}
      className="h-24 w-16 rounded-md border border-slate-300 bg-white"
    />
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- Card`
Expected: PASS, 4/4. If the "distinct source for each rank" test fails, the
`RANK_FILE` mapping doesn't match the vendored filenames — fix the mapping, not the
test.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/assets packages/frontend/src/components/Card.tsx packages/frontend/src/components/Card.test.tsx packages/frontend/THIRD_PARTY_NOTICES.md
git commit -m "feat(frontend): add Card component and vendor MIT-licensed card SVGs"
```

---

### Task 4: JoinScreen

**Files:**
- Create: `packages/frontend/src/components/JoinScreen.tsx`
- Test: `packages/frontend/src/components/JoinScreen.test.tsx`

**Interfaces:**
- Consumes: `useSocket`, `SocketContext`, `SocketContextValue` from
  `../socket/SocketContext`.
- Produces: `export function JoinScreen(): JSX.Element` (no props — reads
  everything it needs from `useSocket()`).

- [ ] **Step 1: Write the failing test**

`packages/frontend/src/components/JoinScreen.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinScreen } from './JoinScreen';
import { SocketContext, type SocketContextValue } from '../socket/SocketContext';

function renderWithContext(overrides: Partial<SocketContextValue> = {}) {
  const connect = vi.fn();
  const value: SocketContextValue = {
    status: 'entering-name',
    state: null,
    errorMessage: null,
    displayName: null,
    connect,
    sendReady: vi.fn(),
    sendAction: vi.fn(),
    leave: vi.fn(),
    ...overrides,
  };
  render(
    <SocketContext.Provider value={value}>
      <JoinScreen />
    </SocketContext.Provider>
  );
  return { connect };
}

describe('JoinScreen', () => {
  it('calls connect with the trimmed display name on submit', async () => {
    const { connect } = renderWithContext();
    await userEvent.type(screen.getByLabelText(/display name/i), '  alice  ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(connect).toHaveBeenCalledWith('alice');
  });

  it('does not call connect for an empty or whitespace-only name', async () => {
    const { connect } = renderWithContext();
    await userEvent.type(screen.getByLabelText(/display name/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    expect(connect).not.toHaveBeenCalled();
  });

  it('disables the form while connecting', () => {
    renderWithContext({ status: 'connecting' });
    expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /joining/i })).toBeDisabled();
  });

  it('shows an error message when one is present', () => {
    renderWithContext({ errorMessage: 'Invalid display name' });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid display name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- JoinScreen`
Expected: FAIL — `src/components/JoinScreen.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

`packages/frontend/src/components/JoinScreen.tsx`:

```typescript
import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';

export function JoinScreen() {
  const { status, errorMessage, connect } = useSocket();
  const [name, setName] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    connect(trimmed);
  }

  const connecting = status === 'connecting';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-white">
      <h1 className="text-2xl font-semibold">Poker &amp; Blackjack</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="displayName" className="text-sm text-slate-300">
          Display name
        </label>
        <input
          id="displayName"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={connecting}
          className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={connecting || name.trim().length === 0}
          className="rounded-md bg-emerald-600 px-3 py-2 font-medium disabled:opacity-50"
        >
          {connecting ? 'Joining…' : 'Join table'}
        </button>
        {errorMessage && (
          <p role="alert" className="text-sm text-red-400">
            {errorMessage}
          </p>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- JoinScreen`
Expected: PASS, 4/4.

- [ ] **Step 5: Add the `user-event` dev dependency**

`userEvent` is not yet a dependency. Run from the repo root:

```bash
npm install -D @testing-library/user-event@^14.5.2 --workspace=@poker-blackjack/frontend
```

Re-run Step 4's command to confirm it still passes with the real package installed.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/JoinScreen.tsx packages/frontend/src/components/JoinScreen.test.tsx packages/frontend/package.json package-lock.json
git commit -m "feat(frontend): add JoinScreen"
```

---

### Task 5: GameTable shared shell

**Files:**
- Create: `packages/frontend/src/components/GameTable.tsx`
- Test: `packages/frontend/src/components/GameTable.test.tsx`

**Interfaces:**
- Consumes: `SeatView` from `@poker-blackjack/server/src/table`; `ConnectionStatus`
  from `../socket/SocketContext`.
- Produces:
  ```typescript
  export interface GameTableProps {
    seats: SeatView[];
    activeSeatIndex: number | null;
    mySeatIndex: number | null;
    connectionStatus: ConnectionStatus;
    handInProgress: boolean;
    onReady: () => void;
    onLeave: () => void;
    seatContent?: Partial<Record<number, ReactNode>>;
    children: ReactNode;
  }
  export function GameTable(props: GameTableProps): JSX.Element;
  ```
  This component has **no** dependency on `useSocket()`, `holdem`, or
  `blackjackRounds` — it is pure layout, taking everything as props. `PokerTable`
  (Task 6) and `BlackjackTable` (Task 7) both render `<GameTable>` internally,
  computing `activeSeatIndex` and `seatContent` themselves from their own
  game-specific view.

- [ ] **Step 1: Write the failing test**

`packages/frontend/src/components/GameTable.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { makeSeat } from '../fixtures/tableStateFixtures';

const baseProps = {
  seats: [makeSeat({ seatIndex: 0, displayName: 'alice' }), makeSeat({ seatIndex: 1, displayName: 'bob' })],
  activeSeatIndex: 1,
  mySeatIndex: 0,
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
};

describe('GameTable', () => {
  it('renders every seat with its display name and highlights the active one', () => {
    render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.getByTestId('seat-0')).toHaveTextContent('alice');
    expect(screen.getByTestId('seat-1')).toHaveTextContent('bob');
    expect(screen.getByTestId('seat-1').className).toMatch(/bg-amber-500/);
    expect(screen.getByTestId('seat-0').className).not.toMatch(/bg-amber-500/);
  });

  it('renders per-seat extra content passed via seatContent', () => {
    render(
      <GameTable {...baseProps} seatContent={{ 0: <span data-testid="extra">hi</span> }}>
        {null}
      </GameTable>
    );
    expect(screen.getByTestId('seat-0')).toContainElement(screen.getByTestId('extra'));
  });

  it('renders children in the center of the table', () => {
    render(<GameTable {...baseProps}>{<span data-testid="center">community</span>}</GameTable>);
    expect(screen.getByTestId('center')).toBeInTheDocument();
  });

  it('shows a reconnecting banner only when connectionStatus is reconnecting', () => {
    const { rerender } = render(<GameTable {...baseProps}>{null}</GameTable>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(
      <GameTable {...baseProps} connectionStatus="reconnecting">
        {null}
      </GameTable>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/reconnecting/i);
  });

  it('shows a Ready button only for my own not-yet-ready seat with no hand in progress', () => {
    const { rerender } = render(
      <GameTable {...baseProps} handInProgress={false} seats={[makeSeat({ seatIndex: 0, ready: false })]} mySeatIndex={0}>
        {null}
      </GameTable>
    );
    expect(screen.getByRole('button', { name: /ready/i })).toBeInTheDocument();

    rerender(
      <GameTable {...baseProps} handInProgress={true} seats={[makeSeat({ seatIndex: 0, ready: false })]} mySeatIndex={0}>
        {null}
      </GameTable>
    );
    expect(screen.queryByRole('button', { name: /^ready$/i })).not.toBeInTheDocument();
  });

  it('calls onReady and onLeave when their buttons are clicked', async () => {
    const onReady = vi.fn();
    const onLeave = vi.fn();
    render(
      <GameTable
        {...baseProps}
        handInProgress={false}
        seats={[makeSeat({ seatIndex: 0, ready: false })]}
        mySeatIndex={0}
        onReady={onReady}
        onLeave={onLeave}
      >
        {null}
      </GameTable>
    );
    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));
    expect(onReady).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /leave table/i }));
    expect(onLeave).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- GameTable`
Expected: FAIL — `src/components/GameTable.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

`packages/frontend/src/components/GameTable.tsx`:

```typescript
import type { ReactNode } from 'react';
import type { SeatView } from '@poker-blackjack/server/src/table';
import type { ConnectionStatus } from '../socket/SocketContext';

export interface GameTableProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  onReady: () => void;
  onLeave: () => void;
  seatContent?: Partial<Record<number, ReactNode>>;
  children: ReactNode;
}

export function GameTable({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  onReady,
  onLeave,
  seatContent,
  children,
}: GameTableProps) {
  const mySeat = mySeatIndex !== null ? (seats.find((s) => s.seatIndex === mySeatIndex) ?? null) : null;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-emerald-900 p-8 text-white">
      {connectionStatus === 'reconnecting' && (
        <div role="status" className="absolute top-4 rounded-md bg-amber-600 px-4 py-2 font-medium">
          Reconnecting…
        </div>
      )}
      <div className="relative flex h-[28rem] w-[36rem] items-center justify-center rounded-full border-4 border-emerald-700 bg-emerald-800">
        {seats.map((seat, i) => {
          const angle = (i / seats.length) * 2 * Math.PI;
          const x = 50 + 42 * Math.cos(angle);
          const y = 50 + 42 * Math.sin(angle);
          const isActive = seat.seatIndex === activeSeatIndex;
          return (
            <div
              key={seat.seatIndex}
              data-testid={`seat-${seat.seatIndex}`}
              className={`absolute flex flex-col items-center gap-1 rounded-md px-2 py-1 text-xs ${
                isActive ? 'bg-amber-500 text-black' : 'bg-emerald-950/70'
              }`}
              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <span className="font-semibold">{seat.displayName ?? 'Empty seat'}</span>
              {seat.displayName && (
                <>
                  <span>{seat.balance} chips</span>
                  <span>{seat.connected ? (seat.ready ? 'Ready' : 'Not ready') : 'Disconnected'}</span>
                  {seatContent?.[seat.seatIndex]}
                </>
              )}
            </div>
          );
        })}
        <div className="flex flex-col items-center gap-2">{children}</div>
      </div>
      {mySeat && !handInProgress && !mySeat.ready && (
        <button onClick={onReady} className="mt-4 rounded-md bg-emerald-600 px-4 py-2 font-medium">
          Ready
        </button>
      )}
      <button onClick={onLeave} className="mt-2 text-sm text-slate-300 underline">
        Leave table
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- GameTable`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/GameTable.tsx packages/frontend/src/components/GameTable.test.tsx
git commit -m "feat(frontend): add generic GameTable seat-ring layout shell"
```

---

### Task 6: PokerTable

**Files:**
- Create: `packages/frontend/src/components/PokerTable.tsx`
- Test: `packages/frontend/src/components/PokerTable.test.tsx`
- Modify: `packages/frontend/src/fixtures/tableStateFixtures.ts` (add one fixture,
  see Step 1)

**Interfaces:**
- Consumes: `GameTable` from `./GameTable`; `Card` from `./Card`; `SeatView`,
  `HoldemView` from `@poker-blackjack/server/src/table`; `HoldemAction` from
  `@poker-blackjack/game-engine`; `ConnectionStatus` from `../socket/SocketContext`.
- Produces:
  ```typescript
  export interface PokerTableProps {
    seats: SeatView[];
    mySeatIndex: number | null;
    connectionStatus: ConnectionStatus;
    handInProgress: boolean;
    onReady: () => void;
    onLeave: () => void;
    holdem: HoldemView | null;
    onAction: (action: HoldemAction, amount?: number) => void;
  }
  export function PokerTable(props: PokerTableProps): JSX.Element;
  ```
  `holdem` is nullable: before the first hand starts, `TableStateView.holdem` is
  `null` (the server only populates it once a hand deals) — `PokerTable` must render
  a normal waiting-room view (seats, Ready button via `GameTable`) in that case, not
  crash or show broken card/pot UI.

- [ ] **Step 1: Add one more fixture**

Add to `packages/frontend/src/fixtures/tableStateFixtures.ts` (append, don't
restructure the existing exports):

```typescript
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
```

- [ ] **Step 2: Write the failing test**

`packages/frontend/src/components/PokerTable.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PokerTable } from './PokerTable';
import { makeSeat, makeHoldemPreflopState, makeHoldemMyTurnState } from '../fixtures/tableStateFixtures';

const baseProps = {
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
  onAction: vi.fn(),
};

describe('PokerTable', () => {
  it('renders own hole cards face-up and the opponent face-down', () => {
    const state = makeHoldemPreflopState();
    render(
      <PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.getByTestId('hole-cards-0').querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByTestId('hole-cards-1').querySelectorAll('img')).toHaveLength(0);
    expect(screen.getAllByRole('img', { name: /face-down/i })).toHaveLength(2);
  });

  it('renders community cards and the total pot', () => {
    const state = makeHoldemPreflopState({
      holdem: {
        street: 'flop',
        communityCards: [
          { suit: 'clubs', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'hearts', rank: 'Q' },
        ],
        actingPlayerId: 'bob',
        pots: [{ amount: 10, eligiblePlayerIds: ['alice', 'bob'] }, { amount: 5, eligiblePlayerIds: ['bob'] }],
        results: null,
        players: makeHoldemPreflopState().holdem!.players,
      },
    });
    render(
      <PokerTable {...baseProps} seats={state.seats} mySeatIndex={0} holdem={state.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.getByTestId('community-cards').querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByText(/pot: 15/i)).toBeInTheDocument();
  });

  it('shows betting controls only when it is my turn', () => {
    const notMyTurn = makeHoldemPreflopState();
    const { rerender } = render(
      <PokerTable {...baseProps} seats={notMyTurn.seats} mySeatIndex={1} holdem={notMyTurn.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.queryByRole('button', { name: /fold/i })).not.toBeInTheDocument();

    const myTurn = makeHoldemMyTurnState();
    rerender(
      <PokerTable {...baseProps} seats={myTurn.seats} mySeatIndex={0} holdem={myTurn.holdem}>
        {null}
      </PokerTable>
    );
    expect(screen.getByRole('button', { name: /fold/i })).toBeInTheDocument();
  });

  it('sends the right action with amount when a betting control is used', async () => {
    const onAction = vi.fn();
    const state = makeHoldemMyTurnState();
    render(
      <PokerTable {...baseProps} onAction={onAction} seats={state.seats} mySeatIndex={0} holdem={state.holdem}>
        {null}
      </PokerTable>
    );
    await userEvent.click(screen.getByRole('button', { name: /fold/i }));
    expect(onAction).toHaveBeenCalledWith('fold');

    await userEvent.clear(screen.getByLabelText(/raise amount/i));
    await userEvent.type(screen.getByLabelText(/raise amount/i), '40');
    await userEvent.click(screen.getByRole('button', { name: /^raise$/i }));
    expect(onAction).toHaveBeenCalledWith('raise', 40);
  });

  it('renders a waiting-room view with no crash when holdem is null', () => {
    render(
      <PokerTable {...baseProps} seats={[makeSeat({ seatIndex: 0 })]} mySeatIndex={0} holdem={null}>
        {null}
      </PokerTable>
    );
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- PokerTable`
Expected: FAIL — `src/components/PokerTable.tsx` does not exist yet.

- [ ] **Step 4: Write the implementation**

`packages/frontend/src/components/PokerTable.tsx`:

```typescript
import { useState, type ReactNode } from 'react';
import type { SeatView, HoldemView } from '@poker-blackjack/server/src/table';
import type { HoldemAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';

export interface PokerTableProps {
  seats: SeatView[];
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  onReady: () => void;
  onLeave: () => void;
  holdem: HoldemView | null;
  onAction: (action: HoldemAction, amount?: number) => void;
}

export function PokerTable({
  seats,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  onReady,
  onLeave,
  holdem,
  onAction,
}: PokerTableProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);

  const activeSeatIndex = holdem
    ? (seats.find((s) => s.displayName === holdem.actingPlayerId)?.seatIndex ?? null)
    : null;
  const isMyTurn = mySeatIndex !== null && mySeatIndex === activeSeatIndex;

  const seatContent: Partial<Record<number, ReactNode>> = {};
  if (holdem) {
    for (const player of holdem.players) {
      const seat = seats.find((s) => s.displayName === player.playerId);
      if (!seat) continue;
      seatContent[seat.seatIndex] = (
        <div className="flex gap-1" data-testid={`hole-cards-${seat.seatIndex}`}>
          <Card card={player.holeCards?.[0]} faceDown={player.holeCards === null} />
          <Card card={player.holeCards?.[1]} faceDown={player.holeCards === null} />
        </div>
      );
    }
  }

  return (
    <GameTable
      seats={seats}
      activeSeatIndex={activeSeatIndex}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      onReady={onReady}
      onLeave={onLeave}
      seatContent={seatContent}
    >
      {holdem ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-1" data-testid="community-cards">
            {holdem.communityCards.map((card, i) => (
              <Card key={i} card={card} />
            ))}
          </div>
          <p>Pot: {holdem.pots.reduce((sum, pot) => sum + pot.amount, 0)}</p>
          {isMyTurn && (
            <div className="flex items-center gap-2">
              <button onClick={() => onAction('fold')} className="rounded-md bg-red-600 px-3 py-1">
                Fold
              </button>
              <button onClick={() => onAction('check')} className="rounded-md bg-slate-600 px-3 py-1">
                Check
              </button>
              <button onClick={() => onAction('call')} className="rounded-md bg-slate-600 px-3 py-1">
                Call
              </button>
              <input
                type="number"
                value={raiseAmount}
                onChange={(event) => setRaiseAmount(Number(event.target.value))}
                aria-label="Raise amount"
                className="w-20 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-white"
              />
              <button
                onClick={() => onAction('raise', raiseAmount)}
                className="rounded-md bg-emerald-600 px-3 py-1"
              >
                Raise
              </button>
              <button onClick={() => onAction('all-in')} className="rounded-md bg-amber-600 px-3 py-1">
                All In
              </button>
            </div>
          )}
        </div>
      ) : (
        <p>Waiting for hand to start…</p>
      )}
    </GameTable>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- PokerTable`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/PokerTable.tsx packages/frontend/src/components/PokerTable.test.tsx packages/frontend/src/fixtures/tableStateFixtures.ts
git commit -m "feat(frontend): add PokerTable"
```

---

### Task 7: BlackjackTable

**Files:**
- Create: `packages/frontend/src/components/BlackjackTable.tsx`
- Test: `packages/frontend/src/components/BlackjackTable.test.tsx`
- Modify: `packages/frontend/src/fixtures/tableStateFixtures.ts` (add one fixture)

**Interfaces:**
- Consumes: `GameTable` from `./GameTable`; `Card` from `./Card`; `SeatView`,
  `BlackjackRoundView` from `@poker-blackjack/server/src/table`; `PlayerAction` from
  `@poker-blackjack/game-engine`; `ConnectionStatus` from `../socket/SocketContext`.
- Produces:
  ```typescript
  export interface BlackjackTableProps {
    seats: SeatView[];
    activeSeatIndex: number | null;
    mySeatIndex: number | null;
    connectionStatus: ConnectionStatus;
    handInProgress: boolean;
    onReady: () => void;
    onLeave: () => void;
    blackjackRounds: Record<number, BlackjackRoundView> | null;
    onAction: (action: PlayerAction) => void;
  }
  export function BlackjackTable(props: BlackjackTableProps): JSX.Element;
  ```
  `blackjackRounds` is nullable for the same reason `PokerTable`'s `holdem` is —
  before the first hand deals, it's `null`. Unlike `PokerTable`, `activeSeatIndex`
  is passed in directly (`Table.activeSeatIndex` is populated by the server for
  Blackjack, unlike Hold'em, which tracks turn via `actingPlayerId` instead — see
  the Global Constraints note on this asymmetry, and don't "fix" it to match
  `PokerTable`'s derivation pattern, they're genuinely different at the protocol
  level).

- [ ] **Step 1: Add one more fixture**

Append to `packages/frontend/src/fixtures/tableStateFixtures.ts`:

```typescript
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
```

- [ ] **Step 2: Write the failing test**

`packages/frontend/src/components/BlackjackTable.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlackjackTable } from './BlackjackTable';
import { makeSeat, makeBlackjackPlayingState, makeBlackjackSplitHandState } from '../fixtures/tableStateFixtures';

const baseProps = {
  connectionStatus: 'at-table' as const,
  handInProgress: true,
  onReady: vi.fn(),
  onLeave: vi.fn(),
  onAction: vi.fn(),
};

describe('BlackjackTable', () => {
  it("renders the dealer's up-card before the round settles", () => {
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds}>
        {null}
      </BlackjackTable>
    );
    expect(screen.getByTestId('dealer-hand').querySelectorAll('img')).toHaveLength(1);
  });

  it("renders both of a seat's hands after a split", () => {
    const state = makeBlackjackSplitHandState();
    render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds}>
        {null}
      </BlackjackTable>
    );
    const hands = screen.getByTestId('hands-0');
    expect(hands.querySelectorAll('img')).toHaveLength(4);
  });

  it('shows action controls only when it is my seat\'s turn', () => {
    const state = makeBlackjackPlayingState();
    const { rerender } = render(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={1} blackjackRounds={state.blackjackRounds}>
        {null}
      </BlackjackTable>
    );
    expect(screen.queryByRole('button', { name: /^hit$/i })).not.toBeInTheDocument();

    rerender(
      <BlackjackTable {...baseProps} seats={state.seats} activeSeatIndex={0} mySeatIndex={0} blackjackRounds={state.blackjackRounds}>
        {null}
      </BlackjackTable>
    );
    expect(screen.getByRole('button', { name: /^hit$/i })).toBeInTheDocument();
  });

  it('sends the right action when a control is clicked', async () => {
    const onAction = vi.fn();
    const state = makeBlackjackPlayingState();
    render(
      <BlackjackTable
        {...baseProps}
        onAction={onAction}
        seats={state.seats}
        activeSeatIndex={0}
        mySeatIndex={0}
        blackjackRounds={state.blackjackRounds}
      >
        {null}
      </BlackjackTable>
    );
    await userEvent.click(screen.getByRole('button', { name: /^stand$/i }));
    expect(onAction).toHaveBeenCalledWith('stand');
  });

  it('renders a waiting-room view with no crash when blackjackRounds is null', () => {
    render(
      <BlackjackTable {...baseProps} seats={[makeSeat({ seatIndex: 0 })]} activeSeatIndex={null} mySeatIndex={0} blackjackRounds={null}>
        {null}
      </BlackjackTable>
    );
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- BlackjackTable`
Expected: FAIL — `src/components/BlackjackTable.tsx` does not exist yet.

- [ ] **Step 4: Write the implementation**

`packages/frontend/src/components/BlackjackTable.tsx`:

```typescript
import type { ReactNode } from 'react';
import type { SeatView, BlackjackRoundView } from '@poker-blackjack/server/src/table';
import type { PlayerAction } from '@poker-blackjack/game-engine';
import type { ConnectionStatus } from '../socket/SocketContext';
import { Card } from './Card';
import { GameTable } from './GameTable';

export interface BlackjackTableProps {
  seats: SeatView[];
  activeSeatIndex: number | null;
  mySeatIndex: number | null;
  connectionStatus: ConnectionStatus;
  handInProgress: boolean;
  onReady: () => void;
  onLeave: () => void;
  blackjackRounds: Record<number, BlackjackRoundView> | null;
  onAction: (action: PlayerAction) => void;
}

export function BlackjackTable({
  seats,
  activeSeatIndex,
  mySeatIndex,
  connectionStatus,
  handInProgress,
  onReady,
  onLeave,
  blackjackRounds,
  onAction,
}: BlackjackTableProps) {
  const isMyTurn = mySeatIndex !== null && mySeatIndex === activeSeatIndex;
  const dealerRound = blackjackRounds ? Object.values(blackjackRounds)[0] : undefined;

  const seatContent: Partial<Record<number, ReactNode>> = {};
  if (blackjackRounds) {
    for (const [seatIndexStr, round] of Object.entries(blackjackRounds)) {
      const seatIndex = Number(seatIndexStr);
      seatContent[seatIndex] = (
        <div className="flex flex-col gap-1" data-testid={`hands-${seatIndex}`}>
          {round.playerHands.map((hand, i) => (
            <div key={i} className="flex gap-1">
              {hand.cards.map((card, j) => (
                <Card key={j} card={card} />
              ))}
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <GameTable
      seats={seats}
      activeSeatIndex={activeSeatIndex}
      mySeatIndex={mySeatIndex}
      connectionStatus={connectionStatus}
      handInProgress={handInProgress}
      onReady={onReady}
      onLeave={onLeave}
      seatContent={seatContent}
    >
      {blackjackRounds ? (
        <div className="flex flex-col items-center gap-2" data-testid="dealer-hand">
          <p>Dealer</p>
          <div className="flex gap-1">
            {dealerRound?.dealerCards
              ? dealerRound.dealerCards.map((card, i) => <Card key={i} card={card} />)
              : dealerRound && <Card card={dealerRound.dealerUpcard} />}
          </div>
          {isMyTurn && (
            <div className="flex gap-2">
              <button onClick={() => onAction('hit')} className="rounded-md bg-slate-600 px-3 py-1">
                Hit
              </button>
              <button onClick={() => onAction('stand')} className="rounded-md bg-slate-600 px-3 py-1">
                Stand
              </button>
              <button onClick={() => onAction('double')} className="rounded-md bg-emerald-600 px-3 py-1">
                Double
              </button>
              <button onClick={() => onAction('split')} className="rounded-md bg-amber-600 px-3 py-1">
                Split
              </button>
            </div>
          )}
        </div>
      ) : (
        <p>Waiting for hand to start…</p>
      )}
    </GameTable>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- BlackjackTable`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/BlackjackTable.tsx packages/frontend/src/components/BlackjackTable.test.tsx packages/frontend/src/fixtures/tableStateFixtures.ts
git commit -m "feat(frontend): add BlackjackTable"
```

---

### Task 8: App wiring

**Files:**
- Modify: `packages/frontend/src/App.tsx` (replaces Task 1's placeholder entirely)
- Modify: `packages/frontend/src/App.test.tsx` (replaces Task 1's placeholder test)

**Interfaces:**
- Consumes: `SocketProvider`, `useSocket` from `./socket/SocketContext`; `JoinScreen`
  from `./components/JoinScreen`; `PokerTable` from `./components/PokerTable`;
  `BlackjackTable` from `./components/BlackjackTable`.
- Produces: `export default function App(): JSX.Element` — this is the last task
  that touches `App.tsx`; nothing later depends on its internals beyond the default
  export already established in Task 1.

- [ ] **Step 1: Write the failing test**

`packages/frontend/src/App.test.tsx` (replace entirely):

```typescript
import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import { makeWaitingState } from './fixtures/tableStateFixtures';

const handlers = new Map<string, (...args: unknown[]) => void>();

function fakeSocket() {
  return {
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    emit: () => {},
    disconnect: () => {},
    io: { on: () => {} },
  };
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket()) }));

describe('App', () => {
  beforeEach(() => {
    handlers.clear();
    sessionStorage.clear();
  });

  it('shows the join screen before connecting', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /poker & blackjack/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('shows PokerTable once state arrives with gameMode holdem', async () => {
    render(<App />);
    act(() => {
      screen.getByLabelText(/display name/i);
    });
    const input = screen.getByLabelText(/display name/i);
    input.focus();
    act(() => {
      (input as HTMLInputElement).value = 'alice';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      screen.getByRole('button', { name: /join table/i }).click();
    });
    act(() => {
      handlers.get('connect')?.();
      handlers.get('state')?.(makeWaitingState({ gameMode: 'holdem' }));
    });
    expect(await screen.findByRole('button', { name: /leave table/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting for hand to start/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=@poker-blackjack/frontend -- App`
Expected: FAIL — the second test fails because `App.tsx` still renders the Task 1
static placeholder, not a real `JoinScreen`.

- [ ] **Step 3: Write the implementation**

`packages/frontend/src/App.tsx` (replace entirely):

```typescript
import { SocketProvider, useSocket } from './socket/SocketContext';
import { JoinScreen } from './components/JoinScreen';
import { PokerTable } from './components/PokerTable';
import { BlackjackTable } from './components/BlackjackTable';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

function AppContent() {
  const { status, state, displayName, sendReady, sendAction, leave } = useSocket();

  if (!state || status === 'entering-name' || status === 'connecting' || status === 'error') {
    return <JoinScreen />;
  }

  const mySeatIndex = state.seats.find((s) => s.displayName === displayName)?.seatIndex ?? null;
  const sharedProps = {
    seats: state.seats,
    mySeatIndex,
    connectionStatus: status,
    handInProgress: state.handInProgress,
    onReady: sendReady,
    onLeave: leave,
  };

  return state.gameMode === 'holdem' ? (
    <PokerTable {...sharedProps} holdem={state.holdem} onAction={sendAction} />
  ) : (
    <BlackjackTable
      {...sharedProps}
      activeSeatIndex={state.activeSeatIndex}
      blackjackRounds={state.blackjackRounds}
      onAction={sendAction}
    />
  );
}

function App() {
  return (
    <SocketProvider serverUrl={SERVER_URL}>
      <AppContent />
    </SocketProvider>
  );
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- App`
Expected: PASS, 2/2.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npm run test --workspace=@poker-blackjack/frontend`
Expected: all prior tasks' tests still pass alongside this one (no regressions from
replacing `App.tsx`).

Run: `npm run typecheck --workspace=@poker-blackjack/frontend`
Expected: clean. If `import.meta.env.VITE_SERVER_URL` errors as untyped, add a
`packages/frontend/src/vite-env.d.ts` containing `/// <reference types="vite/client" />`
and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/App.test.tsx packages/frontend/src/vite-env.d.ts
git commit -m "feat(frontend): wire SocketContext, JoinScreen, PokerTable, and BlackjackTable into App"
```

---

### Task 9: End-to-end integration tests

**Files:**
- Create: `packages/frontend/src/integration/poker.integration.test.ts`
- Create: `packages/frontend/src/integration/blackjack.integration.test.ts`
- Modify: `packages/frontend/package.json` (add `@poker-blackjack/game-engine`,
  `socket.io` as devDependencies — needed to run a real server instance in-process,
  mirroring exactly what `packages/server/src/integration.test.ts` already does)

**Interfaces:**
- Consumes: `createServer` from `@poker-blackjack/server/src/socketServer`;
  `JsonPlayerStore` from `@poker-blackjack/server/src/playerStore`; `JsonlHandLog`
  from `@poker-blackjack/server/src/handLog`; a real `socket.io-client` `io()` (not
  mocked, unlike every earlier task); `App` from `../App`.
- Produces: nothing consumed by other tasks — this is the plan's last task.

This task does not unit-test a component; it proves the whole stack (`App` → real
`socket.io-client` → real `packages/server` `Table`) works end to end, the same way
`packages/server/src/integration.test.ts` already proves the server side end to end.
Read that file first (`packages/server/src/integration.test.ts`) — this task's setup
(temp dir, `JsonPlayerStore`, `JsonlHandLog`, `createServer`, `httpServer.listen(0)`
to get a free port, teardown in `afterEach`) should mirror it exactly rather than
inventing a new pattern.

- [ ] **Step 1: Read the existing server-side integration test for the setup pattern**

Run: read `packages/server/src/integration.test.ts` in full before writing this
task's setup — do not skip this, the temp-directory-per-test and server
startup/teardown pattern must match exactly (same env var conventions, same
`afterEach` ordering) or this suite will leak file handles or ports across test runs.

- [ ] **Step 2: Add the real-server devDependencies**

`packages/frontend/package.json`'s `devDependencies` needs two more entries (the
rest already present from Task 1):

```json
    "@poker-blackjack/game-engine": "*",
    "socket.io": "^4.8.0",
```

Run from the repo root: `npm install`

- [ ] **Step 3: Write the Hold'em integration test**

`packages/frontend/src/integration/poker.integration.test.ts`:

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { createServer } from '@poker-blackjack/server/src/socketServer';
import { JsonPlayerStore } from '@poker-blackjack/server/src/playerStore';
import { JsonlHandLog } from '@poker-blackjack/server/src/handLog';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import App from '../App';

// Mirrors packages/server/src/integration.test.ts's own setup pattern --
// see that file for the established conventions this follows.
let tmpDir: string;
let httpServer: import('node:http').Server;
let serverUrl: string;
let originalServerUrl: string | undefined;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'frontend-poker-integration-'));
  const config: TableConfig = {
    gameMode: 'holdem',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 120_000,
    random: Math.random,
  };
  const playerStore = new JsonPlayerStore(join(tmpDir, 'balances.json'), config.defaultStartingBalance);
  const handLog = new JsonlHandLog(join(tmpDir, 'hand.jsonl'));
  const result = await createServer(config, playerStore, handLog);
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  serverUrl = `http://localhost:${port}`;
  originalServerUrl = import.meta.env.VITE_SERVER_URL;
  (import.meta.env as Record<string, string>).VITE_SERVER_URL = serverUrl;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
  (import.meta.env as Record<string, string | undefined>).VITE_SERVER_URL = originalServerUrl;
});

describe('Poker end-to-end via App', () => {
  it('two players join, ready up, and see the hand start with correct hole-card visibility', async () => {
    // Player 1: drives the real App component through the DOM.
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    // Player 2: a second real socket.io-client connection (not through React --
    // this is the same "opponent" role packages/server's own tests use).
    const bobSocket: Socket = createClient(serverUrl);
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    bobSocket.emit('ready');

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('hole-cards-0').querySelectorAll('img')).toHaveLength(2);
    });
    // Own hole cards are real card images; the opponent's are face-down.
    expect(screen.getAllByRole('img', { name: /face-down/i }).length).toBeGreaterThan(0);

    bobSocket.disconnect();
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- poker.integration`
Expected first: FAIL or hang if the server/App wiring has any mismatch — debug
against the real error rather than assuming; this test exercises real sockets, so a
failure here can be a genuine protocol mismatch, not a test bug.
Once fixed: PASS, 1/1.

- [ ] **Step 5: Write the Blackjack integration test**

`packages/frontend/src/integration/blackjack.integration.test.ts` — same structure
as Step 3, with `gameMode: 'blackjack'` in the config. **Confirmed via
`Table.startHandIfEveryoneReady` (`packages/server/src/table.ts`):**
`eligibleSeats.length >= 2` is checked unconditionally, before the game-mode branch
— Blackjack requires two ready, eligible players to deal a hand, exactly like
Hold'em, not one. Use a second real `socket.io-client` connection (`bobSocket`) the
same way Step 3 did, and assert on `screen.getByTestId('dealer-hand')` and
`screen.getByTestId('hands-0')` instead of the Hold'em-specific testids:

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { createServer } from '@poker-blackjack/server/src/socketServer';
import { JsonPlayerStore } from '@poker-blackjack/server/src/playerStore';
import { JsonlHandLog } from '@poker-blackjack/server/src/handLog';
import type { TableConfig } from '@poker-blackjack/server/src/table';
import App from '../App';

let tmpDir: string;
let httpServer: import('node:http').Server;
let serverUrl: string;
let originalServerUrl: string | undefined;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'frontend-blackjack-integration-'));
  const config: TableConfig = {
    gameMode: 'blackjack',
    seatCount: 8,
    smallBlind: 5,
    bigBlind: 10,
    blackjackDefaultBet: 25,
    defaultStartingBalance: 1000,
    reconnectGraceMs: 120_000,
    random: Math.random,
  };
  const playerStore = new JsonPlayerStore(join(tmpDir, 'balances.json'), config.defaultStartingBalance);
  const handLog = new JsonlHandLog(join(tmpDir, 'hand.jsonl'));
  const result = await createServer(config, playerStore, handLog);
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  serverUrl = `http://localhost:${port}`;
  originalServerUrl = import.meta.env.VITE_SERVER_URL;
  (import.meta.env as Record<string, string>).VITE_SERVER_URL = serverUrl;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
  (import.meta.env as Record<string, string | undefined>).VITE_SERVER_URL = originalServerUrl;
});

describe('Blackjack end-to-end via App', () => {
  it('two players join and ready up, and each sees their own hand and the shared dealer up-card', async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /join table/i }));
    await screen.findByRole('button', { name: /^ready$/i });

    const bobSocket: Socket = createClient(serverUrl);
    await new Promise<void>((resolve) => bobSocket.on('connect', resolve));
    bobSocket.emit('join', { displayName: 'bob' });
    await new Promise<void>((resolve) => bobSocket.once('state', () => resolve()));
    bobSocket.emit('ready');

    await userEvent.click(screen.getByRole('button', { name: /^ready$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('hands-0').querySelectorAll('img').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId('dealer-hand').querySelectorAll('img')).toHaveLength(1);

    bobSocket.disconnect();
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=@poker-blackjack/frontend -- blackjack.integration`
Expected: PASS, 1/1.

- [ ] **Step 7: Run the full verification suite**

Run from the repo root:
```bash
npm test
npm run typecheck
```
Expected: every workspace green (`game-engine`, `server`, `frontend`), typecheck
clean in all three.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/integration packages/frontend/package.json package-lock.json
git commit -m "test(frontend): add end-to-end Poker and Blackjack integration tests"
```

---

## After All Tasks: Final Verification

1. `npm test` from the repo root — every workspace green.
2. `npm run typecheck` from the repo root — clean in all three workspaces.
3. **Known blocker, confirmed while writing this plan, not caused by anything in
   it:** `packages/server` has never actually been run as a standalone Node process
   — Plan 3's tests only ever exercised it through Vitest's own module loader.
   Running it directly currently fails two different ways in sequence: plain `node
   src/index.ts` rejects the extensionless relative imports under Node's stricter
   ESM resolution, and running it via `tsx` (which fixes that) then fails on
   `packages/game-engine/src/holdemHandRank.ts`'s `import { Hand } from
   'pokersolver'` — Node's CJS-to-ESM interop doesn't detect `pokersolver`'s `Hand`
   export. This is a `packages/game-engine` (Plan 1/2) dependency-interop issue, not
   a Plan 4 defect — flagged separately for a dedicated fix, do not attempt to fix
   it as part of this plan's tasks.
   **Because of this, a real manual click-through in a browser is blocked until
   that's fixed.** Once it is, do the manual pass this step originally called for —
   `npm run dev --workspace=@poker-blackjack/frontend` alongside a real running
   server, joining/readying/playing a hand in both game modes in an actual browser.
   Until then, Task 9's real-server integration tests (which go through Vitest, not
   a standalone process, so they aren't affected by this blocker) are the strongest
   available verification, but they are not a substitute for eyes on the real UI —
   say so explicitly when reporting this plan's completion, rather than silently
   treating the automated tests as sufficient. The design doc's own testing
   philosophy note applies here: automated tests verify code correctness, not that
   the UI actually looks and feels right.
4. Re-read the diff once, end to end, before the final review — specifically
   re-verify: `GameTable` has no `useSocket()` call anywhere in it (Task 5's whole
   point); the Hold'em/Blackjack `activeSeatIndex` asymmetry noted in Task 7 is
   preserved, not "fixed" to look symmetric; every vendored asset in
   `THIRD_PARTY_NOTICES.md` is accounted for.
