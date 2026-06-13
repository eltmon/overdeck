import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync, execFile } from 'child_process';
import { readFileSync } from 'fs';
import {
  ensurePanopticonTmuxServerSync,
  ensurePanopticonTmuxServerAsync,
  findManagedServerPidSync,
} from '../tmux.js';

const execFileSyncMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());
const readFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: execFileSyncMock,
    execSync: execSyncMock,
    execFile: execFileMock,
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExecSync = vi.mocked(execSync);
const mockedExecFile = vi.mocked(execFile);
const mockedReadFileSync = vi.mocked(readFileSync);

function isListSessionsCall(cmd: unknown, args: unknown): boolean {
  return cmd === 'tmux' && Array.isArray(args) && args.includes('list-sessions');
}

function isStartServerCall(cmd: unknown, args: unknown): boolean {
  return cmd === 'tmux' && Array.isArray(args) && args.includes('start-server');
}

function isSystemctlShowCall(cmd: unknown): boolean {
  return cmd === 'systemctl';
}

describe('ensurePanopticonTmuxServerSync', () => {
  let serverAlive = false;
  let systemdAvailable = true;
  let setsidAvailable = true;
  let systemctlMainPid: string | null = null;
  let pgrepOutput = '';
  let cgroupOutput = '';
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PANOPTICON_TMUX_MANAGED_SERVER_FORCE = '1';
    serverAlive = false;
    systemdAvailable = true;
    setsidAvailable = true;
    systemctlMainPid = null;
    pgrepOutput = '';
    cgroupOutput = '';
    warnSpy.mockClear();

    mockedExecFileSync.mockImplementation((cmd: unknown, args?: unknown, _options?: unknown) => {
      const command = String(cmd);
      const argv = Array.isArray(args) ? (args as string[]) : [];

      if (isListSessionsCall(command, argv)) {
        if (serverAlive) return '';
        const err = new Error('no server running');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }

      if (command === 'systemd-run') {
        if (!systemdAvailable) {
          const err = new Error('systemd-run not found');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        serverAlive = true;
        return '';
      }

      if (isSystemctlShowCall(command)) {
        return systemctlMainPid ?? '0\n';
      }

      if (command === 'pgrep') {
        if (!pgrepOutput) {
          const err = new Error('no match');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        return pgrepOutput;
      }

      if (command === 'setsid') {
        if (!setsidAvailable) {
          const err = new Error('setsid not found');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        serverAlive = true;
        return '';
      }

      if (command === 'sleep') return '';
      if (isStartServerCall(command, argv)) {
        serverAlive = true;
        return '';
      }

      return '';
    });

    mockedExecSync.mockImplementation(() => '');

    mockedReadFileSync.mockImplementation((path: unknown, _encoding?: unknown) => {
      if (typeof path === 'string' && path.includes('/proc/') && path.includes('/cgroup')) {
        return cgroupOutput;
      }
      throw new Error('ENOENT');
    });
  });

  afterEach(() => {
    warnSpy.mockClear();
    delete process.env.PANOPTICON_TMUX_MANAGED_SERVER_FORCE;
  });

  it('founds the shared server in a dedicated systemd unit', () => {
    ensurePanopticonTmuxServerSync({});

    const systemdCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'systemd-run');
    expect(systemdCalls).toHaveLength(1);

    const argv = systemdCalls[0]![1] as string[];
    expect(argv).toContain('--unit');
    expect(argv).toContain('panopticon-tmux-server');
    expect(argv).not.toContain('--scope');
    expect(argv).toContain('--collect');
  });

  it('skips founding when the server is already alive', () => {
    serverAlive = true;
    ensurePanopticonTmuxServerSync({});

    const systemdCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'systemd-run');
    expect(systemdCalls).toHaveLength(0);
  });

  it('falls back to setsid when systemd-run is unavailable', () => {
    systemdAvailable = false;
    ensurePanopticonTmuxServerSync({});

    const setsidCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'setsid');
    expect(setsidCalls).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('without systemd scope isolation'));
  });

  it('falls back to plain tmux when neither systemd-run nor setsid is available', () => {
    systemdAvailable = false;
    setsidAvailable = false;
    ensurePanopticonTmuxServerSync({});

    const tmuxCalls = mockedExecFileSync.mock.calls.filter(
      (c) => c[0] === 'tmux' && isStartServerCall(c[0], c[1]),
    );
    expect(tmuxCalls.length).toBeGreaterThanOrEqual(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('without systemd scope isolation'));
  });

  it('warns when the live server is stuck in a tmux-spawn scope', () => {
    serverAlive = true;
    systemctlMainPid = '12345';
    cgroupOutput = '0::/user.slice/user-1000.slice/user@1000.service/tmux-spawn-abc.scope\n';

    ensurePanopticonTmuxServerSync({});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tmux-spawn'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PID 12345'));
  });

  it('does not warn when the server is in the dedicated unit', () => {
    serverAlive = true;
    systemctlMainPid = '12345';
    cgroupOutput = '0::/user.slice/user-1000.slice/user@1000.service/panopticon-tmux-server.service\n';

    ensurePanopticonTmuxServerSync({});

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('tmux-spawn'));
  });
});

describe('ensurePanopticonTmuxServerAsync', () => {
  let serverAlive = false;
  let systemdAvailable = true;
  let setsidAvailable = true;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PANOPTICON_TMUX_MANAGED_SERVER_FORCE = '1';
    serverAlive = false;
    systemdAvailable = true;
    setsidAvailable = true;

    mockedExecFileSync.mockImplementation((cmd: unknown, args?: unknown) => {
      const command = String(cmd);
      const argv = Array.isArray(args) ? (args as string[]) : [];
      if (isListSessionsCall(command, argv)) {
        if (serverAlive) return '';
        const err = new Error('no server running');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }
      if (isSystemctlShowCall(command)) return '0\n';
      if (command === 'pgrep') throw new Error('no match');

      if (command === 'systemd-run') {
        if (!systemdAvailable) {
          const err = new Error('systemd-run not found');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        serverAlive = true;
        return '';
      }

      if (command === 'setsid') {
        if (!setsidAvailable) {
          const err = new Error('setsid not found');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        serverAlive = true;
        return '';
      }

      if (isStartServerCall(command, argv)) {
        serverAlive = true;
        return '';
      }

      return '';
    });
  });

  it('delegates to the sync helper and founds a dedicated systemd unit', async () => {
    await ensurePanopticonTmuxServerAsync({});

    const systemdCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'systemd-run');
    expect(systemdCalls).toHaveLength(1);

    const argv = systemdCalls[0]![1] as string[];
    expect(argv).toContain('--unit');
    expect(argv).toContain('panopticon-tmux-server');
    expect(argv).not.toContain('--scope');
  });

  it('falls back to setsid when systemd-run is unavailable', async () => {
    systemdAvailable = false;
    await ensurePanopticonTmuxServerAsync({});

    const setsidCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'setsid');
    expect(setsidCalls).toHaveLength(1);
  });
});

describe('findManagedServerPidSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the dedicated unit MainPID when available', () => {
    mockedExecFileSync.mockImplementation((cmd: unknown) => {
      if (cmd === 'systemctl') return '54321\n';
      if (cmd === 'pgrep') throw new Error('no match');
      return '';
    });

    expect(findManagedServerPidSync()).toBe(54321);
  });

  it('falls back to pgrep when the unit is not loaded', () => {
    mockedExecFileSync.mockImplementation((cmd: unknown) => {
      if (cmd === 'systemctl') return '0\n';
      if (cmd === 'pgrep') return '11111\n22222\n';
      return '';
    });

    expect(findManagedServerPidSync()).toBe(11111);
  });

  it('returns undefined when no PID can be found', () => {
    mockedExecFileSync.mockImplementation((cmd: unknown) => {
      if (cmd === 'systemctl') throw new Error('systemctl not found');
      if (cmd === 'pgrep') throw new Error('no match');
      return '';
    });

    expect(findManagedServerPidSync()).toBeUndefined();
  });
});
