import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';

export function AdminPanel() {
  const { state, isAdmin, adminAdjustBalance, adminSetBlinds, adminSetDefaultBet, adminSetStartingBalance } =
    useSocket();
  const [open, setOpen] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [targetBalance, setTargetBalance] = useState('');
  const [smallBlind, setSmallBlind] = useState('');
  const [bigBlind, setBigBlind] = useState('');
  const [defaultBet, setDefaultBet] = useState('');
  const [startingBalance, setStartingBalance] = useState('');

  if (!isAdmin || !state?.table) {
    return null;
  }
  const table = state.table;
  const seatedNames = table.seats
    .map((s) => s.displayName)
    .filter((name): name is string => name !== null);

  function handleAdjustBalance(event: FormEvent) {
    event.preventDefault();
    const balance = Number(targetBalance);
    if (targetName.trim().length === 0 || Number.isNaN(balance)) {
      return;
    }
    adminAdjustBalance(targetName, balance);
    setTargetBalance('');
  }

  function handleSetBlinds(event: FormEvent) {
    event.preventDefault();
    const sb = Number(smallBlind);
    const bb = Number(bigBlind);
    if (Number.isNaN(sb) || Number.isNaN(bb)) {
      return;
    }
    adminSetBlinds(sb, bb);
    setSmallBlind('');
    setBigBlind('');
  }

  function handleSetDefaultBet(event: FormEvent) {
    event.preventDefault();
    const bet = Number(defaultBet);
    if (Number.isNaN(bet)) {
      return;
    }
    adminSetDefaultBet(bet);
    setDefaultBet('');
  }

  function handleSetStartingBalance(event: FormEvent) {
    event.preventDefault();
    const balance = Number(startingBalance);
    if (Number.isNaN(balance)) {
      return;
    }
    adminSetStartingBalance(balance);
    setStartingBalance('');
  }

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
          <form onSubmit={handleAdjustBalance} className="flex flex-col gap-1">
            <p className="text-xs text-slate-400">Correct a player&apos;s balance</p>
            <select
              id="admin-balance-name"
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
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
              value={targetBalance}
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
                value={smallBlind}
                onChange={(event) => setSmallBlind(event.target.value)}
                placeholder="Small blind"
                aria-label="Small blind"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
              />
              <input
                type="number"
                value={bigBlind}
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
                value={defaultBet}
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
              value={startingBalance}
              onChange={(event) => setStartingBalance(event.target.value)}
              aria-label="Starting balance for new joiners"
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1"
            />
            <button type="submit" className="rounded bg-emerald-600 px-2 py-1">
              Save starting balance
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
