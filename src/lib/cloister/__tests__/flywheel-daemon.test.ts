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
  loadCloisterConfig: vi.fn().mockReturnValue({}),
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

vi.mock('child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    if (typeof cb === 'function') setImmediate(() => cb(null, { stdout: '[]', stderr: '' }));
  }),
}));

vi.mock('../../flywheel/synthesis.js', () => ({
  runSynthesis: vi.fn().mockResolvedValue({ proposals: [], watchlist: [], processedRetros: [], filterRatio: 1 }),
}));

vi.mock('../../flywheel/issue-filer.js', () => ({
  fileFlywheelIssues: vi.fn().mockResolvedValue({ filed: [], deferred: [], errors: [] }),
}));

vi.mock('../../flywheel/retro-archiver.js', () => ({
  archiveProcessedRetros: vi.fn().mockResolvedValue({ archived: [], wontfixed: [], errors: [] }),
}));

vi.mock('../../flywheel/flywheel-report.js', () => ({
  appendFlywheelReport: vi.fn().mockResolvedValue('/tmp/test'),
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
  notifyFlywheelMergeComplete,
  acquireLock,
  releaseLock,
  readCyclingAlerts,
  hasActiveClaudeSession,
  fileSubstrateIssue,
  daemonTick,
} from '../flywheel-daemon.js';
import { loadCloisterConfig } from '../config.js';
import { execFile } from 'child_process';

const mockLoadCloisterConfig = vi.mocked(loadCloisterConfig);
const mockExecFile = vi.mocked(execFile);

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
    mockLoadCloisterConfig.mockReturnValue({});
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

// ---------------------------------------------------------------------------
// Suite: notifyFlywheelMergeComplete — quiet-hours queue
// ---------------------------------------------------------------------------

describe('notifyFlywheelMergeComplete — quiet-hours queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockLoadCloisterConfig.mockReturnValue({});
  });

  it('persists issue to queue file when called during quiet hours', async () => {
    // Force always-quiet-hours via mocked config
    mockLoadCloisterConfig.mockReturnValue({
      flywheel: { quiet_hours: '00:00-23:59', autonomous: true },
    } as ReturnType<typeof loadCloisterConfig>);

    notifyFlywheelMergeComplete('PAN-999');

    // Wait for the async queue write to complete
    await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled());

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    expect(JSON.parse(writtenContent)).toContain('PAN-999');
  });

  it('does not duplicate an issue already in the queue', async () => {
    mockLoadCloisterConfig.mockReturnValue({
      flywheel: { quiet_hours: '00:00-23:59', autonomous: true },
    } as ReturnType<typeof loadCloisterConfig>);
    // Queue already has PAN-999
    mockReadFile.mockResolvedValue(JSON.stringify(['PAN-999']) as unknown as Buffer);

    notifyFlywheelMergeComplete('PAN-999');

    // No write should happen (issue already queued)
    await new Promise(r => setTimeout(r, 50));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: fileSubstrateIssue — idempotency
// ---------------------------------------------------------------------------

describe('fileSubstrateIssue', () => {
  function makeExecFileCallback(stdout: string) {
    return (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      if (typeof cb === 'function') setImmediate(() => cb(null, { stdout, stderr: '' }));
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips filing when an open substrate-improvement issue already exists', async () => {
    // First call (list check) returns an existing issue; second call (create) should NOT happen
    mockExecFile.mockImplementation(
      makeExecFileCallback(JSON.stringify([{ number: 42 }])) as unknown as typeof execFile,
    );

    await fileSubstrateIssue('PAN-001');

    expect(mockExecFile).toHaveBeenCalledTimes(1); // only the list check, not create
    const [, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(args).toContain('list');
  });

  it('files a new issue when none exists', async () => {
    // First call (list check) returns empty; second call (create) should happen
    mockExecFile
      .mockImplementationOnce(
        makeExecFileCallback(JSON.stringify([])) as unknown as typeof execFile,
      )
      .mockImplementationOnce(
        makeExecFileCallback('') as unknown as typeof execFile,
      );

    await fileSubstrateIssue('PAN-001');

    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const createArgs = mockExecFile.mock.calls[1][1] as string[];
    expect(createArgs).toContain('create');
    expect(createArgs).toContain('--label');
    expect(createArgs).toContain('substrate-improvement');
  });
});

// ---------------------------------------------------------------------------
// Suite: daemonTick — double-scheduled path
// ---------------------------------------------------------------------------

/** Far-future timestamp: ensures nowMs - lastSynthesisAt is always > any interval, regardless
 *  of what a background tick from another test suite set lastSynthesisAt to. */
const FAR_FUTURE_MS = new Date('2099-01-01T11:00:00Z').getTime();

describe('daemonTick — double-scheduled path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Spy on Date.now so the intervals are always "overdue" regardless of module state.
    // quiet_hours is '' so isQuietHours bypasses new Date() check entirely (parseQuietHours returns null).
    vi.spyOn(Date, 'now').mockReturnValue(FAR_FUTURE_MS);
    mockExistsSync.mockReturnValue(false); // no lock file
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockLoadCloisterConfig.mockReturnValue({
      flywheel: {
        autonomous: true,
        trigger_interval_minutes: 30,
        full_cycle_interval_hours: 24,
        quiet_hours: '', // empty string → parseQuietHours returns null → isQuietHours returns false
        backoff_on_active_session: false,
        awaiting_merge_notify_threshold: 5,
      },
    } as ReturnType<typeof loadCloisterConfig>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acquires the lock exactly once when both synthesis and full-cycle are due (startup: both timestamps at 0)', async () => {
    // On first startup lastSynthesisAt=0 and lastFullCycleAt=0 — both intervals are
    // overdue. The old buggy code acquired the lock TWICE (one per if-block) and the
    // second acquire returned early, skipping the full-cycle path entirely. The fixed
    // code computes both booleans upfront and acquires the lock exactly once.
    await daemonTick();

    // Exactly one writeFile call = the lock was acquired exactly once.
    // In the old double-lock code, mockExistsSync=false means both acquires succeed
    // and writeFile is called twice.
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('does not acquire the lock when neither interval is due', async () => {
    // Use intervals that exceed any plausible Date.now() value (even from epoch 0)
    // so doSynthesis and doFullCycle are always false regardless of module state.
    mockLoadCloisterConfig.mockReturnValue({
      flywheel: {
        autonomous: true,
        trigger_interval_minutes: Number.MAX_SAFE_INTEGER,
        full_cycle_interval_hours: Number.MAX_SAFE_INTEGER,
        quiet_hours: '03:00-03:01',
        backoff_on_active_session: false,
        awaiting_merge_notify_threshold: 5,
      },
    } as ReturnType<typeof loadCloisterConfig>);

    await daemonTick();

    // No lock should be acquired (no writeFile call for lock file)
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
