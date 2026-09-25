/**
 * #3853: `POST /api/specialists/:project/:issueId/review/restart` grants the
 * restarted run operator standing (its reviewer may block an approved head)
 * only when the operator asked for it. `pan review restart` from a managed
 * agent pane (the flywheel, the stall sweeper's recovery) says it is an agent;
 * the dashboard's restart button sends no caller, and a browser is the operator.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  killAllReviewerSessions: vi.fn(),
  spawnReviewRoleForIssue: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  getDerivedIssueState: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionsSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
  killSession: () => Effect.void,
}));

vi.mock('../../../../lib/cloister/review-agent.js', () => ({
  killAllReviewerSessions: mocks.killAllReviewerSessions,
  spawnReviewRoleForIssue: (opts: unknown) => Effect.promise(() => mocks.spawnReviewRoleForIssue(opts)),
}));

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../lib/project-repos.js', () => ({
  resolveWorkspaceRepoRoots: (_issueId: string, workspace: string) => [{ dir: workspace, sourceBranch: 'main' }],
  resolvePrimaryWorkspaceRepoDir: (_issueId: string, workspace: string) => workspace,
}));

vi.mock('../specialists/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../specialists/shared.js')>()),
  execAsync: vi.fn(async () => ({ stdout: 'feature/pan-3853\n', stderr: '' })),
}));

vi.mock('../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: mocks.getDerivedIssueState,
}));

async function restart(body: unknown): Promise<{ status: number; body: unknown }> {
  const { specialistsProjectRouteLayer } = await import('../specialists/project-routes.js');
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/specialists/overdeck/PAN-3853/review/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
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

let projectRoot: string;

beforeEach(() => {
  vi.clearAllMocks();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-review-restart-caller-'));
  mkdirSync(join(projectRoot, 'workspaces', 'feature-pan-3853'), { recursive: true });
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: projectRoot });
  mocks.getDerivedIssueState.mockResolvedValue({ issueId: 'PAN-3853', state: 'ready', pr: { url: 'https://github.com/o/r/pull/7' } });
  mocks.killAllReviewerSessions.mockResolvedValue({ killed: [] });
  mocks.spawnReviewRoleForIssue.mockResolvedValue({ success: true, message: 'spawned' });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('POST /api/specialists/:project/:issueId/review/restart — operator standing (#3853)', () => {
  it('does not mark an agent-context restart as operator-requested', async () => {
    const result = await restart({ callerKind: 'agent' });

    expect(result.status).toBe(200);
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledOnce();
    expect(mocks.spawnReviewRoleForIssue.mock.calls[0][0]).toMatchObject({
      issueId: 'PAN-3853',
      operatorRequested: false,
    });
  });

  it('marks the dashboard restart (no caller field) as operator-requested', async () => {
    const result = await restart({});

    expect(result.status).toBe(200);
    expect(mocks.spawnReviewRoleForIssue.mock.calls[0][0]).toMatchObject({
      issueId: 'PAN-3853',
      operatorRequested: true,
    });
  });

  it('marks an operator-shell restart as operator-requested', async () => {
    await restart({ callerKind: 'operator' });

    expect(mocks.spawnReviewRoleForIssue.mock.calls[0][0]).toMatchObject({ operatorRequested: true });
  });
});
