/**
 * PAN-1990 dashboard-api: REST routes for the projects/workspaces domain
 * (`workspace-registry`, distinct from the PAN-428 `/api/workspaces/*`
 * issue/git-worktree routes). All resolver/writer/status calls are mocked —
 * this test exercises routing, param/body parsing, and response shape, the
 * same convention as pipeline-membership-route.test.ts.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRow } from '../../../../src/lib/workspaces/types.js';

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
}));

vi.mock('../../../../src/lib/workspaces/resolver.js', () => ({
  getWorkspaceById: routeMocks.getWorkspaceById,
  listWorkspaces: routeMocks.listWorkspaces,
}));

vi.mock('../../../../src/lib/workspaces/writer.js', () => ({
  archiveWorkspace: routeMocks.archiveWorkspace,
  unarchiveWorkspace: routeMocks.unarchiveWorkspace,
  setWorkspaceFavorite: routeMocks.setWorkspaceFavorite,
  touchWorkspaceAccessed: routeMocks.touchWorkspaceAccessed,
  updateWorkspaceLayout: routeMocks.updateWorkspaceLayout,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: routeMocks.getReviewStatusSync,
}));

vi.mock('../../../../src/lib/memory/rollup.js', () => ({
  readCurrentStatus: routeMocks.readCurrentStatus,
  readRecentObservations: routeMocks.readRecentObservations,
}));

vi.mock('../../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
}));

import { workspaceRegistryRouteLayer } from '../../../../src/dashboard/server/routes/workspace-registry.js';

function baseWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'ws-1',
    projectId: 'overdeck',
    kind: 'issue',
    name: 'feature-pan-9001',
    path: '/repo/workspaces/feature-pan-9001',
    branchName: 'feature/pan-9001',
    parentBranch: 'main',
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: 'PAN-9001',
    layoutConfig: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    createdAt: 1,
    lastAccessedAt: 1,
    ...overrides,
  };
}

async function requestWorkspaceRegistryRoute(path: string, init: RequestInit = {}): Promise<{
  status: number;
  body: unknown;
}> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspaceRegistryRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
  routeMocks.readCurrentStatus.mockResolvedValue(undefined);
  routeMocks.readRecentObservations.mockResolvedValue([]);
});

describe('GET /api/workspace-registry (ac1)', () => {
  it('returns rows with project, kind, and pipeline badge data', async () => {
    const workspace = baseWorkspace();
    routeMocks.listWorkspaces.mockReturnValue([workspace]);
    routeMocks.getReviewStatusSync.mockReturnValue({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      verificationStatus: 'passed',
      readyForMerge: true,
    });

    const { status, body } = await requestWorkspaceRegistryRoute('/api/workspace-registry');

    expect(status).toBe(200);
    expect(body).toEqual({
      workspaces: [{
        ...workspace,
        pipeline: {
          reviewStatus: 'passed',
          testStatus: 'passed',
          mergeStatus: 'merged',
          verificationStatus: 'passed',
          readyForMerge: true,
        },
        // PAN-3286 FR-12: null for issue rows, which badge the pipeline phase.
        memoryPhase: null,
      }],
    });
    expect(routeMocks.getReviewStatusSync).toHaveBeenCalledWith('PAN-9001');
  });

  it('omits the pipeline badge for a workspace with no issueId', async () => {
    routeMocks.listWorkspaces.mockReturnValue([baseWorkspace({ id: 'ws-scratch', issueId: null, kind: 'scratch' })]);

    const { body } = await requestWorkspaceRegistryRoute('/api/workspace-registry');

    expect((body as { workspaces: Array<{ pipeline: unknown }> }).workspaces[0]!.pipeline).toBeNull();
    expect(routeMocks.getReviewStatusSync).not.toHaveBeenCalled();
  });
});

describe('POST activate/archive/favorite (ac2)', () => {
  it('activate calls touchWorkspaceAccessed through the writer', async () => {
    const workspace = baseWorkspace();
    routeMocks.getWorkspaceById.mockReturnValue(workspace);

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/activate', { method: 'POST' });

    expect(status).toBe(200);
    expect(routeMocks.touchWorkspaceAccessed).toHaveBeenCalledWith('ws-1');
  });

  it('archive calls archiveWorkspace through the writer', async () => {
    const workspace = baseWorkspace();
    routeMocks.getWorkspaceById.mockReturnValue(workspace);
    routeMocks.archiveWorkspace.mockResolvedValue(undefined);

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/archive', { method: 'POST' });

    expect(status).toBe(200);
    expect(routeMocks.archiveWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('favorite calls setWorkspaceFavorite through the writer', async () => {
    const workspace = baseWorkspace();
    routeMocks.getWorkspaceById.mockReturnValue(workspace);

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });

    expect(status).toBe(200);
    expect(routeMocks.setWorkspaceFavorite).toHaveBeenCalledWith('ws-1', true);
  });

  it('rejects malformed JSON on archive with 400 instead of defaulting to archived=true (non-blocking fix)', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    expect(status).toBe(400);
    expect(routeMocks.archiveWorkspace).not.toHaveBeenCalled();
    expect(routeMocks.unarchiveWorkspace).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on favorite with 400 instead of defaulting to favorite=true (non-blocking fix)', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    expect(status).toBe(400);
    expect(routeMocks.setWorkspaceFavorite).not.toHaveBeenCalled();
  });

  it('rejects a mutation the dashboard-auth guard blocks', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    const { HttpServerResponse } = await import('effect/unstable/http');
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      HttpServerResponse.text('Invalid origin', { status: 403 }),
    );

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/activate', { method: 'POST' });

    expect(status).toBe(403);
    expect(routeMocks.touchWorkspaceAccessed).not.toHaveBeenCalled();
  });
});

describe('PUT layout (ac3)', () => {
  it('persists layout_config JSON and a subsequent GET returns it', async () => {
    let stored: WorkspaceRow = baseWorkspace();
    routeMocks.getWorkspaceById.mockImplementation(() => stored);
    routeMocks.updateWorkspaceLayout.mockImplementation((_id: string, layoutConfig: string) => {
      stored = { ...stored, layoutConfig };
    });

    const putResult = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: { panels: ['tree', 'terminal'] } }),
    });
    expect(putResult.status).toBe(200);
    expect(routeMocks.updateWorkspaceLayout).toHaveBeenCalledWith('ws-1', JSON.stringify({ panels: ['tree', 'terminal'] }));

    const getResult = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1');
    expect((getResult.body as { layoutConfig: string }).layoutConfig).toBe(JSON.stringify({ panels: ['tree', 'terminal'] }));
  });

  it('rejects malformed JSON with 400 instead of treating it as a missing layout field (non-blocking fix)', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    expect(status).toBe(400);
    expect(routeMocks.updateWorkspaceLayout).not.toHaveBeenCalled();
  });
});

describe('GET /api/workspace-registry/:id/memory (ac4)', () => {
  it('returns the status headline and observation timeline', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.readCurrentStatus.mockResolvedValue({
      name: 'status',
      headline: 'Building the workspace registry API.',
      summary: 'summary',
      goal: null,
      phase: 'building',
      accomplished: [],
      decided: [],
      open: [],
      nextSteps: [],
      confidence: 0.8,
      workingSet: [],
      tags: [],
    });
    routeMocks.readRecentObservations.mockResolvedValue([
      { id: 'obs-1', timestamp: '2026-07-29T00:00:00.000Z', summary: 'first observation' },
    ]);

    const { status, body } = await requestWorkspaceRegistryRoute('/api/workspace-registry/ws-1/memory');

    expect(status).toBe(200);
    expect((body as { headline: string }).headline).toBe('Building the workspace registry API.');
    expect((body as { observations: unknown[] }).observations).toHaveLength(1);
    expect(routeMocks.readRecentObservations).toHaveBeenCalledWith('overdeck', 'ws-1', 50);
  });

  it('returns 404 for an unknown workspace id', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(null);

    const { status } = await requestWorkspaceRegistryRoute('/api/workspace-registry/missing/memory');

    expect(status).toBe(404);
  });
});
