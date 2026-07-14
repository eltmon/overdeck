import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  getIssueState: vi.fn(),
  isGitHubAppConfigured: vi.fn(),
  getShadowState: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
  // Linear branch
  resolveTrackerTypeSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  createTracker: vi.fn(),
  getLinearApiKey: vi.fn(),
  linearGetIssue: vi.fn(),
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
  resolveTrackerTypeSync: mocks.resolveTrackerTypeSync,
}));

vi.mock('../../../lib/github-app.js', () => ({
  getIssueState: mocks.getIssueState,
  isGitHubAppConfigured: mocks.isGitHubAppConfigured,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../lib/tracker/factory.js', () => ({
  createTracker: mocks.createTracker,
}));

vi.mock('../../../lib/tracker/linear.js', () => ({
  LinearTracker: vi.fn().mockImplementation(() => ({ getIssue: mocks.linearGetIssue })),
}));

vi.mock('../../../lib/shadow-utils.js', () => ({
  getLinearApiKey: mocks.getLinearApiKey,
}));

import {
  clearIssueClosedCache,
  isIssueClosed,
  isTrackerIssueClosed,
  TRACKER_CLOSED_CACHE_TTL_MS,
} from '../issue-closed.js';

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

describe('linear closed detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIssueClosedCache();
    mocks.getShadowState.mockReturnValue(Effect.succeed(null));
    // Non-GitHub resolution so the Linear branch runs.
    mocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: false });
    mocks.resolveTrackerTypeSync.mockReturnValue('linear');
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'myn',
      projectName: 'Mind Your Now',
      projectPath: '/projects/myn',
      linearTeam: 'MIN',
    });
    mocks.createTracker.mockReturnValue({ getIssue: mocks.linearGetIssue });
    mocks.getLinearApiKey.mockReturnValue(Effect.succeed('linear-key'));
    mocks.linearGetIssue.mockReturnValue(
      Effect.succeed({ ref: 'MIN-729', state: 'closed' }),
    );
  });

  it('returns true when the Linear issue is closed (FR-1)', async () => {
    mocks.linearGetIssue.mockReturnValue(
      Effect.succeed({ ref: 'MIN-729', state: 'closed' }),
    );

    await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(true);
    expect(mocks.linearGetIssue).toHaveBeenCalledWith('MIN-729');
  });

  it('returns false and skips the API when no Linear key resolves (FR-2)', async () => {
    mocks.createTracker.mockImplementation(() => {
      throw new Error('no key');
    });
    mocks.getLinearApiKey.mockReturnValue(Effect.succeed(null));

    await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(false);
    expect(mocks.linearGetIssue).not.toHaveBeenCalled();
  });

  it('returns false without building a Linear client for non-linear tracker types (FR-3)', async () => {
    mocks.resolveTrackerTypeSync.mockReturnValue('rally');

    await expect(isTrackerIssueClosed('FOO-1')).resolves.toBe(false);
    expect(mocks.createTracker).not.toHaveBeenCalled();
    expect(mocks.linearGetIssue).not.toHaveBeenCalled();
  });

  it('returns false without a Linear call when the issue resolves to no project (FR-3)', async () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);

    await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(false);
    expect(mocks.createTracker).not.toHaveBeenCalled();
    expect(mocks.linearGetIssue).not.toHaveBeenCalled();
  });

  it('returns false and caches false when getIssue fails (FR-5)', async () => {
    mocks.linearGetIssue.mockReturnValue(Effect.fail(new Error('boom')));

    await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(false);

    // The false verdict is cached: a second call within the TTL must not
    // re-invoke the tracker even though the mock now reports closed.
    mocks.linearGetIssue.mockReturnValue(
      Effect.succeed({ ref: 'MIN-729', state: 'closed' }),
    );
    await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(false);
    expect(mocks.linearGetIssue).toHaveBeenCalledTimes(1);
  });

  it('returns false when the returned ref does not match the requested id (FR-6)', async () => {
    mocks.linearGetIssue.mockReturnValue(
      Effect.succeed({ ref: 'MIN-7290', state: 'closed' }),
    );

    await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(false);
    expect(mocks.linearGetIssue).toHaveBeenCalledTimes(1);
  });

  describe('cache TTL', () => {
    // Fake only Date so the cache's Date.now() comparisons are controllable
    // without freezing Effect's microtask/real-timer runtime (NFR-2).
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1_700_000_000_000);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('serves the cached verdict within the TTL and re-queries after expiry (FR-4)', async () => {
      mocks.linearGetIssue.mockReturnValue(
        Effect.succeed({ ref: 'MIN-729', state: 'closed' }),
      );

      await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(true);
      await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(true);
      expect(mocks.linearGetIssue).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_700_000_000_000 + TRACKER_CLOSED_CACHE_TTL_MS + 1);

      await expect(isTrackerIssueClosed('MIN-729')).resolves.toBe(true);
      expect(mocks.linearGetIssue).toHaveBeenCalledTimes(2);
    });
  });
});
