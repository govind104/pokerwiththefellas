// Resolves the backend's base URL. An explicit VITE_SERVER_URL always wins
// -- used for local dev, where the frontend and backend run as two
// separate processes on different ports. Otherwise falls back to the
// page's own origin, which is correct for the single-process deployment
// (docs/superpowers/specs/2026-08-24-local-tailscale-hosting-design.md,
// Section 2/3): the backend serves the built frontend itself, so both are
// reached through the same host:port and no explicit URL is needed.
export function resolveServerUrl(envServerUrl: string | undefined, pageOrigin: string): string {
  return envServerUrl ?? pageOrigin;
}
