import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnPanCommandDetached } from '../../../dashboard/server/routes/agents/shared.js';
import {
  launchPanCommandDetached,
  runDetachedCommand,
} from '../detached.js';

function createChild() {
  const child = new EventEmitter() as ChildProcess;
  child.pid = 4242;
  child.unref = vi.fn(() => child);
  return child;
}

async function emitSpawnWhenReady(
  spawnPanCli: ReturnType<typeof vi.fn>,
  child: ChildProcess,
): Promise<void> {
  await vi.waitFor(() => expect(spawnPanCli).toHaveBeenCalled());
  child.emit('spawn');
}

describe('detached composer command execution', () => {
  let overdeckHome: string;

  beforeEach(async () => {
    overdeckHome = await mkdtemp(join(tmpdir(), 'pan-1525-detached-'));
  });

  afterEach(async () => {
    await rm(overdeckHome, { recursive: true, force: true });
  });

  it('returns an accepted tracked activity after the detached child spawns', async () => {
    const child = createChild();
    const spawnPanCli = vi.fn(() => child);
    const resultPromise = runDetachedCommand(['start', 'PAN-42'], {
      now: () => 1234,
      overdeckHome,
      spawnPanCli,
    });

    await emitSpawnWhenReady(spawnPanCli, child);
    await expect(resultPromise).resolves.toEqual({
      kind: 'activity',
      status: 'accepted',
      command: '/pan start PAN-42',
      activityId: 'activity-1234',
      message: 'Started /pan start PAN-42 for PAN-42. Watch activity activity-1234 or the PAN-42 issue view for progress.',
    });
    expect(child.unref).toHaveBeenCalled();
    expect(spawnPanCli).toHaveBeenCalledWith(['start', 'PAN-42'], expect.objectContaining({
      detached: true,
      stdio: ['ignore', expect.any(Number), expect.any(Number)],
    }));
    expect(spawnPanCli.mock.calls[0][0]).not.toContain('--model');
    expect(spawnPanCli.mock.calls[0][0]).not.toContain('--harness');

    child.emit('close', 0, null);
  });

  it('forwards plan argv without injecting provider-routing flags', async () => {
    const child = createChild();
    const spawnPanCli = vi.fn(() => child);
    const resultPromise = runDetachedCommand(['plan', 'PAN-42', '--auto'], {
      now: () => 5678,
      overdeckHome,
      spawnPanCli,
    });

    await emitSpawnWhenReady(spawnPanCli, child);
    await resultPromise;
    expect(spawnPanCli.mock.calls[0][0]).toEqual(['plan', 'PAN-42', '--auto']);
    child.emit('close', 0, null);
  });

  it.each([
    ['start', '../../../escaped'],
    ['start', '/tmp/escaped'],
    ['start', 'PAN-42/../../escaped'],
    ['start', '..\\..\\escaped'],
    ['plan', '../../../escaped'],
    ['plan', '/tmp/escaped'],
    ['plan', 'PAN-42/../../escaped'],
    ['plan', '..\\..\\escaped'],
  ])('rejects /pan %s issue path traversal before filesystem access or spawn', async (command, issueId) => {
    const spawnPanCli = vi.fn();

    await expect(runDetachedCommand([command, issueId], {
      overdeckHome,
      spawnPanCli,
    })).resolves.toEqual({
      kind: 'terminal-only',
      status: 'rejected',
      message: `/pan ${command} requires a canonical issue ID such as PAN-1525.`,
    });

    expect(spawnPanCli).not.toHaveBeenCalled();
    await expect(access(join(overdeckHome, 'agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an unsafe agent session name at the detached launcher boundary', async () => {
    const spawnPanCli = vi.fn();

    await expect(launchPanCommandDetached({
      agentSessionName: '../escaped',
      issueId: 'PAN-42',
      role: 'work',
      workspacePath: '/tmp/pan-42',
      args: ['start', 'PAN-42'],
    }, {
      overdeckHome,
      spawnPanCli,
    })).rejects.toThrow('Agent ID must be a single filesystem-safe path segment.');

    expect(spawnPanCli).not.toHaveBeenCalled();
    await expect(access(join(overdeckHome, 'agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the route helper contract by awaiting successful completion', async () => {
    const child = createChild();
    const spawnPanCli = vi.fn(() => child);
    const resultPromise = spawnPanCommandDetached({
      agentSessionName: 'agent-pan-42',
      issueId: 'PAN-42',
      role: 'work',
      workspacePath: '/tmp/pan-42',
      args: ['start', 'PAN-42'],
    }, {
      now: () => 9999,
      overdeckHome,
      spawnPanCli,
    });

    await emitSpawnWhenReady(spawnPanCli, child);
    let resolved = false;
    void resultPromise.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    child.emit('close', 0, null);
    await expect(resultPromise).resolves.toBe('activity-9999');
  });

  it('preserves non-zero route failures with captured spawn-log output', async () => {
    const child = createChild();
    const spawnPanCli = vi.fn(() => child);
    const launchPromise = launchPanCommandDetached({
      agentSessionName: 'agent-pan-42',
      issueId: 'PAN-42',
      role: 'work',
      workspacePath: '/tmp/pan-42',
      args: ['start', 'PAN-42'],
    }, {
      now: () => 7777,
      overdeckHome,
      spawnPanCli,
    });

    await emitSpawnWhenReady(spawnPanCli, child);
    const launch = await launchPromise;
    child.emit('close', 2, null);

    await expect(launch.completion).rejects.toMatchObject({
      activityId: 'activity-7777',
      code: 2,
    });
    expect(await readFile(join(overdeckHome, 'agents', 'agent-pan-42', 'lifecycle.log'), 'utf8'))
      .toContain('agent.work_spawn_process_closed');
  });
});
