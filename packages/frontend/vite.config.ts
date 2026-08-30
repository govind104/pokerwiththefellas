import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same PORT env var packages/server/src/index.ts reads (default 3000), so
// overriding the backend's port keeps this proxy target in sync -- as long
// as PORT is set in the same shell environment before starting both `npm
// run dev` processes. There's no other way for this config (loaded once,
// in a separate process) to learn the backend's actual bound port.
const BACKEND_PORT = process.env.PORT ?? 3000;

export default defineConfig({
  plugins: [react()],
  server: {
    // Two-port local dev workflow (this dev server on :5173, the backend on
    // BACKEND_PORT, per HANDOFF.md): proxying /socket.io means the
    // socket.io-client in App.tsx can just connect to the page's own origin
    // (its default, same-origin fallback -- see serverUrl.ts) in dev too,
    // exactly like it does in the single-process `npm run play` deployment.
    // This replaces a previous VITE_SERVER_URL override that lived in a
    // plaintext .env.development file with nothing guarding against it
    // being deleted -- this proxy config is checked into source instead.
    // `ws: true` is required for Engine.IO's websocket upgrade, not just
    // its initial polling handshake.
    proxy: {
      '/socket.io': {
        target: `http://localhost:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
});
