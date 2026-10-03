import type { ConnectionStatus } from '../socket/SocketContext';

export function Banners({ connectionStatus, errorMessage }: { connectionStatus: ConnectionStatus; errorMessage?: string | null }) {
  return (
    <div className="fixed left-1/2 top-3 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
      {connectionStatus === 'reconnecting' && (
        <div role="status" className="rounded-md bg-amber-600 px-4 py-2 font-medium">
          Reconnecting…
        </div>
      )}
      {errorMessage && (
        <div role="alert" className="rounded-md bg-red-600 px-4 py-2 font-medium">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
