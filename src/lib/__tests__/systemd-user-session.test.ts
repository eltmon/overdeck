import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENVIRONMENT_D_FILE,
  isLingerEnabled,
  lingerSudoCommand,
  persistUserManagerPath,
  tryEnableLinger,
  waitForLinger,
  type SystemdUserSessionDeps,
} from '../systemd-user-session.js';

type ExecFile = SystemdUserSessionDeps['execFile'];

function fakeDeps(overrides: Partial<SystemdUserSessionDeps> = {}) {
  const files = new Map<string, string>();
  const deps = {
    execFile: vi.fn<ExecFile>(async () => ({ stdout: '', stderr: '' })),
    fileExists: vi.fn(async (path: string) => files.has(path)),
    readFile: vi.fn(async (path: string) => files.get(path) ?? null),
    writeFile: vi.fn(async (path: string, data: string) => {
      files.set(path, data);
    }),
    mkdir: vi.fn(async () => undefined),
    homedir: () => '/home/alice',
    ...overrides,
  };
  return { deps, files };
}

/** loginctl show-user answering `value`, or failing when `value` is an Error. */
function showUser(value: string | Error): ExecFile {
  return async (file, args) => {
    if (file === 'loginctl' && args[0] === 'show-user') {
      if (value instanceof Error) throw value;
      return { stdout: `${value}\n`, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

describe('isLingerEnabled', () => {
  it('reads Linger from loginctl show-user', async () => {
    const { deps } = fakeDeps({ execFile: vi.fn(showUser('yes')) });
    await expect(isLingerEnabled('alice', deps)).resolves.toBe(true);
    expect(deps.execFile).toHaveBeenCalledWith(
      'loginctl',
      ['show-user', 'alice', '--property=Linger', '--value'],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );

    const off = fakeDeps({ execFile: vi.fn(showUser('no')) });
    off.files.set('/var/lib/systemd/linger/alice', '');
    await expect(isLingerEnabled('alice', off.deps)).resolves.toBe(false);
  });

  it('falls back to the linger file when loginctl fails', async () => {
    const { deps, files } = fakeDeps({ execFile: vi.fn(showUser(new Error('User alice is not logged in'))) });
    await expect(isLingerEnabled('alice', deps)).resolves.toBe(false);

    files.set('/var/lib/systemd/linger/alice', '');
    await expect(isLingerEnabled('alice', deps)).resolves.toBe(true);
  });
});

describe('tryEnableLinger', () => {
  it('runs loginctl enable-linger --no-ask-password with the user as one argv entry', async () => {
    let enabled = false;
    const execFile = vi.fn<ExecFile>(async (_file, args) => {
      if (args[0] === 'enable-linger') enabled = true;
      return { stdout: enabled ? 'yes\n' : 'no\n', stderr: '' };
    });
    const { deps } = fakeDeps({ execFile });

    await expect(tryEnableLinger('alice', deps)).resolves.toBe(true);
    expect(execFile.mock.calls[0]?.[0]).toBe('loginctl');
    expect(execFile.mock.calls[0]?.[1]).toEqual(['enable-linger', '--no-ask-password', 'alice']);
  });

  it('returns false without throwing when enable-linger is refused', async () => {
    const execFile = vi.fn<ExecFile>(async (_file, args) => {
      if (args[0] === 'enable-linger') throw new Error('Interactive authentication required.');
      return { stdout: 'no\n', stderr: '' };
    });
    const { deps } = fakeDeps({ execFile });

    await expect(tryEnableLinger('alice', deps)).resolves.toBe(false);
  });
});

describe('waitForLinger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves 'on' at the third poll, 4 s in", async () => {
    let polls = 0;
    const execFile = vi.fn<ExecFile>(async () => {
      polls += 1;
      return { stdout: polls >= 3 ? 'yes\n' : 'no\n', stderr: '' };
    });
    const { deps } = fakeDeps({ execFile });
    let result: 'on' | 'off' | undefined;
    void waitForLinger('alice', new Promise<void>(() => {}), deps).then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(3_999);
    expect(result).toBeUndefined();
    expect(polls).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe('on');
    expect(polls).toBe(3);
  });

  it("resolves 'off' when skip settles first and stops polling", async () => {
    const { deps } = fakeDeps({ execFile: vi.fn(showUser('no')) });
    let pressEnter!: () => void;
    const skip = new Promise<void>((resolve) => {
      pressEnter = resolve;
    });
    const waiting = waitForLinger('alice', skip, deps);

    await vi.advanceTimersByTimeAsync(2_000);
    pressEnter();
    await expect(waiting).resolves.toBe('off');

    const polls = deps.execFile.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.execFile.mock.calls.length).toBe(polls);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('persistUserManagerPath', () => {
  const file = `/home/alice/.config/environment.d/${ENVIRONMENT_D_FILE}`;

  it('writes the environment.d file once and always runs set-environment', async () => {
    const { deps, files } = fakeDeps();

    await expect(persistUserManagerPath('/home/alice/.local/bin:/usr/bin', deps)).resolves.toEqual({ file, written: true });
    expect(files.get(file)).toBe('PATH=/home/alice/.local/bin:/usr/bin\n');
    expect(deps.mkdir).toHaveBeenCalledWith('/home/alice/.config/environment.d');

    await expect(persistUserManagerPath('/home/alice/.local/bin:/usr/bin', deps)).resolves.toEqual({ file, written: false });
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    expect(deps.execFile.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['systemctl', ['--user', 'set-environment', 'PATH=/home/alice/.local/bin:/usr/bin']],
      ['systemctl', ['--user', 'set-environment', 'PATH=/home/alice/.local/bin:/usr/bin']],
    ]);
  });

  it('drops git-guard shim directories before writing', async () => {
    const { deps, files } = fakeDeps();

    await persistUserManagerPath('/home/a/.overdeck/agents/x/git-guard:/home/a/.local/bin:/usr/bin', deps);

    expect(files.get(file)).toBe('PATH=/home/a/.local/bin:/usr/bin\n');
    expect(deps.execFile).toHaveBeenCalledWith(
      'systemctl',
      ['--user', 'set-environment', 'PATH=/home/a/.local/bin:/usr/bin'],
      expect.any(Object),
    );
  });
});

describe('user name validation', () => {
  it('rejects a user name that is not a login name', async () => {
    const { deps } = fakeDeps();
    const bad = 'alice; rm -rf ~';

    expect(() => lingerSudoCommand(bad)).toThrow(`Invalid user name: ${bad}`);
    await expect(isLingerEnabled(bad, deps)).rejects.toThrow(/Invalid user name/);
    await expect(tryEnableLinger(bad, deps)).rejects.toThrow(/Invalid user name/);
    await expect(waitForLinger(bad, Promise.resolve(), deps)).rejects.toThrow(/Invalid user name/);
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('builds the sudo command for a valid user', () => {
    expect(lingerSudoCommand('alice')).toBe('sudo loginctl enable-linger alice');
  });
});
