import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  killSession: vi.fn(),
  spawnReviewSubRoleForIssue: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  saveAgentRuntimeState: vi.fn(),
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
});
