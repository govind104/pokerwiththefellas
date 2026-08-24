import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';
import type { GameMode } from '@poker-blackjack/server/src/table';

// Every numeric field is held as `string | null`, where `null` means
// "untouched -- show whatever the server last broadcast". That gives the
// admin three things the old always-blank inputs did not: the current value
// is visible without guessing, a successful change is visibly confirmed the
// moment the next broadcast arrives, and an *explicitly* cleared field is
// distinguishable from an untouched one (`''` vs `null`), which matters
// because `Number('') === 0` -- the coercion that used to let an empty
// "New balance" field zero a player's chips and an empty "Big blind" field
// persist a 0 big blind across restarts.
type FieldValue = string | null;

export function AdminPanel() {
  const {
    state,
    isAdmin,
    adminActionErrorMessage,
    adminSwitchMode,
    adminAdjustBalance,
    adminSetBlinds,
    adminSetDefaultBet,
    adminSetStartingBalance,
  } = useSocket();
  const [open, setOpen] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [targetBalance, setTargetBalance] = useState<FieldValue>(null);
  const [smallBlind, setSmallBlind] = useState<FieldValue>(null);
  const [bigBlind, setBigBlind] = useState<FieldValue>(null);
  const [defaultBet, setDefaultBet] = useState<FieldValue>(null);
  const [startingBalance, setStartingBalance] = useState<FieldValue>(null);

  if (!isAdmin || !state?.table) {
    return null;
  }
  const table = state.table;
  const seatedNames = table.seats
    .map((s) => s.displayName)
    .filter((name): name is string => name !== null);
  const selectedSeat = table.seats.find((s) => s.displayName === targetName) ?? null;

  const targetBalanceValue = targetBalance ?? (selectedSeat ? String(selectedSeat.balance) : '');
  const smallBlindValue = smallBlind ?? String(state.smallBlind);
  const bigBlindValue = bigBlind ?? String(state.bigBlind);
  const defaultBetValue = defaultBet ?? String(state.blackjackDefaultBet);
  const startingBalanceValue = startingBalance ?? String(state.defaultStartingBalance);

  // A blank field is "no change", never a zero. Anything else is handed to
  // the server, which does the real range validation and answers a bad value
  // with a scoped error rendered right below (see adminActionErrorMessage).
  function parseField(raw: string): number | null {
    if (raw.trim() === '') {
      return null;
    }
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function handleAdjustBalance(event: FormEvent) {
    event.preventDefault();
    const balance = parseField(targetBalanceValue);
    if (targetName.trim().length === 0 || balance === null) {
      return;
    }
    adminAdjustBalance(targetName, balance);
    // Back to "show the broadcast value": once the server applies the
    // change, the next state event carries the new balance and the input
    // reflects it -- which is the visible confirmation the change landed.
    setTargetBalance(null);
  }

  function handleSetBlinds(event: FormEvent) {
    event.preventDefault();
    const sb = parseField(smallBlindValue);
    const bb = parseField(bigBlindValue);
    if (sb === null || bb === null) {
      return;
    }
    adminSetBlinds(sb, bb);
    setSmallBlind(null);
    setBigBlind(null);
  }

  function handleSetDefaultBet(event: FormEvent) {
    event.preventDefault();
    const bet = parseField(defaultBetValue);
    if (bet === null) {
      return;
    }
    adminSetDefaultBet(bet);
    setDefaultBet(null);
  }

  function handleSetStartingBalance(event: FormEvent) {
    event.preventDefault();
    const balance = parseField(startingBalanceValue);
    if (balance === null) {
      return;
    }
    adminSetStartingBalance(balance);
    setStartingBalance(null);
  }

  const otherMode: GameMode = table.gameMode === 'holdem' ? 'blackjack' : 'holdem';

  return (
    <div className="fixed bottom-2 right-2 z-50 text-sm text-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-slate-700 px-3 py-1.5 font-medium"
      >
        {open ? 'Close admin panel' : 'Admin panel'}
      </button>
      {open && (
        <div className="mt-2 flex w-64 flex-col gap-3 rounded-md border border-slate-600 bg-slate-800 p-3">
          {/* The mode picker lives here, not in Lobby: Lobby only renders at
              status 'lobby', which SocketContext only reaches when no mode is
              active -- so Lobby's own switch UI (which requires a mode to be
              active) could never actually appear. AdminPanel is mounted
              exactly when a table exists, which is exactly when switching is
              the operation that makes sense. */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-slate-400">
              Currently playing {table.gameMode === 'holdem' ? 'Poker' : 'Blackjack'}
            </p>
            <button
              type="button"
              onClick={() => adminSwitchMode(otherMode)}
              className="rounded bg-emerald-600 px-2 py-1"
            >
              {otherMode === 'holdem' ? 'Switch to Poker' : 'Switch to Blackjack'}
            </button>
          </div>

          <form onSubmit={handleAdjustBalance} className="flex flex-col gap-1">
            <p className="text-xs text-slate-400">Correct a player&apos;s balance</p>
            <select
              value={targetName}
              onChange={(event) => {
                setTargetName(event.target.value);
                // Revert to "show the newly selected player's balance"
                // rather than carrying the previous player's typed value
                // over to a different player.
                setTargetBalance(null);
              }}
              aria-label="Select player"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            >
              <option value="">Select player</option>
              {seatedNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={targetBalanceValue}
              onChange={(event) => setTargetBalance(event.target.value)}
              placeholder="New balance"
              aria-label="New balance"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Save balance
            </button>
          </form>

          {table.gameMode === 'holdem' && (
            <form onSubmit={handleSetBlinds} className="flex flex-col gap-1">
              <p className="text-xs text-slate-400">Blinds (next hand)</p>
              <input
                type="number"
                value={smallBlindValue}
                onChange={(event) => setSmallBlind(event.target.value)}
                placeholder="Small blind"
                aria-label="Small blind"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <input
                type="number"
                value={bigBlindValue}
                onChange={(event) => setBigBlind(event.target.value)}
                placeholder="Big blind"
                aria-label="Big blind"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
                Save blinds
              </button>
            </form>
          )}

          {table.gameMode === 'blackjack' && (
            <form onSubmit={handleSetDefaultBet} className="flex flex-col gap-1">
              <label htmlFor="admin-default-bet" className="text-xs text-slate-400">
                Default bet (next hand)
              </label>
              <input
                id="admin-default-bet"
                type="number"
                value={defaultBetValue}
                onChange={(event) => setDefaultBet(event.target.value)}
                aria-label="Default bet"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
                Save default bet
              </button>
            </form>
          )}

          <form onSubmit={handleSetStartingBalance} className="flex flex-col gap-1">
            <label htmlFor="admin-starting-balance" className="text-xs text-slate-400">
              Starting balance for new joiners
            </label>
            <input
              id="admin-starting-balance"
              type="number"
              value={startingBalanceValue}
              onChange={(event) => setStartingBalance(event.target.value)}
              aria-label="Starting balance for new joiners"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Save starting balance
            </button>
          </form>

          {/* Admin-action rejections land here rather than in JoinScreen's
              form, where they used to be announced as a problem with the
              display-name input. */}
          {adminActionErrorMessage && (
            <p role="alert" className="text-xs text-red-400">
              {adminActionErrorMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
