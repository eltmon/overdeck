import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { resolveProjectFromIssueMock, spawnInspectAgentMock } = vi.hoisted(() => ({
  resolveProjectFromIssueMock: vi.fn(),
  spawnInspectAgentMock: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: resolveProjectFromIssueMock,
  };
});

vi.mock('../../../../lib/cloister/inspect-agent.js', () => ({
  spawnInspectAgent: spawnInspectAgentMock,
}));

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    getIssues: vi.fn(() => []),
    getIssueSource: vi.fn(),
    patchIssue: vi.fn(),
    invalidateTracker: vi.fn(),
  }),
}));

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { issuesRouteLayer } from '../issues.js';

type JsonBody = Record<string, unknown>;

let projectPath: string;

async function postInspect(issueId: string, beadId: string, body?: JsonBody, headers: Record<string, string> = {}) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/issues/${issueId}/beads/${beadId}/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(issuesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

async function createWorkspace(issueId: string) {
  await mkdir(join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`), { recursive: true });
}

describe('POST /api/issues/:id/beads/:beadId/inspect', () => {
  beforeEach(async () => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
    _resetInternalTokenCacheForTests();
    projectPath = await mkdtemp(join(tmpdir(), 'pan-inspect-route-'));
    resolveProjectFromIssueMock.mockReturnValue({
      projectKey: 'panopticon',
      projectName: 'Panopticon',
      projectPath,
      linearTeam: 'PAN',
    });
    spawnInspectAgentMock.mockReturnValue(Effect.succeed({
      success: true,
      runId: 'inspect-run-1',
      tmuxSession: 'inspect-pan-1331-workspace-f1q5',
      message: 'spawned',
    }));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    if (projectPath) await rm(projectPath, { recursive: true, force: true });
  });

  it('spawns a fast inspect agent for a valid workspace and bead', async () => {
    await createWorkspace('PAN-1331');

    const result = await postInspect('PAN-1331', 'workspace-f1q5');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      runId: 'inspect-run-1',
      tmuxSession: 'inspect-pan-1331-workspace-f1q5',
    });
    expect(spawnInspectAgentMock).toHaveBeenCalledWith({
      projectKey: 'panopticon',
      projectPath,
      issueId: 'PAN-1331',
      beadId: 'workspace-f1q5',
      workspace: join(projectPath, 'workspaces', 'feature-pan-1331'),
      branch: 'feature/pan-1331',
    }, { deep: false });
  });

  it('rejects unauthenticated inspect requests before spawning', async () => {
    await createWorkspace('PAN-1331');

    const result = await postInspect('PAN-1331', 'workspace-f1q5', undefined, { [INTERNAL_TOKEN_HEADER]: '' });

    expect(result.status).toBe(401);
    expect(spawnInspectAgentMock).not.toHaveBeenCalled();
  });

  it('rejects bead IDs that are not command-safe identifiers', async () => {
    await createWorkspace('PAN-1331');

    const result = await postInspect('PAN-1331', encodeURIComponent('workspace-f1q5;touch-pwned'));

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid bead ID' });
    expect(spawnInspectAgentMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the issue cannot resolve to a project', async () => {
    resolveProjectFromIssueMock.mockReturnValue(null);

    const result = await postInspect('PAN-9999', 'workspace-f1q5');

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Could not resolve project for PAN-9999' });
    expect(spawnInspectAgentMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the expected workspace does not exist', async () => {
    const result = await postInspect('PAN-1331', 'workspace-f1q5');

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'No workspace found for PAN-1331' });
    expect(spawnInspectAgentMock).not.toHaveBeenCalled();
  });

  it('forwards the deep flag to the inspect agent', async () => {
    await createWorkspace('PAN-1331');

    const result = await postInspect('pan-1331', 'workspace-f1q5', { deep: true });

    expect(result.status).toBe(200);
    expect(spawnInspectAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-1331',
      beadId: 'workspace-f1q5',
    }), { deep: true });
  });
});
