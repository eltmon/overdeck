import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureHerdrServer,
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
});
