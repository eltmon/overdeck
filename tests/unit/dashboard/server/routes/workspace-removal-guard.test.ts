import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const { dockerExecMock } = vi.hoisted(() => {
  const dockerExecMock = vi.fn();
  Object.assign(dockerExecMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: dockerExecMock,
  });
  return { dockerExecMock };
});

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  exec: dockerExecMock,
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

import { checkWorkspaceRemovalGuard } from '../../../../../src/dashboard/server/routes/workspaces/stash-clean.js';

describe('checkWorkspaceRemovalGuard', () => {
  it('allows removal when no container references the workspace', async () => {
    dockerExecMock.mockResolvedValue({ stdout: '' });

    await expect(Effect.runPromise(checkWorkspaceRemovalGuard('/workspaces/feature-pan-3567')))
      .resolves.toEqual({ allow: true });
  });

  it('refuses removal when containers reference the workspace', async () => {
    dockerExecMock.mockResolvedValue({
      stdout: 'container-1|/workspaces/feature-pan-3567/.devcontainer/docker-compose.yml\ncontainer-2|/workspaces/feature-pan-3567/.devcontainer/docker-compose.yml',
    });

    const result = await Effect.runPromise(checkWorkspaceRemovalGuard('/workspaces/feature-pan-3567'));

    expect(result).toMatchObject({ allow: false, status: 409 });
    expect(result.error).toContain('2 Docker container(s)');
  });

  it('fails closed when Docker enumeration fails', async () => {
    const workspacePath = '/workspaces/feature-pan-3567';
    dockerExecMock.mockRejectedValue(new Error('Docker daemon unavailable'));

    const result = await Effect.runPromise(checkWorkspaceRemovalGuard(workspacePath));

    expect(result).toMatchObject({ allow: false, status: 500 });
    expect(result.error).toContain(workspacePath);
    expect(result.error).toContain('Docker daemon unavailable');
  });
});
