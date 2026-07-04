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
