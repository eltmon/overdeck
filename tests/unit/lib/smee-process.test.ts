/**
 * Tests for smee.ts process mode (PAN-905)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startSmeeProcessSync,
  stopSmeeProcessSync,
  isSmeeProcessRunningSync,
} from '../../../src/lib/smee.js';

// ─── Mock state ──────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockOpenSync = vi.fn();
const mockCloseSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
  readFileSync: (...args: Parameters<typeof mockReadFileSync>) => mockReadFileSync(...args),
  writeFileSync: (...args: Parameters<typeof mockWriteFileSync>) => mockWriteFileSync(...args),
  unlinkSync: (...args: Parameters<typeof mockUnlinkSync>) => mockUnlinkSync(...args),
  openSync: (...args: Parameters<typeof mockOpenSync>) => mockOpenSync(...args),
  closeSync: (...args: Parameters<typeof mockCloseSync>) => mockCloseSync(...args),
  readdirSync: (...args: Parameters<typeof mockReaddirSync>) => mockReaddirSync(...args),
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
  fileURLToPath: () => '/home/eltmon/Projects/overdeck/workspaces/feature-pan-905/src/lib/smee.ts',
}));

const mockLoadConfig = vi.fn(() => ({
  dashboard: { api_port: 3011 },
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: (...args: Parameters<typeof mockLoadConfig>) => mockLoadConfig(...args),
  loadConfigSync: (...args: Parameters<typeof mockLoadConfig>) => mockLoadConfig(...args),
}));

beforeEach(() => {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockImplementation((path: string) => {
    if (path.includes('smee-url')) return 'https://smee.io/abc123';
    if (path.includes('smee.pid')) return '12345';
    if (path.includes('/proc/12345/cmdline')) return '';
    return '';
  });
  mockOpenSync.mockReturnValue(3);
  mockReaddirSync.mockReturnValue([]);
  mockSpawnReturn.pid = 12345;
  mockSpawnReturn.unref.mockClear();
  mockSpawnReturn.on.mockClear();
  mockSpawn.mockClear();
  mockWriteFileSync.mockClear();
  mockUnlinkSync.mockClear();
  mockCloseSync.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('startSmeeProcess', () => {
  it('spawns smee CLI when smee-url is configured', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // The mocked pidfile returns PID 12345; without mocking process.kill,
    // isProcessAlive() probes the real host process table and the test
    // becomes flaky (passes only when PID 12345 happens to be dead).
    // Force "not alive" so startSmeeProcess proceeds to spawn.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    startSmeeProcessSync();

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
    killSpy.mockRestore();
  });

  it('skips when smee-url file is missing', () => {
    mockExistsSync.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startSmeeProcessSync();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No smee-url configured'),
    );
    warnSpy.mockRestore();
  });

  it('is idempotent when already running', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);
    mockReaddirSync.mockReturnValue(['12345']);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('smee-url')) return 'https://smee.io/abc123';
      if (path.includes('smee.pid')) return '12345';
      if (path.includes('/proc/12345/cmdline')) {
        return 'node\0/home/eltmon/project/node_modules/smee-client/bin/smee.js\0--url\0https://smee.io/abc123\0--target\0http://localhost:3011/api/webhooks/github\0';
      }
      return '';
    });

    startSmeeProcessSync();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[smee] Process already running');

    killSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('adopts an orphaned matching relay instead of spawning a duplicate', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0 && pid === 22222) return true;
      throw new Error('ESRCH');
    });
    mockReaddirSync.mockReturnValue(['22222']);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('smee-url')) return 'https://smee.io/abc123';
      if (path.includes('smee.pid')) return '12345';
      if (path.includes('/proc/22222/cmdline')) {
        return 'bun\0/home/eltmon/project/node_modules/smee-client/bin/smee.js\0--url\0https://smee.io/abc123\0--target\0http://localhost:3011/api/webhooks/github\0';
      }
      return '';
    });

    startSmeeProcessSync();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
      '22222',
    );
    expect(logSpy).toHaveBeenCalledWith('[smee] Process already running');
    killSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('keeps one matching relay and terminates duplicates', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0 && (pid === 11111 || pid === 22222)) return true;
      if (signal === 'SIGTERM' && pid === 22222) return true;
      throw new Error('ESRCH');
    });
    mockReaddirSync.mockReturnValue(['11111', '22222']);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('smee-url')) return 'https://smee.io/abc123';
      if (path.includes('smee.pid')) return '11111';
      if (path.includes('/proc/11111/cmdline') || path.includes('/proc/22222/cmdline')) {
        return 'node\0/home/eltmon/project/node_modules/smee-client/bin/smee.js\0--url\0https://smee.io/abc123\0--target\0http://localhost:3011/api/webhooks/github\0';
      }
      return '';
    });

    startSmeeProcessSync();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith(22222, 'SIGTERM');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
      '11111',
    );
    expect(warnSpy).toHaveBeenCalledWith('[smee] Removed duplicate process(es): 22222');
    expect(logSpy).toHaveBeenCalledWith('[smee] Process already running');
    killSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('handles spawn failure gracefully', () => {
    mockSpawnReturn.pid = undefined;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // See note above: force isProcessAlive() to report "not alive" so the
    // mocked-12345 pidfile doesn't make this test flaky against the host.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    startSmeeProcessSync();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[smee] Failed to spawn smee process',
    );
    errorSpy.mockRestore();
    killSpy.mockRestore();
  });
});

describe('stopSmeeProcess', () => {
  it('stops running process and removes pidfile', () => {
    mockReadFileSync.mockReturnValue('12345');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    stopSmeeProcessSync();

    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
    );
    expect(logSpy).toHaveBeenCalledWith('[smee] Process stopped');
    logSpy.mockRestore();
  });

  it('is safe when pidfile is missing', () => {
    mockExistsSync.mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    stopSmeeProcessSync();

    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[smee] Process stopped');
    logSpy.mockRestore();
  });
});

describe('isSmeeProcessRunning', () => {
  it('returns true when pidfile exists and process is alive', () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

    expect(isSmeeProcessRunningSync()).toBe(true);

    killSpy.mockRestore();
  });

  it('returns false when pidfile is missing', () => {
    mockExistsSync.mockReturnValue(false);

    expect(isSmeeProcessRunningSync()).toBe(false);
  });

  it('returns false and cleans up stale pidfile when process is dead', () => {
    mockReadFileSync.mockReturnValue('99999');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    expect(isSmeeProcessRunningSync()).toBe(false);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('smee.pid'),
    );

    killSpy.mockRestore();
  });
});
