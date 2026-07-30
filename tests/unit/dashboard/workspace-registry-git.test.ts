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
