import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * PAN-3917: the idempotent close-out guard used to read `pipeline.closedOut`
 * off the per-issue record. The tracker owns close-out now: the issue is
 * CLOSED and carries the `closed-out` label.
 */
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: mocks.resolveGitHubIssueSync,
}));

import { readCompletedCloseOut } from '../../../../src/lib/lifecycle/dod-gate.js';

function ghReturns(payload: unknown | Error): void {
  mocks.execFile.mockImplementation((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (payload instanceof Error) return cb(payload, { stdout: '', stderr: '' });
    cb(null, { stdout: JSON.stringify(payload), stderr: '' });
  });
}

describe('readCompletedCloseOut idempotent guard (PAN-3025 WI-4, PAN-3917)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 3025 });
  });

  it('returns closedAt for a CLOSED issue labelled closed-out', async () => {
    ghReturns({ state: 'CLOSED', closedAt: '2026-07-28T08:00:00Z', labels: [{ name: 'closed-out' }] });

    await expect(readCompletedCloseOut('PAN-3025', '/repo/overdeck')).resolves.toBe('2026-07-28T08:00:00Z');
  });

  it('returns null for a CLOSED issue that was never closed out', async () => {
    ghReturns({ state: 'CLOSED', closedAt: '2026-07-28T08:00:00Z', labels: [{ name: 'bug' }] });

    await expect(readCompletedCloseOut('PAN-3025', '/repo/overdeck')).resolves.toBeNull();
  });

  it('returns null for an open issue even when it carries the label', async () => {
    ghReturns({ state: 'OPEN', labels: [{ name: 'closed-out' }] });

    await expect(readCompletedCloseOut('PAN-3025', '/repo/overdeck')).resolves.toBeNull();
  });

  it('fails closed on a tracker read error', async () => {
    ghReturns(new Error('gh unavailable'));

    await expect(readCompletedCloseOut('PAN-3025', '/repo/overdeck')).resolves.toBeNull();
  });

  it('fails closed for a non-GitHub issue', async () => {
    mocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: false });

    await expect(readCompletedCloseOut('MIN-1', '/repo/myn')).resolves.toBeNull();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
