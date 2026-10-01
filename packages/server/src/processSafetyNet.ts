import type { EventEmitter } from 'node:events';

// Node exits on an unhandled rejection by default. One stray rejection (a missed catch around a
// file write) would then disconnect every player with nothing to restart the server, so log it
// and keep running instead (audit C4). Takes the emitter as a parameter so it can be tested
// without touching the real process.
export function logUnhandledRejections(
  target: Pick<EventEmitter, 'on'> = process,
  log: (...args: unknown[]) => void = console.error
): void {
  target.on('unhandledRejection', (reason: unknown) => {
    log('Unhandled promise rejection (server kept running):', reason);
  });
}
