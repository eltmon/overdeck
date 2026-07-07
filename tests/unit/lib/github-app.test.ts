import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, existsSyncMock, readFileSyncMock, signMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  existsSyncMock: vi.fn(() => true),
  readFileSyncMock: vi.fn((path: string) => {
    if (path.endsWith('app-id')) return '12345';
    if (path.endsWith('installation-id')) return '67890';
    if (path.endsWith('private-key.pem')) return 'private-key';
    return '';
  }),
  signMock: vi.fn(() => 'jwt-signature'),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

vi.mock('crypto', () => ({
  createSign: vi.fn(() => ({
    update: vi.fn(),
    sign: signMock,
  })),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = execFileMock;
  Object.assign(execFile, {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn((command: string, args: string[], options: unknown) =>
      Promise.resolve(execFile(command, args, options))),
  });
  return { ...actual, execFile };
});

import {
  getCiCheckRunsState,
  getIssueState,
  getIssueStatePromise,
  getMergeBackendStatus,
  isIntegrationPermissionError,
  listOpenIssuesWithLabels,
  listOpenIssuesWithLabelsPromise,
  listPullRequestsForHead,
  listPullRequestsForHeadPromise,
} from '../../../src/lib/github-app.js';

describe('getMergeBackendStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the GitHub App backend when credentials are configured', async () => {
    await expect(getMergeBackendStatus({
      isConfigured: () => true,
      checkGhAuth: vi.fn(async () => true),
    })).resolves.toMatchObject({
      available: true,
      mode: 'app',
    });
  });

  it('falls back to gh CLI when the App is not configured and gh is authenticated', async () => {
    await expect(getMergeBackendStatus({
      isConfigured: () => false,
      checkGhAuth: vi.fn(async () => true),
    })).resolves.toMatchObject({
      available: true,
      mode: 'gh-cli',
    });
  });

  it('reports no backend when neither the App nor gh CLI is available', async () => {
    await expect(getMergeBackendStatus({
      isConfigured: () => false,
      checkGhAuth: vi.fn(async () => false),
    })).resolves.toMatchObject({
      available: false,
      mode: 'none',
    });
  });

  it('default gh auth check resolves false when gh auth status fails', async () => {
    execFileMock.mockRejectedValue(new Error('gh not found'));

    await expect(getMergeBackendStatus({
      isConfigured: () => false,
    })).resolves.toMatchObject({
      available: false,
      mode: 'none',
    });
    expect(execFileMock).toHaveBeenCalledWith('gh', ['auth', 'status'], { timeout: 5000 });
  });
});

describe('getCiCheckRunsState', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadState(checkRuns: Array<{ name: string; status: string; conclusion: string | null }>) {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token', expires_at: '2026-06-10T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ check_runs: checkRuns }), { status: 200 }));

    return Effect.runPromise(getCiCheckRunsState('eltmon', 'overdeck', 'abc123'));
  }

  it('returns green from check-runs only when at least one run succeeded and none are pending or failed', async () => {
    const state = await loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'Mintlify Deployment', status: 'completed', conclusion: 'skipped' },
    ]);

    expect(state).toMatchObject({
      verdict: 'green',
      green: true,
      pending: false,
      failed: false,
      total: 3,
      successCount: 2,
      pendingCount: 0,
      failedCount: 0,
    });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/commits/abc123/check-runs'))).toBe(true);
    expect(urls.some((url) => url.includes('/commits/abc123/status'))).toBe(false);
  });

  it('returns pending for incomplete runs and for commits with zero successful check-runs', async () => {
    await expect(loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'in_progress', conclusion: null },
    ])).resolves.toMatchObject({ verdict: 'pending', green: false, pending: true, failed: false, pendingCount: 1 });

    await expect(loadState([])).resolves.toMatchObject({ verdict: 'pending', green: false, pending: true, failed: false, total: 0 });
  });

  it('returns red for failed, timed-out, cancelled, or action-required completed runs', async () => {
    await expect(loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'timed_out' },
    ])).resolves.toMatchObject({ verdict: 'red', green: false, pending: false, failed: true, failedCount: 1 });

    await expect(loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'cancelled' },
    ])).resolves.toMatchObject({ verdict: 'red', green: false, pending: false, failed: true, failedCount: 1 });
  });

  it('fetches paginated check-runs before deciding the commit is green', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token', expires_at: '2026-06-10T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ check_runs: [{ name: 'build (22)', status: 'completed', conclusion: 'success' }] }),
        {
          status: 200,
          headers: {
            link: '<https://api.github.com/repos/eltmon/overdeck/commits/abc123/check-runs?per_page=100&page=2>; rel="next"',
          },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }] }),
        { status: 200 },
      ));

    const state = await Effect.runPromise(getCiCheckRunsState('eltmon', 'overdeck', 'abc123'));

    expect(state).toMatchObject({
      verdict: 'pending',
      green: false,
      pending: true,
      failed: false,
      total: 2,
      successCount: 1,
      pendingCount: 1,
    });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.github.com/app/installations/67890/access_tokens',
      'https://api.github.com/repos/eltmon/overdeck/commits/abc123/check-runs?per_page=100',
      'https://api.github.com/repos/eltmon/overdeck/commits/abc123/check-runs?per_page=100&page=2',
    ]);
  });
});

describe('App REST shared helpers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tokenResponse() {
    return new Response(JSON.stringify({ token: 'token', expires_at: '2026-06-10T00:00:00Z' }), { status: 201 });
  }

  it('lists pull requests for an owner-qualified head ref via REST', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          number: 123,
          html_url: 'https://github.com/eltmon/overdeck/pull/123',
          state: 'closed',
          merged: true,
          merged_at: '2026-07-03T12:00:00Z',
          merge_commit_sha: 'abc123',
        },
      ]), { status: 200 }));

    const result = await listPullRequestsForHeadPromise('eltmon', 'overdeck', 'feature/pan-2265', 'all');

    expect(result).toEqual([{
      number: 123,
      state: 'closed',
      merged: true,
      mergedAt: '2026-07-03T12:00:00Z',
      mergeCommit: 'abc123',
      url: 'https://github.com/eltmon/overdeck/pull/123',
    }]);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.pathname).toBe('/repos/eltmon/overdeck/pulls');
    expect(url.searchParams.get('head')).toBe('eltmon:feature/pan-2265');
    expect(url.searchParams.get('state')).toBe('all');
  });

  it('returns issue state via REST', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'closed' }), { status: 200 }));

    await expect(getIssueStatePromise('eltmon', 'overdeck', 2265)).resolves.toEqual({ state: 'closed' });

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.github.com/app/installations/67890/access_tokens',
      'https://api.github.com/repos/eltmon/overdeck/issues/2265',
    ]);
  });

  it('lists open issue labels with REST pagination and excludes pull requests', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          number: 1,
          labels: [{ name: 'pan-2265' }, { name: 'backend' }],
        },
        {
          number: 2,
          pull_request: { url: 'https://api.github.com/repos/eltmon/overdeck/pulls/2' },
          labels: [{ name: 'pan-2265' }],
        },
      ]), {
        status: 200,
        headers: {
          link: '<https://api.github.com/repos/eltmon/overdeck/issues?state=open&per_page=100&page=2>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          number: 3,
          labels: ['infra', { name: null }, { name: 'rate-limit' }],
        },
      ]), { status: 200 }));

    const result = await listOpenIssuesWithLabelsPromise('eltmon', 'overdeck');

    expect(result).toEqual([
      { number: 1, labels: ['pan-2265', 'backend'] },
      { number: 3, labels: ['infra', 'rate-limit'] },
    ]);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.github.com/app/installations/67890/access_tokens',
      'https://api.github.com/repos/eltmon/overdeck/issues?state=open&per_page=100',
      'https://api.github.com/repos/eltmon/overdeck/issues?state=open&per_page=100&page=2',
    ]);
  });

  it('exports Effect wrappers for all shared helpers', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { number: 4, state: 'open', merged: false, merged_at: null, merge_commit_sha: null },
      ]), { status: 200 }))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'open' }), { status: 200 }))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { number: 5, labels: [{ name: 'ready' }] },
      ]), { status: 200 }));

    await expect(Effect.runPromise(listPullRequestsForHead('eltmon', 'overdeck', 'feature/pan-2265', 'open')))
      .resolves.toMatchObject([{ number: 4, state: 'open', merged: false }]);
    await expect(Effect.runPromise(getIssueState('eltmon', 'overdeck', 2265)))
      .resolves.toEqual({ state: 'open' });
    await expect(Effect.runPromise(listOpenIssuesWithLabels('eltmon', 'overdeck')))
      .resolves.toEqual([{ number: 5, labels: ['ready'] }]);
  });
});

describe('isIntegrationPermissionError', () => {
  it('returns true for a 403 "Resource not accessible by integration" message', () => {
    expect(isIntegrationPermissionError('GitHub merge failed: 403 {"message":"Resource not accessible by integration"}')).toBe(true);
  });

  it('returns false for transient network errors', () => {
    expect(isIntegrationPermissionError('fetch failed: ECONNRESET')).toBe(false);
    expect(isIntegrationPermissionError('fetch failed: ETIMEDOUT')).toBe(false);
  });

  it('returns false for timeout and mergeable-state errors', () => {
    expect(isIntegrationPermissionError('Timed out waiting for GitHub PR #123 to become mergeable')).toBe(false);
    expect(isIntegrationPermissionError('GitHub merge failed: 409 {"message":"Head branch was modified"}')).toBe(false);
    expect(isIntegrationPermissionError('GitHub merge failed: 422 {"message":"Required status check"}')).toBe(false);
    expect(isIntegrationPermissionError('GitHub merge failed: 405 Method Not Allowed')).toBe(false);
  });
});
