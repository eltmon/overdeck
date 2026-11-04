import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TailscaleCli } from '../../../../src/lib/tailscale/cli.js';
import {
  LOGIN_CHILD_MAX_MS,
  LOGIN_URL_TIMEOUT_MS,
  startTailscaleLogin,
  type LoginChild,
} from '../../../../src/lib/tailscale/login.js';
import type { TailscaleState } from '../../../../src/lib/tailscale/state.js';

const CLI: TailscaleCli = { bin: '/usr/bin/tailscale', mode: 'system', baseArgs: [] };

function state(backendState: string, cli: TailscaleCli | null = CLI): TailscaleState {
  return { cli, backendState } as TailscaleState;
}

class FakeChild extends EventEmitter implements LoginChild {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null));
    return true;
  }
}

function fakeSpawn() {
  const children: FakeChild[] = [];
  const spawn = vi.fn((_bin: string, _args: string[]) => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  return { spawn, children };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
});

/** End any child a test left running so the shared login slot is free. */
async function exitAll(children: FakeChild[]) {
  for (const child of children) child.emit('exit', 0);
  await Promise.resolve();
}

describe('startTailscaleLogin', () => {
  it('resolves with the URL printed on stderr and keeps the child running', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stderr.emit('data', Buffer.from('\nTo authenticate, visit:\n\thttps://login.tailscale.com/a/abc\n'));
    expect(await pending).toEqual({ authUrl: 'https://login.tailscale.com/a/abc' });
    expect(spawn).toHaveBeenCalledWith('/usr/bin/tailscale', ['login']);
    expect(children[0].killed).toBe(false);
    await exitAll(children);
  });

  it('times out after 15 s with no URL and kills the child', async () => {
    const { spawn, children } = fakeSpawn();
    let settled = false;
    const pending = startTailscaleLogin(state('NeedsLogin'), { spawn }).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(LOGIN_URL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ error: 'timeout' });
    expect(children[0].killed).toBe(true);
  });

  it('maps access-denied output to access-denied', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stderr.emit('data', 'Access denied: prefs write access denied\n');
    expect(await pending).toEqual({ error: 'access-denied', message: 'Access denied: prefs write access denied' });
    expect(children[0].killed).toBe(true);
    await Promise.resolve();
  });

  it('shares one child between concurrent callers', async () => {
    const { spawn, children } = fakeSpawn();
    const first = startTailscaleLogin(state('NeedsLogin'), { spawn });
    const second = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stdout.emit('data', 'https://login.tailscale.com/a/shared\n');
    expect(await first).toEqual({ authUrl: 'https://login.tailscale.com/a/shared' });
    expect(await second).toEqual({ authUrl: 'https://login.tailscale.com/a/shared' });
    // A caller after the URL arrived, while the child still runs, gets the same URL.
    expect(await startTailscaleLogin(state('NeedsLogin'), { spawn })).toEqual({ authUrl: 'https://login.tailscale.com/a/shared' });
    expect(spawn).toHaveBeenCalledTimes(1);
    await exitAll(children);
  });

  it('starts a fresh child after the previous one exits', async () => {
    const { spawn, children } = fakeSpawn();
    const first = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stderr.emit('data', 'https://login.tailscale.com/a/one\n');
    await first;
    await exitAll(children);
    const second = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[1].stderr.emit('data', 'https://login.tailscale.com/a/two\n');
    expect(await second).toEqual({ authUrl: 'https://login.tailscale.com/a/two' });
    expect(spawn).toHaveBeenCalledTimes(2);
    await exitAll(children);
  });

  it('runs up when the backend is Stopped and resolves null when it exits 0 with no URL', async () => {
    const { spawn, children } = fakeSpawn();
    const userspace: TailscaleCli = { bin: '/h/bin/tailscale', mode: 'userspace', baseArgs: ['--socket=/h/s.sock'] };
    const pending = startTailscaleLogin(state('Stopped', userspace), { spawn });
    expect(spawn).toHaveBeenCalledWith('/h/bin/tailscale', ['--socket=/h/s.sock', 'up']);
    children[0].emit('exit', 0);
    expect(await pending).toEqual({ authUrl: null });
  });

  it('reports a non-zero exit with no URL as failed', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stderr.emit('data', 'backend error: boom\n');
    children[0].emit('exit', 1);
    expect(await pending).toEqual({ error: 'failed', message: 'backend error: boom' });
  });

  it('kills a child still running after 10 minutes', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stderr.emit('data', 'https://login.tailscale.com/a/slow\n');
    await pending;
    await vi.advanceTimersByTimeAsync(LOGIN_CHILD_MAX_MS - 1);
    expect(children[0].killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0].killed).toBe(true);
  });

  it('fails without spawning when Tailscale is not installed', async () => {
    const { spawn } = fakeSpawn();
    expect(await startTailscaleLogin(state('NeedsLogin', null), { spawn })).toMatchObject({ error: 'failed' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('frees the slot when spawn throws', async () => {
    const throwing = vi.fn(() => { throw new Error('spawn EACCES'); });
    expect(await startTailscaleLogin(state('NeedsLogin'), { spawn: throwing })).toEqual({ error: 'failed', message: 'spawn EACCES' });
    const { spawn, children } = fakeSpawn();
    const next = startTailscaleLogin(state('NeedsLogin'), { spawn });
    children[0].stderr.emit('data', 'https://login.tailscale.com/a/after\n');
    expect(await next).toEqual({ authUrl: 'https://login.tailscale.com/a/after' });
    await exitAll(children);
  });
});
