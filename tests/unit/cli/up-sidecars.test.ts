import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { ensureHerdrMock } = vi.hoisted(() => ({ ensureHerdrMock: vi.fn() }));

vi.mock('../../../src/lib/herdr-setup/ensure.js', () => ({
  ensureHerdr: ensureHerdrMock,
  isHerdrSetupSkipped: (report: object) => 'skipped' in report,
}));

import {
  deferredSyncLogPath,
  ensureHerdrBeforeDashboard,
  spawnDeferredSync,
} from '../../../src/cli/up-sidecars.js';

afterEach(() => {
  vi.restoreAllMocks();
  ensureHerdrMock.mockReset();
});

describe('spawnDeferredSync (PAN-3956 review finding 5)', () => {
  it('logs to ~/.overdeck/logs/sync.log by default', () => {
    expect(deferredSyncLogPath('/home/op/.overdeck')).toBe('/home/op/.overdeck/logs/sync.log');
  });

  it('starts pan sync --if-changed detached with its output appended to the log, and returns the path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'up-sidecars-'));
    try {
      const logPath = join(dir, 'logs', 'sync.log');
      const child = { on: vi.fn(), unref: vi.fn() };
      const spawnImpl = vi.fn(() => child);

      const returned = await spawnDeferredSync({ selfCli: '/opt/pan/cli.js', logPath, spawnImpl: spawnImpl as never });

      expect(returned).toBe(logPath);
      expect(spawnImpl).toHaveBeenCalledWith(
        process.execPath,
        ['/opt/pan/cli.js', 'sync', '--if-changed'],
        { detached: true, stdio: ['ignore', expect.any(Number), expect.any(Number)] },
      );
      expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(child.unref).toHaveBeenCalledOnce();
      expect(readFileSync(logPath, 'utf-8')).toMatch(/--- pan sync --if-changed \(started by pan up\) \d{4}-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ensureHerdrBeforeDashboard (PAN-3956 review finding 8)', () => {
  function captureLog(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    return lines;
  }

  it('runs the up-mode pass and reports a running server', async () => {
    const lines = captureLog();
    ensureHerdrMock.mockResolvedValueOnce({
      session: 'overdeck',
      server: { running: true, managedBy: 'systemd' },
      warnings: ['a warning'],
    });
    await ensureHerdrBeforeDashboard();
    expect(ensureHerdrMock).toHaveBeenCalledWith({ mode: 'up' });
    expect(lines.join('\n')).toContain("Herdr session server 'overdeck' running (systemd)");
    expect(lines.join('\n')).toContain('a warning');
  });

  it('prints the reason and the warnings (the hand fix) when the server was not started', async () => {
    const lines = captureLog();
    ensureHerdrMock.mockResolvedValueOnce({
      session: 'overdeck',
      server: { running: false, reason: 'not started — config unsafe' },
      warnings: ['Herdr config not updated: By hand: add `resume_agents_on_restore = false`'],
    });
    await ensureHerdrBeforeDashboard();
    const text = lines.join('\n');
    expect(text).toContain('Herdr session server not running: not started — config unsafe');
    expect(text).toContain('By hand: add `resume_agents_on_restore = false`');
  });

  it('never throws, so pan up still starts the dashboard', async () => {
    captureLog();
    ensureHerdrMock.mockRejectedValueOnce(new Error('boom'));
    await expect(ensureHerdrBeforeDashboard()).resolves.toBeUndefined();
  });
});
