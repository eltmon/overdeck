import { describe, expect, it } from 'vitest';
import {
  LINUX_INSTALL_COMMAND,
  USERSPACE_MODE_AVAILABLE,
  installPlan,
  operatorCommand,
  resolveInstallPlan,
  type InstallPlanInput,
} from '../../../../src/lib/tailscale/installer.js';

function input(overrides: Partial<InstallPlanInput> = {}): InstallPlanInput {
  return { platform: 'linux', uid: 1000, username: 'op', hasSudo: true, hasBrew: false, userspace: false, port: 3011, ...overrides };
}

describe('installPlan (D-9)', () => {
  it('runs the installer without sudo for root on Linux', () => {
    expect(installPlan(input({ uid: 0 }))).toEqual({ kind: 'pane', command: LINUX_INSTALL_COMMAND });
  });

  it('runs the installer and sets the operator when sudo is on PATH', () => {
    expect(installPlan(input())).toEqual({
      kind: 'pane',
      command: 'curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale set --operator=op',
    });
  });

  it('uses the userspace install with no sudo or when requested, once userspace mode is available', () => {
    expect(installPlan(input({ hasSudo: false, userspaceAvailable: true }))).toEqual({ kind: 'userspace' });
    expect(installPlan(input({ userspace: true, userspaceAvailable: true }))).toEqual({ kind: 'userspace' });
  });

  it('does not offer userspace while the C-1 live check is outstanding', () => {
    expect(USERSPACE_MODE_AVAILABLE).toBe(false);
    expect(installPlan(input({ hasSudo: false }))).toMatchObject({
      kind: 'manual',
      url: 'https://tailscale.com/download/linux',
      command: LINUX_INSTALL_COMMAND,
    });
    expect(installPlan(input({ userspace: true }))).toEqual({
      kind: 'pane',
      command: `${LINUX_INSTALL_COMMAND} && sudo tailscale set --operator=op`,
    });
  });

  it('uses Homebrew on macOS when it is on PATH', () => {
    expect(installPlan(input({ platform: 'darwin', hasBrew: true }))).toEqual({
      kind: 'pane',
      command: 'brew install --cask tailscale-app && open -a Tailscale',
    });
  });

  it('links the macOS package without Homebrew', () => {
    expect(installPlan(input({ platform: 'darwin', hasBrew: false }))).toMatchObject({
      kind: 'manual',
      url: 'https://pkgs.tailscale.com/stable/#macos',
    });
  });

  it('sends WSL to the Windows installer with the serve command for this port', () => {
    const plan = installPlan(input({ platform: 'wsl', port: 4000 }));
    expect(plan).toMatchObject({ kind: 'manual', url: 'https://tailscale.com/download/windows' });
    expect(plan.kind === 'manual' && plan.message).toContain('tailscale serve --bg --https=443 http://127.0.0.1:4000');
  });

  it('offers winget on native Windows', () => {
    expect(installPlan(input({ platform: 'win32' }))).toMatchObject({
      kind: 'manual',
      url: 'https://tailscale.com/download/windows',
      command: 'winget install tailscale.tailscale',
    });
  });

  it('falls back to a manual plan when the username is unsafe for a shell command', () => {
    const plan = installPlan(input({ username: 'bad name;rm' }));
    expect(plan).toMatchObject({ kind: 'manual', command: LINUX_INSTALL_COMMAND });
  });
});

describe('operatorCommand', () => {
  it('builds the set --operator command for a valid name', () => {
    expect(operatorCommand('op')).toBe('sudo tailscale set --operator=op');
    expect(operatorCommand('svc_user.1-a$')).toBe('sudo tailscale set --operator=svc_user.1-a$');
  });

  it('returns null for an unsafe name', () => {
    expect(operatorCommand('bad name;rm')).toBeNull();
    expect(operatorCommand('')).toBeNull();
    expect(operatorCommand('1abc')).toBeNull();
  });
});

describe('resolveInstallPlan', () => {
  const accessFor = (executables: string[]) => async (path: string) => {
    if (!executables.includes(path)) throw new Error('ENOENT');
  };

  it('scans PATH for sudo', async () => {
    const plan = await resolveInstallPlan({ userspace: false, port: 3011 }, {
      platform: 'linux', uid: 1000, username: 'op', access: accessFor(['/usr/bin/sudo']), pathEnv: '/usr/local/bin:/usr/bin',
    });
    expect(plan).toEqual({ kind: 'pane', command: `${LINUX_INSTALL_COMMAND} && sudo tailscale set --operator=op` });
  });

  it('scans PATH for brew on macOS', async () => {
    const plan = await resolveInstallPlan({ userspace: false, port: 3011 }, {
      platform: 'darwin', uid: 501, username: 'op', access: accessFor(['/opt/homebrew/bin/brew']), pathEnv: '/usr/bin:/opt/homebrew/bin',
    });
    expect(plan).toMatchObject({ kind: 'pane', command: 'brew install --cask tailscale-app && open -a Tailscale' });
  });

  it('returns the manual installer plan when no sudo is found', async () => {
    const plan = await resolveInstallPlan({ userspace: false, port: 3011 }, {
      platform: 'linux', uid: 1000, username: 'op', access: accessFor([]), pathEnv: '/usr/bin',
    });
    expect(plan).toMatchObject({ kind: 'manual', command: LINUX_INSTALL_COMMAND });
  });
});
