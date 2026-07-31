/**
 * PAN-3331 WI-2 (FR-2, FR-3, D-2): the workspace-registry git state and
 * fast-forward pull routes — fetch throttling, non-git rows, the issue-kind
 * refusal that protects sync-main semantics, and typed refusal pass-through.
 *
 * Resolver/writer/git-state calls are mocked, matching the convention in
 * workspace-registry-memory-phase.test.ts. Throttle tests use fake timers per
 * the repo's delay-test rule — no real waiting.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceGitState, WorkspaceRow } from '../../../src/lib/workspaces/types.js';

const routeMocks = vi.hoisted(() => ({
  getWorkspaceById: vi.fn(),
  listWorkspaces: vi.fn(),
  archiveWorkspace: vi.fn(),
  unarchiveWorkspace: vi.fn(),
  setWorkspaceFavorite: vi.fn(),
  touchWorkspaceAccessed: vi.fn(),
  updateWorkspaceLayout: vi.fn(),
  getReviewStatusSync: vi.fn(),
  readCurrentStatus: vi.fn(),
  readRecentObservations: vi.fn(),
  rejectUnsafeDashboardMutationRequest: vi.fn(),
  rejectUnauthorizedDashboardRequest: vi.fn(),
  getWorkspaceGitState: vi.fn(),
  pullWorkspaceFastForward: vi.fn(),
}));

vi.mock('../../../src/lib/workspaces/resolver.js', () => ({
  getWorkspaceById: routeMocks.getWorkspaceById,
  listWorkspaces: routeMocks.listWorkspaces,
}));

vi.mock('../../../src/lib/workspaces/writer.js', () => ({
  archiveWorkspace: routeMocks.archiveWorkspace,
  unarchiveWorkspace: routeMocks.unarchiveWorkspace,
  setWorkspaceFavorite: routeMocks.setWorkspaceFavorite,
  touchWorkspaceAccessed: routeMocks.touchWorkspaceAccessed,
  updateWorkspaceLayout: routeMocks.updateWorkspaceLayout,
}));

vi.mock('../../../src/lib/workspaces/git-state.js', () => ({
  getWorkspaceGitState: routeMocks.getWorkspaceGitState,
  pullWorkspaceFastForward: routeMocks.pullWorkspaceFastForward,
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: routeMocks.getReviewStatusSync,
}));

vi.mock('../../../src/lib/memory/rollup.js', () => ({
  readCurrentStatus: routeMocks.readCurrentStatus,
  readRecentObservations: routeMocks.readRecentObservations,
}));

vi.mock('../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
  rejectUnauthorizedDashboardRequest: routeMocks.rejectUnauthorizedDashboardRequest,
}));

import { workspaceRegistryRouteLayer } from '../../../src/dashboard/server/routes/workspace-registry.js';

function baseWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'ws-main',
    projectId: 'overdeck',
    kind: 'main',
    name: 'main',
    path: '/repo',
    branchName: 'main',
    parentBranch: null,
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: null,
    layoutConfig: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    createdAt: 1,
    lastAccessedAt: 1,
    ...overrides,
  };
}

function gitState(overrides: Partial<WorkspaceGitState> = {}): WorkspaceGitState {
  return {
    branch: 'main',
    detached: false,
    dirtyFiles: 0,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    upstreamRef: 'origin/main',
    recentRemoteCommits: [],
    fetchedAt: null,
    fetchFailed: false,
    ...overrides,
  };
}

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: string, url: string, body?: unknown): Promise<RouteResponse> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspaceRegistryRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

/** Each test uses its own path so the module-level fetch throttle never leaks between them. */
let pathCounter = 0;
function uniquePath(): string {
  pathCounter += 1;
  return `/repo/case-${pathCounter}`;
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
  routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(null);
  routeMocks.readCurrentStatus.mockResolvedValue(undefined);
  routeMocks.readRecentObservations.mockResolvedValue([]);
  routeMocks.getReviewStatusSync.mockReturnValue(null);
  routeMocks.getWorkspaceGitState.mockResolvedValue(gitState());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/workspace-registry/:id/git (FR-2)', () => {
  it('returns the git state for a known workspace', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.getWorkspaceGitState.mockResolvedValue(gitState({ behind: 3, ahead: 1 }));

    const response = await call('GET', '/api/workspace-registry/ws-main/git');

    expect(response.status).toBe(200);
    expect(response.body.git).toMatchObject({ behind: 3, ahead: 1, upstreamRef: 'origin/main' });
  });

  it('returns 404 for an unknown workspace', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(undefined);

    const response = await call('GET', '/api/workspace-registry/nope/git');

    expect(response.status).toBe(404);
    expect(routeMocks.getWorkspaceGitState).not.toHaveBeenCalled();
  });

  it('returns git:null for a non-git workspace without shelling out', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ isGitRepository: false, path: uniquePath() }));

    const response = await call('GET', '/api/workspace-registry/ws-main/git');

    expect(response.status).toBe(200);
    expect(response.body.git).toBeNull();
    expect(routeMocks.getWorkspaceGitState).not.toHaveBeenCalled();
  });

  it('does not fetch unless fetch=1 is requested', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));

    await call('GET', '/api/workspace-registry/ws-main/git');
    await call('GET', '/api/workspace-registry/ws-main/git?fetch=0');

    for (const callArgs of routeMocks.getWorkspaceGitState.mock.calls) {
      expect(callArgs[1]).toEqual({ fetch: false });
    }
  });

  it('fetches on the first fetch=1 request and skips repeats inside the throttle window', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: options.fetch ? Date.now() : null }));

    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    expect(routeMocks.getWorkspaceGitState.mock.calls[0]![1]).toEqual({ fetch: true });

    vi.advanceTimersByTime(29_000);
    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    expect(routeMocks.getWorkspaceGitState.mock.calls[1]![1]).toEqual({ fetch: false });
  });

  it('fetches again once the throttle window has elapsed', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: options.fetch ? Date.now() : null }));

    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    vi.advanceTimersByTime(30_000);
    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    expect(routeMocks.getWorkspaceGitState.mock.calls[1]![1]).toEqual({ fetch: true });
  });

  it('reports the last fetch time even on a throttled read', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: options.fetch ? Date.now() : null }));

    const fetched = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    const fetchedAt = (fetched.body.git as WorkspaceGitState).fetchedAt;
    vi.advanceTimersByTime(5_000);
    const throttled = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    expect(fetchedAt).toBeTypeOf('number');
    expect((throttled.body.git as WorkspaceGitState).fetchedAt).toBe(fetchedAt);
  });

  it('throttles per workspace path, not globally', async () => {
    vi.useFakeTimers();
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: options.fetch ? Date.now() : null }));

    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    await call('GET', '/api/workspace-registry/ws-a/git?fetch=1');
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    await call('GET', '/api/workspace-registry/ws-b/git?fetch=1');

    expect(routeMocks.getWorkspaceGitState.mock.calls[1]![1]).toEqual({ fetch: true });
  });
});

describe('unknown state passes through the route (review cycle 4)', () => {
  it('returns dirtyFiles null rather than zero when git could not read the status', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.getWorkspaceGitState.mockResolvedValue(gitState({ dirtyFiles: null }));

    const response = await call('GET', '/api/workspace-registry/ws-main/git');

    expect((response.body.git as WorkspaceGitState).dirtyFiles).toBeNull();
  });

  it('returns fetchFailed so the card can say the counts were not refreshed', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.getWorkspaceGitState.mockResolvedValue(gitState({ fetchFailed: true, fetchedAt: null }));

    const response = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    expect((response.body.git as WorkspaceGitState).fetchFailed).toBe(true);
  });
});

describe('failed-fetch warning is sticky (review cycle 5)', () => {
  /** A fetching read that fails, then a non-fetching poll, on one path. */
  function failingThenPolling(path: string) {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: null, fetchFailed: options.fetch === true }));
  }

  it('keeps the warning through the next background poll, which does not fetch', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    failingThenPolling(path);

    const failed = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    expect((failed.body.git as WorkspaceGitState).fetchFailed).toBe(true);

    // The band polls every 30s WITHOUT forcing a fetch; the helper reports
    // fetchFailed:false for that read, so only sticky route state can hold it.
    vi.advanceTimersByTime(30_000);
    const polled = await call('GET', '/api/workspace-registry/ws-main/git?fetch=0');

    expect((polled.body.git as WorkspaceGitState).fetchFailed).toBe(true);
  });

  it('keeps the warning on a fetch=1 read the throttle skips', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    failingThenPolling(path);

    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    vi.advanceTimersByTime(5_000);
    const throttled = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    expect((throttled.body.git as WorkspaceGitState).fetchFailed).toBe(true);
  });

  it('clears the warning only once a fetch succeeds, and keeps it cleared', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: null, fetchFailed: options.fetch === true }));

    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    // The remote comes back; the next due fetch succeeds.
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: options.fetch ? Date.now() : null, fetchFailed: false }));
    vi.advanceTimersByTime(30_000);
    const recovered = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    expect((recovered.body.git as WorkspaceGitState).fetchFailed).toBe(false);

    const polled = await call('GET', '/api/workspace-registry/ws-main/git?fetch=0');
    expect((polled.body.git as WorkspaceGitState).fetchFailed).toBe(false);
  });

  it('does not leak one path failure onto another workspace', async () => {
    vi.useFakeTimers();
    const failingPath = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: failingPath }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      gitState({ fetchedAt: null, fetchFailed: options.fetch === true }));
    await call('GET', '/api/workspace-registry/ws-a/git?fetch=1');

    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.getWorkspaceGitState.mockResolvedValue(gitState({ fetchedAt: 99, fetchFailed: false }));
    const other = await call('GET', '/api/workspace-registry/ws-b/git?fetch=1');

    expect((other.body.git as WorkspaceGitState).fetchFailed).toBe(false);
  });

  it('clears the warning after a successful pull', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    failingThenPolling(path);
    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    routeMocks.pullWorkspaceFastForward.mockResolvedValue({ ok: true, state: gitState({ behind: 0 }) });
    const pulled = await call('POST', '/api/workspace-registry/ws-main/pull');
    expect((pulled.body.git as WorkspaceGitState).fetchFailed).toBe(false);

    routeMocks.getWorkspaceGitState.mockResolvedValue(gitState({ fetchedAt: null, fetchFailed: false }));
    const polled = await call('GET', '/api/workspace-registry/ws-main/git?fetch=0');
    expect((polled.body.git as WorkspaceGitState).fetchFailed).toBe(false);
  });
});

describe('GET /api/workspace-registry/:id/git authentication', () => {
  it('rejects an unauthenticated read before fetching, since fetch=1 rewrites remote refs', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );

    const response = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    expect(response.status).toBe(401);
    expect(routeMocks.getWorkspaceGitState).not.toHaveBeenCalled();
  });
});

describe('fetch coalescing (concurrent fetch=1)', () => {
  it('runs one git fetch for overlapping requests against the same checkout', async () => {
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    let resolveFetch: ((state: WorkspaceGitState) => void) | undefined;
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) => {
      if (!options.fetch) return gitState();
      return new Promise<WorkspaceGitState>((resolve) => { resolveFetch = resolve; });
    });

    // Both requests are in flight before either fetch resolves — the exact
    // window in which a check-then-await throttle starts two fetches.
    const first = call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    const second = call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    await Promise.resolve();
    await Promise.resolve();
    resolveFetch?.(gitState({ fetchedAt: 1234 }));
    await Promise.all([first, second]);

    const fetching = routeMocks.getWorkspaceGitState.mock.calls.filter((c) => c[1]?.fetch === true);
    expect(fetching).toHaveLength(1);
  });

  it('both coalesced callers receive the fetched state', async () => {
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    routeMocks.getWorkspaceGitState.mockImplementation(async (_path: string, options: { fetch?: boolean }) =>
      (options.fetch ? gitState({ behind: 7, fetchedAt: 4242 }) : gitState()));

    const [first, second] = await Promise.all([
      call('GET', '/api/workspace-registry/ws-main/git?fetch=1'),
      call('GET', '/api/workspace-registry/ws-main/git?fetch=1'),
    ]);

    expect((first.body.git as WorkspaceGitState).behind).toBe(7);
    expect((second.body.git as WorkspaceGitState).behind).toBe(7);
  });

  it('holds the throttle window after a fetch that reports no success, without claiming freshness', async () => {
    vi.useFakeTimers();
    const path = uniquePath();
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path }));
    // fetchedAt null is how the module reports "the fetch did not succeed".
    routeMocks.getWorkspaceGitState.mockResolvedValue(gitState({ fetchedAt: null }));

    const failed = await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');
    vi.advanceTimersByTime(5_000);
    await call('GET', '/api/workspace-registry/ws-main/git?fetch=1');

    expect((failed.body.git as WorkspaceGitState).fetchedAt).toBeNull();
    const fetching = routeMocks.getWorkspaceGitState.mock.calls.filter((c) => c[1]?.fetch === true);
    expect(fetching).toHaveLength(1);
  });
});

describe('POST /api/workspace-registry/:id/pull (FR-3)', () => {
  it('fast-forwards a main workspace and returns the new state', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.pullWorkspaceFastForward.mockResolvedValue({ ok: true, state: gitState({ behind: 0 }) });

    const response = await call('POST', '/api/workspace-registry/ws-main/pull');

    expect(response.status).toBe(200);
    expect(response.body.git).toMatchObject({ behind: 0 });
    expect((response.body.git as WorkspaceGitState).fetchedAt).toBeTypeOf('number');
  });

  it('rejects an unauthorized mutation before touching git', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );

    await call('POST', '/api/workspace-registry/ws-main/pull');

    expect(routeMocks.pullWorkspaceFastForward).not.toHaveBeenCalled();
  });

  it('refuses an issue workspace with 409 and points at sync-main', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({
      id: 'ws-issue',
      kind: 'issue',
      issueId: 'PAN-9001',
      path: uniquePath(),
    }));

    const response = await call('POST', '/api/workspace-registry/ws-issue/pull');

    expect(response.status).toBe(409);
    expect(response.body.syncMainUrl).toBe('/api/issues/PAN-9001/sync-main');
    expect(routeMocks.pullWorkspaceFastForward).not.toHaveBeenCalled();
  });

  it('rejects a non-git workspace with 400', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ isGitRepository: false, path: uniquePath() }));

    const response = await call('POST', '/api/workspace-registry/ws-main/pull');

    expect(response.status).toBe(400);
    expect(routeMocks.pullWorkspaceFastForward).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown workspace', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(undefined);

    expect((await call('POST', '/api/workspace-registry/nope/pull')).status).toBe(404);
  });

  it.each([
    ['dirty', 409],
    ['operation-in-progress', 409],
    ['not-fast-forward', 409],
    ['no-upstream', 409],
    ['detached', 409],
    ['error', 500],
  ])('passes the %s refusal through verbatim', async (reason, status) => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: uniquePath() }));
    routeMocks.pullWorkspaceFastForward.mockResolvedValue({ ok: false, reason, detail: `because ${reason}` });

    const response = await call('POST', '/api/workspace-registry/ws-main/pull');

    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ reason, error: `because ${reason}` });
  });
});
