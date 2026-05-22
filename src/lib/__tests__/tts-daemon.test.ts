import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedTtsDaemonConfig } from '../config-yaml.js';

const CONFIG: NormalizedTtsDaemonConfig = {
  enabled: true,
  voice: '',
  volume: 1,
  rate: 1,
  maxChars: 140,
  dropInfoWhenFull: true,
  daemonHost: '127.0.0.1',
  daemonPort: 8787,
  daemonAutoStart: false,
  voiceMap: {},
  mutedSources: [],
  utteranceTemplates: {},
  mutedIssues: [],
};

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testHome: string;

function mockProcIdentities(identities: Record<number, { cmdline: string; startTimeTicks: string }>): void {
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return {
      ...actual,
      readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], ...args: unknown[]) => {
        const pathString = String(path);
        const cmdlineMatch = pathString.match(/^\/proc\/(\d+)\/cmdline$/);
        if (cmdlineMatch) {
          const identity = identities[Number(cmdlineMatch[1])];
          if (!identity) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return `${identity.cmdline.replaceAll(' ', '\0')}\0`;
        }
        const statMatch = pathString.match(/^\/proc\/(\d+)\/stat$/);
        if (statMatch) {
          const identity = identities[Number(statMatch[1])];
          if (!identity) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return `${statMatch[1]} (python) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${identity.startTimeTicks}`;
        }
        return actual.readFile(path, ...(args as [Parameters<typeof actual.readFile>[1]]));
      }),
    };
  });
}

describe('tts daemon lifecycle state', () => {
  beforeEach(() => {
    vi.resetModules();
    testHome = mkdtempSync(join(tmpdir(), 'pan-tts-daemon-'));
    process.env.PANOPTICON_HOME = testHome;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('ECONNREFUSED');
    }));
  });

  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs/promises');
    vi.unstubAllGlobals();
    if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalPanopticonHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('reports stale daemon state without deleting crash markers', async () => {
    const { QWEN_TTS_PID_PATH, QWEN_TTS_STATE_PATH, getTtsDaemonStatus } = await import('../tts-daemon.js');
    mkdirSync(join(testHome, 'pids'), { recursive: true });
    writeFileSync(QWEN_TTS_PID_PATH, '999999999\n', 'utf8');
    writeFileSync(QWEN_TTS_STATE_PATH, JSON.stringify({
      pid: 999999999,
      startedAt: '2026-05-18T00:00:00.000Z',
      host: '127.0.0.1',
      port: 8787,
    }), 'utf8');

    const status = await Effect.runPromise(getTtsDaemonStatus(CONFIG));

    expect(status).toMatchObject({ ok: false, running: false, pid: null });
    expect(existsSync(QWEN_TTS_PID_PATH)).toBe(true);
    expect(existsSync(QWEN_TTS_STATE_PATH)).toBe(true);
  });

  it('reports healthy unmanaged daemons from the health endpoint pid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      queue: 0,
      model: 'qwen3-tts',
      pid: 4321,
    }), { status: 200 })));
    const { getTtsDaemonStatus } = await import('../tts-daemon.js');

    const status = await Effect.runPromise(getTtsDaemonStatus(CONFIG));

    expect(status).toMatchObject({ ok: true, running: true, managed: false, pid: 4321 });
  });

  it('preserves a live managed daemon that is still inside startup grace', async () => {
    const spawn = vi.fn(() => ({ pid: 7777, unref: vi.fn() }));
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('node:child_process')),
      spawn,
    }));
    mockProcIdentities({ 4242: { cmdline: `python ${join(process.cwd(), 'skills', 'pan-tts', 'scripts', 'tts_daemon.py')}`, startTimeTicks: '12345' } });
    const killSpy = vi.spyOn(process, 'kill');
    killSpy.mockImplementation(((pid: number) => {
      if (pid === 4242) return true;
      return true;
    }) as typeof process.kill);
    const { QWEN_TTS_PID_PATH, QWEN_TTS_STATE_PATH, getTtsDaemonStatus, startTtsDaemon } = await import('../tts-daemon.js');
    mkdirSync(join(testHome, 'pids'), { recursive: true });
    writeFileSync(QWEN_TTS_PID_PATH, '4242\n', 'utf8');
    writeFileSync(QWEN_TTS_STATE_PATH, JSON.stringify({
      pid: 4242,
      startedAt: '2026-05-18T00:00:00.000Z',
      host: '127.0.0.1',
      port: 8787,
      phase: 'starting',
      startupDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
      scriptPath: join(process.cwd(), 'skills', 'pan-tts', 'scripts', 'tts_daemon.py'),
      processStartTimeTicks: '12345',
    }), 'utf8');

    try {
      const status = await Effect.runPromise(getTtsDaemonStatus(CONFIG));
      const result = await Effect.runPromise(startTtsDaemon({ config: CONFIG, timeoutMs: 0 }));

      expect(status).toMatchObject({ ok: false, running: true, managed: true, phase: 'starting', initializing: true, pid: 4242 });
      expect(result).toMatchObject({ ok: false, pid: 4242, alreadyRunning: true, status: { phase: 'starting', initializing: true } });
      expect(killSpy).not.toHaveBeenCalledWith(4242, 'SIGTERM');
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it('does not signal a stale pid that fails process identity validation', async () => {
    const spawn = vi.fn(() => ({ pid: 7777, unref: vi.fn() }));
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('node:child_process')),
      spawn,
    }));
    const scriptPath = join(process.cwd(), 'skills', 'pan-tts', 'scripts', 'tts_daemon.py');
    mockProcIdentities({ 7777: { cmdline: `python ${scriptPath}`, startTimeTicks: '67890' } });
    const killSpy = vi.spyOn(process, 'kill');
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 4242 && signal === 0) return true;
      if (pid === 7777 && signal === 0) return true;
      return true;
    }) as typeof process.kill);
    const { QWEN_TTS_PID_PATH, QWEN_TTS_STATE_PATH, getTtsDaemonVenvDir, startTtsDaemon } = await import('../tts-daemon.js');
    mkdirSync(join(testHome, 'pids'), { recursive: true });
    writeFileSync(QWEN_TTS_PID_PATH, '4242\n', 'utf8');
    writeFileSync(QWEN_TTS_STATE_PATH, JSON.stringify({
      pid: 4242,
      startedAt: '2026-05-18T00:00:00.000Z',
      host: '127.0.0.1',
      port: 8787,
      scriptPath,
      processStartTimeTicks: '12345',
    }), 'utf8');
    const venvDir = await Effect.runPromise(getTtsDaemonVenvDir());
    const packageDir = join(venvDir, '..');
    const hadPackageDir = existsSync(packageDir);
    const hadVenvDir = existsSync(venvDir);
    const python = join(venvDir, 'bin', 'python');
    const hadPython = existsSync(python);
    if (!hadPython) {
      mkdirSync(join(python, '..'), { recursive: true });
      writeFileSync(python, '#!/usr/bin/env python3\n', 'utf8');
    }

    try {
      const result = await Effect.runPromise(startTtsDaemon({ config: CONFIG, waitForHealth: false }));

      expect(result).toMatchObject({ ok: true, pid: 7777, alreadyRunning: false });
      expect(killSpy).not.toHaveBeenCalledWith(4242, 'SIGTERM');
      expect(spawn).toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
      if (!hadPython) rmSync(python, { force: true });
      if (!hadVenvDir) rmSync(venvDir, { recursive: true, force: true });
      if (!hadPackageDir) rmSync(packageDir, { recursive: true, force: true });
    }
  });

  it('replaces an unhealthy live managed daemon on start', async () => {
    const spawn = vi.fn(() => ({ pid: 7777, unref: vi.fn() }));
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('node:child_process')),
      spawn,
    }));
    const scriptPath = join(process.cwd(), 'skills', 'pan-tts', 'scripts', 'tts_daemon.py');
    mockProcIdentities({
      4242: { cmdline: `python ${scriptPath}`, startTimeTicks: '12345' },
      7777: { cmdline: `python ${scriptPath}`, startTimeTicks: '67890' },
    });
    const killSpy = vi.spyOn(process, 'kill');
    let oldPidAlive = true;
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 4242) {
        if (signal === 'SIGTERM') oldPidAlive = false;
        if (oldPidAlive || signal === 'SIGTERM') return true;
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
      if (pid === 7777 && signal === 0) return true;
      return true;
    }) as typeof process.kill);
    const { QWEN_TTS_PID_PATH, QWEN_TTS_STATE_PATH, getTtsDaemonVenvDir, startTtsDaemon } = await import('../tts-daemon.js');
    mkdirSync(join(testHome, 'pids'), { recursive: true });
    writeFileSync(QWEN_TTS_PID_PATH, '4242\n', 'utf8');
    writeFileSync(QWEN_TTS_STATE_PATH, JSON.stringify({
      pid: 4242,
      startedAt: '2026-05-18T00:00:00.000Z',
      host: '127.0.0.1',
      port: 8787,
      scriptPath,
      processStartTimeTicks: '12345',
    }), 'utf8');
    const venvDir = await Effect.runPromise(getTtsDaemonVenvDir());
    const packageDir = join(venvDir, '..');
    const hadPackageDir = existsSync(packageDir);
    const hadVenvDir = existsSync(venvDir);
    const python = join(venvDir, 'bin', 'python');
    const hadPython = existsSync(python);
    if (!hadPython) {
      mkdirSync(join(python, '..'), { recursive: true });
      writeFileSync(python, '#!/usr/bin/env python3\n', 'utf8');
    }

    try {
      const result = await Effect.runPromise(startTtsDaemon({ config: CONFIG, waitForHealth: false }));

      expect(result).toMatchObject({ ok: true, pid: 7777, alreadyRunning: false });
      expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
      expect(spawn).toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
      if (!hadPython) rmSync(python, { force: true });
      if (!hadVenvDir) rmSync(venvDir, { recursive: true, force: true });
      if (!hadPackageDir) rmSync(packageDir, { recursive: true, force: true });
    }
  });
});
