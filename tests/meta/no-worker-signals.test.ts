import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createWorkerSignalGuard, installWorkerSignalGuard } from '../setup/worker-signal-guard.js';

const WORKER_PID = 1001;
const PARENT_PID = 1000;
const PROTECTED_PIDS = [WORKER_PID, PARENT_PID, 0, -1, -WORKER_PID, -PARENT_PID];

describe('createWorkerSignalGuard', () => {
  it('refuses a non-zero signal to a protected PID and never calls the wrapped kill', () => {
    const fakeKill = vi.fn(() => true);
    const guard = createWorkerSignalGuard({ kill: fakeKill, protectedPids: PROTECTED_PIDS });

    expect(() => guard.kill(WORKER_PID, 'SIGTERM')).toThrow('[test-guard]');
    expect(() => guard.kill(PARENT_PID, 'SIGKILL')).toThrow('[test-guard]');
    expect(() => guard.kill(0, 'SIGTERM')).toThrow('[test-guard]');
    expect(() => guard.kill(-1, 'SIGTERM')).toThrow('[test-guard]');
    expect(() => guard.kill(WORKER_PID)).toThrow('[test-guard]');
    expect(fakeKill).not.toHaveBeenCalled();
  });

  it('passes through signal 0 and a foreign PID', () => {
    const fakeKill = vi.fn(() => true);
    const guard = createWorkerSignalGuard({ kill: fakeKill, protectedPids: PROTECTED_PIDS });

    expect(guard.kill(WORKER_PID, 0)).toBe(true);
    expect(guard.kill(4242, 'SIGTERM')).toBe(true);
    expect(fakeKill).toHaveBeenCalledWith(WORKER_PID, 0);
    expect(fakeKill).toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(guard.drainRefusals()).toEqual([]);
  });

  it('fails the hook when a refusal is swallowed by the code under test', () => {
    const fakeKill = vi.fn(() => true);
    const guard = createWorkerSignalGuard({ kill: fakeKill, protectedPids: PROTECTED_PIDS });

    try {
      guard.kill(WORKER_PID, 'SIGTERM');
    } catch {
      // swallowed, like code that catches process.kill failures
    }

    expect(() => guard.assertNoPendingRefusals()).toThrow('[test-guard]');
    expect(() => guard.assertNoPendingRefusals()).not.toThrow();
  });
});

describe('installWorkerSignalGuard', () => {
  it('installs once per target and registers exactly one hook that fails on a swallowed refusal', () => {
    const fakeKill = vi.fn(() => true);
    const target = { pid: WORKER_PID, ppid: PARENT_PID, kill: fakeKill };
    const hooks: Array<() => void> = [];

    const first = installWorkerSignalGuard(target, (hook) => hooks.push(hook));
    const second = installWorkerSignalGuard(target, (hook) => hooks.push(hook));

    expect(second).toBe(first);
    expect(hooks.length).toBe(1);

    try {
      target.kill(WORKER_PID, 'SIGTERM');
    } catch {
      // swallowed
    }

    expect(() => hooks[0]()).toThrow('[test-guard]');
  });
});

describe('no-worker-signals.ts installed on the real process', () => {
  it('replaces process.kill with the installed guard', () => {
    const guard = (process as unknown as Record<symbol, { kill: unknown }>)[
      Symbol.for('overdeck.test.noWorkerSignals')
    ];
    expect(guard).toBeDefined();
    expect(process.kill).toBe(guard.kill);
  });

  it('allows signal 0 to the real process', () => {
    expect(process.kill(process.pid, 0)).toBe(true);
  });

  it('allows SIGTERM to a spawned child', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const exit = new Promise<{ signal: string | null }>((resolve) => {
      child.on('exit', (_code, signal) => resolve({ signal }));
    });

    process.kill(child.pid!, 'SIGTERM');

    const { signal } = await exit;
    expect(signal).toBe('SIGTERM');
  });
});
