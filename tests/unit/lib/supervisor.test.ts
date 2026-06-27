import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type * as supervisor from '../../../src/lib/supervisor.js';

vi.mock(import('node:child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: vi.fn() };
});

// A pid that is effectively guaranteed not to exist on a normal system.
const DEAD_PID = 2_147_483_640;

function fakeChild(pid: number) {
  const emitter = new EventEmitter();
  Object.assign(emitter, { pid, unref: vi.fn() });
  return emitter;
}

describe('supervisor lifecycle', () => {
  let home: string;
  let prevHome: string | undefined;
  let startSupervisorProcessSync: typeof supervisor.startSupervisorProcessSync;
  let stopSupervisorProcessSync: typeof supervisor.stopSupervisorProcessSync;
  let isSupervisorRunningSync: typeof supervisor.isSupervisorRunningSync;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'pan-sup-'));
    prevHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;

    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.doMock('../../../src/lib/paths.js', async () => {
      const actual = await vi.importActual<typeof import('../../../src/lib/paths.js')>(
        '../../../src/lib/paths.js',
      );
      return {
        ...actual,
        OVERDECK_HOME: home,
        LOGS_DIR: join(home, 'logs'),
        packageRoot: home,
      };
    });
    vi.resetModules();

    const mod = await import('../../../src/lib/supervisor.js');
    startSupervisorProcessSync = mod.startSupervisorProcessSync;
    stopSupervisorProcessSync = mod.stopSupervisorProcessSync;
    isSupervisorRunningSync = mod.isSupervisorRunningSync;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.doUnmock('../../../src/lib/paths.js');
  });

  function makeBundle() {
    const dir = join(home, 'dist', 'supervisor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.js'), '// dummy supervisor bundle\n', 'utf-8');
  }

  describe('startSupervisorProcessSync', () => {
    it('removes the pidfile and logs an error when the child dies immediately', () => {
      makeBundle();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        fakeChild(DEAD_PID) as never,
      );

      startSupervisorProcessSync();

      expect(existsSync(join(home, 'supervisor.pid'))).toBe(false);
      expect(isSupervisorRunningSync()).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('exited immediately'));

      errorSpy.mockRestore();
    });
  });

  describe('stopSupervisorProcessSync', () => {
    it('waits for the process to exit before removing the pidfile', () => {
      const pid = 1_234_567;
      writeFileSync(join(home, 'supervisor.pid'), String(pid), 'utf-8');

      let sigtermReceived = false;
      let sigkillReceived = false;
      let aliveChecks = 0;
      const originalKill = process.kill.bind(process);

      vi.spyOn(process, 'kill').mockImplementation(
        ((targetPid: number, signal?: number | NodeJS.Signals) => {
          if (targetPid !== pid) {
            return originalKill(targetPid, signal as never);
          }
          if (signal === 0 || signal === undefined) {
            aliveChecks += 1;
            if (aliveChecks > 3) throw new Error('dead');
            return true;
          }
          if (signal === 'SIGTERM') {
            sigtermReceived = true;
            return true;
          }
          if (signal === 'SIGKILL') {
            sigkillReceived = true;
            return true;
          }
          return true;
        }) as typeof process.kill,
      );

      stopSupervisorProcessSync();

      expect(existsSync(join(home, 'supervisor.pid'))).toBe(false);
      expect(sigtermReceived).toBe(true);
      expect(sigkillReceived).toBe(false);
      expect(Atomics.wait).toHaveBeenCalled();
    });

    it('escalates to SIGKILL when SIGTERM is ignored', () => {
      const pid = 1_234_568;
      writeFileSync(join(home, 'supervisor.pid'), String(pid), 'utf-8');

      let sigtermReceived = false;
      let sigkillReceived = false;
      let aliveChecks = 0;
      const originalKill = process.kill.bind(process);

      vi.spyOn(process, 'kill').mockImplementation(
        ((targetPid: number, signal?: number | NodeJS.Signals) => {
          if (targetPid !== pid) {
            return originalKill(targetPid, signal as never);
          }
          if (signal === 0 || signal === undefined) {
            aliveChecks += 1;
            if (aliveChecks > 35) throw new Error('dead');
            return true;
          }
          if (signal === 'SIGTERM') {
            sigtermReceived = true;
            return true;
          }
          if (signal === 'SIGKILL') {
            sigkillReceived = true;
            return true;
          }
          return true;
        }) as typeof process.kill,
      );

      stopSupervisorProcessSync();

      expect(existsSync(join(home, 'supervisor.pid'))).toBe(false);
      expect(sigtermReceived).toBe(true);
      expect(sigkillReceived).toBe(true);
    });
  });
});
