import type { spawn as spawnType } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureLocalDashboard,
  LocalDashboardError,
  type LocalDashboardDeps,
} from '../../../../src/cli/commands/sharing/local-dashboard.js';
import { _resetInternalTokenCacheForTests } from '../../../../src/lib/internal-token.js';

const PID = 4242;

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: { detached?: boolean; cwd?: string; env?: NodeJS.ProcessEnv };
}

function fakeSpawn(onChild: (child: EventEmitter) => void = () => {}) {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: readonly string[], options: SpawnCall['options']) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { pid: PID, unref: vi.fn() });
    onChild(child);
    return child;
  };
  return { spawn: spawn as unknown as typeof spawnType, calls };
}

const refusedFetch = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

let root: string;
let home: string;
let savedHome: string | undefined;
let savedDashboardUrl: string | undefined;
let savedOverdeckDashboardUrl: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-local-dashboard-root-'));
  home = mkdtempSync(join(tmpdir(), 'pan-local-dashboard-home-'));
  mkdirSync(join(root, 'dist', 'dashboard', 'public'), { recursive: true });
  writeFileSync(join(root, 'dist', 'dashboard', 'server.js'), '');
  writeFileSync(join(root, 'dist', 'dashboard', 'public', 'index.html'), '');

  savedHome = process.env.OVERDECK_HOME;
  savedDashboardUrl = process.env.DASHBOARD_URL;
  savedOverdeckDashboardUrl = process.env.OVERDECK_DASHBOARD_URL;
  process.env.OVERDECK_HOME = home;
  _resetInternalTokenCacheForTests();

  vi.useFakeTimers();
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  vi.useRealTimers();
  restoreEnv('OVERDECK_HOME', savedHome);
  restoreEnv('DASHBOARD_URL', savedDashboardUrl);
  restoreEnv('OVERDECK_DASHBOARD_URL', savedOverdeckDashboardUrl);
  _resetInternalTokenCacheForTests();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function deps(overrides: Partial<LocalDashboardDeps>): LocalDashboardDeps {
  return {
    apiUrl: () => 'http://localhost:4567',
    packageRoot: root,
    waitForHealth: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('ensureLocalDashboard', () => {
  it('reports a running dashboard without spawning when health answers 200', async () => {
    const { spawn, calls } = fakeSpawn();
    const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof globalThis.fetch;

    const result = await ensureLocalDashboard(deps({ fetch, spawn }));

    expect(result).toEqual({ apiUrl: 'http://localhost:4567', started: false, pid: null });
    expect(calls).toHaveLength(0);
  });

  it('treats a 503 health answer as running and spawns nothing', async () => {
    const { spawn, calls } = fakeSpawn();
    const fetch = (() => Promise.resolve(new Response('{}', { status: 503 }))) as unknown as typeof globalThis.fetch;

    const result = await ensureLocalDashboard(deps({ fetch, spawn }));

    expect(result.started).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('starts the bundled server detached on the API port when nothing answers', async () => {
    process.env.DASHBOARD_URL = 'https://overdeck.localhost';
    process.env.OVERDECK_DASHBOARD_URL = 'https://overdeck.localhost';
    const { spawn, calls } = fakeSpawn();
    const waitForHealth = vi.fn(() => Promise.resolve());

    const result = await ensureLocalDashboard(deps({ fetch: refusedFetch, spawn, waitForHealth }));

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.command).toBe(process.execPath);
    expect(call.args).toEqual([join(root, 'dist', 'dashboard', 'server.js')]);
    expect(call.options.detached).toBe(true);
    expect(call.options.cwd).toBe(home);
    const env = call.options.env!;
    expect(env.PORT).toBe('4567');
    expect(env.API_PORT).toBe('4567');
    expect(env.OVERDECK_MODE).toBe('production');
    expect(env.OVERDECK_NO_RESUME).toBe('1');
    expect('DASHBOARD_URL' in env).toBe(false);
    expect('OVERDECK_DASHBOARD_URL' in env).toBe(false);
    expect(waitForHealth).toHaveBeenCalledWith(4567, PID);
    expect(result).toEqual({ apiUrl: 'http://localhost:4567', started: true, pid: PID });
  });

  it('aborts a probe that never settles after the probe timeout and spawns', async () => {
    const { spawn, calls } = fakeSpawn();
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof globalThis.fetch;

    const pending = ensureLocalDashboard(deps({ fetch, spawn }));
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;

    expect(calls).toHaveLength(1);
    expect(result.started).toBe(true);
  });

  it('refuses to auto-start a non-loopback URL and names pan up', async () => {
    const { spawn, calls } = fakeSpawn();

    const attempt = ensureLocalDashboard(deps({ apiUrl: () => 'https://overdeck.localhost', fetch: refusedFetch, spawn }));

    await expect(attempt).rejects.toBeInstanceOf(LocalDashboardError);
    await expect(attempt).rejects.toThrow('pan up');
    expect(calls).toHaveLength(0);
  });

  it('fails with a clear message when the bundle is missing', async () => {
    rmSync(join(root, 'dist', 'dashboard', 'server.js'));
    const { spawn, calls } = fakeSpawn();

    await expect(ensureLocalDashboard(deps({ fetch: refusedFetch, spawn }))).rejects.toThrow('Dashboard bundle not found');
    expect(calls).toHaveLength(0);
  });

  it('fails when the child exits before the dashboard is ready', async () => {
    const { spawn } = fakeSpawn((child) => {
      queueMicrotask(() => child.emit('exit', 1, null));
    });
    const waitForHealth = vi.fn(() => new Promise<void>(() => {}));

    const attempt = ensureLocalDashboard(deps({ fetch: refusedFetch, spawn, waitForHealth }));

    await expect(attempt).rejects.toThrow('exited with code 1');
    await expect(attempt).rejects.toThrow('dashboard.log');
  });
});
