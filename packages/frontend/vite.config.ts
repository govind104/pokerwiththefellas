import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Two-port local dev workflow (this dev server on :5173, the backend on
    // :3000, per HANDOFF.md): proxying /socket.io means the socket.io-client
    // in App.tsx can just connect to the page's own origin (its default,
    // same-origin fallback -- see serverUrl.ts) in dev too, exactly like it
    // does in the single-process `npm run play` deployment. This replaces a
    // previous VITE_SERVER_URL override that lived in a plaintext
    // .env.development file with nothing guarding against it being deleted
    // -- this proxy config is checked into source instead. `ws: true` is
    // required for Engine.IO's websocket upgrade, not just its initial
    // polling handshake.
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
