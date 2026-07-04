import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  getIssueState: vi.fn(),
  isGitHubAppConfigured: vi.fn(),
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

vi.mock('../../../lib/github-app.js', () => ({
  getIssueState: mocks.getIssueState,
  isGitHubAppConfigured: mocks.isGitHubAppConfigured,
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
      repo: 'overdeck',
      number: 1613,
    });
    mocks.isGitHubAppConfigured.mockReturnValue(false);
    mocks.getIssueState.mockReturnValue(Effect.succeed({ state: 'open' }));
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
      'eltmon/overdeck',
      '--json',
      'state',
    ], { encoding: 'utf-8', timeout: 10_000 });
  });

  it('returns true through the GitHub App REST tracker fallback when configured', async () => {
    mocks.isGitHubAppConfigured.mockReturnValue(true);
    mocks.getIssueState.mockReturnValue(Effect.succeed({ state: 'closed' }));

    await expect(isIssueClosed('PAN-1613')).resolves.toBe(true);

    expect(mocks.getIssueState).toHaveBeenCalledWith('eltmon', 'overdeck', 1613);
    expect(mocks.execFileAsync).not.toHaveBeenCalled();
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

  it('uses the 5-minute tracker cache for App REST results', async () => {
    mocks.isGitHubAppConfigured.mockReturnValue(true);
    mocks.getIssueState.mockReturnValue(Effect.succeed({ state: 'closed' }));

    await expect(isTrackerIssueClosed('PAN-1613')).resolves.toBe(true);
    await expect(isTrackerIssueClosed('PAN-1613')).resolves.toBe(true);

    expect(mocks.getIssueState).toHaveBeenCalledTimes(1);
    expect(mocks.execFileAsync).not.toHaveBeenCalled();
  });
});
