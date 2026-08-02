import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  killSession: vi.fn(),
  saveAgentState: vi.fn(),
  spawnReviewSubRoleForIssue: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  saveAgentRuntimeState: vi.fn(),
}));

vi.mock('../../../../lib/agents/agent-state.js', () => ({
  saveAgentState: (state: unknown) => Effect.promise(() => mocks.saveAgentState(state)),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  killSession: (agentId: string) => Effect.promise(() => mocks.killSession(agentId)),
}));

vi.mock('../../../../lib/cloister/review-agent.js', () => ({
  spawnReviewSubRoleForIssue: (opts: unknown) => Effect.promise(() => mocks.spawnReviewSubRoleForIssue(opts)),
}));

async function requestRoute(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const { specialistsProjectRouteLayer } = await import('../specialists/project-routes.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(specialistsProjectRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('per-reviewer restart route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentStateSync.mockImplementation((agentId: string) => {
      if (agentId === 'agent-pan-3368-review') {
        return {
          id: agentId,
          workspace: '/workspace',
          reviewRunId: 'agent-pan-3368-review-abcdef12',
          reviewContextManifestPath: '/workspace/.pan/review/agent-pan-3368-review-abcdef12/context.json',
        };
      }
      if (agentId === 'agent-pan-3368-review-correctness') {
        return {
          id: agentId,
          reviewRunId: 'agent-pan-3368-review-abcdef12',
          reviewOutputPath: '/workspace/.pan/review/agent-pan-3368-review-abcdef12/correctness.md',
        };
      }
      return null;
    });
    mocks.killSession.mockResolvedValue(undefined);
    mocks.saveAgentState.mockResolvedValue(undefined);
    mocks.spawnReviewSubRoleForIssue.mockResolvedValue({
      success: true,
      message: 'Review correctness resumed',
      sessionId: 'agent-pan-3368-review-correctness',
    });
  });

  it('re-dispatches only the requested reviewer lane on the active run', async () => {
    const result = await requestRoute(
      '/api/specialists/overdeck/PAN-3368/reviewer/correctness/restart',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        message: 'Review correctness resumed',
        restarted: 'correctness',
      },
    });
    expect(mocks.killSession).toHaveBeenCalledWith('agent-pan-3368-review-correctness');
    expect(mocks.spawnReviewSubRoleForIssue).toHaveBeenCalledWith({
      issueId: 'PAN-3368',
      workspace: '/workspace',
      subRole: 'correctness',
      runId: 'agent-pan-3368-review-abcdef12',
      outputPath: '/workspace/.pan/review/agent-pan-3368-review-abcdef12/correctness.md',
      contextManifestPath: '/workspace/.pan/review/agent-pan-3368-review-abcdef12/context.json',
      synthesisAgentId: 'agent-pan-3368-review',
      allowHost: false,
    });
  });

  it('repairs a missing parent run id from one current run directory before dispatch', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-review-restart-'));
    tempRoots.push(workspace);
    const runId = 'agent-pan-3368-review-abcdef12';
    const reviewDir = join(workspace, '.pan', 'review', runId);
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'context.json'), '{}');
    const parent = {
      id: 'agent-pan-3368-review',
      issueId: 'PAN-3368',
      workspace,
      role: 'review',
      model: 'review-model',
      status: 'starting',
      startedAt: '2000-01-01T00:00:00.000Z',
    };
    mocks.getAgentStateSync.mockImplementation((agentId: string) =>
      agentId === parent.id ? parent : null,
    );

    const result = await requestRoute(
      '/api/specialists/overdeck/PAN-3368/reviewer/correctness/restart',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(result.status).toBe(200);
    expect(mocks.saveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      reviewRunId: runId,
      reviewContextManifestPath: join(reviewDir, 'context.json'),
    }));
    expect(mocks.spawnReviewSubRoleForIssue).toHaveBeenCalledWith(expect.objectContaining({
      workspace,
      runId,
      contextManifestPath: join(reviewDir, 'context.json'),
    }));
  });

  it.each([
    { name: 'no matching runs', runIds: [] },
    {
      name: 'multiple matching runs',
      runIds: [
        'agent-pan-3368-review-abcdef12',
        'agent-pan-3368-review-fedcba98',
      ],
    },
  ])('preserves 409 when there are $name', async ({ runIds }) => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-review-restart-'));
    tempRoots.push(workspace);
    for (const runId of runIds) {
      mkdirSync(join(workspace, '.pan', 'review', runId), { recursive: true });
    }
    mocks.getAgentStateSync.mockImplementation((agentId: string) =>
      agentId === 'agent-pan-3368-review'
        ? {
            id: agentId,
            issueId: 'PAN-3368',
            workspace,
            role: 'review',
            model: 'review-model',
            status: 'starting',
            startedAt: '2000-01-01T00:00:00.000Z',
          }
        : null,
    );

    const result = await requestRoute(
      '/api/specialists/overdeck/PAN-3368/reviewer/correctness/restart',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(result).toEqual({
      status: 409,
      body: { error: 'Active review run not found for PAN-3368' },
    });
    expect(mocks.saveAgentState).not.toHaveBeenCalled();
    expect(mocks.spawnReviewSubRoleForIssue).not.toHaveBeenCalled();
  });
});
