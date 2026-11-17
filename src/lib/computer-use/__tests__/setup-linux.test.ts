import { describe, expect, it, vi } from 'vitest';

import type { ProviderSession } from '../platform-types.js';
import {
  enableGnomeAccessibility,
  installCommandText,
  installPackages,
  manualInstallResult,
  type SetupExecFileFn,
} from '../setup-linux.js';

const session: ProviderSession = { label: 'x11 · display :1', env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } };

function execError(fields: { code?: number | string; stderr?: string; message?: string }): Error {
  return Object.assign(new Error(fields.message ?? 'Command failed'), fields);
}

/** `which <name>` resolves to /usr/bin/<name> for names in `onPath`; `pkexec` runs `pkexecResult`. */
function fakeExec(options: { onPath?: string[]; pkexec?: () => Promise<{ stdout: string; stderr: string }> } = {}) {
  const onPath = options.onPath ?? ['apt-get', 'dnf', 'pacman', 'gnome-terminal'];
  return vi.fn<SetupExecFileFn>(async (file, args) => {
    if (file === 'which') {
      if (onPath.includes(args[0] ?? '')) return { stdout: `/usr/bin/${args[0]}\n`, stderr: '' };
      throw execError({ code: 1 });
    }
    if (file === 'pkexec') return (options.pkexec ?? (async () => ({ stdout: '', stderr: '' })))();
    throw new Error(`unexpected ${file}`);
  });
}

describe('installCommandText', () => {
  it('builds each manager’s sudo command', () => {
    expect(installCommandText('apt-get', ['xdotool', 'xclip'])).toBe('sudo apt-get install -y xdotool xclip');
    expect(installCommandText('dnf', ['xdotool'])).toBe('sudo dnf install -y xdotool');
    expect(installCommandText('pacman', ['xdotool'])).toBe('sudo pacman -S --needed --noconfirm xdotool');
    expect(installCommandText('zypper', ['xdotool'])).toBe('sudo zypper install -y xdotool');
    expect(installCommandText('apk', ['xdotool'])).toBe('sudo apk add xdotool');
  });
});

describe('installPackages (PAN-5461 WI-4a)', () => {
  it('runs pkexec apt-get install -y with the session env and returns done', async () => {
    const execFile = fakeExec();
    const result = await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached: vi.fn() });
    expect(execFile).toHaveBeenCalledWith('pkexec', ['/usr/bin/apt-get', 'install', '-y', 'xdotool'], {
      env: session.env,
      timeout: 600_000,
    });
    expect(result).toEqual({ status: 'done', message: 'Installed xdotool.' });
    expect(execFile.mock.calls.some(([, args]) => args.includes('update'))).toBe(false);
  });

  it('uses -S --needed --noconfirm for pacman', async () => {
    const execFile = fakeExec();
    await installPackages('pacman', ['xdotool', 'xclip'], session, { execFile, spawnDetached: vi.fn() });
    expect(execFile).toHaveBeenCalledWith(
      'pkexec',
      ['/usr/bin/pacman', '-S', '--needed', '--noconfirm', 'xdotool', 'xclip'],
      { env: session.env, timeout: 600_000 },
    );
  });

  it('reports the manager missing from PATH with the command', async () => {
    const result = await installPackages('dnf', ['xdotool'], session, { execFile: fakeExec({ onPath: [] }), spawnDetached: vi.fn() });
    expect(result).toEqual({ status: 'failed', message: "Couldn't find dnf on PATH.", command: 'sudo dnf install -y xdotool' });
  });

  it('maps exit 126 to the cancelled message with the command', async () => {
    const execFile = fakeExec({ pkexec: async () => Promise.reject(execError({ code: 126 })) });
    const result = await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached: vi.fn() });
    expect(result).toEqual({
      status: 'failed',
      message: 'The password prompt was cancelled. Try again, or run the command below in a terminal.',
      command: 'sudo apt-get install -y xdotool',
    });
  });

  it('opens gnome-terminal with the script on exit 127', async () => {
    const spawnDetached = vi.fn();
    const execFile = fakeExec({ pkexec: async () => Promise.reject(execError({ code: 127 })) });
    const result = await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached });
    expect(spawnDetached).toHaveBeenCalledWith(
      'gnome-terminal',
      ['--', 'bash', '-c', 'sudo apt-get install -y xdotool; echo; read -p "Press Enter to close"'],
      session.env,
    );
    expect(result).toEqual({
      status: 'failed',
      message: 'A terminal window opened to install the packages. Enter your password there, then press Try again.',
      command: 'sudo apt-get install -y xdotool',
    });
  });

  it('falls back to a terminal when pkexec is missing (ENOENT)', async () => {
    const spawnDetached = vi.fn();
    const execFile = fakeExec({ pkexec: async () => Promise.reject(execError({ code: 'ENOENT' })) });
    const result = await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached });
    expect(spawnDetached).toHaveBeenCalledWith('gnome-terminal', expect.arrayContaining(['--', 'bash', '-c']), session.env);
    expect(result.message).toContain('A terminal window opened');
  });

  it('falls back to a terminal when no polkit agent is running', async () => {
    const spawnDetached = vi.fn();
    const execFile = fakeExec({
      onPath: ['apt-get', 'xterm'],
      pkexec: async () => Promise.reject(execError({ code: 1, stderr: 'Error executing command as another user: No authentication agent found.\n' })),
    });
    await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached });
    expect(spawnDetached).toHaveBeenCalledWith(
      'xterm',
      ['-e', 'bash', '-c', 'sudo apt-get install -y xdotool; echo; read -p "Press Enter to close"'],
      session.env,
    );
  });

  it('returns the Run this command message when no terminal is found', async () => {
    const spawnDetached = vi.fn();
    const execFile = fakeExec({ onPath: ['apt-get'], pkexec: async () => Promise.reject(execError({ code: 127 })) });
    const result = await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached });
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed',
      message: 'Run this command in a terminal, then press Try again.',
      command: 'sudo apt-get install -y xdotool',
    });
  });

  it('gives the apt-get update hint for Unable to locate package', async () => {
    const execFile = fakeExec({
      pkexec: async () => Promise.reject(execError({ code: 100, stderr: 'Reading package lists...\nE: Unable to locate package xdotool\n' })),
    });
    const result = await installPackages('apt-get', ['xdotool'], session, { execFile, spawnDetached: vi.fn() });
    expect(result).toEqual({
      status: 'failed',
      message: "apt couldn't find a package. Run sudo apt-get update, then press Try again.",
      command: 'sudo apt-get install -y xdotool',
    });
  });

  it('reports the last stderr line for any other failure', async () => {
    const execFile = fakeExec({
      pkexec: async () => Promise.reject(execError({ code: 1, stderr: 'line one\nerror: failed to lock database\n\n' })),
    });
    const result = await installPackages('pacman', ['xdotool'], session, { execFile, spawnDetached: vi.fn() });
    expect(result).toEqual({
      status: 'failed',
      message: 'Package install failed: error: failed to lock database',
      command: 'sudo pacman -S --needed --noconfirm xdotool',
    });
  });
});

describe('manualInstallResult (D-4)', () => {
  it('returns the zypper command', () => {
    expect(manualInstallResult('zypper', ['xdotool'])).toEqual({
      status: 'failed',
      message: "Overdeck can't run zypper for you. Run the command below in a terminal, then press Try again.",
      command: 'sudo zypper install -y xdotool',
    });
  });

  it('returns the apk command', () => {
    expect(manualInstallResult('apk', ['xdotool']).command).toBe('sudo apk add xdotool');
  });

  it('names the packages and gives no command without a manager', () => {
    const result = manualInstallResult(null, ['python3-gi', 'xclip']);
    expect(result).toEqual({
      status: 'failed',
      message:
        "No supported package manager found. Install python3-gi xclip (Debian/Ubuntu names) with your system's package manager, then press Try again.",
    });
    expect(result.command).toBeUndefined();
  });
});

describe('enableGnomeAccessibility (D-5)', () => {
  it('runs gsettings set with the session env and returns done', async () => {
    const execFile = vi.fn<SetupExecFileFn>(async () => ({ stdout: '', stderr: '' }));
    const result = await enableGnomeAccessibility(session, { execFile });
    expect(execFile).toHaveBeenCalledWith(
      'gsettings',
      ['set', 'org.gnome.desktop.interface', 'toolkit-accessibility', 'true'],
      { env: session.env, timeout: 5000 },
    );
    expect(result).toEqual({ status: 'done', message: 'Done. Apps opened before this need a restart to show their contents.' });
  });

  it('returns failed with the gsettings command on error', async () => {
    const execFile = vi.fn<SetupExecFileFn>(async () => Promise.reject(new Error('dbus unreachable')));
    const result = await enableGnomeAccessibility(session, { execFile });
    expect(result).toEqual({
      status: 'failed',
      message: "Couldn't turn on GNOME accessibility: dbus unreachable",
      command: 'gsettings set org.gnome.desktop.interface toolkit-accessibility true',
    });
  });
});
