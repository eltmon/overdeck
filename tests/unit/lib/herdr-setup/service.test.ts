import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultSpawnDetached,
  ensureHerdrServer,
  herdrPersistentUnitWanted,
  herdrUnitName,
  renderHerdrUnit,
  type HerdrSystemd,
} from '../../../../src/lib/herdr-setup/service.js';
import type { HerdrExec } from '../../../../src/lib/herdr-setup/status.js';
import { HAND_WRITTEN_UNIT, STATUS_NOT_RUNNING_JSON, STATUS_RUNNING_JSON } from './fixtures.js';

const BINARY = '/home/op/.local/bin/herdr';
const SOCKET = '/home/op/.config/herdr/sessions/overdeck/herdr.sock';

/** Every command any path issued: herdr argv and systemctl verbs. */
type Call = readonly string[];

function harness(options: { running: boolean; systemd: boolean; socketAfterStart?: boolean }) {
  const calls: Call[] = [];
  let serverUp = options.running;
  const exec = vi.fn<HerdrExec>(async (file, args) => {
    calls.push([file, ...args]);
    return { stdout: serverUp ? STATUS_RUNNING_JSON : STATUS_NOT_RUNNING_JSON, stderr: '', exitCode: 0 };
  });
  const started = () => {
    if (options.socketAfterStart !== false) serverUp = true;
  };
  const systemd: HerdrSystemd = {
    available: vi.fn(async () => options.systemd),
    installUserUnit: vi.fn(async (name: string) => {
      calls.push(['systemctl', 'install', name]);
      return { path: `/units/${name}`, written: true };
    }),
    enableUserUnit: vi.fn(async (name: string) => { calls.push(['systemctl', 'enable', name]); }),
    enableUserUnitNow: vi.fn(async (name: string) => {
      calls.push(['systemctl', 'enable', '--now', name]);
      started();
    }),
    isUserUnitActive: vi.fn(async () => serverUp),
  };
  const spawnDetached = vi.fn(async (file: string, args: readonly string[]) => {
    calls.push(['spawn', file, ...args]);
    started();
  });
  return {
    calls,
    exec,
    systemd,
    spawnDetached,
    exists: vi.fn(async (path: string) => path === SOCKET && serverUp),
  };
}

function assertNeverStopsOrRestarts(calls: readonly Call[]): void {
  for (const call of calls) {
    const text = call.join(' ');
    expect(text).not.toMatch(/\brestart\b/);
    expect(text).not.toMatch(/\bstop\b/);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('unit rendering (PAN-3956 W7)', () => {
  it('names the unit after the session', () => {
    expect(herdrUnitName('overdeck')).toBe('overdeck-herdr.service');
    expect(herdrUnitName('overdeck-1a2b3c4d')).toBe('overdeck-1a2b3c4d-herdr.service');
  });

  it('matches the hand-written host unit except for the quoted absolute ExecStart', () => {
    const rendered = renderHerdrUnit(BINARY, 'overdeck');
    expect(rendered).toBe(HAND_WRITTEN_UNIT.replace(
      'ExecStart=%h/.local/bin/herdr --session overdeck server',
      `ExecStart="${BINARY}" --session overdeck server`,
    ));
  });

  it('doubles % and $ in ExecStart so systemd takes an odd path literally', () => {
    const rendered = renderHerdrUnit('/opt/100%$HOME/herdr', 'overdeck');
    expect(rendered).toContain('ExecStart="/opt/100%%$$HOME/herdr" --session overdeck server');
  });
});

describe('boot-persistent unit policy (review finding 6)', () => {
  it('is on for the default home and off for any other home unless opted in', () => {
    expect(herdrPersistentUnitWanted('overdeck', {})).toBe(true);
    expect(herdrPersistentUnitWanted('overdeck-1a2b3c4d', {})).toBe(false);
    expect(herdrPersistentUnitWanted('overdeck-1a2b3c4d', { OVERDECK_HERDR_PERSISTENT_UNIT: '1' })).toBe(true);
  });
});

describe('ensureHerdrServer', () => {
  it('returns already-running without spawning when the socket answers, and only enables the unit', async () => {
    const h = harness({ running: true, systemd: true });
    const result = await ensureHerdrServer({ binary: BINARY, session: 'overdeck', socket: SOCKET, ...h });
    expect(result).toEqual({ running: true, managedBy: 'already-running', unit: 'overdeck-herdr.service' });
    expect(h.spawnDetached).not.toHaveBeenCalled();
    expect(h.systemd.enableUserUnitNow).not.toHaveBeenCalled();
    expect(h.systemd.installUserUnit).toHaveBeenCalledWith('overdeck-herdr.service', renderHerdrUnit(BINARY, 'overdeck'));
    expect(h.systemd.enableUserUnit).toHaveBeenCalledWith('overdeck-herdr.service');
    assertNeverStopsOrRestarts(h.calls);
  });

  it('touches no systemd when already running on a non-systemd host', async () => {
    const h = harness({ running: true, systemd: false });
    const result = await ensureHerdrServer({ binary: BINARY, session: 'overdeck', socket: SOCKET, ...h });
    expect(result).toEqual({ running: true, managedBy: 'already-running' });
    expect(h.systemd.installUserUnit).not.toHaveBeenCalled();
  });

  it('installs and enables --now the unit on a systemd host, then waits for the socket', async () => {
    vi.useFakeTimers();
    const h = harness({ running: false, systemd: true });
    const pending = ensureHerdrServer({ binary: BINARY, session: 'overdeck', socket: SOCKET, ...h });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual({ running: true, managedBy: 'systemd', unit: 'overdeck-herdr.service' });
    expect(h.systemd.enableUserUnitNow).toHaveBeenCalledWith('overdeck-herdr.service');
    expect(h.spawnDetached).not.toHaveBeenCalled();
    assertNeverStopsOrRestarts(h.calls);
  });

  it('spawns a detached server on a host without systemd', async () => {
    vi.useFakeTimers();
    const h = harness({ running: false, systemd: false });
    const pending = ensureHerdrServer({
      binary: BINARY,
      session: 'overdeck',
      socket: SOCKET,
      logPath: '/home/op/.overdeck/logs/herdr-overdeck.log',
      ...h,
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual({ running: true, managedBy: 'detached' });
    expect(h.spawnDetached).toHaveBeenCalledWith(
      BINARY,
      ['--session', 'overdeck', 'server'],
      '/home/op/.overdeck/logs/herdr-overdeck.log',
    );
    expect(h.systemd.installUserUnit).not.toHaveBeenCalled();
    assertNeverStopsOrRestarts(h.calls);
  });

  it('reports running:false with a reason after the 10 s wait', async () => {
    vi.useFakeTimers();
    const h = harness({ running: false, systemd: true, socketAfterStart: false });
    const pending = ensureHerdrServer({ binary: BINARY, session: 'overdeck', socket: SOCKET, ...h });
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(9_750);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual({
      running: false,
      managedBy: 'systemd',
      unit: 'overdeck-herdr.service',
      reason: 'session socket did not appear within 10s',
    });
    assertNeverStopsOrRestarts(h.calls);
  });

  it('keeps reporting a running server when unit upkeep fails (review finding 9)', async () => {
    const h = harness({ running: true, systemd: true });
    vi.mocked(h.systemd.installUserUnit).mockRejectedValueOnce(new Error('daemon-reload timed out'));
    const result = await ensureHerdrServer({ binary: BINARY, session: 'overdeck', socket: SOCKET, ...h });
    expect(result.running).toBe(true);
    expect(result.managedBy).toBe('already-running');
    expect(result.warning).toMatch(/Could not refresh or enable overdeck-herdr\.service: daemon-reload timed out/);
  });

  it('never installs or enables a unit for a non-default home, even on a systemd host', async () => {
    vi.useFakeTimers();
    const session = 'overdeck-1a2b3c4d';
    const socket = `/home/op/.config/herdr/sessions/${session}/herdr.sock`;
    const h = harness({ running: false, systemd: true });
    h.exists.mockImplementation(async (path: string) => path === socket);
    const pending = ensureHerdrServer({ binary: BINARY, session, socket, persistentUnit: false, ...h });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual({ running: true, managedBy: 'detached' });
    expect(h.systemd.installUserUnit).not.toHaveBeenCalled();
    expect(h.systemd.enableUserUnit).not.toHaveBeenCalled();
    expect(h.systemd.enableUserUnitNow).not.toHaveBeenCalled();
    expect(h.spawnDetached).toHaveBeenCalledOnce();
  });

  it('leaves an already-running non-default server without unit upkeep', async () => {
    const h = harness({ running: true, systemd: true });
    const result = await ensureHerdrServer({
      binary: BINARY,
      session: 'overdeck-1a2b3c4d',
      socket: SOCKET,
      persistentUnit: false,
      ...h,
    });
    expect(result).toEqual({ running: true, managedBy: 'already-running' });
    expect(h.systemd.installUserUnit).not.toHaveBeenCalled();
  });
});

describe('defaultSpawnDetached (review finding 7)', () => {
  it('backgrounds the server through sh in a new session, with the log as stdout/stderr', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'herdr-spawn-'));
    try {
      const child = { on: vi.fn(), unref: vi.fn() };
      const spawnImpl = vi.fn(() => child);
      const logPath = join(dir, 'logs', 'herdr-overdeck.log');
      await defaultSpawnDetached(BINARY, ['--session', 'overdeck', 'server'], logPath, spawnImpl as never);
      expect(spawnImpl).toHaveBeenCalledWith(
        '/bin/sh',
        ['-c', '"$0" "$@" </dev/null &', BINARY, '--session', 'overdeck', 'server'],
        expect.objectContaining({ detached: true, stdio: ['ignore', expect.any(Number), expect.any(Number)] }),
      );
      expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(child.unref).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'starts a process that is neither our child nor in our session',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'herdr-spawn-real-'));
      const report = join(dir, 'report');
      const fake = join(dir, 'fake-herdr');
      writeFileSync(fake, [
        '#!/bin/sh',
        `ps -o pid=,ppid=,sid= -p $$ > "${report}.tmp" && mv "${report}.tmp" "${report}"`,
        'exec sleep 30',
        '',
      ].join('\n'));
      chmodSync(fake, 0o755);
      let serverPid: number | undefined;
      try {
        await defaultSpawnDetached(fake, ['--session', 'x', 'server'], join(dir, 'server.log'));
        const fields = await vi.waitFor(() => {
          const text = readFileSync(report, 'utf-8').trim();
          const parts = text.split(/\s+/).map(Number);
          if (parts.length !== 3) throw new Error(`unexpected ps output: ${text}`);
          return parts;
        }, { timeout: 10_000, interval: 50 });
        const [pid, ppid, sid] = fields as [number, number, number];
        serverPid = pid;
        const ownSid = Number(execFileSync('ps', ['-o', 'sid=', '-p', String(process.pid)], { encoding: 'utf-8' }).trim());
        expect(ppid).not.toBe(process.pid);
        expect(sid).not.toBe(ownSid);
      } finally {
        if (serverPid) {
          try { process.kill(serverPid, 'SIGKILL'); } catch { /* already gone */ }
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
