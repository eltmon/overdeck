import { describe, expect, it } from 'vitest';

import { deriveConnectionPhase, isWriteBlockedPhase, type ConnectionInputs } from '../connectionState';

const base: ConnectionInputs = {
  serverReachable: true,
  streamLive: true,
  restarting: false,
  sessionAuthFailed: false,
  hasSnapshot: true,
  lastLiveAt: 1,
};

describe('unauthorized connection phase (PAN-1166 FR-5)', () => {
  it('is unauthorized when the session mint failed', () => {
    expect(deriveConnectionPhase({ ...base, sessionAuthFailed: true })).toBe('unauthorized');
  });

  it('prefers restarting over unauthorized', () => {
    expect(deriveConnectionPhase({ ...base, sessionAuthFailed: true, restarting: true })).toBe('restarting');
  });

  it('blocks writes while unauthorized', () => {
    expect(isWriteBlockedPhase('unauthorized')).toBe(true);
  });
});
