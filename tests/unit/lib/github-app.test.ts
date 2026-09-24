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
  GITHUB_API_TIMEOUT_MS,
  GitHubRequestTimeoutError,
  generateInstallationToken,
  getCiCheckRunsState,
  getIssueState,
  getMergeBackendStatus,
  getPullRequestState,
  isIntegrationPermissionError,
  listOpenIssuesWithLabels,
  listPullRequestsForHead,
  mergePullRequestWithApp,
  postOverdeckTestsStatus,
  verifyAppCanMerge,
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

    return getCiCheckRunsState('eltmon', 'overdeck', 'abc123');
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

  it('excludes advisory check runs without suppressing real failures', async () => {
    await expect(loadState([
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'coderabbitai[bot]', status: 'completed', conclusion: 'failure' },
    ])).resolves.toMatchObject({ verdict: 'green', green: true, failed: false, total: 1, failedCount: 0 });

    await expect(loadState([
      { name: 'test', status: 'completed', conclusion: 'failure' },
      { name: 'coderabbitai[bot]', status: 'completed', conclusion: 'failure' },
    ])).resolves.toMatchObject({ verdict: 'red', green: false, failed: true, total: 1, failedCount: 1 });
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

    const state = await getCiCheckRunsState('eltmon', 'overdeck', 'abc123');

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

describe('getPullRequestState', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockPullRequestState(
    statuses: Array<{ context: string; state: string }>,
    checkRuns: Array<{ name: string; status: string; conclusion: string | null }> = [
      { name: 'test', status: 'completed', conclusion: 'success' },
    ],
  ): void {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/app/installations/67890/access_tokens')) {
        return new Response(JSON.stringify({ token: 'token', expires_at: '2026-06-10T00:00:00Z' }), { status: 201 });
      }
      if (url.endsWith('/repos/eltmon/overdeck/pulls/42')) {
        return new Response(JSON.stringify({
          html_url: 'https://github.com/eltmon/overdeck/pull/42',
          state: 'open',
          mergeable: true,
          mergeable_state: 'unstable',
          draft: false,
          head: { sha: 'abc123', ref: 'feature/pan-42' },
          base: { ref: 'main' },
        }), { status: 200 });
      }
      if (url.endsWith('/repos/eltmon/overdeck/commits/abc123/status')) {
        return new Response(JSON.stringify({ state: 'failure', statuses }), { status: 200 });
      }
      if (url.endsWith('/repos/eltmon/overdeck/commits/abc123/check-runs')) {
        return new Response(JSON.stringify({ check_runs: checkRuns }), { status: 200 });
      }
      throw new Error(`Unexpected GitHub API request: ${url}`);
    });
  }

  it('ignores an advisory commit status when every real check is green', async () => {
    mockPullRequestState([
      { context: 'test', state: 'success' },
      { context: 'CodeRabbit', state: 'failure' },
    ]);

    await expect(getPullRequestState('eltmon', 'overdeck', 42))
      .resolves.toMatchObject({ headRef: 'feature/pan-42', checksPending: false, checksFailed: false });
  });

  it('still fails when a real commit status fails', async () => {
    mockPullRequestState([
      { context: 'test', state: 'failure' },
      { context: 'CodeRabbit', state: 'failure' },
    ]);

    await expect(getPullRequestState('eltmon', 'overdeck', 42))
      .resolves.toMatchObject({ checksFailed: true });
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

    const result = await listPullRequestsForHead('eltmon', 'overdeck', 'feature/pan-2265', 'all');

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

    await expect(getIssueState('eltmon', 'overdeck', 2265)).resolves.toEqual({ state: 'closed' });

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

    const result = await listOpenIssuesWithLabels('eltmon', 'overdeck');

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

    await expect(listPullRequestsForHead('eltmon', 'overdeck', 'feature/pan-2265', 'open'))
      .resolves.toMatchObject([{ number: 4, state: 'open', merged: false }]);
    await expect(getIssueState('eltmon', 'overdeck', 2265))
      .resolves.toEqual({ state: 'open' });
    await expect(listOpenIssuesWithLabels('eltmon', 'overdeck'))
      .resolves.toEqual([{ number: 5, labels: ['ready'] }]);
  });
});

describe('verifyAppCanMerge', () => {
  it('returns canMerge:true when the App has pull_requests:write and contents:write', async () => {
    const result = await verifyAppCanMerge({
      isConfigured: () => true,
      generateToken: async () => ({
        token: 'token',
        expiresAt: '2026-07-07T00:00:00Z',
        permissions: { pull_requests: 'write', contents: 'write' },
      }),
    });
    expect(result).toMatchObject({ configured: true, canMerge: true, missing: [] });
    expect(result.detail).toContain('merge permissions');
  });

  it('returns missing pull_requests:write when the permission is not write', async () => {
    const result = await verifyAppCanMerge({
      isConfigured: () => true,
      generateToken: async () => ({
        token: 'token',
        expiresAt: '2026-07-07T00:00:00Z',
        permissions: { contents: 'write' },
      }),
    });
    expect(result).toMatchObject({ configured: true, canMerge: false, missing: ['pull_requests:write'] });
    expect(result.detail).toContain('pull_requests:write');
  });

  it('returns missing contents:write when the permission is not write', async () => {
    const result = await verifyAppCanMerge({
      isConfigured: () => true,
      generateToken: async () => ({
        token: 'token',
        expiresAt: '2026-07-07T00:00:00Z',
        permissions: { pull_requests: 'write' },
      }),
    });
    expect(result).toMatchObject({ configured: true, canMerge: false, missing: ['contents:write'] });
    expect(result.detail).toContain('contents:write');
  });

  it('returns missing both permissions when neither is granted', async () => {
    const result = await verifyAppCanMerge({
      isConfigured: () => true,
      generateToken: async () => ({
        token: 'token',
        expiresAt: '2026-07-07T00:00:00Z',
        permissions: {},
      }),
    });
    expect(result.missing).toEqual(['pull_requests:write', 'contents:write']);
    expect(result.canMerge).toBe(false);
  });

  it('returns a neutral not-configured result and mints no token when the App is not configured', async () => {
    const generateToken = vi.fn();
    const result = await verifyAppCanMerge({
      isConfigured: () => false,
      generateToken,
    });
    expect(result.configured).toBe(false);
    expect(generateToken).not.toHaveBeenCalled();
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

describe('postOverdeckTestsStatus sha binding (PAN-3847)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    execFileMock.mockClear();
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes('/access_tokens')) {
        return Promise.resolve(new Response(JSON.stringify({ token: 'token', expires_at: '2026-09-18T00:00:00Z' }), { status: 201 }));
      }
      return Promise.resolve(new Response('{}', { status: 201 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to /statuses/<sha> with the caller-provided sha and never shells out to git', async () => {
    const testedSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    await postOverdeckTestsStatus(
      '/workspaces/feature-pan-3847',
      'eltmon',
      'overdeck',
      'success',
      'Verification gate passed (changed-file scope)',
      testedSha,
    );

    const statusCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/statuses/'));
    expect(statusCall).toBeDefined();
    expect(String(statusCall![0])).toBe(`https://api.github.com/repos/eltmon/overdeck/statuses/${testedSha}`);
    expect(execFileMock.mock.calls.some((call) => String(call[1]).includes('rev-parse'))).toBe(false);
    expect(execFileMock.mock.calls.some((call) => String(call[0]).includes('rev-parse'))).toBe(false);
  });

});

describe('GitHub App request timeout (PAN-4047)', () => {
  const fetchMock = vi.fn();

  function tokenResponse() {
    return new Response(JSON.stringify({ token: 'token', expires_at: '2026-09-24T00:00:00Z' }), { status: 201 });
  }

  /** A fetch that never answers; it settles only when its signal aborts, like real fetch. */
  function hangUntilAborted(_input: unknown, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fails the installation-token fetch with a typed timeout instead of hanging', async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    let settled = false;
    const result = Effect.runPromise(Effect.flip(generateInstallationToken()))
      .finally(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(GITHUB_API_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = await result;
    expect(error._tag).toBe('GitHubApiError');
    expect(error.message).toContain(`timed out after ${GITHUB_API_TIMEOUT_MS}ms`);
    if (error._tag === 'GitHubApiError') {
      expect(error.cause).toBeInstanceOf(GitHubRequestTimeoutError);
    }
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  });

  it('rejects an API call with GitHubRequestTimeoutError when the request never answers', async () => {
    // Never settles and ignores the signal: the bound must hold regardless.
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementationOnce(() => new Promise<Response>(() => {}));

    const assertion = expect(getIssueState('eltmon', 'overdeck', 4047)).rejects.toBeInstanceOf(GitHubRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(GITHUB_API_TIMEOUT_MS);
    await assertion;

    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  });

  it('bounds the merge request too', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementationOnce(hangUntilAborted);

    const assertion = expect(mergePullRequestWithApp('eltmon', 'overdeck', 4047)).rejects.toMatchObject({
      name: 'GitHubRequestTimeoutError',
      operation: 'PUT /repos/eltmon/overdeck/pulls/4047/merge',
      timeoutMs: GITHUB_API_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(GITHUB_API_TIMEOUT_MS);
    await assertion;
  });

  it('clears the timer once a request answers', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'open' }), { status: 200 }));

    await expect(getIssueState('eltmon', 'overdeck', 4047)).resolves.toEqual({ state: 'open' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
