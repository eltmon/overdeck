/**
 * Tests for PAN-444: pending post-merge lifecycle processing.
 * Covers processPendingLifecycle() in src/dashboard/server/pending-lifecycle.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── fs/promises mock ──────────────────────────────────────────────────────────
const mockReadFile = vi.hoisted(() => vi.fn<(path: string, enc: string) => Promise<string>>());
const mockRename = vi.hoisted(() => vi.fn<(from: string, to: string) => Promise<void>>());
const mockUnlink = vi.hoisted(() => vi.fn<(path: string) => Promise<void>>());
const mockExistsSync = vi.hoisted(() => vi.fn<(path: string) => boolean>());
const mockEmitDashboardLifecycleSync = vi.hoisted(() => vi.fn());

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitDashboardLifecycleSync: mockEmitDashboardLifecycleSync,
}));

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  rename: mockRename,
  unlink: mockUnlink,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

// ── os mock — deterministic home dir ─────────────────────────────────────────
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => '/home/testuser',
  };
});

// ── Subject ───────────────────────────────────────────────────────────────────
import {
  processPendingLifecycle,
  PENDING_FILE,
  RESTART_MARKER,
  STALE_THRESHOLD_MS,
  type PendingLifecycleData,
} from '../../../src/dashboard/server/pending-lifecycle.js';

function makePendingData(overrides: Partial<PendingLifecycleData> = {}): PendingLifecycleData {
  return {
    issueId: 'PAN-999',
    projectPath: '/tmp/test-project',
    sourceBranch: 'feature/test',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('processPendingLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockExistsSync.mockReturnValue(false);
    mockRename.mockImplementation(async (from) => {
      if (mockExistsSync(from)) return;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    mockUnlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a no-op when pending file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    await processPendingLifecycle({ pendingFile: PENDING_FILE });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('emits lifecycle start from a restart marker even when no pending lifecycle file exists yet', async () => {
    const now = Date.now();
    mockExistsSync.mockImplementation((path) => path === RESTART_MARKER);
    mockReadFile.mockResolvedValue(JSON.stringify({
      reason: 'post-merge',
      issueId: 'PAN-1744',
      trigger: 'deploy-script',
      timestamp: now - 1000,
    }));
    mockUnlink.mockResolvedValue(undefined);

    await processPendingLifecycle({
      pendingFile: PENDING_FILE,
      restartMarker: RESTART_MARKER,
      now,
    });

    expect(mockReadFile).toHaveBeenCalledWith(RESTART_MARKER, 'utf-8');
    expect(mockUnlink).toHaveBeenCalledWith(RESTART_MARKER);
    expect(mockEmitDashboardLifecycleSync).toHaveBeenCalledWith('started', {
      reason: 'post-merge',
      issueId: 'PAN-1744',
      trigger: 'deploy-script',
    });
  });

  it('atomically claims and discards the pending artifact after success', async () => {
    const data = makePendingData();
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));

    await processPendingLifecycle({
      pendingFile: PENDING_FILE,
      lifecycleDelayMs: 0,
      now: data.timestamp + 1000,
      _runner: vi.fn().mockResolvedValue(undefined),
    });

    expect(mockRename).toHaveBeenCalledWith(
      PENDING_FILE,
      expect.stringContaining(`${PENDING_FILE}.claimed-`),
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining(`${PENDING_FILE}.claimed-`),
      'utf-8',
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining(`${PENDING_FILE}.claimed-`),
    );
  });

  it('discards a claimed stale artifact', async () => {
    const data = makePendingData({ timestamp: Date.now() - (STALE_THRESHOLD_MS + 1000) });
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockUnlink.mockResolvedValue(undefined);

    await processPendingLifecycle({ pendingFile: PENDING_FILE, now: Date.now() });

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining(`${PENDING_FILE}.claimed-`),
    );
  });

  it('ignores stale files (> 1h old) without running lifecycle', async () => {
    const staleTimestamp = Date.now() - (STALE_THRESHOLD_MS + 60_000);
    const data = makePendingData({ timestamp: staleTimestamp });
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockUnlink.mockResolvedValue(undefined);
    const runner = vi.fn().mockResolvedValue(undefined);

    await processPendingLifecycle({ pendingFile: PENDING_FILE, now: Date.now(), _runner: runner });
    await vi.runAllTimersAsync();

    expect(runner).not.toHaveBeenCalled();
  });

  it('schedules lifecycle runner after delay for fresh files', async () => {
    const data = makePendingData();
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockUnlink.mockResolvedValue(undefined);
    const runner = vi.fn().mockResolvedValue(undefined);

    const processing = processPendingLifecycle({
      pendingFile: PENDING_FILE,
      lifecycleDelayMs: 100,
      now: data.timestamp + 1000,
      _runner: runner,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(runner).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await processing;
    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(data);
  });

  it('passes full pending data to the runner', async () => {
    const data = makePendingData({ issueId: 'PAN-42', projectPath: '/my/proj', sourceBranch: 'feature/x' });
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockUnlink.mockResolvedValue(undefined);
    const runner = vi.fn().mockResolvedValue(undefined);

    await processPendingLifecycle({
      pendingFile: PENDING_FILE,
      lifecycleDelayMs: 0,
      now: data.timestamp + 1000,
      _runner: runner,
    });
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-42',
      projectPath: '/my/proj',
      sourceBranch: 'feature/x',
    }));
  });

  it('handles malformed JSON gracefully without throwing', async () => {
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue('not-valid-json');
    mockUnlink.mockResolvedValue(undefined);

    await expect(processPendingLifecycle({ pendingFile: PENDING_FILE })).resolves.toBeUndefined();
  });

  it('accepts files exactly at the stale boundary (1h - 1s is fresh)', async () => {
    const data = makePendingData({ timestamp: 0 });
    const now = STALE_THRESHOLD_MS - 1000; // 59m59s old → not stale
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockUnlink.mockResolvedValue(undefined);
    const runner = vi.fn().mockResolvedValue(undefined);

    await processPendingLifecycle({ pendingFile: PENDING_FILE, lifecycleDelayMs: 0, now, _runner: runner });
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledOnce();
  });

  it('rejects files exactly at the stale boundary (1h + 1s is stale)', async () => {
    const data = makePendingData({ timestamp: 0 });
    const now = STALE_THRESHOLD_MS + 1000;
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockUnlink.mockResolvedValue(undefined);
    const runner = vi.fn().mockResolvedValue(undefined);

    await processPendingLifecycle({ pendingFile: PENDING_FILE, now, _runner: runner });
    await vi.runAllTimersAsync();

    expect(runner).not.toHaveBeenCalled();
  });

  it('emits one failed terminal event and discards the claim when the runner throws', async () => {
    const data = makePendingData();
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    const runner = vi.fn().mockRejectedValue(new Error('lifecycle failed'));

    await processPendingLifecycle({
      pendingFile: PENDING_FILE,
      lifecycleDelayMs: 0,
      now: data.timestamp + 1000,
      _runner: runner,
    });

    expect(mockEmitDashboardLifecycleSync).toHaveBeenCalledTimes(1);
    expect(mockEmitDashboardLifecycleSync).toHaveBeenCalledWith('failed', expect.objectContaining({
      issueId: data.issueId,
      error: 'lifecycle failed',
    }));
    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining(`${PENDING_FILE}.claimed-`),
    );
  });

  it('runs one lifecycle and emits one terminal event when two processes see one artifact', async () => {
    const data = makePendingData();
    mockExistsSync.mockImplementation((path) => path === PENDING_FILE);
    mockReadFile.mockResolvedValue(JSON.stringify(data));
    mockRename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const runner = vi.fn().mockResolvedValue(undefined);

    const owner = processPendingLifecycle({
      pendingFile: PENDING_FILE,
      lifecycleDelayMs: 100,
      now: data.timestamp + 1000,
      _runner: runner,
    });
    await vi.advanceTimersByTimeAsync(0);
    await processPendingLifecycle({
      pendingFile: PENDING_FILE,
      lifecycleDelayMs: 0,
      now: data.timestamp + 1000,
      _runner: runner,
    });
    await vi.advanceTimersByTimeAsync(100);
    await owner;

    expect(runner).toHaveBeenCalledTimes(1);
    expect(mockEmitDashboardLifecycleSync).toHaveBeenCalledTimes(1);
    expect(mockEmitDashboardLifecycleSync).toHaveBeenCalledWith('completed', expect.objectContaining({
      issueId: data.issueId,
    }));
  });
});
