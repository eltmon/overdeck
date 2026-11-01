import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  origin: 'git@github.com:eltmon/overdeck.git',
  commands: [] as string[],
  exec: vi.fn(),
  saveWorkspaceMetadata: vi.fn(),
  writeRemoteFile: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mocks.exec };
});

vi.mock('../../src/lib/config.js', () => ({
  loadConfigSync: () => ({ remote: { enabled: true, provider: 'fly' } }),
}));

vi.mock('../../src/lib/remote/index.js', () => ({
  createFlyProviderFromConfig: () => ({
    createVm: (name: string) => Effect.succeed({ name, status: 'running', machineId: 'm1' }),
    ssh: (_vm: string, command: string) => {
      mocks.commands.push(command);
      return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 });
    },
    deleteVm: () => Effect.succeed(undefined),
    exposePort: () => Effect.succeed(''),
    syncAllCredentials: vi.fn().mockResolvedValue(undefined),
    configureClaudeCode: vi.fn().mockResolvedValue(undefined),
    copySkillsToVm: vi.fn().mockResolvedValue(undefined),
    getAppName: () => 'overdeck-test',
  }),
}));

vi.mock('../../src/lib/remote/remote-agents.js', () => ({
  writeRemoteFile: mocks.writeRemoteFile,
}));

vi.mock('../../src/lib/remote/workspace-metadata.js', () => ({
  saveWorkspaceMetadata: mocks.saveWorkspaceMetadata,
}));

vi.mock('../../src/lib/projects.js', () => ({
  extractTeamPrefix: () => 'PAN',
  findProjectByTeam: () => ({ path: '/nonexistent/overdeck-remote-workspace-test' }),
  resolveProjectFromIssueSync: () => null,
  getIssuePrefix: () => 'PAN',
}));

import { createRemoteWorkspace } from '../../src/lib/remote-workspace.js';

describe('createRemoteWorkspace', () => {
  beforeEach(() => {
    mocks.commands.length = 0;
    mocks.saveWorkspaceMetadata.mockReset();
    mocks.exec.mockReset().mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, out: unknown) => void) => {
      cb(null, { stdout: `${mocks.origin}\n`, stderr: '' });
    });
  });

  it('clones a GitHub origin over https and sends no SSH key to the VM', async () => {
    mocks.origin = 'git@github.com:eltmon/overdeck.git';

    const metadata = await createRemoteWorkspace('PAN-4295');

    expect(mocks.commands).toContain('git clone https://github.com/eltmon/overdeck.git /workspace');
    expect(mocks.commands.filter((command) => /\.ssh\/|exe-dev-key|ssh-keyscan/.test(command))).toEqual([]);
    expect(metadata.vmName).toBe('pan-pan-4295-ws');
    expect(mocks.saveWorkspaceMetadata).toHaveBeenCalledTimes(1);
  });

  it('clones any git@host origin over https', async () => {
    mocks.origin = 'git@gitlab.com:group/repo.git';

    await createRemoteWorkspace('PAN-4295');

    expect(mocks.commands).toContain('git clone https://gitlab.com/group/repo.git /workspace');
  });
});
