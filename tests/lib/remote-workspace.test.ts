import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  origin: 'git@github.com:eltmon/overdeck.git',
  commands: [] as string[],
  // Answers to successive polls of /tmp/pan-clone.exit; '' means still cloning.
  cloneExits: [] as string[],
  // ssh commands containing one of these substrings reject with
  // `exec failed: <substring>` — checked before any other ssh behavior.
  sshFailures: [] as string[],
  deleteVm: vi.fn(),
  // When set, deleteVm still records the call but rejects with this error.
  deleteVmError: null as Error | null,
  tier: 'ephemeral' as 'ephemeral' | 'durable',
  configureClaudeCode: vi.fn(),
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
      const failure = mocks.sshFailures.find((substring) => command.includes(substring));
      if (failure) {
        return Effect.fail(new Error(`exec failed: ${failure}`));
      }
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
      return mocks.deleteVmError ? Effect.fail(mocks.deleteVmError) : Effect.succeed(undefined);
    },
    exposePort: () => Effect.succeed(''),
    syncAllCredentials: vi.fn().mockResolvedValue(undefined),
    configureClaudeCode: mocks.configureClaudeCode,
    copySkillsToVm: vi.fn().mockResolvedValue(undefined),
    getAppName: () => 'overdeck-test',
    getResiliencyTier: () => mocks.tier,
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
    mocks.sshFailures.length = 0;
    mocks.deleteVmError = null;
    mocks.tier = 'ephemeral';
    mocks.deleteVm.mockReset();
    mocks.saveWorkspaceMetadata.mockReset();
    mocks.configureClaudeCode.mockReset().mockResolvedValue(undefined);
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

  it('deletes the VM when the clone start exec rejects', async () => {
    mocks.sshFailures.push('setsid nohup');

    await expect(create('PAN-4295')).rejects.toThrow('exec failed: setsid nohup');
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it('deletes the VM when the clone log tail rejects', async () => {
    mocks.cloneExits.push('128');
    mocks.sshFailures.push('tail -5 /tmp/pan-clone.log');

    await expect(create('PAN-4295')).rejects.toThrow('exec failed: tail -5');
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it('deletes the VM when a later creation step rejects', async () => {
    mocks.configureClaudeCode.mockRejectedValueOnce(new Error('configure failed'));

    await expect(create('PAN-4295')).rejects.toThrow('configure failed');
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it('deletes the VM when the branch checkout exec rejects', async () => {
    mocks.sshFailures.push('git checkout');

    await expect(create('PAN-4295')).rejects.toThrow('exec failed: git checkout');
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
  });

  it('names the VM and the destroy command when the rollback delete fails', async () => {
    mocks.sshFailures.push('setsid nohup');
    mocks.deleteVmError = new Error('403 Forbidden');

    await expect(create('PAN-4295')).rejects.toThrow(
      /exec failed: setsid nohup.*pan-pan-4295-ws.*m1.*403 Forbidden.*fly machines destroy m1 -a overdeck-test --force/s,
    );
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it('names the durable volume and the volume commands when the rollback delete fails on the durable tier', async () => {
    mocks.tier = 'durable';
    mocks.sshFailures.push('setsid nohup');
    mocks.deleteVmError = new Error('403 Forbidden');

    await expect(create('PAN-4295')).rejects.toThrow(
      /fly machines destroy m1 -a overdeck-test --force.*fly volumes list -a overdeck-test.*pan-pan-4295-ws-workspace.*fly volumes destroy <volume-id> -a overdeck-test --yes/s,
    );
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });

  it('omits volume commands from the recovery text on the ephemeral tier', async () => {
    mocks.sshFailures.push('setsid nohup');
    mocks.deleteVmError = new Error('403 Forbidden');

    try {
      await create('PAN-4295');
      throw new Error('expected create to reject');
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain('fly volumes');
    }
    expect(mocks.deleteVm).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspaceMetadata).not.toHaveBeenCalled();
  });
});
