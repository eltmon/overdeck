/**
 * PAN-3286 WI-8 (FR-12, D-12): the workspace-registry list DTO carries
 * `memoryPhase` for main/scratch rows, null when they have no status, and null
 * for issue rows WITHOUT reading their status file at all. Also asserts every
 * pre-existing list field survives the addition (no-loss).
 *
 * Resolver/writer/status calls are mocked, matching the convention in
 * routes/workspaces-routes.test.ts.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRow } from '../../../src/lib/workspaces/types.js';

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

/** Every field the list DTO exposed before PAN-3286 added `memoryPhase`. */
const PRE_EXISTING_LIST_FIELDS = [
  'id',
  'projectId',
  'kind',
  'name',
  'path',
  'branchName',
  'parentBranch',
  'parentBranchGuessed',
  'isGitRepository',
  'issueId',
  'layoutConfig',
  'isFavorite',
  'isArchived',
  'title',
  'createdAt',
  'lastAccessedAt',
  'pipeline',
] as const;

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

async function listRows(): Promise<Array<Record<string, unknown>>> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/workspace-registry'));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspaceRegistryRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return (JSON.parse(text) as { workspaces: Array<Record<string, unknown>> }).workspaces;
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
  routeMocks.readCurrentStatus.mockResolvedValue(undefined);
  routeMocks.readRecentObservations.mockResolvedValue([]);
  routeMocks.getReviewStatusSync.mockReturnValue(null);
});

describe('GET /api/workspace-registry memoryPhase (PAN-3286 FR-12)', () => {
  it('carries the status phase for main and scratch rows that have a status file', async () => {
    routeMocks.listWorkspaces.mockReturnValue([
      baseWorkspace({ id: 'ws-main', kind: 'main', name: 'main', issueId: null }),
      baseWorkspace({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-lens', issueId: null }),
    ]);
    routeMocks.readCurrentStatus.mockImplementation(async (_projectId: string, workspaceId: string) =>
      workspaceId === 'ws-main' ? { phase: 'shipping' } : { phase: 'exploring' });

    const rows = await listRows();

    expect(rows.map((row) => [row.id, row.memoryPhase])).toEqual([
      ['ws-main', 'shipping'],
      ['ws-scratch', 'exploring'],
    ]);
  });

  it('returns null for a non-issue row with no status file', async () => {
    routeMocks.listWorkspaces.mockReturnValue([
      baseWorkspace({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-lens', issueId: null }),
    ]);
    routeMocks.readCurrentStatus.mockResolvedValue(undefined);

    expect((await listRows())[0]!.memoryPhase).toBeNull();
  });

  it('returns null for a non-issue row whose status read rejects', async () => {
    routeMocks.listWorkspaces.mockReturnValue([
      baseWorkspace({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-lens', issueId: null }),
    ]);
    routeMocks.readCurrentStatus.mockRejectedValue(new Error('status file unreadable'));

    expect((await listRows())[0]!.memoryPhase).toBeNull();
  });

  it('returns null for an issue row without reading its status file, even when one exists', async () => {
    routeMocks.listWorkspaces.mockReturnValue([baseWorkspace({ id: 'ws-issue', kind: 'issue' })]);
    routeMocks.readCurrentStatus.mockResolvedValue({ phase: 'building' });

    const rows = await listRows();

    expect(rows[0]!.memoryPhase).toBeNull();
    expect(routeMocks.readCurrentStatus).not.toHaveBeenCalled();
  });

  it('reads status only for the non-issue rows in a mixed list', async () => {
    routeMocks.listWorkspaces.mockReturnValue([
      baseWorkspace({ id: 'ws-issue', kind: 'issue' }),
      baseWorkspace({ id: 'ws-scratch', kind: 'scratch', name: 'scratch-lens', issueId: null }),
    ]);
    routeMocks.readCurrentStatus.mockResolvedValue({ phase: 'verifying' });

    const rows = await listRows();

    expect(rows.map((row) => row.memoryPhase)).toEqual([null, 'verifying']);
    expect(routeMocks.readCurrentStatus).toHaveBeenCalledTimes(1);
    expect(routeMocks.readCurrentStatus).toHaveBeenCalledWith('overdeck', 'ws-scratch');
  });

  it('keeps every pre-existing list field alongside the new one (no-loss)', async () => {
    const workspace = baseWorkspace();
    routeMocks.listWorkspaces.mockReturnValue([workspace]);
    routeMocks.getReviewStatusSync.mockReturnValue({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      verificationStatus: 'passed',
      readyForMerge: true,
    });

    const row = (await listRows())[0]!;

    for (const field of PRE_EXISTING_LIST_FIELDS) {
      expect(Object.hasOwn(row, field)).toBe(true);
    }
    expect(row).toEqual({
      ...workspace,
      pipeline: {
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'merged',
        verificationStatus: 'passed',
        readyForMerge: true,
      },
      memoryPhase: null,
    });
  });
});
