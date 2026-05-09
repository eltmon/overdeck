/**
 * Tests for smee.ts process mode (PAN-905)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startSmeeProcess,
  stopSmeeProcess,
  isSmeeProcessRunning,
} from '../../../src/lib/smee.js';

// ─── Mock state ──────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockOpenSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
  readFileSync: (...args: Parameters<typeof mockReadFileSync>) => mockReadFileSync(...args),
  writeFileSync: (...args: Parameters<typeof mockWriteFileSync>) => mockWriteFileSync(...args),
  unlinkSync: (...args: Parameters<typeof mockUnlinkSync>) => mockUnlinkSync(...args),
  openSync: (...args: Parameters<typeof mockOpenSync>) => mockOpenSync(...args),
}));

const mockSpawnReturn = {
  pid: 12345,
  unref: vi.fn(),
  on: vi.fn(),
};
const mockSpawn = vi.fn(() => mockSpawnReturn);

vi.mock('node:child_process', () => ({
  spawn: (...args: Parameters<typeof mockSpawn>) => mockSpawn(...args),
}));

vi.mock('node:url', () => ({
  fileURLToPath: () => '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-905/src/lib/smee.ts',
}));

const mockLoadConfig = vi.fn(() => ({
  dashboard: { api_port: 3011 },
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: (...args: Parameters<typeof mockLoadConfig>) => mockLoadConfig(...args),
}));

beforeEach(() => {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockImplementation((path: string) => {
    if (path.includes('smee-url')) return 'https://smee.io/abc123';
    if (path.includes('smee.pid')) return '12345';
    return '';
  });
  mockOpenSync.mockReturnValue(3);
  mockSpawnReturn.pid = 12345;
  mockSpawnReturn.unref.mockClear();
  mockSpawnReturn.on.mockClear();
  mockSpawn.mockClear();
  mockWriteFileSync.mockClear();
  mockUnlinkSync.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('startSmeeProcess', () => {
  it('spawns smee CLI when smee-url is configured', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    startSmeeProcess();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining('node_modules/smee-client/bin/smee.js'),
        '--url',
        'https://smee.io/abc123',
        '--target',
        'http://localhost:3011/api/webhooks/github',
      ],
      expect.objectContaining({ detached: true }),
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
      '12345',
    );
    expect(mockSpawnReturn.unref).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Started process (PID 12345)'),
    );
    logSpy.mockRestore();
  });

  it('skips when smee-url file is missing', () => {
    mockExistsSync.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startSmeeProcess();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No smee-url configured'),
    );
    warnSpy.mockRestore();
  });

  it('is idempotent when already running', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

    startSmeeProcess();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[smee] Process already running');

    killSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('handles spawn failure gracefully', () => {
    mockSpawnReturn.pid = undefined;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    startSmeeProcess();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[smee] Failed to spawn smee process',
    );
    errorSpy.mockRestore();
  });
});

describe('stopSmeeProcess', () => {
  it('stops running process and removes pidfile', () => {
    mockReadFileSync.mockReturnValue('12345');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    stopSmeeProcess();

    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
    );
    expect(logSpy).toHaveBeenCalledWith('[smee] Process stopped');
    logSpy.mockRestore();
  });

  it('is safe when pidfile is missing', () => {
    mockExistsSync.mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    stopSmeeProcess();

    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[smee] Process stopped');
    logSpy.mockRestore();
  });
});

describe('isSmeeProcessRunning', () => {
  it('returns true when pidfile exists and process is alive', () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

    expect(isSmeeProcessRunning()).toBe(true);

    killSpy.mockRestore();
  });

  it('returns false when pidfile is missing', () => {
    mockExistsSync.mockReturnValue(false);

    expect(isSmeeProcessRunning()).toBe(false);
  });

  it('returns false and cleans up stale pidfile when process is dead', () => {
    mockReadFileSync.mockReturnValue('99999');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    expect(isSmeeProcessRunning()).toBe(false);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
    );

    killSpy.mockRestore();
  });
});
