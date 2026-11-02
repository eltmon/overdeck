/**
 * PAN-4652 WI-9: ensureFlyProject clones a GitHub project onto the Fly machine
 * detached and polls for it (fake timers); a non-GitHub project fails before
 * any exec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../../projects.js';
import { FlyApiError, type FlyExecResult } from '../../../remote/fly-api.js';
import { ensureFlyProject, ensureFlyWorkspace } from '../project.js';

const MACHINE = { appName: 'overdeck-ws', machineId: '148e21ea7e1689' };
const PROJECT = { name: 'overdeck', path: '/home/me/Projects/overdeck', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN' } as ProjectConfig;

function fakeApi(respond: (command: string) => Partial<FlyExecResult> | undefined) {
  const execs: string[] = [];
  const api = {
    execCommand: vi.fn(async (_app: string, _id: string, command: string[]) => {
      execs.push(command[2]!);
      return { stdout: '', stderr: '', exit_code: 0, ...respond(command[2]!) };
    }),
  };
  return { api, execs };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ensureFlyProject (PAN-4652 WI-9)', () => {
  it('clones detached, polls every 5 s until the exit file reads 0, then checks the VM lists the key', async () => {
    let polls = 0;
    const { api, execs } = fakeApi((command) => {
      if (command === 'cat /tmp/pan-project.exit') return { stdout: ++polls >= 3 ? '0\n' : '' };
      if (command === 'pan project list --json') return { stdout: JSON.stringify({ overdeck: { name: 'overdeck' } }, null, 2) };
      return undefined;
    });
    const pending = ensureFlyProject(MACHINE, 'overdeck', { api, getProject: () => PROJECT });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(polls).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeUndefined();

    expect(polls).toBe(3);
    const start = execs[0]!;
    expect(start).toContain('pan project clone https://github.com/eltmon/overdeck.git --parent /workspace --name overdeck --issue-prefix PAN');
    expect(start.startsWith('rm -f /tmp/pan-project.exit && setsid nohup sh -c')).toBe(true);
    expect(execs.at(-1)).toBe('pan project list --json');
  });

  it('fails with project-failed before any exec for a project with only gitlab_repo', async () => {
    const { api } = fakeApi(() => undefined);
    const gitlab = { name: 'myn', path: '/p/myn', gitlab_repo: 'group/myn' } as ProjectConfig;
    await expect(ensureFlyProject(MACHINE, 'myn', { api, getProject: () => gitlab })).rejects.toMatchObject({ code: 'project-failed' });
    await expect(ensureFlyProject(MACHINE, 'nope', { api, getProject: () => null })).rejects.toMatchObject({ code: 'project-failed' });
    expect(api.execCommand).not.toHaveBeenCalled();
  });

  it('fails with project-failed and the log tail when the clone exits non-zero', async () => {
    const { api } = fakeApi((command) => {
      if (command === 'cat /tmp/pan-project.exit') return { stdout: '128\n' };
      if (command.startsWith('tail -n 20')) return { stdout: 'fatal: repository not found\n' };
      return undefined;
    });
    const error = await ensureFlyProject(MACHINE, 'overdeck', { api, getProject: () => PROJECT }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'project-failed' });
    expect((error as Error).message).toContain('fatal: repository not found');
  });

  it('fails with project-failed when the VM does not list the key after the clone', async () => {
    const { api } = fakeApi((command) => {
      if (command === 'cat /tmp/pan-project.exit') return { stdout: '0\n' };
      if (command === 'pan project list --json') return { stdout: 'No projects registered.\n' };
      return undefined;
    });
    await expect(ensureFlyProject(MACHINE, 'overdeck', { api, getProject: () => PROJECT })).rejects.toMatchObject({ code: 'project-failed' });
  });

  it('gives up after 20 minutes without an exit code', async () => {
    const { api } = fakeApi(() => undefined);
    const settled = ensureFlyProject(MACHINE, 'overdeck', { api, getProject: () => PROJECT }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(await settled).toMatchObject({ code: 'project-failed' });
  });

  it('a 403 from the clone poll fails at once with fly-token-rejected (PAN-4748)', async () => {
    let pollExecs = 0;
    const api = {
      execCommand: vi.fn(async (_app: string, _id: string, command: string[]) => {
        if (command[2] === 'cat /tmp/pan-project.exit') {
          pollExecs++;
          throw new FlyApiError('Fly API error 403 for GET …', 403, '{"error":"unauthorized"}');
        }
        return { stdout: '', stderr: '', exit_code: 0 };
      }),
    };
    const error = await ensureFlyProject(MACHINE, 'overdeck', { api, getProject: () => PROJECT }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'fly-token-rejected' });
    expect(pollExecs).toBe(1);
  });

  it('a non-auth probe error still counts as not finished', async () => {
    let pollExecs = 0;
    const { api } = fakeApi((command) => {
      if (command === 'cat /tmp/pan-project.exit') {
        pollExecs++;
        if (pollExecs === 1) throw new Error('Fly API error 500 for GET …');
        return { stdout: '0\n' };
      }
      if (command === 'pan project list --json') return { stdout: JSON.stringify({ overdeck: { name: 'overdeck' } }, null, 2) };
      return undefined;
    });
    const pending = ensureFlyProject(MACHINE, 'overdeck', { api, getProject: () => PROJECT });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeUndefined();
    expect(pollExecs).toBe(2);
  });
});

describe('ensureFlyWorkspace (PAN-4734 WI-6)', () => {
  const WORKTREE = '/workspace/overdeck/workspaces/feature-pan-4734';

  it('fetches the branch, adds the worktree with the agent identity and returns its path', async () => {
    const { api, execs } = fakeApi((command) =>
      command.startsWith('git -C') ? { stdout: 'feature/pan-4734\n' } : undefined);

    expect(await ensureFlyWorkspace(MACHINE, 'overdeck', 'PAN-4734', { api })).toBe(WORKTREE);
    expect(execs).toEqual([
      'cd /workspace/overdeck && git config user.email "panopticon-agent[bot]@users.noreply.github.com" && git config user.name "panopticon-agent[bot]" && git fetch origin feature/pan-4734 && git worktree add -b feature/pan-4734 workspaces/feature-pan-4734 origin/feature/pan-4734',
      `git -C ${WORKTREE} branch --show-current`,
    ]);
    expect(api.execCommand).toHaveBeenCalledWith(MACHINE.appName, MACHINE.machineId, ['/bin/sh', '-c', expect.any(String)], 60);
  });

  it('fails with workspace-failed and the stderr when the worktree command exits non-zero', async () => {
    const { api } = fakeApi((command) =>
      command.startsWith('cd ') ? { exit_code: 128, stderr: "fatal: couldn't find remote ref feature/pan-4734\n" } : undefined);

    await expect(ensureFlyWorkspace(MACHINE, 'overdeck', 'PAN-4734', { api })).rejects.toMatchObject({
      code: 'workspace-failed',
      message: expect.stringContaining("couldn't find remote ref feature/pan-4734"),
    });
  });

  it('fails with workspace-failed when the worktree is on another branch', async () => {
    const { api } = fakeApi((command) => command.startsWith('git -C') ? { stdout: 'main\n' } : undefined);

    await expect(ensureFlyWorkspace(MACHINE, 'overdeck', 'PAN-4734', { api })).rejects.toMatchObject({
      code: 'workspace-failed',
      message: expect.stringContaining('is on main, not feature/pan-4734'),
    });
  });

  it('fails before any exec for an invalid issue id or project key', async () => {
    const { api } = fakeApi(() => undefined);

    await expect(ensureFlyWorkspace(MACHINE, 'overdeck', 'PAN-1; rm -rf /', { api })).rejects.toMatchObject({ code: 'workspace-failed' });
    await expect(ensureFlyWorkspace(MACHINE, '../etc', 'PAN-1', { api })).rejects.toMatchObject({ code: 'workspace-failed' });
    expect(api.execCommand).not.toHaveBeenCalled();
  });
});
