/**
 * PAN-4404 WI-5: runSshCommand — argv from target.ts, output capture, and the
 * timeout that kills the child and rejects with `unreachable`.
 */
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSshCommand, type SpawnFn } from '../run.js';

class FakeSsh extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal;
    return true;
  });
}

function fakeSpawn(child: FakeSsh): { spawnFn: SpawnFn; calls: Array<{ cmd: string; argv: string[] }> } {
  const calls: Array<{ cmd: string; argv: string[] }> = [];
  const spawnFn = ((cmd: string, argv: string[]) => {
    calls.push({ cmd, argv });
    return child;
  }) as unknown as SpawnFn;
  return { spawnFn, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runSshCommand', () => {
  it('spawns ssh with the command argv and resolves with exit code and output', async () => {
    const child = new FakeSsh();
    const { spawnFn, calls } = fakeSpawn(child);
    const pending = runSshCommand('desk', 'CMD', { timeoutMs: 20_000 }, spawnFn);
    child.stdout.emit('data', Buffer.from('banner\n0.72.0\n'));
    child.stderr.emit('data', Buffer.from('warning\n'));
    child.emit('close', 0);
    expect(await pending).toEqual({ exitCode: 0, stdout: 'banner\n0.72.0\n', stderr: 'warning\n' });
    expect(calls).toEqual([
      {
        cmd: 'ssh',
        argv: ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '--', 'desk', 'CMD'],
      },
    ]);
  });

  it('kills the child and rejects unreachable at the timeout', async () => {
    const child = new FakeSsh();
    const { spawnFn } = fakeSpawn(child);
    const pending = runSshCommand('desk', 'CMD', { timeoutMs: 20_000 }, spawnFn);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'unreachable' });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects a bad destination before spawning', async () => {
    const child = new FakeSsh();
    const { spawnFn, calls } = fakeSpawn(child);
    expect(() => runSshCommand('-oProxyCommand=x', 'CMD', { timeoutMs: 1_000 }, spawnFn)).toThrow();
    expect(calls).toEqual([]);
  });
});
