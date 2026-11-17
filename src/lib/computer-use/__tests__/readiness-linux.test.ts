import { describe, expect, it, vi } from 'vitest';

import {
  linuxReadiness,
  planLinuxInstall,
  probeLinux,
  type ExecFileFn,
  type LinuxReadinessDeps,
} from '../readiness-linux.js';

type Handler = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

const notFound: Handler = async () => {
  throw new Error('not found');
};

/** Every probe succeeds unless overridden; `which <pm>` fails unless listed in `managers`. Keys match the doctor test's okExecFile. */
function fakeExecFile(overrides: Partial<Record<string, Handler>> = {}, managers: string[] = []): ExecFileFn {
  return async (file, args) => {
    const key = file === 'which' ? args[0] : file;
    const handler = overrides[key];
    if (handler) return handler(args);
    if (file === 'which' && ['pacman', 'dnf', 'zypper', 'apk', 'apt-get'].includes(args[0])) {
      if (!managers.includes(args[0])) throw new Error('not found');
    }
    if (file === 'gsettings') return { stdout: 'true\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

const x11Env = async () => ({ ok: true as const, env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } });
const waylandEnv = async () => ({ ok: true as const, env: { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' } });

function deps(overrides: Partial<LinuxReadinessDeps> = {}): LinuxReadinessDeps {
  return {
    execFile: fakeExecFile(),
    resolveDesktopEnv: x11Env,
    runHelper: async () => ({ ok: true, capabilities: {} }),
    ...overrides,
  };
}

const check = (report: Awaited<ReturnType<typeof linuxReadiness>>, id: string) => report.checks.find((c) => c.id === id);

describe('linuxReadiness rows (PAN-5461 WI-2b)', () => {
  it('returns every row ok in FR-3 order on a ready X11 host', async () => {
    const report = await linuxReadiness({ helperLock: 'none', setupSteps: true }, deps({ execFile: fakeExecFile({}, ['apt-get']) }));
    expect(report.checks).toEqual([
      { id: 'session', label: 'Desktop session', status: 'ok', detail: 'x11 · display :1' },
      { id: 'atspi', label: 'Accessibility bindings', status: 'ok', detail: 'Importable' },
      { id: 'gnome-a11y', label: 'GNOME accessibility', status: 'ok', detail: 'On' },
      { id: 'input', label: 'Mouse and keyboard input', status: 'ok', detail: 'xdotool' },
      { id: 'screenshots', label: 'Screenshots', status: 'ok', detail: 'Built in on X11' },
      { id: 'clipboard', label: 'Clipboard', status: 'ok', detail: 'xclip' },
      { id: 'helper', label: 'Helper', status: 'ok', detail: 'Handshake ok' },
    ]);
    expect(report.session).toEqual({ ok: true, label: 'x11 · display :1' });
    expect(report.setupSteps).toEqual([]);
    expect(report.sessionType).toBe('x11');
    expect(report.display).toBe(':1');
    expect(report.helperError).toBeUndefined();
  });

  it('gives exactly [session, atspi] rows and no helper call without a session', async () => {
    const runHelper = vi.fn();
    const report = await linuxReadiness(
      { helperLock: 'wait', setupSteps: true },
      deps({
        execFile: fakeExecFile({ '/usr/bin/python3': notFound }, ['apt-get']),
        resolveDesktopEnv: async () => ({ ok: false, code: 'no_desktop_session', message: 'No desktop session' }),
        runHelper,
      }),
    );
    expect(report.checks.map((c) => c.id)).toEqual(['session', 'atspi']);
    expect(report.checks[0]).toEqual({ id: 'session', label: 'Desktop session', status: 'unavailable', detail: 'No desktop session' });
    expect(report.checks[1]?.status).toBe('missing');
    expect(report.session).toEqual({ ok: false, message: 'No desktop session' });
    expect(report.setupSteps).toEqual([]);
    expect(report.sessionType).toBe('');
    expect(report.display).toBe('');
    expect(runHelper).not.toHaveBeenCalled();
  });

  it('reports a missing atspi row as Not importable', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile({ '/usr/bin/python3': notFound }, ['apt-get']) }),
    );
    expect(check(report, 'atspi')).toEqual({ id: 'atspi', label: 'Accessibility bindings', status: 'missing', detail: 'Not importable' });
  });

  it('reports GNOME accessibility off as action, and Not GNOME without gsettings', async () => {
    const off = await linuxReadiness(
      { helperLock: 'none', setupSteps: false },
      deps({ execFile: fakeExecFile({ gsettings: async () => ({ stdout: 'false\n', stderr: '' }) }) }),
    );
    expect(check(off, 'gnome-a11y')).toMatchObject({ status: 'action', detail: 'Off' });

    const notGnome = await linuxReadiness(
      { helperLock: 'none', setupSteps: false },
      deps({ execFile: fakeExecFile({ gsettings: notFound }) }),
    );
    expect(check(notGnome, 'gnome-a11y')).toMatchObject({ status: 'ok', detail: 'Not GNOME' });
  });

  it('passes the session env to gsettings get', async () => {
    const execFile = vi.fn(fakeExecFile());
    await linuxReadiness({ helperLock: 'none', setupSteps: false }, deps({ execFile }));
    expect(execFile).toHaveBeenCalledWith(
      'gsettings',
      ['get', 'org.gnome.desktop.interface', 'toolkit-accessibility'],
      { timeout: 5000, env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } },
    );
  });

  it('reports a missing xdotool and a missing clipboard on X11', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: false },
      deps({ execFile: fakeExecFile({ xdotool: notFound, xclip: notFound, xsel: notFound }) }),
    );
    expect(check(report, 'input')).toMatchObject({ status: 'missing' });
    expect(check(report, 'input')?.detail).toContain('xdotool not installed');
    expect(check(report, 'clipboard')).toMatchObject({ status: 'missing' });
    expect(check(report, 'clipboard')?.detail).toContain('No xclip, xsel or wl-copy');
  });

  it('skips xdotool and probes grim on Wayland', async () => {
    const execFile = vi.fn(fakeExecFile({ grim: notFound }));
    const report = await linuxReadiness({ helperLock: 'none', setupSteps: false }, deps({ execFile, resolveDesktopEnv: waylandEnv }));
    const whichArgs = execFile.mock.calls.filter(([file]) => file === 'which').map(([, args]) => args[0]);
    expect(whichArgs).not.toContain('xdotool');
    expect(whichArgs).toContain('grim');
    expect(check(report, 'input')).toMatchObject({ status: 'ok', detail: 'Wayland: not used' });
    expect(check(report, 'screenshots')).toMatchObject({ status: 'missing' });
    expect(check(report, 'screenshots')?.detail).toContain('grim not installed');
    expect(check(report, 'clipboard')).toMatchObject({ status: 'ok', detail: 'wl-copy' });
  });

  it('reports grim as the screenshot tool on a ready Wayland host', async () => {
    const report = await linuxReadiness({ helperLock: 'none', setupSteps: false }, deps({ resolveDesktopEnv: waylandEnv }));
    expect(check(report, 'screenshots')).toMatchObject({ status: 'ok', detail: 'grim' });
    expect(check(report, 'session')).toMatchObject({ detail: 'wayland · display wayland-0' });
  });

  it('reports a thrown handshake error and sets helperError', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: false },
      deps({ runHelper: async () => { throw new Error('boom'); } }),
    );
    expect(check(report, 'helper')).toEqual({ id: 'helper', label: 'Helper', status: 'missing', detail: 'Handshake failed: boom' });
    expect(report.helperError).toBe('boom');
  });

  it('treats an ok:false helper response as a failed handshake', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: false },
      deps({ runHelper: async () => ({ ok: false, error: 'no atspi bus' }) }),
    );
    expect(check(report, 'helper')).toMatchObject({ status: 'missing', detail: 'Handshake failed: no atspi bus' });
    expect(report.helperError).toBe('no atspi bus');
  });
});

describe('linuxReadiness helper lock modes', () => {
  it("'if-free' with the lock busy gives the Skipped row without calling runHelper", async () => {
    const runHelper = vi.fn();
    const tryWithDesktopLock = vi.fn(async () => ({ acquired: false as const }));
    const report = await linuxReadiness(
      { helperLock: 'if-free', setupSteps: false },
      deps({ runHelper, tryWithDesktopLock }),
    );
    expect(check(report, 'helper')).toEqual({ id: 'helper', label: 'Helper', status: 'ok', detail: 'Skipped: an agent is using the desktop' });
    expect(runHelper).not.toHaveBeenCalled();
    expect(tryWithDesktopLock).toHaveBeenCalledWith(expect.any(Function), { waitMs: 2000 });
  });

  it("'if-free' with the lock free runs the handshake inside it", async () => {
    const runHelper = vi.fn(async () => ({ ok: true }));
    const tryWithDesktopLock = async <T,>(fn: () => Promise<T>) => ({ acquired: true as const, value: await fn() });
    const report = await linuxReadiness({ helperLock: 'if-free', setupSteps: false }, deps({ runHelper, tryWithDesktopLock }));
    expect(check(report, 'helper')).toMatchObject({ status: 'ok', detail: 'Handshake ok' });
    expect(runHelper).toHaveBeenCalledWith({ tool: 'handshake' }, { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' });
  });

  it("'wait' runs the handshake under withDesktopLock", async () => {
    const withDesktopLock = vi.fn(async <T,>(fn: () => Promise<T>) => fn());
    const report = await linuxReadiness({ helperLock: 'wait', setupSteps: false }, deps({ withDesktopLock }));
    expect(withDesktopLock).toHaveBeenCalledTimes(1);
    expect(check(report, 'helper')).toMatchObject({ status: 'ok' });
  });
});

describe('linuxReadiness setup steps and package managers', () => {
  const allMissing = { '/usr/bin/python3': notFound, xdotool: notFound, xclip: notFound, xsel: notFound };

  it.each([
    ['apt-get', 'Install python3-gi gir1.2-atspi-2.0 xdotool xclip'],
    ['dnf', 'Install python3-gobject at-spi2-core xdotool xclip'],
    ['pacman', 'Install python-gobject at-spi2-core xdotool xclip'],
  ])('lists install-packages with needsPassword for %s', async (manager, label) => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile(allMissing, [manager]) }),
    );
    expect(report.setupSteps).toEqual([{ id: 'install-packages', label, needsPassword: true }]);
    expect(report.checks.some((c) => c.fixCommand !== undefined)).toBe(false);
  });

  it.each([
    ['apt-get', true, undefined],
    ['dnf', true, undefined],
    ['pacman', true, undefined],
    ['zypper', false, 'sudo zypper install -y xdotool'],
    ['apk', false, 'sudo apk add xdotool'],
    [null, false, undefined],
  ] as const)('with only xdotool missing on X11 and manager %s, lists Install xdotool (needsPassword %s)', async (manager, needsPassword, fixCommand) => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile({ xdotool: notFound }, manager ? [manager] : []) }),
    );
    const expected = needsPassword
      ? { id: 'install-packages', label: 'Install xdotool', needsPassword: true }
      : { id: 'install-packages', label: 'Install xdotool' };
    expect(report.setupSteps).toEqual([expected]);
    expect(check(report, 'input')?.fixCommand).toBe(fixCommand);
  });

  it('picks the first package manager in pacman, dnf, zypper, apk, apt-get order', async () => {
    const probe = await probeLinux({ detectPackageManager: true }, deps({ execFile: fakeExecFile({}, ['apt-get', 'dnf']) }));
    expect(probe.packageManager).toBe('dnf');
  });

  it('never probes for a package manager when detection is off', async () => {
    const execFile = vi.fn(fakeExecFile({}, ['apt-get']));
    const probe = await probeLinux({ detectPackageManager: false }, deps({ execFile }));
    expect(probe.packageManager).toBeNull();
    const whichArgs = execFile.mock.calls.filter(([file]) => file === 'which').map(([, args]) => args[0]);
    expect(whichArgs).not.toContain('apt-get');
  });

  it('gives zypper rows a fixCommand and an install step without needsPassword', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile(allMissing, ['zypper']) }),
    );
    expect(check(report, 'atspi')?.fixCommand).toBe('sudo zypper install -y python3-gobject at-spi2-core');
    expect(check(report, 'input')?.fixCommand).toBe('sudo zypper install -y xdotool');
    expect(check(report, 'clipboard')?.fixCommand).toBe('sudo zypper install -y xclip');
    expect(report.setupSteps).toEqual([{ id: 'install-packages', label: 'Install python3-gobject at-spi2-core xdotool xclip' }]);
  });

  it('gives apk rows a fixCommand and an install step without needsPassword', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile({ '/usr/bin/python3': notFound }, ['apk']) }),
    );
    expect(check(report, 'atspi')?.fixCommand).toBe('sudo apk add py3-gobject3 at-spi2-core');
    expect(report.setupSteps).toEqual([{ id: 'install-packages', label: 'Install py3-gobject3 at-spi2-core' }]);
  });

  it('with no manager puts the apt-get names in the detail and lists the step without needsPassword', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile({ '/usr/bin/python3': notFound, xclip: notFound, xsel: notFound }, []) }),
    );
    expect(check(report, 'atspi')).toEqual({
      id: 'atspi',
      label: 'Accessibility bindings',
      status: 'missing',
      detail: 'Not importable — install python3-gi gir1.2-atspi-2.0 with your package manager',
    });
    expect(check(report, 'atspi')?.fixCommand).toBeUndefined();
    expect(report.setupSteps).toEqual([{ id: 'install-packages', label: 'Install python3-gi gir1.2-atspi-2.0 xclip' }]);
  });

  it('lists enable-accessibility only when gsettings reports false', async () => {
    const off = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile({ gsettings: async () => ({ stdout: 'false\n', stderr: '' }) }, ['apt-get']) }),
    );
    expect(off.setupSteps).toEqual([{ id: 'enable-accessibility', label: 'Turn on GNOME accessibility' }]);

    const on = await linuxReadiness({ helperLock: 'none', setupSteps: true }, deps({ execFile: fakeExecFile({}, ['apt-get']) }));
    expect(on.setupSteps).toEqual([]);

    const notGnome = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({ execFile: fakeExecFile({ gsettings: notFound }, ['apt-get']) }),
    );
    expect(notGnome.setupSteps).toEqual([]);
  });

  it('orders install-packages before enable-accessibility', async () => {
    const report = await linuxReadiness(
      { helperLock: 'none', setupSteps: true },
      deps({
        execFile: fakeExecFile({ xdotool: notFound, gsettings: async () => ({ stdout: 'false\n', stderr: '' }) }, ['apt-get']),
      }),
    );
    expect(report.setupSteps.map((s) => s.id)).toEqual(['install-packages', 'enable-accessibility']);
  });

  it('omits setup steps when setupSteps is false', async () => {
    const report = await linuxReadiness({ helperLock: 'none', setupSteps: false }, deps({ execFile: fakeExecFile(allMissing, ['apt-get']) }));
    expect(report.setupSteps).toEqual([]);
  });
});

describe('planLinuxInstall', () => {
  const readyProbe = {
    session: { ok: true as const, env: {}, sessionType: 'x11', display: ':1' },
    atspiOk: true,
    isWayland: false,
    xdotool: true,
    grim: true,
    clipboard: 'xclip',
    gsettings: true,
    accessibilityOn: true,
    packageManager: 'apt-get' as const,
  };

  it('returns null when nothing is missing', () => {
    expect(planLinuxInstall(readyProbe)).toBeNull();
  });

  it('includes grim for a Wayland host without it, in table order', () => {
    expect(planLinuxInstall({ ...readyProbe, isWayland: true, grim: false, clipboard: null, packageManager: 'pacman' })).toEqual({
      packageManager: 'pacman',
      packages: ['xclip', 'grim'],
      automatic: true,
    });
  });
});
