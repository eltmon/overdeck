import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  origin: 'git@github.com:eltmon/overdeck.git',
  commands: [] as string[],
  // Answers to successive polls of /tmp/pan-clone.exit; '' means still cloning.
  cloneExits: [] as string[],
  deleteVm: vi.fn(),
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
      if (command.includes('cat /tmp/pan-clone.exit')) {
        const code = mocks.cloneExits.shift() ?? '0';
        return Effect.succeed(code === ''
          ? { stdout: '', stderr: '', exitCode: 1 }
          : { stdout: `${code}\n`, stderr: '', exitCode: 0 });
      }
      if (command.includes('tail -5 /tmp/pan-clone.log')) {
        return Effect.succeed({ stdout: 'fatal: repository not found\n', stderr: '', exitCode: 0 });
      }
      return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 });
    },
    deleteVm: () => {
      mocks.deleteVm();
      return Effect.succeed(undefined);
    },
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

/** Run a creation to completion, advancing the fake clock past each 5 s clone poll. */
async function create(issueId: string) {
  const pending = createRemoteWorkspace(issueId);
  pending.catch(() => undefined);
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5_000);
  return pending;
}

function cloneCommands(): string[] {
  return mocks.commands.filter((command) => command.includes('git clone'));
}

describe('createRemoteWorkspace', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.commands.length = 0;
    mocks.cloneExits.length = 0;
    mocks.deleteVm.mockReset();
    mocks.saveWorkspaceMetadata.mockReset();
    mocks.exec.mockReset().mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null, out: unknown) => void) => {
      cb(null, { stdout: `${mocks.origin}\n`, stderr: '' });
    });
  });

  it('clones a GitHub origin over https and sends no SSH key to the VM', async () => {
    mocks.origin = 'git@github.com:eltmon/overdeck.git';

    const metadata = await create('PAN-4295');

    expect(cloneCommands()).toHaveLength(1);
    expect(cloneCommands()[0]).toContain('git clone https://github.com/eltmon/overdeck.git /workspace');
    expect(mocks.commands.filter((command) => /\.ssh\/|exe-dev-key|ssh-keyscan/.test(command))).toEqual([]);
    expect(metadata.vmName).toBe('pan-pan-4295-ws');
    expect(mocks.saveWorkspaceMetadata).toHaveBeenCalledTimes(1);
  });

  it('clones any git@host origin over https', async () => {
    mocks.origin = 'git@gitlab.com:group/repo.git';

    await create('PAN-4295');

    expect(cloneCommands()[0]).toContain('git clone https://gitlab.com/group/repo.git /workspace');
  });

  it('starts the clone detached and polls until it exits, outlasting the 60 s exec deadline', async () => {
    mocks.origin = 'git@github.com:eltmon/overdeck.git';
    mocks.cloneExits.push('', '', '0');

    await create('PAN-4295');

    expect(cloneCommands()[0]).toMatch(/setsid nohup sh -c .*&$/);
    expect(mocks.commands.filter((command) => command.includes('cat /tmp/pan-clone.exit'))).toHaveLength(3);
    expect(mocks.deleteVm).not.toHaveBeenCalled();
  });

  it('deletes the VM and reports the clone log when the clone fails', async () => {
    mocks.origin = 'git@github.com:eltmon/overdeck.git';
    mocks.cloneExits.push('128');

    await expect(create('PAN-4295')).rejects.toThrow('Failed to clone: fatal: repository not found');
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });
});
