/**
 * PAN-5176 FR-18: with `process.platform` stubbed to `darwin`, the systemd
 * helpers, the OOM canary (`readNewKernelJournal`) and the restart announcer
 * spawn 0 `systemctl` and 0 `journalctl` processes (the PAN-5170 bug class).
 *
 * The spawn ledger counts at the real `node:child_process` boundary. The
 * positive control stubs `linux` and proves the ledger sees the systemd
 * helpers' `promisify(exec)` path: one redirected `systemctl` call, whose
 * shell exits 127, so the helper resolves false and nothing real runs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  explainSystemdUserUnavailable,
  isSupervisorUnitFailed,
  startSupervisorUnitIfAvailable,
  stopSupervisorUnitIfActive,
  systemdUserAvailable,
} from '../../../src/lib/systemd.js';
import { readNewKernelJournal } from '../../../src/lib/cloister/memory-pressure-patrol.js';
import { announceNewRestart } from '../../../src/dashboard/server/services/restart-announcer.js';

const ledger = await vi.hoisted(async () =>
  (await import('../../helpers/spawn-budget.js')).installSpawnLedger());

const LINUX_ONLY_TOOLS = ['systemctl', 'journalctl'] as const;
const linuxOnlySpawns = (): number => ledger.count({ programs: LINUX_ONLY_TOOLS });

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const savedSupervisorUnit = process.env.OVERDECK_SUPERVISOR_UNIT;

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeAll(() => {
  stubPlatform('darwin');
  // Without it, supervisorUnitAllowed() returns false first in the temp
  // OVERDECK_HOME, and the start and stop cases would pass for the wrong reason.
  process.env.OVERDECK_SUPERVISOR_UNIT = '1';
});

afterAll(() => {
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
  if (savedSupervisorUnit === undefined) delete process.env.OVERDECK_SUPERVISOR_UNIT;
  else process.env.OVERDECK_SUPERVISOR_UNIT = savedSupervisorUnit;
  ledger.restore();
});

describe('on darwin, Linux-only tools are never spawned', () => {
  afterEach(() => {
    ledger.reset();
  });

  it('isSupervisorUnitFailed resolves false', async () => {
    await expect(isSupervisorUnitFailed()).resolves.toBe(false);
    expect(linuxOnlySpawns()).toBe(0);
  });

  it('systemdUserAvailable resolves false', async () => {
    await expect(systemdUserAvailable()).resolves.toBe(false);
    expect(linuxOnlySpawns()).toBe(0);
  });

  it('explainSystemdUserUnavailable resolves not-linux', async () => {
    await expect(explainSystemdUserUnavailable()).resolves.toBe('not-linux');
    expect(linuxOnlySpawns()).toBe(0);
  });

  it('startSupervisorUnitIfAvailable resolves false', async () => {
    await expect(startSupervisorUnitIfAvailable()).resolves.toBe(false);
    expect(linuxOnlySpawns()).toBe(0);
  });

  it('stopSupervisorUnitIfActive resolves false', async () => {
    await expect(stopSupervisorUnitIfActive()).resolves.toBe(false);
    expect(linuxOnlySpawns()).toBe(0);
  });

  it('readNewKernelJournal with no deps resolves an empty string', async () => {
    await expect(readNewKernelJournal()).resolves.toBe('');
    expect(linuxOnlySpawns()).toBe(0);
  });

  describe('announceNewRestart', () => {
    beforeAll(() => {
      vi.useFakeTimers({ now: new Date('2026-11-13T00:00:00Z'), toFake: ['Date'] });
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it('runs 5 times with the default platform and systemd check', async () => {
      const emit = vi.fn();
      const deps = {
        readStatus: async () => null,
        writeStatus: vi.fn(async () => {}),
        emit,
        getLastAnnounced: () => null,
        setLastAnnounced: vi.fn(),
        now: () => Date.now(),
        isPeer: () => false,
        probeSupervisor: async () => true,
        supervisorUrl: () => 'http://127.0.0.1:3012',
      };
      for (let pass = 0; pass < 5; pass += 1) {
        await expect(announceNewRestart(deps)).resolves.toBe(false);
        vi.setSystemTime(Date.now() + 61_000);
      }
      expect(emit).not.toHaveBeenCalled();
      expect(linuxOnlySpawns()).toBe(0);
    });
  });
});

describe('positive control on linux', () => {
  const savedRuntimeDir = process.env.XDG_RUNTIME_DIR;

  beforeAll(() => {
    stubPlatform('linux');
    delete process.env.XDG_RUNTIME_DIR;
  });

  afterAll(() => {
    stubPlatform('darwin');
    if (savedRuntimeDir !== undefined) process.env.XDG_RUNTIME_DIR = savedRuntimeDir;
  });

  it('isSupervisorUnitFailed makes exactly 1 redirected systemctl call and resolves false', async () => {
    ledger.reset();
    await expect(isSupervisorUnitFailed()).resolves.toBe(false);
    expect(ledger.records.filter((record) => record.program === 'systemctl')).toEqual([
      { api: 'exec', program: 'systemctl', denied: true },
    ]);
  });
});
