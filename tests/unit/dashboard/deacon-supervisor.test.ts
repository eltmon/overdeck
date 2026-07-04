import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDeaconSupervisor } from '../../../src/dashboard/server/services/deacon-supervisor.js';

function fakeChild(pid: number) {
  const emitter = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    connected: boolean;
    send: ReturnType<typeof vi.fn>;
  };
  emitter.pid = pid;
  emitter.killed = false;
  emitter.connected = true;
  emitter.send = vi.fn();
  return emitter;
}

describe('deacon supervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('spawns the deacon child with OVERDECK_DISABLE_DEACON removed', async () => {
    const child = fakeChild(101);
    const fork = vi.fn(() => child as never);
    const supervisor = createDeaconSupervisor({
      fork,
      scriptPath: '/dist/dashboard/deacon.js',
      env: {
        OVERDECK_DISABLE_DEACON: '1',
        API_PORT: '3999',
      },
      readState: () => ({ running: false }),
    });

    await expect(supervisor.startDeaconChild()).resolves.toBe(true);

    expect(fork).toHaveBeenCalledWith('/dist/dashboard/deacon.js', [], expect.objectContaining({
      env: expect.objectContaining({
        API_PORT: '3999',
        OVERDECK_INTERNAL_DASHBOARD_URL: 'http://127.0.0.1:3999',
      }),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    }));
    expect(fork.mock.calls[0]?.[2]?.env).not.toHaveProperty('OVERDECK_DISABLE_DEACON');
    expect(supervisor.isChildRunning()).toBe(true);
  });

  it('does not spawn when a live foreign Cloister pid holds the lock', async () => {
    const fork = vi.fn();
    const emit = vi.fn();
    const supervisor = createDeaconSupervisor({
      fork: fork as never,
      emitActivity: emit,
      readState: () => ({ running: true, pid: 202, startedAt: new Date().toISOString() }),
    });

    await expect(supervisor.startDeaconChild()).resolves.toBe(false);

    expect(fork).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringContaining('pid 202'),
    }));
  });

  it('restarts exited children and gives up after the max restart window', async () => {
    const children = [fakeChild(1), fakeChild(2), fakeChild(3)];
    const fork = vi.fn(() => {
      const child = children.shift();
      if (!child) throw new Error('unexpected spawn');
      return child as never;
    });
    const emit = vi.fn();
    const supervisor = createDeaconSupervisor({
      fork,
      emitActivity: emit,
      readState: () => ({ running: false }),
      now: () => Date.now(),
      maxRestarts: 2,
      restartWindowMs: 60_000,
      restartDelayMs: 1_000,
    });

    await supervisor.startDeaconChild();
    expect(fork).toHaveBeenCalledTimes(1);

    const first = fork.mock.results[0]?.value as ReturnType<typeof fakeChild>;
    first.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fork).toHaveBeenCalledTimes(2);

    const second = fork.mock.results[1]?.value as ReturnType<typeof fakeChild>;
    second.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fork).toHaveBeenCalledTimes(3);

    const third = fork.mock.results[2]?.value as ReturnType<typeof fakeChild>;
    third.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fork).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('gave up'),
    }));
  });

  it('stops with SIGTERM and escalates to SIGKILL after the grace window', async () => {
    const child = fakeChild(303);
    const killPid = vi.fn();
    const supervisor = createDeaconSupervisor({
      fork: vi.fn(() => child as never),
      killPid,
      readState: () => ({ running: false }),
      shutdownGraceMs: 10_000,
    });
    await supervisor.startDeaconChild();

    const stopPromise = supervisor.stopDeaconChild();
    expect(killPid).toHaveBeenCalledWith(303, 'SIGTERM');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(killPid).toHaveBeenCalledWith(303, 'SIGKILL');

    child.emit('exit', null, 'SIGKILL');
    await stopPromise;
    expect(supervisor.isChildRunning()).toBe(false);
  });

  it('sends an on-demand patrol IPC message only while connected', async () => {
    const child = fakeChild(404);
    const supervisor = createDeaconSupervisor({
      fork: vi.fn(() => child as never),
      readState: () => ({ running: false }),
    });
    await supervisor.startDeaconChild();

    expect(supervisor.sendPatrolNow()).toBe(true);
    expect(child.send).toHaveBeenCalledWith({ type: 'patrol' });

    child.connected = false;
    expect(supervisor.sendPatrolNow()).toBe(false);
  });

  it('sends a config reload IPC message only while connected', async () => {
    const child = fakeChild(405);
    const supervisor = createDeaconSupervisor({
      fork: vi.fn(() => child as never),
      readState: () => ({ running: false }),
    });
    await supervisor.startDeaconChild();

    expect(supervisor.reloadConfig()).toBe(true);
    expect(child.send).toHaveBeenCalledWith({ type: 'reload-config' });

    child.connected = false;
    expect(supervisor.reloadConfig()).toBe(false);
  });
});
