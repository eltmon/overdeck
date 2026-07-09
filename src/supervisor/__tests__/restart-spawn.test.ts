import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import {
  buildSupervisorRestartArgs,
  createSupervisorRestartSpawner,
  resolveBundledPanInvocation,
} from '../restart-spawn.js';

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  unref = vi.fn();
}

describe('supervisor restart spawner', () => {
  it('resolves the bundled pan CLI without relying on daemon PATH', () => {
    const invocation = resolveBundledPanInvocation('file:///opt/overdeck/dist/supervisor/restart-spawn.js');

    expect(invocation).toEqual({
      panBinary: process.execPath,
      panArgsPrefix: ['/opt/overdeck/dist/cli/index.js'],
    });
  });

  it('spawns pan restart --dashboard with a 120s health timeout', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as never);
    const spawnRestart = createSupervisorRestartSpawner({
      panBinary: 'pan',
      log: vi.fn(),
      spawnFn: spawnFn as never,
    });

    const result = await spawnRestart({ restartLockHeld: true, bootId: 'boot-test' });

    expect(result).toMatchObject({ pid: 4242, error: null });
    expect(spawnFn).toHaveBeenCalledWith('pan', buildSupervisorRestartArgs(), expect.objectContaining({
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: expect.objectContaining({
        OVERDECK_RESTART_LOCK_HELD: '1',
        OVERDECK_SKIP_SUPERVISOR_CYCLE: '1',
        OVERDECK_BOOT_ID: 'boot-test',
      }),
    }));
    expect(buildSupervisorRestartArgs()).toEqual([
      'restart',
      '--dashboard',
      '--health-timeout',
      '120000',
    ]);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('logs captured child stderr when restart exits nonzero', async () => {
    const child = new FakeChild();
    const log = vi.fn();
    const spawnRestart = createSupervisorRestartSpawner({
      panBinary: 'pan',
      log,
      spawnFn: vi.fn(() => child as never) as never,
    });

    const result = await spawnRestart({ restartLockHeld: true });
    child.stderr.write('health check did not pass within 15000ms\n');
    child.emit('close', 1, null);

    await expect(result.done).rejects.toThrow('pan restart --dashboard exited 1');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('health check did not pass within 15000ms'));
  });

  it('reports a held restart lock without spawning another restart', async () => {
    const spawnFn = vi.fn();
    const spawnRestart = createSupervisorRestartSpawner({
      panBinary: 'pan',
      log: vi.fn(),
      spawnFn: spawnFn as never,
      acquireRestartLockFn: (() => Effect.succeed(null)) as never,
      readRestartLockHolderFn: (() => Effect.succeed({ pid: 123, ts: Date.now(), caller: 'pan reload' })) as never,
    });

    await expect(spawnRestart()).resolves.toEqual({
      pid: null,
      error: 'restart in progress (held by PID 123 (pan reload))',
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
