import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  getShadowState: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('child_process', () => {
  function execFile(): void {
    throw new Error('execFile callback form is not used in issue-closed tests');
  }

  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { execFile };
});

vi.mock('../../../lib/shadow-state.js', () => ({
  getShadowState: mocks.getShadowState,
}));

vi.mock('../../../lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: mocks.resolveGitHubIssueSync,
}));

import { clearIssueClosedCache, isIssueClosed, isTrackerIssueClosed } from '../issue-closed.js';

describe('issue closed detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIssueClosedCache();
    mocks.getShadowState.mockReturnValue(Effect.succeed(null));
    mocks.resolveGitHubIssueSync.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 1613,
    });
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' });
  });

  it.each([
    ['trackerStatus', { trackerStatus: 'closed' }],
    ['shadowStatus', { shadowStatus: 'closed' }],
    ['done canonical state', { targetCanonicalState: 'done' }],
    ['canceled canonical state', { targetCanonicalState: 'canceled' }],
  ])('returns true for closed shadow state via %s', async (_label, shadowState) => {
    mocks.getShadowState.mockReturnValue(Effect.succeed(shadowState));

    await expect(isIssueClosed('PAN-1613')).resolves.toBe(true);
    expect(mocks.execFileAsync).not.toHaveBeenCalled();
  });

  it('returns true through the gh tracker fallback when shadow state is open', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ state: 'CLOSED' }), stderr: '' });

    await expect(isIssueClosed('PAN-1613')).resolves.toBe(true);
    expect(mocks.execFileAsync).toHaveBeenCalledWith('gh', [
      'issue',
      'view',
      '1613',
      '--repo',
      'eltmon/panopticon-cli',
      '--json',
      'state',
    ], { encoding: 'utf-8', timeout: 10_000 });
  });

  it('returns false for an open issue', async () => {
    await expect(isIssueClosed('PAN-1613')).resolves.toBe(false);
  });

  it('can clear one cached tracker result without clearing the whole cache', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ state: 'CLOSED' }), stderr: '' });
    await expect(isTrackerIssueClosed('PAN-1613')).resolves.toBe(true);

    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' });
    await expect(isTrackerIssueClosed('PAN-1613')).resolves.toBe(true);

    clearIssueClosedCache('PAN-1613');
    await expect(isTrackerIssueClosed('PAN-1613')).resolves.toBe(false);
  });
});
