import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(
    tmpdir(),
    `pan-1418-auto-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('auto-merge-db', () => {
  it('creates the auto_merge table through schema migration', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();

    const table = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auto_merge'`).get() as { name: string } | undefined;
    const userVersion = db.pragma('user_version', { simple: true });

    expect(table?.name).toBe('auto_merge');
    expect(userVersion).toBe(41);
  });

  it('schedules a pending auto merge and returns normalized status', async () => {
    const { schedulePendingAutoMerge, getAutoMergeStatus } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('pan-1418', '2026-05-23T12:00:00.000Z')).toBe(true);

    const row = getAutoMergeStatus('pan-1418');
    expect(row).toMatchObject({
      issueId: 'PAN-1418',
      executeAt: '2026-05-23T12:00:00.000Z',
      status: 'pending',
      cancelReason: null,
      abortReason: null,
    });
    expect(row?.scheduledAt).toBeTruthy();
  });

  it('does not update an existing pending row when scheduling idempotently', async () => {
    const { schedulePendingAutoMerge, getAutoMergeStatus } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T13:00:00.000Z')).toBe(false);

    expect(getAutoMergeStatus('PAN-1418')?.executeAt).toBe('2026-05-23T12:00:00.000Z');
  });

  it('can schedule again after a terminal non-pending status', async () => {
    const { schedulePendingAutoMerge, cancelPendingAutoMerge, getAutoMergeStatus } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(cancelPendingAutoMerge('PAN-1418', 'manual')).toBe(true);
    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T13:00:00.000Z')).toBe(true);

    expect(getAutoMergeStatus('PAN-1418')).toMatchObject({
      executeAt: '2026-05-23T13:00:00.000Z',
      status: 'pending',
      cancelReason: null,
      abortReason: null,
    });
  });

  it('atomically cancels only pending rows', async () => {
    const { schedulePendingAutoMerge, cancelPendingAutoMerge, markAutoMergeExecuting, getAutoMergeStatus } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(cancelPendingAutoMerge('PAN-1418', 'manual')).toBe(true);
    expect(cancelPendingAutoMerge('PAN-1418', 'duplicate')).toBe(false);
    expect(getAutoMergeStatus('PAN-1418')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'manual',
    });

    expect(schedulePendingAutoMerge('PAN-1419', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(markAutoMergeExecuting('PAN-1419')).toBe(true);
    expect(cancelPendingAutoMerge('PAN-1419', 'late')).toBe(false);
    expect(getAutoMergeStatus('PAN-1419')?.status).toBe('executing');
  });

  it('atomically transitions pending to executing and loses to cancellation', async () => {
    const { schedulePendingAutoMerge, cancelPendingAutoMerge, markAutoMergeExecuting, getAutoMergeStatus } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(cancelPendingAutoMerge('PAN-1418', 'operator')).toBe(true);
    expect(markAutoMergeExecuting('PAN-1418')).toBe(false);
    expect(getAutoMergeStatus('PAN-1418')?.status).toBe('cancelled');

    expect(schedulePendingAutoMerge('PAN-1419', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(markAutoMergeExecuting('PAN-1419')).toBe(true);
    expect(markAutoMergeExecuting('PAN-1419')).toBe(false);
    expect(getAutoMergeStatus('PAN-1419')?.status).toBe('executing');
  });

  it('marks executing rows executed or failed and pending or executing rows aborted', async () => {
    const {
      schedulePendingAutoMerge,
      markAutoMergeExecuting,
      markAutoMergeExecuted,
      markAutoMergeAborted,
      markAutoMergeFailed,
      getAutoMergeStatus,
    } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(markAutoMergeExecuting('PAN-1418')).toBe(true);
    markAutoMergeExecuted('PAN-1418');
    expect(getAutoMergeStatus('PAN-1418')?.status).toBe('executed');

    expect(schedulePendingAutoMerge('PAN-1419', '2026-05-23T12:00:00.000Z')).toBe(true);
    markAutoMergeAborted('PAN-1419', 'stale');
    expect(getAutoMergeStatus('PAN-1419')).toMatchObject({ status: 'aborted', abortReason: 'stale' });

    expect(schedulePendingAutoMerge('PAN-1420', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(markAutoMergeExecuting('PAN-1420')).toBe(true);
    markAutoMergeFailed('PAN-1420', 'trigger-failed');
    expect(getAutoMergeStatus('PAN-1420')).toMatchObject({ status: 'failed', abortReason: 'trigger-failed' });
  });

  it('returns pending auto merges ordered by executeAt', async () => {
    const { schedulePendingAutoMerge, cancelPendingAutoMerge, getPendingAutoMerges } = await import('../auto-merge-db.js');

    expect(schedulePendingAutoMerge('PAN-1420', '2026-05-23T12:20:00.000Z')).toBe(true);
    expect(schedulePendingAutoMerge('PAN-1418', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(schedulePendingAutoMerge('PAN-1419', '2026-05-23T12:10:00.000Z')).toBe(true);
    expect(cancelPendingAutoMerge('PAN-1419', 'manual')).toBe(true);

    expect(getPendingAutoMerges().map((row) => row.issueId)).toEqual(['PAN-1418', 'PAN-1420']);
  });

  it('returns null for missing issue status', async () => {
    const { getAutoMergeStatus } = await import('../auto-merge-db.js');

    expect(getAutoMergeStatus('PAN-9999')).toBeNull();
  });
});
