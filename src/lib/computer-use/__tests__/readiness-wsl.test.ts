import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTEROP_FIX, wslReadiness, type WslReadinessDeps } from '../readiness-wsl.js';

const DIR = {
  linux: '/mnt/c/Users/me/AppData/Local/Overdeck/computer-use',
  win: 'C:\\Users\\me\\AppData\\Local\\Overdeck\\computer-use',
};

function makeDeps(overrides: Partial<WslReadinessDeps> = {}): WslReadinessDeps {
  return {
    interopEnabled: () => true,
    windowsVersion: vi.fn(async () => ({ powershell: '5.1.22621.4391', build: '10.0.22631.0' })),
    resolveHelperDir: vi.fn(async () => DIR),
    runWindowsHelper: vi.fn(async () => ({ ok: true, capabilities: { platform: 'win32' } })),
    writeFile: vi.fn(async () => undefined) as unknown as WslReadinessDeps['writeFile'],
    rm: vi.fn(async () => undefined) as unknown as WslReadinessDeps['rm'],
    randomUUID: () => 'fixed-uuid',
    withDesktopLock: async <T>(fn: () => Promise<T>) => fn(),
    tryWithDesktopLock: async <T>(fn: () => Promise<T>) => ({ acquired: true as const, value: await fn() }),
    ...overrides,
  };
}

describe('wslReadiness (PAN-5462 FR-3, FR-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports interop missing with the FR-4 fix and the other three checks unavailable (ac1)', async () => {
    const deps = makeDeps({ interopEnabled: () => false });
    const report = await wslReadiness({ probeHelper: 'if-free' }, deps);

    expect(report.checks.map((check) => check.id)).toEqual(['interop', 'powershell', 'helper-dir', 'helper']);
    expect(report.checks[0]).toMatchObject({ status: 'missing', fixCommand: INTEROP_FIX });
    for (const check of report.checks.slice(1)) {
      expect(check).toMatchObject({ status: 'unavailable', detail: 'needs Windows interop' });
    }
    expect(report.session.ok).toBe(false);
    expect(deps.windowsVersion).not.toHaveBeenCalled();
  });

  it('reports PowerShell 5.1 and a windows session label with no setup steps (ac2)', async () => {
    const report = await wslReadiness({ probeHelper: 'wait' }, makeDeps());

    expect(report.checks[1]).toMatchObject({ id: 'powershell', status: 'ok' });
    expect(report.checks[1].detail.startsWith('PowerShell 5.1')).toBe(true);
    expect(report.session).toEqual({ ok: true, label: 'windows · 10.0.22631.0' });
    expect(report.setupSteps).toEqual([]);
    expect(report.checks[2]).toEqual({ id: 'helper-dir', label: 'Helper folder', status: 'ok', detail: DIR.win });
    expect(report.checks[3]).toMatchObject({ id: 'helper', status: 'ok', detail: 'handshake ok' });
  });

  it('skips the handshake when another agent holds the desktop lock, after the 2 s wait (ac3)', async () => {
    const runWindowsHelper = vi.fn(async () => ({ ok: true }));
    const waits: number[] = [];
    const deps = makeDeps({
      runWindowsHelper,
      tryWithDesktopLock: <T>(_fn: () => Promise<T>, options: { waitMs: number }) =>
        new Promise<{ acquired: false }>((resolve) => {
          waits.push(options.waitMs);
          setTimeout(() => resolve({ acquired: false }), options.waitMs);
        }),
    });

    const pending = wslReadiness({ probeHelper: 'if-free' }, deps);
    await vi.advanceTimersByTimeAsync(2_000);
    const report = await pending;

    expect(waits).toEqual([2_000]);
    expect(runWindowsHelper).not.toHaveBeenCalled();
    expect(report.checks[3]).toMatchObject({ id: 'helper', status: 'ok', detail: 'skipped: an agent is using the desktop' });
  });

  it('reports an unwritable helper dir as missing with the error message (ac4)', async () => {
    const deps = makeDeps({
      writeFile: vi.fn(async () => {
        throw new Error("EACCES: permission denied, open '/mnt/c/.../.probe-fixed-uuid'");
      }) as unknown as WslReadinessDeps['writeFile'],
    });
    const report = await wslReadiness({ probeHelper: 'wait' }, deps);

    expect(report.checks[2]).toMatchObject({
      id: 'helper-dir',
      status: 'missing',
      detail: "EACCES: permission denied, open '/mnt/c/.../.probe-fixed-uuid'",
    });
    expect(report.checks[3]).toMatchObject({ id: 'helper', status: 'unavailable' });
  });

  it('reports PowerShell missing when windowsVersion fails', async () => {
    const deps = makeDeps({
      windowsVersion: vi.fn(async () => {
        throw new Error('not found');
      }),
    });
    const report = await wslReadiness({ probeHelper: 'wait' }, deps);

    expect(report.checks[1]).toMatchObject({ status: 'missing', detail: 'powershell.exe not found or failed to start' });
    expect(report.session).toEqual({ ok: false, message: 'powershell.exe not found or failed to start' });
  });

  it('reports a failed handshake as missing with the helper message', async () => {
    const deps = makeDeps({
      runWindowsHelper: vi.fn(async () => {
        throw new Error('Windows execution policy blocked the computer-use helper');
      }),
    });
    const report = await wslReadiness({ probeHelper: 'wait' }, deps);
    expect(report.checks[3]).toMatchObject({ status: 'missing', detail: 'Windows execution policy blocked the computer-use helper' });
  });
});
