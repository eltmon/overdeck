/**
 * PAN-3330 WI-2 (FR-2/FR-3/FR-4): the four registry routes that let the
 * dashboard create and manage a user workspace.
 *
 * The mutation guard, the write-free resolve, the 422-findings pass-through,
 * the writer's refusal mapping, and the project-targets read are all pinned
 * here. Resolver/writer/core calls are mocked, matching the convention in
 * workspace-registry-memory-phase.test.ts.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRow } from '../../../src/lib/workspaces/types.js';

const routeMocks = vi.hoisted(() => ({
  getWorkspaceById: vi.fn(),
  listWorkspaces: vi.fn(),
  listProjectsAsync: vi.fn(),
  listProjectTargets: vi.fn(),
  archiveWorkspace: vi.fn(),
  unarchiveWorkspace: vi.fn(),
  relocateWorkspace: vi.fn(),
  setWorkspaceFavorite: vi.fn(),
  touchWorkspaceAccessed: vi.fn(),
  updateWorkspaceLayout: vi.fn(),
  getReviewStatusSync: vi.fn(),
  readCurrentStatus: vi.fn(),
  readRecentObservations: vi.fn(),
  rejectUnsafeDashboardMutationRequest: vi.fn(),
  resolveWorkspaceCreateIntent: vi.fn(),
  performWorkspaceCreate: vi.fn(),
}));

vi.mock('../../../src/lib/workspaces/resolver.js', () => ({
  getWorkspaceById: routeMocks.getWorkspaceById,
  listWorkspaces: routeMocks.listWorkspaces,
  listProjectTargets: routeMocks.listProjectTargets,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  listProjectsAsync: routeMocks.listProjectsAsync,
}));

vi.mock('../../../src/lib/workspaces/writer.js', () => ({
  archiveWorkspace: routeMocks.archiveWorkspace,
  unarchiveWorkspace: routeMocks.unarchiveWorkspace,
  relocateWorkspace: routeMocks.relocateWorkspace,
  setWorkspaceFavorite: routeMocks.setWorkspaceFavorite,
  touchWorkspaceAccessed: routeMocks.touchWorkspaceAccessed,
  updateWorkspaceLayout: routeMocks.updateWorkspaceLayout,
}));

vi.mock('../../../src/lib/workspaces/create.js', () => ({
  resolveWorkspaceCreateIntent: routeMocks.resolveWorkspaceCreateIntent,
  performWorkspaceCreate: routeMocks.performWorkspaceCreate,
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

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: string, path: string, body?: unknown): Promise<RouteResult> {
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
  );
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

function baseWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'ws-1',
    projectId: 'overdeck',
    kind: 'scratch',
    name: 'scratch-lens',
    path: '/repo/scratch-lens',
    branchName: null,
    parentBranch: 'main',
    parentBranchGuessed: true,
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

/** A clean resolved intent, shaped like the WI-1 core's return value. */
function resolvedIntent(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'overdeck',
    kind: 'scratch',
    name: 'lens',
    path: '/repo',
    branchName: null,
    parentBranch: 'main',
    parentBranchGuessed: true,
    isGitRepository: true,
    wouldCreateWorktree: false,
    unregisteredTargetPath: false,
    findings: [],
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
  routeMocks.readCurrentStatus.mockResolvedValue(undefined);
  routeMocks.readRecentObservations.mockResolvedValue([]);
  routeMocks.getReviewStatusSync.mockReturnValue(null);
  routeMocks.resolveWorkspaceCreateIntent.mockResolvedValue(resolvedIntent());
  routeMocks.performWorkspaceCreate.mockResolvedValue({ id: 'ws-new' });
});

describe('dashboard mutation guard (AC-1)', () => {
  const GUARD_RESPONSE = { status: 403, body: { body: new TextEncoder().encode('{"error":"forbidden"}') } };

  it.each([
    ['POST', '/api/workspace-registry', { project: 'overdeck', name: 'lens' }],
    ['POST', '/api/workspace-registry/resolve', { project: 'overdeck', name: 'lens' }],
    ['POST', '/api/workspace-registry/ws-1/relocate', { path: '/elsewhere' }],
  ])('%s %s is rejected when the guard refuses it', async (method, path, body) => {
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(GUARD_RESPONSE);
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const result = await call(method, path, body);

    expect(result.status).toBe(403);
    expect(routeMocks.performWorkspaceCreate).not.toHaveBeenCalled();
    expect(routeMocks.relocateWorkspace).not.toHaveBeenCalled();
  });

  it('GET project-targets is served without the mutation guard, like its sibling GETs', async () => {
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(GUARD_RESPONSE);
    routeMocks.listProjectsAsync.mockResolvedValue([{ key: 'overdeck', config: { name: 'Overdeck', path: '/repo' } }]);
    routeMocks.listProjectTargets.mockReturnValue([]);

    const result = await call('GET', '/api/workspace-registry/project-targets?project=overdeck');

    expect(result.status).toBe(200);
    expect(result.body.primaryPath).toBe('/repo');
  });
});

describe('POST /api/workspace-registry/resolve (AC-2)', () => {
  it('returns the resolved-intent shape including findings', async () => {
    const intent = resolvedIntent({ wouldCreateWorktree: true, branchName: 'scratch/lens' });
    routeMocks.resolveWorkspaceCreateIntent.mockResolvedValue(intent);

    const result = await call('POST', '/api/workspace-registry/resolve', { project: 'overdeck', name: 'lens', isolated: true });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(intent);
  });

  it('writes nothing — no create, no worktree, no registry mutation', async () => {
    await call('POST', '/api/workspace-registry/resolve', { project: 'overdeck', name: 'lens', isolated: true });

    expect(routeMocks.resolveWorkspaceCreateIntent).toHaveBeenCalledTimes(1);
    expect(routeMocks.performWorkspaceCreate).not.toHaveBeenCalled();
    expect(routeMocks.relocateWorkspace).not.toHaveBeenCalled();
    expect(routeMocks.archiveWorkspace).not.toHaveBeenCalled();
    expect(routeMocks.setWorkspaceFavorite).not.toHaveBeenCalled();
    expect(routeMocks.updateWorkspaceLayout).not.toHaveBeenCalled();
    expect(routeMocks.touchWorkspaceAccessed).not.toHaveBeenCalled();
  });

  it('passes the operator intent through to the core verbatim', async () => {
    await call('POST', '/api/workspace-registry/resolve', {
      project: 'overdeck',
      name: 'lens',
      targetPath: '/elsewhere',
      parentBranch: 'develop',
    });

    expect(routeMocks.resolveWorkspaceCreateIntent).toHaveBeenCalledWith({
      name: 'lens',
      kind: 'scratch',
      projectKey: 'overdeck',
      targetPath: '/elsewhere',
      isolated: false,
      parentBranch: 'develop',
    });
  });

  it('rejects a malformed JSON body with 400', async () => {
    const result = await call('POST', '/api/workspace-registry/resolve', '{not json');

    expect(result.status).toBe(400);
    expect(routeMocks.resolveWorkspaceCreateIntent).not.toHaveBeenCalled();
  });
});

describe('POST /api/workspace-registry (AC-3)', () => {
  it('returns 201 with the new id for a clean intent', async () => {
    const result = await call('POST', '/api/workspace-registry', { project: 'overdeck', name: 'lens' });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({ id: 'ws-new' });
    expect(routeMocks.performWorkspaceCreate).toHaveBeenCalledWith(resolvedIntent());
  });

  it('returns 422 carrying the findings array verbatim, and creates nothing', async () => {
    const findings = [
      { field: 'name', code: 'invalid-name', message: 'Use letters, numbers, and hyphens only.', detail: 'bad/name' },
    ];
    routeMocks.resolveWorkspaceCreateIntent.mockResolvedValue(resolvedIntent({ findings, path: null }));

    const result = await call('POST', '/api/workspace-registry', { project: 'overdeck', name: 'bad/name' });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ findings });
    expect(routeMocks.performWorkspaceCreate).not.toHaveBeenCalled();
  });

  it('resolves the intent server-side rather than trusting a client-supplied one', async () => {
    // A doctored resolved intent in the body must not reach performWorkspaceCreate.
    await call('POST', '/api/workspace-registry', {
      project: 'overdeck',
      name: 'lens',
      path: '/etc',
      wouldCreateWorktree: true,
      findings: [],
    });

    expect(routeMocks.performWorkspaceCreate).toHaveBeenCalledWith(resolvedIntent());
  });

  it('routes bootstrapMain to a main-kind intent', async () => {
    await call('POST', '/api/workspace-registry', { project: 'overdeck', bootstrapMain: true });

    expect(routeMocks.resolveWorkspaceCreateIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'main', projectKey: 'overdeck' }),
    );
  });
});

describe('POST /api/workspace-registry/:id/relocate (AC-4)', () => {
  it('returns 404 for an unknown workspace id', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(null);

    const result = await call('POST', '/api/workspace-registry/nope/relocate', { path: '/elsewhere' });

    expect(result.status).toBe(404);
    expect(routeMocks.relocateWorkspace).not.toHaveBeenCalled();
  });

  it('returns 400 when no path is supplied', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const result = await call('POST', '/api/workspace-registry/ws-1/relocate', {});

    expect(result.status).toBe(400);
    expect(routeMocks.relocateWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    ['archived', `Cannot relocate archived workspace 'scratch-lens'`],
    ['issue-kind', `Cannot relocate an issue-kind workspace — it is owned by the pipeline worktree`],
    ['main without force', `Relocating the main workspace diverges it from projects.yaml's primary path; pass --force to proceed anyway`],
  ])('maps the writer refusal for %s to 409 carrying its message', async (_label, message) => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.relocateWorkspace.mockRejectedValue(new Error(message));

    const result = await call('POST', '/api/workspace-registry/ws-1/relocate', { path: '/elsewhere' });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: message });
  });

  it('returns 200 {ok:true} and forwards force for a permitted relocate', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ kind: 'main', name: 'main' }));
    routeMocks.relocateWorkspace.mockResolvedValue(undefined);

    const result = await call('POST', '/api/workspace-registry/ws-1/relocate', { path: '/elsewhere', force: true });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(routeMocks.relocateWorkspace).toHaveBeenCalledWith('ws-1', '/elsewhere', { force: true });
  });

  it('defaults force to false when the body omits it', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.relocateWorkspace.mockResolvedValue(undefined);

    await call('POST', '/api/workspace-registry/ws-1/relocate', { path: '/elsewhere' });

    expect(routeMocks.relocateWorkspace).toHaveBeenCalledWith('ws-1', '/elsewhere', { force: false });
  });
});

describe('GET /api/workspace-registry/project-targets (AC-5)', () => {
  it('returns the primary path and the registered targets for a known project', async () => {
    const targets = [
      { projectId: 'overdeck', path: '/repo/alt', isPrimary: false, createdAt: 1, lastUsedAt: 2 },
    ];
    routeMocks.listProjectsAsync.mockResolvedValue([{ key: 'overdeck', config: { name: 'Overdeck', path: '/repo' } }]);
    routeMocks.listProjectTargets.mockReturnValue(targets);

    const result = await call('GET', '/api/workspace-registry/project-targets?project=overdeck');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ primaryPath: '/repo', targets });
  });

  it('returns 400 for an unregistered project key', async () => {
    routeMocks.listProjectsAsync.mockResolvedValue([]);

    const result = await call('GET', '/api/workspace-registry/project-targets?project=nope');

    expect(result.status).toBe(400);
    expect(routeMocks.listProjectTargets).not.toHaveBeenCalled();
  });

  it('returns 400 when the project query parameter is missing', async () => {
    const result = await call('GET', '/api/workspace-registry/project-targets');

    expect(result.status).toBe(400);
    expect(routeMocks.listProjectsAsync).not.toHaveBeenCalled();
  });

  it('is not shadowed by the /:id detail route', async () => {
    routeMocks.listProjectsAsync.mockResolvedValue([{ key: 'overdeck', config: { name: 'Overdeck', path: '/repo' } }]);
    routeMocks.listProjectTargets.mockReturnValue([]);

    await call('GET', '/api/workspace-registry/project-targets?project=overdeck');

    // The detail route would have looked the literal up as a workspace id.
    expect(routeMocks.getWorkspaceById).not.toHaveBeenCalled();
  });
});
