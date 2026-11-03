/**
 * PAN-4404 WI-4: the remote SSH helper — adopt or start (D-4404-7), pairing,
 * the remote lock, and the stop rule (D-4404-8), and the supervisor stop
 * (D-4861-1). Fake timers and an in-memory file system; no real process,
 * port or file is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type HelperDeps,
  type HelperFs,
  LOCK_WAIT_MS,
  type PanUpResult,
  runHelperStart,
  runHelperStop,
  STOP_GRACE_MS,
  SUPERVISOR_STOP_WAIT_MS,
} from '../helper.js';

const HOME = '/home/me/.overdeck';
const LOCK = `${HOME}/ssh-launch/lock`;
const MARKER = `${HOME}/ssh-launch/server.json`;
const LINKER = '0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ENV = { environmentId: '9c0e7a52-1111-4222-8333-444455556666', label: 'desk', serverVersion: '0.72.0' };

interface MemFs extends HelperFs {
  files: Map<string, { data: string; mode: number }>;
  dirs: Map<string, number>;
}

function memFs(): MemFs {
  const files = new Map<string, { data: string; mode: number }>();
  const dirs = new Map<string, number>();
  const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    files,
    dirs,
    readFile: async (path) => {
      const file = files.get(path);
      if (!file) throw enoent();
      return file.data;
    },
    writeFile: async (path, data, mode) => {
      files.set(path, { data, mode });
    },
    mkdir: async (path, opts) => {
      if (dirs.has(path)) {
        if (opts.recursive) return undefined;
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      dirs.set(path, Date.now());
      return undefined;
    },
    rmdir: async (path) => {
      if (!dirs.delete(path)) throw enoent();
    },
    unlink: async (path) => {
      if (!files.delete(path)) throw enoent();
    },
    stat: async (path) => {
      const mtimeMs = dirs.get(path);
      if (mtimeMs === undefined) throw enoent();
      return { mtimeMs };
    },
  };
}

interface Server {
  /** pid that /api/health reports, or null when nothing answers. */
  healthPid: number | null;
  inbound: Array<{ environmentId: string }>;
  pairingStatus: number;
  machinesStatus: number;
  supervisorRunning: boolean;
  supervisorStoppable: boolean;
  /** When `supervisorRunning`, whether the supervisor port answers `ok: true` (vs. some other program). */
  supervisorAnswerOk: boolean;
}

interface Harness {
  deps: HelperDeps;
  fs: MemFs;
  server: Server;
  requests: Array<{ url: string; method: string; token?: string }>;
  spawnPanUp: ReturnType<typeof vi.fn<() => Promise<PanUpResult>>>;
  kill: ReturnType<typeof vi.fn<(pid: number, signal: NodeJS.Signals) => void>>;
  stopSupervisor: ReturnType<typeof vi.fn<() => Promise<void>>>;
  alive: Set<number>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(server: Partial<Server> = {}): Harness {
  const fs = memFs();
  const state: Server = {
    healthPid: 4242,
    inbound: [{ environmentId: LINKER }],
    pairingStatus: 200,
    machinesStatus: 200,
    supervisorRunning: false,
    supervisorStoppable: true,
    supervisorAnswerOk: true,
    ...server,
  };
  const requests: Harness['requests'] = [];
  const alive = new Set<number>();
  if (state.healthPid !== null) alive.add(state.healthPid);
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url, method: init?.method ?? 'GET', token: headers['x-overdeck-internal-token'] });
    if (url.startsWith('http://127.0.0.1:3012/health')) {
      if (!state.supervisorRunning) throw new TypeError('fetch failed');
      return state.supervisorAnswerOk ? json({ ok: true, port: 3012 }) : json({ hello: 'world' });
    }
    if (state.healthPid === null) throw new TypeError('fetch failed');
    if (url.endsWith('/api/health')) return json({ status: 'ok', pid: state.healthPid });
    if (url.endsWith('/api/environment')) return json(ENV);
    if (url.endsWith('/api/pairing/credentials')) {
      return state.pairingStatus === 200
        ? json({ credential: 'odp_secret', expiresAt: '2026-11-01T00:10:00.000Z' })
        : json({ error: 'nope' }, state.pairingStatus);
    }
    if (url.endsWith('/api/machines')) return json({ inbound: state.inbound }, state.machinesStatus);
    return json({ error: 'not found' }, 404);
  });
  const spawnPanUp = vi.fn(async (): Promise<PanUpResult> => ({ exitCode: 0, output: ['starting', 'ready'] }));
  const kill = vi.fn((_pid: number, _signal: NodeJS.Signals) => undefined);
  const stopSupervisor = vi.fn(async () => {
    if (state.supervisorStoppable) state.supervisorRunning = false;
  });
  const deps: HelperDeps = {
    fetch: fetchFn as unknown as typeof fetch,
    spawnPanUp,
    kill,
    isAlive: (pid) => alive.has(pid),
    fs,
    now: () => Date.now(),
    overdeckHome: HOME,
    apiPort: 3011,
    internalToken: () => 'internal-token',
    panVersion: '0.72.0',
    supervisorPort: 3012,
    stopSupervisor,
  };
  return { deps, fs, server: state, requests, spawnPanUp, kill, stopSupervisor, alive };
}

/**
 * Models the real supervisor restarting the dashboard: when the dashboard
 * pid is killed, it goes down, and if the supervisor is still running it
 * comes back (with a new pid) 30 s later — the restart the fix must beat.
 */
function restartingSupervisor(h: Harness): void {
  h.kill.mockImplementation((pid) => {
    h.alive.delete(pid);
    h.server.healthPid = null;
    if (h.server.supervisorRunning) {
      setTimeout(() => {
        h.server.healthPid = 5151;
        h.alive.add(5151);
      }, 30_000);
    }
  });
}

function writeMarker(h: Harness, marker: Record<string, unknown>): void {
  h.fs.files.set(MARKER, {
    data: JSON.stringify({ v: 1, apiPort: 3011, version: '0.72.0', startedAt: '2026-11-01T00:00:00.000Z', ...marker }),
    mode: 0o600,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ssh-helper start (D-4404-7)', () => {
  it('adopts a running dashboard without a marker as external and mints a pairing credential', async () => {
    const h = harness();
    const result = await runHelperStart({ linker: LINKER, pair: true }, h.deps);
    expect(result).toEqual({
      v: 1,
      ok: true,
      op: 'start',
      launch: 'external',
      apiPort: 3011,
      ...ENV,
      panVersion: '0.72.0',
      pairing: { credential: 'odp_secret', expiresAt: '2026-11-01T00:10:00.000Z' },
    });
    expect(h.spawnPanUp).not.toHaveBeenCalled();
    const pairing = h.requests.find((r) => r.url.endsWith('/api/pairing/credentials'));
    expect(pairing).toMatchObject({ method: 'POST', token: 'internal-token' });
    expect(h.fs.dirs.has(LOCK)).toBe(false);
  });

  it('reports managed when the marker names this linker and the health pid', async () => {
    const h = harness();
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    const result = await runHelperStart({ linker: LINKER, pair: true }, h.deps);
    expect(result).toMatchObject({ ok: true, launch: 'managed' });
  });

  it('reports external when another linker started it', async () => {
    const h = harness();
    writeMarker(h, { pid: 4242, startedBy: OTHER });
    expect(await runHelperStart({ linker: LINKER, pair: true }, h.deps)).toMatchObject({ ok: true, launch: 'external' });
    expect(h.fs.files.has(MARKER)).toBe(true);
  });

  it('deletes a marker whose pid differs from the health pid and reports external', async () => {
    const h = harness();
    writeMarker(h, { pid: 1111, startedBy: LINKER });
    expect(await runHelperStart({ linker: LINKER, pair: true }, h.deps)).toMatchObject({ ok: true, launch: 'external' });
    expect(h.fs.files.has(MARKER)).toBe(false);
  });

  it('starts pan up when nothing answers, writes a 0600 marker with the health pid and reports managed', async () => {
    const h = harness({ healthPid: null });
    h.spawnPanUp.mockImplementation(async () => {
      h.server.healthPid = 5150;
      return { exitCode: 0, output: [] };
    });
    const result = await runHelperStart({ linker: LINKER, pair: true }, h.deps);
    expect(result).toMatchObject({ ok: true, launch: 'managed', pairing: { credential: 'odp_secret' } });
    expect(h.spawnPanUp).toHaveBeenCalledTimes(1);
    const marker = h.fs.files.get(MARKER);
    expect(marker?.mode).toBe(0o600);
    expect(JSON.parse(marker!.data)).toEqual({
      v: 1,
      pid: 5150,
      apiPort: 3011,
      version: '0.72.0',
      startedAt: '2026-11-01T12:00:00.000Z',
      startedBy: LINKER,
    });
  });

  it('polls health after pan up exits and succeeds when the server comes up within 30 s', async () => {
    const h = harness({ healthPid: null });
    h.spawnPanUp.mockImplementation(async () => {
      setTimeout(() => {
        h.server.healthPid = 6000;
      }, 5_000);
      return { exitCode: 0, output: [] };
    });
    const pending = runHelperStart({ linker: LINKER, pair: false }, h.deps);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await pending).toMatchObject({ ok: true, launch: 'managed', pairing: null });
  });

  it('answers start-failed with the last output lines when no health follows pan up', async () => {
    const h = harness({ healthPid: null });
    const output = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).slice(-20);
    h.spawnPanUp.mockResolvedValue({ exitCode: 1, output });
    const pending = runHelperStart({ linker: LINKER, pair: true }, h.deps);
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: 'start-failed' });
    expect(result.ok === false && result.message).toContain('line 25');
    expect(result.ok === false && result.message).not.toContain('line 5\n');
    expect(h.fs.files.has(MARKER)).toBe(false);
    expect(h.fs.dirs.has(LOCK)).toBe(false);
  });

  it('with --no-pair returns pairing null and sends no pairing request', async () => {
    const h = harness();
    expect(await runHelperStart({ linker: LINKER, pair: false }, h.deps)).toMatchObject({ ok: true, pairing: null });
    expect(h.requests.some((r) => r.url.endsWith('/api/pairing/credentials'))).toBe(false);
  });

  it('maps a 401 pairing answer to token-rejected and another failure to pair-failed', async () => {
    expect(await runHelperStart({ linker: LINKER, pair: true }, harness({ pairingStatus: 401 }).deps)).toMatchObject({
      ok: false,
      error: 'token-rejected',
    });
    expect(await runHelperStart({ linker: LINKER, pair: true }, harness({ pairingStatus: 500 }).deps)).toMatchObject({
      ok: false,
      error: 'pair-failed',
    });
  });

  it('rejects a linker that is not a UUID', async () => {
    const h = harness();
    expect(await runHelperStart({ linker: 'nope', pair: true }, h.deps)).toMatchObject({ ok: false, error: 'bad-linker' });
    expect(h.requests).toEqual([]);
  });
});

describe('remote lock', () => {
  it('answers busy after 30 s when a fresh lock is held', async () => {
    const h = harness();
    h.fs.dirs.set(`${HOME}/ssh-launch`, Date.now());
    h.fs.dirs.set(LOCK, Date.now());
    const pending = runHelperStart({ linker: LINKER, pair: true }, h.deps);
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS + 1_000);
    expect(await pending).toMatchObject({ ok: false, error: 'busy' });
    expect(h.requests).toEqual([]);
    expect(h.fs.dirs.has(LOCK)).toBe(true);
  });

  it('gets the lock when the holder releases it while waiting', async () => {
    const h = harness();
    h.fs.dirs.set(`${HOME}/ssh-launch`, Date.now());
    h.fs.dirs.set(LOCK, Date.now());
    setTimeout(() => h.fs.dirs.delete(LOCK), 2_000);
    const pending = runHelperStart({ linker: LINKER, pair: true }, h.deps);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toMatchObject({ ok: true });
  });

  it('breaks a stale (200 s old) lock', async () => {
    const h = harness();
    h.fs.dirs.set(`${HOME}/ssh-launch`, Date.now());
    h.fs.dirs.set(LOCK, Date.now() - 200_000);
    expect(await runHelperStart({ linker: LINKER, pair: true }, h.deps)).toMatchObject({ ok: true });
    expect(h.fs.dirs.has(LOCK)).toBe(false);
  });
});

describe('ssh-helper stop (D-4404-8)', () => {
  it('case 1: nothing answers ⇒ not-running, marker deleted', async () => {
    const h = harness({ healthPid: null });
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toEqual({ v: 1, ok: true, op: 'stop', stopped: false, reason: 'not-running' });
    expect(h.fs.files.has(MARKER)).toBe(false);
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.stopSupervisor).not.toHaveBeenCalled();
  });

  it('case 2: no marker, or another linker ⇒ external', async () => {
    const h = harness();
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ stopped: false, reason: 'external' });
    writeMarker(h, { pid: 4242, startedBy: OTHER });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ stopped: false, reason: 'external' });
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.stopSupervisor).not.toHaveBeenCalled();
  });

  it('case 3: marker pid differs from the health pid ⇒ restarted, marker deleted', async () => {
    const h = harness();
    writeMarker(h, { pid: 1111, startedBy: LINKER });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ stopped: false, reason: 'restarted' });
    expect(h.fs.files.has(MARKER)).toBe(false);
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.stopSupervisor).not.toHaveBeenCalled();
  });

  it('case 4: another machine holds an active inbound link ⇒ in-use', async () => {
    const h = harness({ inbound: [{ environmentId: LINKER }, { environmentId: OTHER }] });
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ stopped: false, reason: 'in-use' });
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.stopSupervisor).not.toHaveBeenCalled();
    expect(h.requests.find((r) => r.url.endsWith('/api/machines'))?.token).toBe('internal-token');
  });

  it('case 5: SIGTERM, and the server exits ⇒ stopped, no SIGKILL', async () => {
    const h = harness();
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    h.kill.mockImplementation((pid) => {
      h.alive.delete(pid);
    });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ stopped: true, reason: 'stopped' });
    expect(h.kill.mock.calls).toEqual([[4242, 'SIGTERM']]);
    expect(h.fs.files.has(MARKER)).toBe(false);
  });

  it('case 5: SIGKILL after 10 s when the server is still alive', async () => {
    const h = harness();
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    const pending = runHelperStop({ linker: LINKER }, h.deps);
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 500);
    expect(h.kill.mock.calls).toEqual([[4242, 'SIGTERM']]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ stopped: true, reason: 'stopped' });
    expect(h.kill.mock.calls).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGKILL'],
    ]);
  });

  it('never signals when the machines list cannot be read', async () => {
    const h = harness({ machinesStatus: 500 });
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ ok: false, error: 'stop-failed' });
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.stopSupervisor).not.toHaveBeenCalled();
  });
});

describe('ssh-helper stop with a supervisor (D-4861-1)', () => {
  it('stops the supervisor before the dashboard, and nothing restarts it', async () => {
    const h = harness({ supervisorRunning: true, supervisorStoppable: true });
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    restartingSupervisor(h);
    const pending = runHelperStop({ linker: LINKER }, h.deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ stopped: true, reason: 'stopped' });
    expect(h.stopSupervisor.mock.invocationCallOrder[0]).toBeLessThan(h.kill.mock.invocationCallOrder[0]);
    expect(h.server.healthPid).toBeNull();
    expect(h.fs.files.has(MARKER)).toBe(false);
  });

  it('leaves the server running when the supervisor cannot be stopped', async () => {
    const h = harness({ supervisorRunning: true, supervisorStoppable: false });
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    const pending = runHelperStop({ linker: LINKER }, h.deps);
    await vi.advanceTimersByTimeAsync(SUPERVISOR_STOP_WAIT_MS + 500);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: 'stop-failed' });
    expect(result.ok === false && result.message).toContain('3012');
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.fs.files.has(MARKER)).toBe(true);
  });

  it('a non-supervisor answer on the supervisor port does not block the stop', async () => {
    const h = harness({ supervisorRunning: true, supervisorStoppable: false, supervisorAnswerOk: false });
    writeMarker(h, { pid: 4242, startedBy: LINKER });
    h.kill.mockImplementation((pid) => {
      h.alive.delete(pid);
    });
    expect(await runHelperStop({ linker: LINKER }, h.deps)).toMatchObject({ stopped: true, reason: 'stopped' });
    expect(h.kill.mock.calls).toEqual([[4242, 'SIGTERM']]);
  });
});
