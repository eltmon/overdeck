import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isStartingWithinGrace, WORK_LAUNCHER_GRACE_MS } from '../agent-grace.js';

describe('recoverOrphanedAgents starting grace (PAN-1256)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps starting agents inside the launcher grace window active', () => {
    const startedAt = new Date(Date.now() - WORK_LAUNCHER_GRACE_MS + 1).toISOString();

    expect(isStartingWithinGrace({ status: 'starting', startedAt })).toBe(true);
  });

  it('allows starting agents past the launcher grace window to be marked stopped', () => {
    const startedAt = new Date(Date.now() - WORK_LAUNCHER_GRACE_MS).toISOString();

    expect(isStartingWithinGrace({ status: 'starting', startedAt })).toBe(false);
  });

  it('does not extend the launcher grace window to running agents', () => {
    const startedAt = new Date(Date.now() - 1).toISOString();

    expect(isStartingWithinGrace({ status: 'running', startedAt })).toBe(false);
  });
});
