import { describe, expect, it, vi } from 'vitest';

import { resolveDesktopEnv } from '../desktop-env.js';

const SYSTEMCTL_OUTPUT = ['DISPLAY=:1', 'XAUTHORITY=/run/user/1000/gdm/Xauthority', 'XDG_SESSION_TYPE=x11'].join('\n');

describe('resolveDesktopEnv (PAN-5452)', () => {
  it('prefers process env over systemctl for a key both set (ac1)', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: SYSTEMCTL_OUTPUT });
    const result = await resolveDesktopEnv({ env: { DISPLAY: ':0' }, execFile, existsSync: () => false });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.DISPLAY).toBe(':0');
  });

  it('does not pair session-scoped keys from a different session than the shell DISPLAY', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: SYSTEMCTL_OUTPUT });
    const result = await resolveDesktopEnv({ env: { DISPLAY: ':0' }, execFile, existsSync: () => false });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.DISPLAY).toBe(':0');
      expect(result.env.XAUTHORITY).toBeUndefined();
      expect(result.env.XDG_SESSION_TYPE).toBeUndefined();
    }
  });

  it('fills gaps from systemctl when process env is empty (ac2)', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: SYSTEMCTL_OUTPUT });
    const result = await resolveDesktopEnv({ env: {}, execFile, existsSync: () => false });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.DISPLAY).toBe(':1');
      expect(result.env.XAUTHORITY).toBe('/run/user/1000/gdm/Xauthority');
    }
  });

  it('returns no_desktop_session when systemctl fails and no display is set (ac3)', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('no systemd user manager'));
    const result = await resolveDesktopEnv({ env: {}, execFile, existsSync: () => false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_desktop_session');
      expect(result.message).toContain('No desktop session on this host');
    }
  });

  it('falls back to /run/user/<uid> for XDG_RUNTIME_DIR when it exists', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: 'DISPLAY=:1' });
    const existsSync = vi.fn((path: string) => path === '/run/user/1000');
    const result = await resolveDesktopEnv({ env: {}, execFile, existsSync, uid: () => 1000 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.XDG_RUNTIME_DIR).toBe('/run/user/1000');
  });

  it('derives DBUS_SESSION_BUS_ADDRESS from <XDG_RUNTIME_DIR>/bus when it exists (ac4)', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: 'DISPLAY=:1' });
    const existsSync = vi.fn((path: string) => path === '/run/user/1000/bus');
    const result = await resolveDesktopEnv({
      env: { XDG_RUNTIME_DIR: '/run/user/1000' },
      execFile,
      existsSync,
      uid: () => 1000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus');
  });

  it('does not set DBUS_SESSION_BUS_ADDRESS when <XDG_RUNTIME_DIR>/bus does not exist', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: 'DISPLAY=:1' });
    const result = await resolveDesktopEnv({
      env: { XDG_RUNTIME_DIR: '/run/user/1000' },
      execFile,
      existsSync: () => false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined();
  });
});
