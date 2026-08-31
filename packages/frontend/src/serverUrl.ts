// Resolves the backend's base URL. Falls back to the page's own origin,
// which is correct for both of this repo's actual workflows: the
// single-process deployment (`npm run play` -- the backend serves the
// built frontend itself, so both are reached through the same host:port,
// see docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md
// Section 2/3) and the two-port `npm run dev` setup (vite.config.ts's
// server.proxy forwards /socket.io to the backend, so the page's own
// origin still resolves correctly even though it's really Vite's port).
// An explicit VITE_SERVER_URL always wins when set, as an escape hatch for
// a workflow neither of the above covers (e.g. pointing a dev frontend at
// a backend on a different host) -- not something this repo's documented
// workflows need, see App.tsx's SERVER_URL comment for the one case where
// there genuinely is no working default.
export function resolveServerUrl(envServerUrl: string | undefined, pageOrigin: string): string {
  return envServerUrl ?? pageOrigin;
}
