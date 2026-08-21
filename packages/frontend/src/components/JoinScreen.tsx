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
