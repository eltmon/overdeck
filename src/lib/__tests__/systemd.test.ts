import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accessMock, execAsyncMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  execAsyncMock: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: accessMock,
  };
});

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: () => execAsyncMock,
  };
});

const originalEnv = { ...process.env };
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

function restorePlatform(): void {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...originalEnv,
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    XDG_RUNTIME_DIR: '/run/user/1000',
  };
  delete process.env.CI;
  delete process.env.container;
  delete process.env.CONTAINER;
  setPlatform('linux');

  accessMock.mockImplementation(async (path: string) => {
    if (path === '/.dockerenv' || path === '/run/.containerenv') throw new Error('missing');
    return undefined;
  });
  execAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });
});

afterEach(() => {
  process.env = originalEnv;
  restorePlatform();
});

describe('systemdUserAvailable', () => {
  it('returns true when a user systemd manager and DBus session are usable', async () => {
    const { systemdUserAvailable } = await import('../systemd.js');

    await expect(systemdUserAvailable()).resolves.toBe(true);

    expect(execAsyncMock).toHaveBeenCalledTimes(2);
    expect(execAsyncMock).toHaveBeenNthCalledWith(1, 'systemctl --user --version', expect.objectContaining({
      timeout: expect.any(Number),
    }));
    expect(execAsyncMock).toHaveBeenNthCalledWith(2, 'systemctl --user is-system-running', expect.objectContaining({
      timeout: expect.any(Number),
    }));
  });

  it('returns false without throwing when systemctl is missing or unusable', async () => {
    execAsyncMock.mockRejectedValueOnce(new Error('systemctl not found'));
    const { systemdUserAvailable } = await import('../systemd.js');

    await expect(systemdUserAvailable()).resolves.toBe(false);
  });

  it('returns false when no user DBus session exists', async () => {
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
    accessMock.mockImplementation(async (path: string) => {
      if (path === '/run/user/1000/bus') throw new Error('no bus');
      if (path === '/.dockerenv' || path === '/run/.containerenv') throw new Error('missing');
      return undefined;
    });
    const { systemdUserAvailable } = await import('../systemd.js');

    await expect(systemdUserAvailable()).resolves.toBe(false);
    expect(execAsyncMock).not.toHaveBeenCalled();
  });

  it('returns false in CI, containers, and non-Linux platforms', async () => {
    const { systemdUserAvailable } = await import('../systemd.js');

    process.env.CI = 'true';
    await expect(systemdUserAvailable()).resolves.toBe(false);

    delete process.env.CI;
    process.env.container = 'docker';
    await expect(systemdUserAvailable()).resolves.toBe(false);

    delete process.env.container;
    setPlatform('darwin');
    await expect(systemdUserAvailable()).resolves.toBe(false);
  });
});

describe('supervisor systemd unit helpers', () => {
  it('renders the supervisor unit with bounded restart policy and no boot install section', async () => {
    const { renderSupervisorUnit } = await import('../systemd.js');

    const unit = renderSupervisorUnit({
      nodePath: '/usr/bin/node',
      supervisorBundle: '/opt/overdeck/dist/supervisor/server.js',
      supervisorPort: 3012,
      workingDirectory: '/opt/overdeck',
      overdeckHome: '/home/dev/.overdeck',
    });

    expect(unit).toMatchInlineSnapshot(`
      "[Unit]
      Description=Overdeck supervisor sidecar
      StartLimitIntervalSec=300
      StartLimitBurst=3

      [Service]
      Type=simple
      WorkingDirectory=/opt/overdeck
      ExecStart="/usr/bin/node" "/opt/overdeck/dist/supervisor/server.js"
      Environment="OVERDECK_SUPERVISOR_PORT=3012" "OVERDECK_HOME=/home/dev/.overdeck"
      Restart=on-failure
      RestartSec=5
      "
    `);
    expect(unit).not.toContain('[Install]');
    expect(unit).not.toContain('WantedBy=');
  });

  it('installs the unit idempotently and reloads systemd only when content changes', async () => {
    const unitDir = mkdtempSync(join(tmpdir(), 'overdeck-systemd-test-'));
    const unitText = '[Unit]\nDescription=test\n\n[Service]\nType=simple\n';
    const { installSupervisorUnit, supervisorUnitPath } = await import('../systemd.js');

    try {
      const first = await installSupervisorUnit({ unitDir, unitText });
      const second = await installSupervisorUnit({ unitDir, unitText });

      expect(first).toEqual({ path: supervisorUnitPath(unitDir), written: true });
      expect(second).toEqual({ path: supervisorUnitPath(unitDir), written: false });
      expect(readFileSync(supervisorUnitPath(unitDir), 'utf-8')).toBe(unitText);
      expect(execAsyncMock).toHaveBeenCalledTimes(1);
      expect(execAsyncMock).toHaveBeenCalledWith('systemctl --user daemon-reload', expect.any(Object));
    } finally {
      rmSync(unitDir, { recursive: true, force: true });
    }
  });

  it('reports failed unit state and returns false when the unit is absent', async () => {
    const { isSupervisorUnitFailed } = await import('../systemd.js');

    execAsyncMock.mockResolvedValueOnce({ stdout: 'failed\n', stderr: '' });
    await expect(isSupervisorUnitFailed()).resolves.toBe(true);

    execAsyncMock.mockRejectedValueOnce(new Error('unit not loaded'));
    await expect(isSupervisorUnitFailed()).resolves.toBe(false);
  });

  it('installs and starts the unit when systemd is available', async () => {
    const unitDir = mkdtempSync(join(tmpdir(), 'overdeck-systemd-start-test-'));
    const unitText = '[Unit]\nDescription=test\n\n[Service]\nType=simple\n';
    execAsyncMock.mockImplementation(async (command: string) => {
      if (command.includes('is-active')) throw new Error('inactive');
      return { stdout: '', stderr: '' };
    });
    const { startSupervisorUnitIfAvailable } = await import('../systemd.js');

    try {
      await expect(startSupervisorUnitIfAvailable({ unitDir, unitText })).resolves.toBe(true);

      expect(readFileSync(join(unitDir, 'overdeck-supervisor.service'), 'utf-8')).toBe(unitText);
      expect(execAsyncMock).toHaveBeenCalledWith('systemctl --user daemon-reload', expect.any(Object));
      expect(execAsyncMock).toHaveBeenCalledWith('systemctl --user start overdeck-supervisor.service', expect.any(Object));
    } finally {
      rmSync(unitDir, { recursive: true, force: true });
    }
  });

  it('does not restart an already-active unit', async () => {
    const { startSupervisorUnit } = await import('../systemd.js');

    await startSupervisorUnit();

    expect(execAsyncMock).toHaveBeenCalledTimes(1);
    expect(execAsyncMock).toHaveBeenCalledWith('systemctl --user is-active --quiet overdeck-supervisor.service', expect.any(Object));
  });

  it('stops an active unit through systemctl without issuing a restart command', async () => {
    const { stopSupervisorUnitIfActive } = await import('../systemd.js');

    await expect(stopSupervisorUnitIfActive()).resolves.toBe(true);

    expect(execAsyncMock).toHaveBeenCalledWith('systemctl --user stop overdeck-supervisor.service', expect.any(Object));
    expect(execAsyncMock).not.toHaveBeenCalledWith('systemctl --user start overdeck-supervisor.service', expect.any(Object));
  });

  it('does not stop an inactive unit', async () => {
    execAsyncMock.mockImplementation(async (command: string) => {
      if (command.includes('is-active')) throw new Error('inactive');
      return { stdout: '', stderr: '' };
    });
    const { stopSupervisorUnitIfActive } = await import('../systemd.js');

    await expect(stopSupervisorUnitIfActive()).resolves.toBe(false);

    expect(execAsyncMock).not.toHaveBeenCalledWith('systemctl --user stop overdeck-supervisor.service', expect.any(Object));
  });

  it('does not stop through systemd when systemd is unavailable', async () => {
    process.env.CI = 'true';
    const { stopSupervisorUnitIfActive } = await import('../systemd.js');

    await expect(stopSupervisorUnitIfActive()).resolves.toBe(false);

    expect(execAsyncMock).not.toHaveBeenCalled();
  });

  it('does not install or start the unit when systemd is unavailable', async () => {
    process.env.CI = 'true';
    const { startSupervisorUnitIfAvailable } = await import('../systemd.js');

    await expect(startSupervisorUnitIfAvailable({ unitText: 'unused' })).resolves.toBe(false);

    expect(execAsyncMock).not.toHaveBeenCalled();
  });
});
