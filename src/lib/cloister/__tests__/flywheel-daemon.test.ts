/**
 * Unit tests for flywheel-daemon (PAN-709)
 *
 * Covers scaffold (start/stop/status) and async guard functions
 * (acquireLock, releaseLock, readCyclingAlerts, hasActiveClaudeSession).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile, unlink, readdir, stat } from 'fs/promises';

// ---------------------------------------------------------------------------
// Module mocks (must be before any imports from the module under test)
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
  loadCloisterConfig: () => ({}),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ mtimeMs: 0 }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  startFlywheelDaemon,
  stopFlywheelDaemon,
  isFlywheelDaemonRunning,
  getFlywheelDaemonStatus,
  setFlywheelMergeCompleteHandler,
  acquireLock,
  releaseLock,
  readCyclingAlerts,
  hasActiveClaudeSession,
} from '../flywheel-daemon.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockUnlink = vi.mocked(unlink);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

// ---------------------------------------------------------------------------
// Suite: scaffold (start/stop/status)
// ---------------------------------------------------------------------------

describe('flywheelDaemon — start/stop/status', () => {
  beforeEach(() => {
    stopFlywheelDaemon();
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
  });

  afterEach(() => {
    stopFlywheelDaemon();
  });

  it('starts without errors', () => {
    expect(() => startFlywheelDaemon()).not.toThrow();
    expect(isFlywheelDaemonRunning()).toBe(true);
  });

  it('stops without errors', () => {
    startFlywheelDaemon();
    expect(isFlywheelDaemonRunning()).toBe(true);
    expect(() => stopFlywheelDaemon()).not.toThrow();
    expect(isFlywheelDaemonRunning()).toBe(false);
  });

  it('is idempotent: double start does not create two intervals', () => {
    startFlywheelDaemon();
    startFlywheelDaemon();
    expect(isFlywheelDaemonRunning()).toBe(true);
    stopFlywheelDaemon();
    expect(isFlywheelDaemonRunning()).toBe(false);
  });

  it('is idempotent: stop when not running is a no-op', () => {
    expect(() => stopFlywheelDaemon()).not.toThrow();
    expect(isFlywheelDaemonRunning()).toBe(false);
  });

  it('getFlywheelDaemonStatus returns correct isRunning state', () => {
    expect(getFlywheelDaemonStatus().isRunning).toBe(false);
    startFlywheelDaemon();
    expect(getFlywheelDaemonStatus().isRunning).toBe(true);
    stopFlywheelDaemon();
    expect(getFlywheelDaemonStatus().isRunning).toBe(false);
  });

  it('setFlywheelMergeCompleteHandler registers without error', () => {
    const handler = vi.fn();
    expect(() => setFlywheelMergeCompleteHandler(handler)).not.toThrow();
    setFlywheelMergeCompleteHandler(() => {});
  });
});

// ---------------------------------------------------------------------------
// Suite: acquireLock / releaseLock
// ---------------------------------------------------------------------------

describe('acquireLock / releaseLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  it('acquireLock returns true when no lock file exists', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await acquireLock();
    expect(result).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('acquireLock returns false when a fresh lock file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ pid: 9999, ts: Date.now() }) as unknown as Buffer,
    );
    const result = await acquireLock();
    expect(result).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('acquireLock takes over a stale lock (>30 min old)', async () => {
    mockExistsSync.mockReturnValue(true);
    const stalTs = Date.now() - 31 * 60 * 1000;
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ pid: 9999, ts: stalTs }) as unknown as Buffer,
    );
    mockWriteFile.mockResolvedValue(undefined);
    const result = await acquireLock();
    expect(result).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('acquireLock returns false when writeFile throws', async () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockRejectedValueOnce(new Error('EPERM'));
    const result = await acquireLock();
    expect(result).toBe(false);
  });

  it('releaseLock calls unlink when lock file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    await releaseLock();
    expect(mockUnlink).toHaveBeenCalledOnce();
  });

  it('releaseLock does nothing when lock file is absent', async () => {
    mockExistsSync.mockReturnValue(false);
    await releaseLock();
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: readCyclingAlerts
// ---------------------------------------------------------------------------

describe('readCyclingAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('returns [] when state file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const alerts = await readCyclingAlerts();
    expect(alerts).toEqual([]);
  });

  it('returns [] when state file has no Cycling Alerts section', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce('## Some Other Section\n- nothing\n' as unknown as Buffer);
    const alerts = await readCyclingAlerts();
    expect(alerts).toEqual([]);
  });

  it('parses issue IDs from the Cycling Alerts section', async () => {
    mockExistsSync.mockReturnValue(true);
    const content = '## Cycling Alerts\n- PAN-100\n- PAN-200\n## Other\n';
    mockReadFile.mockResolvedValueOnce(content as unknown as Buffer);
    const alerts = await readCyclingAlerts();
    expect(alerts).toEqual(['PAN-100', 'PAN-200']);
  });

  it('returns [] when readFile throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockRejectedValueOnce(new Error('EACCES'));
    const alerts = await readCyclingAlerts();
    expect(alerts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suite: hasActiveClaudeSession
// ---------------------------------------------------------------------------

describe('hasActiveClaudeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddir.mockResolvedValue([]);
  });

  it('returns false when agents directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await hasActiveClaudeSession();
    expect(result).toBe(false);
  });

  it('returns false when agents dir is empty', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([]);
    const result = await hasActiveClaudeSession();
    expect(result).toBe(false);
  });

  it('returns false when runtime.json mtime is older than 5 minutes', async () => {
    mockExistsSync.mockReturnValue(true);
    const fakeEntry = { isDirectory: () => true, name: 'PAN-001' };
    mockReaddir.mockResolvedValue([fakeEntry] as unknown as ReturnType<typeof readdir> extends Promise<infer T> ? T : never);
    // mtime = 10 minutes ago
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 10 * 60 * 1000 } as unknown as ReturnType<typeof stat> extends Promise<infer T> ? T : never);
    const result = await hasActiveClaudeSession();
    expect(result).toBe(false);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('returns true when a recent runtime.json has state=active', async () => {
    mockExistsSync.mockReturnValue(true);
    const fakeEntry = { isDirectory: () => true, name: 'PAN-001' };
    mockReaddir.mockResolvedValue([fakeEntry] as unknown as ReturnType<typeof readdir> extends Promise<infer T> ? T : never);
    // mtime = 1 minute ago (fresh)
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 1000 } as unknown as ReturnType<typeof stat> extends Promise<infer T> ? T : never);
    mockReadFile.mockResolvedValue(JSON.stringify({ state: 'active' }) as unknown as Buffer);
    const result = await hasActiveClaudeSession();
    expect(result).toBe(true);
  });

  it('returns false when a recent runtime.json has state=idle', async () => {
    mockExistsSync.mockReturnValue(true);
    const fakeEntry = { isDirectory: () => true, name: 'PAN-001' };
    mockReaddir.mockResolvedValue([fakeEntry] as unknown as ReturnType<typeof readdir> extends Promise<infer T> ? T : never);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 1000 } as unknown as ReturnType<typeof stat> extends Promise<infer T> ? T : never);
    mockReadFile.mockResolvedValue(JSON.stringify({ state: 'idle' }) as unknown as Buffer);
    const result = await hasActiveClaudeSession();
    expect(result).toBe(false);
  });
});
