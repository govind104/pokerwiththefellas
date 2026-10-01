import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { logUnhandledRejections } from './processSafetyNet';

describe('logUnhandledRejections (audit C4)', () => {
  it('logs an unhandled rejection instead of letting it end the process', () => {
    const fakeProcess = new EventEmitter();
    const log = vi.fn();
    logUnhandledRejections(fakeProcess, log);

    const reason = new Error('EBUSY: resource busy or locked');
    fakeProcess.emit('unhandledRejection', reason);

    expect(log).toHaveBeenCalledWith('Unhandled promise rejection (server kept running):', reason);
  });
});
