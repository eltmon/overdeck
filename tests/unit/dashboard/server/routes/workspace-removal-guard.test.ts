import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const { getContainersReferencingWorkspacePathMock } = vi.hoisted(() => ({
  getContainersReferencingWorkspacePathMock: vi.fn(),
}));

vi.mock('../../../../../src/lib/workspace-manager.js', () => ({
  getContainersReferencingWorkspacePath: getContainersReferencingWorkspacePathMock,
}));
vi.mock('../../../../../src/lib/stashes.js', () => ({
  listStashes: vi.fn(),
  isSalvageableStash: vi.fn(),
  createRecoveryBranchFromStash: vi.fn(),
  dropStash: vi.fn(),
}));
vi.mock('../../../../../src/lib/workspace/devcontainer-renderer.js', () => ({
  DEVCONTAINER_DIRNAME: '.devcontainer',
}));
vi.mock('../../../../../src/dashboard/server/http-helpers.js', () => ({
  jsonResponse: vi.fn(),
}));
vi.mock('../../../../../src/dashboard/server/routes/http-handler.js', () => ({
  httpHandler: (effect: unknown) => effect,
}));
vi.mock('../../../../../src/dashboard/server/routes/workspaces.js', () => ({
  getProjectPath: vi.fn(),
  requireTrustedMutationOrigin: vi.fn(),
  readJsonBody: Effect.succeed({}),
  spawnPanCommand: vi.fn(),
  getWorkspaceInfoForIssue: vi.fn(),
}));

import { ProcessSpawnError } from '../../../../../src/lib/errors.js';
import { checkWorkspaceRemovalGuard } from '../../../../../src/dashboard/server/routes/workspaces/stash-clean.js';

describe('checkWorkspaceRemovalGuard', () => {
  it('allows removal when no container references the workspace', async () => {
    getContainersReferencingWorkspacePathMock.mockReturnValue(Effect.succeed([]));

    await expect(Effect.runPromise(checkWorkspaceRemovalGuard('/workspaces/feature-pan-3567')))
      .resolves.toEqual({ allow: true });
  });

  it('refuses removal when containers reference the workspace', async () => {
    getContainersReferencingWorkspacePathMock.mockReturnValue(Effect.succeed([{}, {}]));

    const result = await Effect.runPromise(checkWorkspaceRemovalGuard('/workspaces/feature-pan-3567'));

    expect(result).toMatchObject({ allow: false, status: 409 });
    expect(result.error).toContain('2 Docker container(s)');
  });

  it('fails closed when Docker enumeration fails', async () => {
    const workspacePath = '/workspaces/feature-pan-3567';
    getContainersReferencingWorkspacePathMock.mockReturnValue(Effect.fail(new ProcessSpawnError({
      command: 'docker',
      args: ['ps'],
      message: 'Docker daemon unavailable',
    })));

    const result = await Effect.runPromise(checkWorkspaceRemovalGuard(workspacePath));

    expect(result).toMatchObject({ allow: false, status: 500 });
    expect(result.error).toContain(workspacePath);
    expect(result.error).toContain('Docker daemon unavailable');
  });
});
