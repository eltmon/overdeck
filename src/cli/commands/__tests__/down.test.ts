import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stopSmeeProcess: vi.fn(),
  stopSupervisorUnitIfActive: vi.fn(async () => false),
  isSupervisorRunning: vi.fn(() => false),
  stopSupervisorProcess: vi.fn(),
  stopDashboard: vi.fn(async () => {}),
  readPlatformConfig: vi.fn(() => ({})),
  killAllReviewSessions: vi.fn(async () => ({ killed: [] as string[], failed: [] as string[] })),
  isCliproxyRunning: vi.fn(async () => false),
  stopCliproxy: vi.fn(async () => {}),
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('../../../lib/smee.js', () => ({ stopSmeeProcess: mocks.stopSmeeProcess }));
vi.mock('../../../lib/supervisor.js', () => ({
  isSupervisorRunning: mocks.isSupervisorRunning,
  stopSupervisorProcess: mocks.stopSupervisorProcess,
}));
vi.mock('../../../lib/systemd.js', () => ({ stopSupervisorUnitIfActive: mocks.stopSupervisorUnitIfActive }));
vi.mock('../../../lib/platform-lifecycle.js', () => ({
  stopDashboard: mocks.stopDashboard,
  readPlatformConfig: mocks.readPlatformConfig,
}));
vi.mock('../../../lib/cloister/review-agent.js', () => ({ killAllReviewSessions: mocks.killAllReviewSessions }));
vi.mock('../../../lib/cliproxy.js', () => ({
  isCliproxyRunning: mocks.isCliproxyRunning,
  stopCliproxy: mocks.stopCliproxy,
}));

import { downCommand } from '../down.js';

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('pan down (PAN-5342 extraction)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'overdeck-down-'));
    mkdirSync(join(home, '.overdeck', 'traefik'), { recursive: true });
    writeFileSync(join(home, '.overdeck', 'config.toml'), '[traefik]\nenabled = true\n\n[dashboard]\nport = 4010\napi_port = 4011\n');
    vi.stubEnv('HOME', home);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(null, '', '');
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it('stops Traefik through an async docker compose down in the Traefik directory', async () => {
    await downCommand({});

    expect(mocks.execFile).toHaveBeenCalledOnce();
    const [file, args, options] = mocks.execFile.mock.calls[0]!;
    expect(file).toBe('docker');
    expect(args).toEqual(['compose', 'down']);
    expect(options).toEqual({ cwd: join(home, '.overdeck', 'traefik'), timeout: 60_000 });
  });

  it('stops the dashboard with the configured ports and runs the rest of the teardown', async () => {
    await downCommand({});

    expect(mocks.stopSmeeProcess).toHaveBeenCalledOnce();
    expect(mocks.stopSupervisorUnitIfActive).toHaveBeenCalledOnce();
    expect(mocks.stopDashboard).toHaveBeenCalledWith(expect.objectContaining({ dashboardPort: 4010, dashboardApiPort: 4011 }));
    expect(mocks.killAllReviewSessions).toHaveBeenCalledOnce();
    expect(mocks.isCliproxyRunning).toHaveBeenCalledOnce();
  });

  it('kills review sessions after the dashboard stops and before Traefik stops (PAN-931)', async () => {
    const order: string[] = [];
    mocks.stopDashboard.mockImplementation(async () => { order.push('dashboard'); });
    mocks.killAllReviewSessions.mockImplementation(async () => {
      order.push('review-sessions');
      return { killed: [], failed: [] };
    });
    mocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      order.push('traefik');
      callback(null, '', '');
    });

    await downCommand({});

    expect(order).toEqual(['dashboard', 'review-sessions', 'traefik']);
  });

  it('skips Traefik with --skip-traefik', async () => {
    await downCommand({ skipTraefik: true });

    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('keeps going when docker compose down fails', async () => {
    mocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(new Error('docker: not found'), '', '');
    });

    await downCommand({});

    expect(mocks.isCliproxyRunning).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('Failed to stop Traefik');
  });
});
