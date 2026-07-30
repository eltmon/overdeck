/**
 * PAN-3331 WI-3 (FR-4, FR-5, D-4, D-5): per-workspace run command — default
 * resolution from the project's services[].start_command, override persistence
 * through the writer door, and the single-live-session run route.
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
  setWorkspaceRunCommand: vi.fn(),
  touchWorkspaceAccessed: vi.fn(),
  updateWorkspaceLayout: vi.fn(),
  getReviewStatusSync: vi.fn(),
  readCurrentStatus: vi.fn(),
  readRecentObservations: vi.fn(),
  rejectUnsafeDashboardMutationRequest: vi.fn(),
  getWorkspaceGitState: vi.fn(),
  pullWorkspaceFastForward: vi.fn(),
  getProjectSync: vi.fn(),
  createSession: vi.fn(),
  sessionExists: vi.fn(),
}));

vi.mock('../../../src/lib/workspaces/resolver.js', () => ({
  getWorkspaceById: routeMocks.getWorkspaceById,
  listWorkspaces: routeMocks.listWorkspaces,
}));

vi.mock('../../../src/lib/workspaces/writer.js', () => ({
  archiveWorkspace: routeMocks.archiveWorkspace,
  unarchiveWorkspace: routeMocks.unarchiveWorkspace,
  setWorkspaceFavorite: routeMocks.setWorkspaceFavorite,
  setWorkspaceRunCommand: routeMocks.setWorkspaceRunCommand,
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

vi.mock('../../../src/lib/projects.js', () => ({
  getProjectSync: routeMocks.getProjectSync,
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  createSession: routeMocks.createSession,
  sessionExists: routeMocks.sessionExists,
}));

vi.mock('../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
}));

import { workspaceRegistryRouteLayer } from '../../../src/dashboard/server/routes/workspace-registry.js';

function baseWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'ws-main-1234abcd',
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
    runCommand: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    createdAt: 1,
    lastAccessedAt: 1,
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

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
  routeMocks.readCurrentStatus.mockResolvedValue(undefined);
  routeMocks.readRecentObservations.mockResolvedValue([]);
  routeMocks.getReviewStatusSync.mockReturnValue(null);
  routeMocks.getProjectSync.mockReturnValue(null);
  routeMocks.sessionExists.mockReturnValue(Effect.succeed(false));
  routeMocks.createSession.mockReturnValue(Effect.succeed(undefined));
});

describe('PUT /api/workspace-registry/:id/run-command (FR-4)', () => {
  it('persists an override through the writer door', async () => {
    const workspace = baseWorkspace();
    routeMocks.getWorkspaceById.mockReturnValue(workspace);

    const response = await call('PUT', `/api/workspace-registry/${workspace.id}/run-command`, {
      command: '  npm run dev  ',
    });

    expect(response.status).toBe(200);
    expect(routeMocks.setWorkspaceRunCommand).toHaveBeenCalledWith(workspace.id, 'npm run dev');
  });

  it('returns the stored override on the updated row', async () => {
    const workspace = baseWorkspace();
    routeMocks.getWorkspaceById
      .mockReturnValueOnce(workspace)
      .mockReturnValue(baseWorkspace({ runCommand: 'npm run dev' }));

    const response = await call('PUT', `/api/workspace-registry/${workspace.id}/run-command`, {
      command: 'npm run dev',
    });

    expect(response.body.runCommand).toBe('npm run dev');
  });

  it('clears the override when given null or an empty string', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ runCommand: 'npm run dev' }));

    await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', { command: null });
    await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', { command: '   ' });

    expect(routeMocks.setWorkspaceRunCommand).toHaveBeenNthCalledWith(1, 'ws-main-1234abcd', null);
    expect(routeMocks.setWorkspaceRunCommand).toHaveBeenNthCalledWith(2, 'ws-main-1234abcd', null);
  });

  it('rejects a command with a newline or a backtick', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const newline = await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', {
      command: 'npm run dev\nrm -rf /',
    });
    const backtick = await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', {
      command: 'npm run `whoami`',
    });

    expect(newline.status).toBe(400);
    expect(backtick.status).toBe(400);
    expect(routeMocks.setWorkspaceRunCommand).not.toHaveBeenCalled();
  });

  it('rejects a command longer than 500 characters', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const response = await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', {
      command: 'x'.repeat(501),
    });

    expect(response.status).toBe(400);
    expect(routeMocks.setWorkspaceRunCommand).not.toHaveBeenCalled();
  });

  it('rejects a non-string, non-null command', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const response = await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', { command: 42 });

    expect(response.status).toBe(400);
    expect(routeMocks.setWorkspaceRunCommand).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized mutation before writing', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );

    await call('PUT', '/api/workspace-registry/ws-main-1234abcd/run-command', { command: 'npm run dev' });

    expect(routeMocks.setWorkspaceRunCommand).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown workspace', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(undefined);

    expect((await call('PUT', '/api/workspace-registry/nope/run-command', { command: 'x' })).status).toBe(404);
  });
});

describe('GET /api/workspace-registry/:id run command defaults (D-4)', () => {
  it('exposes the project services as the default and the picker options', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.getProjectSync.mockReturnValue({
      workspace: { services: [
        { name: 'api', path: 'api', start_command: './run-dev.sh' },
        { name: 'frontend', path: 'fe', start_command: 'npm run dev' },
      ] },
    });

    const response = await call('GET', '/api/workspace-registry/ws-main-1234abcd');

    expect(response.body.runCommandDefault).toBe('./run-dev.sh');
    expect(response.body.runCommandOptions).toEqual([
      { name: 'api', command: './run-dev.sh' },
      { name: 'frontend', command: 'npm run dev' },
    ]);
  });

  it('reports a null default when the project configures no services', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.getProjectSync.mockReturnValue({ workspace: { services: [] } });

    const response = await call('GET', '/api/workspace-registry/ws-main-1234abcd');

    expect(response.body.runCommandDefault).toBeNull();
    expect(response.body.runCommandOptions).toEqual([]);
  });
});

describe('POST /api/workspace-registry/:id/run (FR-5)', () => {
  it('spawns the project default in the workspace path when no override is set', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ path: '/repo/main' }));
    routeMocks.getProjectSync.mockReturnValue({
      workspace: { services: [{ name: 'api', path: 'api', start_command: './run-dev.sh' }] },
    });

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ command: './run-dev.sh' });
    expect(routeMocks.createSession).toHaveBeenCalledWith(
      response.body.sessionName,
      '/repo/main',
      './run-dev.sh',
      expect.objectContaining({ env: expect.objectContaining({ PATH: expect.any(String) }) }),
    );
  });

  it('prefers the stored override over the project default', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ runCommand: 'bun run dev' }));
    routeMocks.getProjectSync.mockReturnValue({
      workspace: { services: [{ name: 'api', path: 'api', start_command: './run-dev.sh' }] },
    });

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(response.body.command).toBe('bun run dev');
    expect(routeMocks.createSession.mock.calls[0]![2]).toBe('bun run dev');
  });

  it('uses a session name derived from the workspace id so a reload finds the same session', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ runCommand: 'npm run dev' }));

    const first = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');
    routeMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    const second = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(first.body.sessionName).toBe(second.body.sessionName);
    expect(String(first.body.sessionName)).toMatch(/^ws-run-[a-zA-Z0-9]+$/);
  });

  it('re-focuses the live session instead of spawning a second one', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ runCommand: 'npm run dev' }));
    routeMocks.sessionExists.mockReturnValue(Effect.succeed(true));

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(response.status).toBe(409);
    expect(response.body.alreadyRunning).toBe(true);
    expect(routeMocks.createSession).not.toHaveBeenCalled();
  });

  it('returns 400 with the (empty) options when nothing is configured', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.getProjectSync.mockReturnValue({ workspace: { services: [] } });

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(response.status).toBe(400);
    expect(response.body.runCommandOptions).toEqual([]);
    expect(routeMocks.createSession).not.toHaveBeenCalled();
  });

  it('refuses to spawn a stored command that would break the session', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ runCommand: 'npm run dev\nrm -rf /' }));

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(response.status).toBe(400);
    expect(routeMocks.createSession).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized mutation before spawning', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace({ runCommand: 'npm run dev' }));
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );

    await call('POST', '/api/workspace-registry/ws-main-1234abcd/run');

    expect(routeMocks.createSession).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown workspace', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(undefined);

    expect((await call('POST', '/api/workspace-registry/nope/run')).status).toBe(404);
  });
});
