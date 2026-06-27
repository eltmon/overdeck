import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync, execFile } from 'child_process';
import { readFileSync } from 'fs';
import {
  createSession,
  ensureOverdeckTmuxServerSync,
  ensureOverdeckTmuxServerAsync,
  findManagedServerPidSync,
  _resetWarnedManagedServerDirtyForTest,
} from '../tmux.js';
import { Effect } from 'effect';

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

describe('ensureOverdeckTmuxServerSync', () => {
  let serverAlive = false;
  let systemdAvailable = true;
  let setsidAvailable = true;
  let systemctlMainPid: string | null = null;
  let pgrepOutput = '';
  let cgroupOutput = '';
  let cmdlineOutput = '';
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    _resetWarnedManagedServerDirtyForTest();
    process.env.OVERDECK_TMUX_MANAGED_SERVER_FORCE = '1';
    serverAlive = false;
    systemdAvailable = true;
    setsidAvailable = true;
    systemctlMainPid = null;
    pgrepOutput = '';
    cgroupOutput = '';
    cmdlineOutput = '';
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
      if (typeof path === 'string' && path.includes('/proc/') && path.includes('/cmdline')) {
        return cmdlineOutput;
      }
      throw new Error('ENOENT');
    });
  });

  afterEach(() => {
    warnSpy.mockClear();
    delete process.env.OVERDECK_TMUX_MANAGED_SERVER_FORCE;
  });

  it('founds the shared server in a dedicated systemd unit', () => {
    ensureOverdeckTmuxServerSync({});

    const systemdCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'systemd-run');
    expect(systemdCalls).toHaveLength(1);

    const argv = systemdCalls[0]![1] as string[];
    expect(argv).toContain('--unit');
    expect(argv).toContain('overdeck-tmux-server');
    expect(argv).not.toContain('--scope');
    expect(argv).toContain('--collect');
  });

  it('skips founding when the server is already alive', () => {
    serverAlive = true;
    ensureOverdeckTmuxServerSync({});

    const systemdCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'systemd-run');
    expect(systemdCalls).toHaveLength(0);
  });

  it('falls back to setsid when systemd-run is unavailable', () => {
    systemdAvailable = false;
    ensureOverdeckTmuxServerSync({});

    const setsidCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'setsid');
    expect(setsidCalls).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('without systemd scope isolation'));
  });

  it('falls back to plain tmux when neither systemd-run nor setsid is available', () => {
    systemdAvailable = false;
    setsidAvailable = false;
    ensureOverdeckTmuxServerSync({});

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

    ensureOverdeckTmuxServerSync({});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tmux-spawn'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PID 12345'));
  });

  it('does not warn when the server is in the dedicated unit', () => {
    serverAlive = true;
    systemctlMainPid = '12345';
    cgroupOutput = '0::/user.slice/user-1000.slice/user@1000.service/overdeck-tmux-server.service\n';
    cmdlineOutput = 'tmux\0-L\0overdeck\0-f\0/home/user/.overdeck/tmux/overdeck.tmux.conf\0start-server\0';

    ensureOverdeckTmuxServerSync({});

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('tmux-spawn'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('dirty cmdline'));
  });

  it('warns when the live server has a dirty cmdline founded by new-session', () => {
    serverAlive = true;
    systemctlMainPid = '12345';
    cmdlineOutput = 'tmux\0-L\0overdeck\0new-session\0-d\0-s\0conv-20260612-3871\0bash\0launcher.sh\0';

    ensureOverdeckTmuxServerSync({});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dirty cmdline'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PID 12345'));
  });
});

describe('ensureOverdeckTmuxServerAsync', () => {
  let serverAlive = false;
  let systemdAvailable = true;
  let setsidAvailable = true;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OVERDECK_TMUX_MANAGED_SERVER_FORCE = '1';
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
    await ensureOverdeckTmuxServerAsync({});

    const systemdCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'systemd-run');
    expect(systemdCalls).toHaveLength(1);

    const argv = systemdCalls[0]![1] as string[];
    expect(argv).toContain('--unit');
    expect(argv).toContain('overdeck-tmux-server');
    expect(argv).not.toContain('--scope');
  });

  it('falls back to setsid when systemd-run is unavailable', async () => {
    systemdAvailable = false;
    await ensureOverdeckTmuxServerAsync({});

    const setsidCalls = mockedExecFileSync.mock.calls.filter((c) => c[0] === 'setsid');
    expect(setsidCalls).toHaveLength(1);
  });
});

describe('createSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OVERDECK_TMUX_MANAGED_SERVER_FORCE = '1';

    mockedExecFileSync.mockImplementation((cmd: unknown, args?: unknown) => {
      const command = String(cmd);
      const argv = Array.isArray(args) ? (args as string[]) : [];
      if (isListSessionsCall(command, argv)) return '';
      if (isSystemctlShowCall(command)) return '0\n';
      if (command === 'pgrep') throw new Error('no match');
      return '';
    });

    mockedExecFile.mockImplementation((_cmd: unknown, _args?: unknown, optionsOrCallback?: unknown, callback?: unknown) => {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      if (typeof cb === 'function') {
        cb(null, '', '');
      }
      return {} as ReturnType<typeof execFile>;
    });
  });

  afterEach(() => {
    delete process.env.OVERDECK_TMUX_MANAGED_SERVER_FORCE;
  });

  it('creates an empty session and sends the command after configuring survive options', async () => {
    await Effect.runPromise(createSession('agent-pan-2023', '/tmp/workspace', 'bash launcher.sh'));

    const newSessionCall = mockedExecFile.mock.calls.find(
      (call) => call[0] === 'tmux' && Array.isArray(call[1]) && call[1].includes('new-session'),
    );

    expect(newSessionCall).toBeDefined();
    const argv = newSessionCall![1] as string[];
    expect(argv).toEqual(expect.arrayContaining(['new-session', '-x', '200', '-y', '50']));
    // The command must NOT be passed to new-session; we configure the window to
    // survive fast-exiting launchers first, then send the command in separately.
    expect(argv).not.toContain('bash launcher.sh');

    const destroyDetachedCall = mockedExecFile.mock.calls.find(
      (call) => call[0] === 'tmux' && Array.isArray(call[1]) && call[1].includes('set-option') && call[1].includes('destroy-unattached'),
    );
    expect(destroyDetachedCall).toBeDefined();

    const remainOnExitCall = mockedExecFile.mock.calls.find(
      (call) => call[0] === 'tmux' && Array.isArray(call[1]) && call[1].includes('set-option') && call[1].includes('remain-on-exit'),
    );
    expect(remainOnExitCall).toBeDefined();

    const sendKeysCall = mockedExecFile.mock.calls.find(
      (call) => call[0] === 'tmux' && Array.isArray(call[1]) && call[1].includes('send-keys') && call[1].includes('C-m'),
    );
    expect(sendKeysCall).toBeDefined();
  });

  it('preserves explicit pane size overrides', async () => {
    await Effect.runPromise(createSession('agent-pan-2023', '/tmp/workspace', 'bash launcher.sh', {
      width: 120,
      height: 30,
    }));

    const newSessionCall = mockedExecFile.mock.calls.find(
      (call) => call[0] === 'tmux' && Array.isArray(call[1]) && call[1].includes('new-session'),
    );

    expect(newSessionCall).toBeDefined();
    const argv = newSessionCall![1] as string[];
    expect(argv).toEqual(expect.arrayContaining(['new-session', '-x', '120', '-y', '30']));
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
