import { useState, type FormEvent } from 'react';
import { useSocket } from '../socket/SocketContext';

export function AdminEntry() {
  const { isAdmin, adminLogin, errorMessage } = useSocket();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (passphrase.trim().length === 0) {
      return;
    }
    adminLogin(passphrase.trim());
    setPassphrase('');
  }

  if (isAdmin) {
    return <p className="fixed right-2 top-2 z-50 text-xs font-medium text-emerald-400">Admin</p>;
  }

  return (
    <div className="fixed right-2 top-2 z-50 text-sm text-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium"
      >
        Admin
      </button>
      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-1 flex flex-col gap-1 rounded-md border border-slate-600 bg-slate-800 p-2"
        >
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase"
            aria-label="Admin passphrase"
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
          />
          <button type="submit" className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium">
            Unlock
          </button>
          {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}
