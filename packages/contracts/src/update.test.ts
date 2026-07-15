import { describe, expect, it } from 'vitest';
import { isUpdateSnapshot, type UpdateSnapshot } from './update';

const valid: UpdateSnapshot = {
  phase: 'idle', installMode: 'npm', channel: 'stable', currentVersion: '1.0.0', targetVersion: null,
  releaseNotes: null, releaseUrl: null, releaseDate: null, progress: null, lastCheckedAt: null, error: null,
  compatibility: { status: 'unknown', currentDashboardProtocol: 1, targetDashboardProtocol: null, currentAgentProtocol: 1, targetAgentProtocol: null },
};

describe('UpdateSnapshot boundary', () => {
  it('accepts a complete snapshot', () => expect(isUpdateSnapshot(valid)).toBe(true));
  it('rejects incomplete and invalid snapshots', () => {
    expect(isUpdateSnapshot({ ...valid, phase: 'surprise' })).toBe(false);
    expect(isUpdateSnapshot({ ...valid, compatibility: null })).toBe(false);
    expect(isUpdateSnapshot({ ...valid, currentVersion: 12 })).toBe(false);
  });
});
