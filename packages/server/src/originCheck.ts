import type { IncomingHttpHeaders } from 'node:http';

// Replaces socket.io's `cors: { origin: '*' }` (audit I7), which let any web page a player had
// open drive the game through their browser. A browser always sends Origin on a WebSocket
// handshake and on any cross-site request, so a missing Origin is a same-origin polling request
// or a non-browser client (the playtest bots, the tests), and is allowed.
export function isAllowedOrigin(headers: IncomingHttpHeaders, allowedOrigins: readonly string[]): boolean {
  const origin = headers.origin;
  if (origin === undefined) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = headers['x-forwarded-host'];
  const hosts = [headers.host, ...(Array.isArray(forwarded) ? forwarded : [forwarded])];
  return hosts.some((host) => host !== undefined && host.toLowerCase() === originHost);
}
