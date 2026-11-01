/**
 * PAN-4652 WI-9: ensureFlyProject clones a GitHub project onto the Fly machine
 * detached and polls for it (fake timers); a non-GitHub project fails before
 * any exec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../../projects.js';
import type { FlyExecResult } from '../../../remote/fly-api.js';
import { ensureFlyProject } from '../project.js';

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
});
