import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  getProjectSync: vi.fn(),
  readPipelineMembershipSnapshotsForProjects: vi.fn(),
  refreshMembershipSnapshotsForProjects: vi.fn(),
  rejectUnsafeDashboardMutationRequest: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  getProjectSync: routeMocks.getProjectSync,
}));

vi.mock('../../../../src/dashboard/server/services/pipeline-membership.js', () => ({
  readPipelineMembershipSnapshotsForProjects: routeMocks.readPipelineMembershipSnapshotsForProjects,
  refreshMembershipSnapshotsForProjects: routeMocks.refreshMembershipSnapshotsForProjects,
}));

vi.mock('../../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
}));

import { pipelineMembershipRouteLayer } from '../../../../src/dashboard/server/routes/pipeline-membership.js';

const project = {
  name: 'route-project',
  path: '/route-project',
  issue_prefix: 'PAN',
  github_repo: 'owner/repo',
};

async function requestMembershipRoute(path: string, init: RequestInit = {}): Promise<{
  status: number;
  body: unknown;
}> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(pipelineMembershipRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('pipeline membership routes', () => {
  beforeEach(() => {
    routeMocks.getProjectSync.mockReset().mockReturnValue(project);
    routeMocks.readPipelineMembershipSnapshotsForProjects.mockReset();
    routeMocks.refreshMembershipSnapshotsForProjects.mockReset().mockResolvedValue(undefined);
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReset().mockReturnValue(null);
  });

  it('returns a typed unavailable body with HTTP 200 for a determined GET failure', async () => {
    routeMocks.readPipelineMembershipSnapshotsForProjects.mockReturnValue([{
      project,
      error: new Error('Workspace repo path is not a git repository: /route-project'),
      unavailableReason: 'repo_unavailable',
    }]);

    await expect(requestMembershipRoute('/api/pipeline/membership?project=route-project')).resolves.toEqual({
      status: 200,
      body: {
        status: 'unavailable',
        reason: 'repo_unavailable',
        message: 'Workspace repo path is not a git repository: /route-project',
        projectKey: 'route-project',
      },
    });
  });

  it('preserves the bare membership array for a healthy GET snapshot', async () => {
    const memberships = [{ issueId: 'PAN-1', inPipeline: true }];
    routeMocks.readPipelineMembershipSnapshotsForProjects.mockReturnValue([{ project, memberships }]);

    await expect(requestMembershipRoute('/api/pipeline/membership?project=route-project')).resolves.toEqual({
      status: 200,
      body: memberships,
    });
  });

  it('preserves the transient HTTP 503 response for a cold GET snapshot', async () => {
    routeMocks.readPipelineMembershipSnapshotsForProjects.mockReturnValue([{
      project,
      error: new Error('Pipeline membership snapshot is loading'),
    }]);

    await expect(requestMembershipRoute('/api/pipeline/membership?project=route-project')).resolves.toEqual({
      status: 503,
      body: { error: 'Pipeline membership snapshot is loading' },
    });
  });

  it('returns a typed unavailable body with HTTP 200 after a failed POST refresh', async () => {
    routeMocks.readPipelineMembershipSnapshotsForProjects.mockReturnValue([{
      project,
      error: new Error('GitHub App cannot access owner/repo'),
      unavailableReason: 'forge_unavailable',
    }]);

    await expect(requestMembershipRoute(
      '/api/pipeline/membership/refresh?project=route-project',
      { method: 'POST' },
    )).resolves.toEqual({
      status: 200,
      body: {
        status: 'unavailable',
        reason: 'forge_unavailable',
        message: 'GitHub App cannot access owner/repo',
        projectKey: 'route-project',
      },
    });
    expect(routeMocks.refreshMembershipSnapshotsForProjects).toHaveBeenCalledWith([project]);
  });
});
