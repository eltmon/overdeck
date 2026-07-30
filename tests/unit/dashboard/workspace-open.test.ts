/**
 * PAN-3331 WI-4 (FR-6, D-6): the open-in route — file-manager reveal always
 * available, editor gated on ui.open_in_editor_command, and no shell-string
 * execution path for either.
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
  rejectUnauthorizedDashboardRequest: vi.fn(),
  getWorkspaceGitState: vi.fn(),
  pullWorkspaceFastForward: vi.fn(),
  getProjectSync: vi.fn(),
  createSession: vi.fn(),
  sessionExists: vi.fn(),
  openPath: vi.fn(),
  openInEditor: vi.fn(),
  getOpenInEditorCommand: vi.fn(),
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

vi.mock('../../../src/lib/browser.js', () => ({
  openPath: routeMocks.openPath,
  openInEditor: routeMocks.openInEditor,
}));

vi.mock('../../../src/lib/config-yaml/load.js', () => ({
  getOpenInEditorCommand: routeMocks.getOpenInEditorCommand,
}));

vi.mock('../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
  rejectUnauthorizedDashboardRequest: routeMocks.rejectUnauthorizedDashboardRequest,
}));

import { workspaceRegistryRouteLayer } from '../../../src/dashboard/server/routes/workspace-registry.js';

function baseWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'ws-main-1234abcd',
    projectId: 'overdeck',
    kind: 'main',
    name: 'main',
    path: '/repo/main',
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
  routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(null);
  routeMocks.readCurrentStatus.mockResolvedValue(undefined);
  routeMocks.readRecentObservations.mockResolvedValue([]);
  routeMocks.getReviewStatusSync.mockReturnValue(null);
  routeMocks.getProjectSync.mockReturnValue(null);
  routeMocks.getOpenInEditorCommand.mockReturnValue(Effect.succeed(null));
  routeMocks.openPath.mockReturnValue(Effect.void);
  routeMocks.openInEditor.mockReturnValue(Effect.void);
});

describe('POST /api/workspace-registry/:id/open (FR-6)', () => {
  it('reveals the workspace path in the file manager', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/open', {
      target: 'file-manager',
    });

    expect(response.status).toBe(200);
    expect(routeMocks.openPath).toHaveBeenCalledWith('/repo/main');
  });

  it('refuses the editor target with 409 when no editor command is configured', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.getOpenInEditorCommand.mockReturnValue(Effect.succeed(null));

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/open', {
      target: 'editor',
    });

    expect(response.status).toBe(409);
    expect(String(response.body.error)).toContain('ui.open_in_editor_command');
    expect(routeMocks.openInEditor).not.toHaveBeenCalled();
  });

  it('opens the editor with the configured template when one is set', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.getOpenInEditorCommand.mockReturnValue(Effect.succeed('cursor {path}'));

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/open', {
      target: 'editor',
    });

    expect(response.status).toBe(200);
    expect(routeMocks.openInEditor).toHaveBeenCalledWith('cursor {path}', '/repo/main');
  });

  it('rejects an unknown target', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const response = await call('POST', '/api/workspace-registry/ws-main-1234abcd/open', {
      target: 'terminal',
    });

    expect(response.status).toBe(400);
    expect(routeMocks.openPath).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized mutation before spawning anything', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );

    await call('POST', '/api/workspace-registry/ws-main-1234abcd/open', { target: 'file-manager' });

    expect(routeMocks.openPath).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown workspace', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(undefined);

    const response = await call('POST', '/api/workspace-registry/nope/open', { target: 'file-manager' });

    expect(response.status).toBe(404);
  });

  it('reports editor availability on the detail route so the band can hide the entry', async () => {
    routeMocks.getWorkspaceById.mockReturnValue(baseWorkspace());

    const hidden = await call('GET', '/api/workspace-registry/ws-main-1234abcd');
    routeMocks.getOpenInEditorCommand.mockReturnValue(Effect.succeed('code {path}'));
    const shown = await call('GET', '/api/workspace-registry/ws-main-1234abcd');

    expect(hidden.body.openInEditorConfigured).toBe(false);
    expect(shown.body.openInEditorConfigured).toBe(true);
  });
});

describe('openInEditor template handling (D-6)', () => {
  /** Captures the argv the editor helper would spawn, without spawning anything. */
  async function spawnedArgv(template: string, path: string): Promise<{ command: string; args: string[] }> {
    const calls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawner = {
      exitCode: (proc: { command: string; args: readonly string[] }) => {
        calls.push({ command: proc.command, args: [...proc.args] });
        return Effect.succeed(0);
      },
    };
    const { ChildProcessSpawner } = await import('effect/unstable/process/ChildProcessSpawner');
    // The route suite above mocks src/lib/browser.js, so reach for the real one.
    const { openInEditor: realOpenInEditor } =
      await vi.importActual<typeof import('../../../src/lib/browser.js')>('../../../src/lib/browser.js');
    await Effect.runPromise(
      realOpenInEditor(template, path).pipe(
        Effect.provideService(ChildProcessSpawner, fakeSpawner as never),
      ),
    );
    return calls[0]!;
  }

  it('substitutes {path} as one argument, never a shell string', async () => {
    const spawned = await spawnedArgv('cursor {path}', '/repo/my main');

    expect(spawned.command).toBe('cursor');
    expect(spawned.args).toEqual(['/repo/my main']);
  });

  it('keeps intermediate flags and passes the path as a single argument', async () => {
    const spawned = await spawnedArgv('code --new-window {path}', '/repo/main');

    expect(spawned.command).toBe('code');
    expect(spawned.args).toEqual(['--new-window', '/repo/main']);
  });

  it('appends the path when the template omits the placeholder', async () => {
    const spawned = await spawnedArgv('subl', '/repo/main');

    expect(spawned.command).toBe('subl');
    expect(spawned.args).toEqual(['/repo/main']);
  });

  it('never lets a path with shell metacharacters become more than one argument', async () => {
    const spawned = await spawnedArgv('cursor {path}', '/repo/main; rm -rf ~');

    expect(spawned.args).toEqual(['/repo/main; rm -rf ~']);
  });

  it('rejects a quoted template with an explanatory error instead of passing quotes through', async () => {
    const { openInEditor: realOpenInEditor } =
      await vi.importActual<typeof import('../../../src/lib/browser.js')>('../../../src/lib/browser.js');
    const { ChildProcessSpawner } = await import('effect/unstable/process/ChildProcessSpawner');
    const spawn = vi.fn(() => Effect.succeed(0));

    await expect(Effect.runPromise(
      realOpenInEditor('"/opt/My Editor/bin/edit" {path}', '/repo/main').pipe(
        Effect.provideService(ChildProcessSpawner, { exitCode: spawn } as never),
      ),
    )).rejects.toThrow(/quoting/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});
