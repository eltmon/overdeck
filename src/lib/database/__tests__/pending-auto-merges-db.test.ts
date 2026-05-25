import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cancelPending,
  clearAllPending,
  getActionableAutoMerge,
  getPendingAutoMerge,
  listActionableAutoMerges,
  listActiveAutoMerges,
  listDuePendingAutoMerges,
  listPendingAutoMerges,
  listProblemAutoMerges,
  markBlocked,
  markFailed,
  scheduleAutoMerge,
  transitionToMerging,
} from '../pending-auto-merges-db.js';
import { resetDatabase } from '../index.js';

let testHome: string;

function schedule(issueId: string, scheduledMergeAt = '2026-05-25T10:00:00.000Z') {
  return scheduleAutoMerge({
    issueId,
    prUrl: `https://github.com/eltmon/panopticon-cli/pull/${issueId.split('-')[1]}`,
    prNumber: Number(issueId.split('-')[1]),
    projectKey: 'panopticon-cli',
    scheduledMergeAt,
    scheduledAt: '2026-05-25T09:00:00.000Z',
  });
}

beforeEach(() => {
  testHome = join(tmpdir(), `pan-pending-auto-merges-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.PANOPTICON_HOME = testHome;
});

afterEach(() => {
  resetDatabase();
  delete process.env.PANOPTICON_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('pending auto-merges db', () => {
  it('schedules and reads back an active auto-merge', () => {
    const entry = schedule('PAN-1486');

    expect(entry).toMatchObject({
      issueId: 'PAN-1486',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
      prNumber: 1486,
      projectKey: 'panopticon-cli',
      status: 'pending',
      scheduledMergeAt: '2026-05-25T10:00:00.000Z',
      scheduledAt: '2026-05-25T09:00:00.000Z',
    });
    expect(getPendingAutoMerge('PAN-1486')).toEqual(entry);
  });

  it('returns the existing active row when scheduling a duplicate issue', () => {
    const first = schedule('PAN-1486');
    const second = schedule('PAN-1486', '2026-05-25T11:00:00.000Z');

    expect(second).toEqual(first);
    expect(listPendingAutoMerges()).toHaveLength(1);
  });

  it('transitions pending to merging exactly once across concurrent calls', async () => {
    const entry = schedule('PAN-1486');

    const results = await Promise.all([
      Promise.resolve().then(() => transitionToMerging(entry.id)),
      Promise.resolve().then(() => transitionToMerging(entry.id)),
      Promise.resolve().then(() => transitionToMerging(entry.id)),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(getPendingAutoMerge('PAN-1486')?.status).toBe('merging');
  });

  it('cancels only pending entries', () => {
    const pending = schedule('PAN-1486');
    expect(cancelPending(pending.id, 'operator')).toBe(true);
    expect(listPendingAutoMerges()[0]).toMatchObject({
      id: pending.id,
      status: 'cancelled',
      cancelledBy: 'operator',
    });

    const merging = schedule('PAN-1486');
    expect(transitionToMerging(merging.id)).toBe(true);
    expect(cancelPending(merging.id, 'operator')).toBe(false);
    expect(getPendingAutoMerge('PAN-1486')?.status).toBe('merging');
  });

  it('keeps failed and blocked rows visible and clearable without treating them as active schedule conflicts', () => {
    const failed = schedule('PAN-3');
    const blocked = schedule('PAN-4');

    expect(transitionToMerging(failed.id)).toBe(true);
    expect(markFailed(failed.id, 'x'.repeat(1100))).toBe(true);
    expect(markBlocked(blocked.id, 'blocked by label')).toBe(true);

    expect(getPendingAutoMerge('PAN-3')).toBeNull();
    expect(getActionableAutoMerge('PAN-3')?.status).toBe('failed');
    expect(listActionableAutoMerges().map((row) => row.issueId)).toEqual(['PAN-3', 'PAN-4']);
    expect(cancelPending(failed.id, 'operator')).toBe(true);
    expect(cancelPending(blocked.id, 'operator')).toBe(true);
    expect(listActionableAutoMerges()).toEqual([]);
  });

  it('bounds active and problem auto-merge reads with explicit limits', () => {
    schedule('PAN-1', '2026-05-25T10:01:00.000Z');
    schedule('PAN-2', '2026-05-25T10:02:00.000Z');
    schedule('PAN-3', '2026-05-25T10:03:00.000Z');
    const failed = schedule('PAN-4', '2026-05-25T10:04:00.000Z');
    const blocked = schedule('PAN-5', '2026-05-25T10:05:00.000Z');
    const extraBlocked = schedule('PAN-6', '2026-05-25T10:06:00.000Z');

    transitionToMerging(failed.id);
    markFailed(failed.id, 'merge failed');
    markBlocked(blocked.id, 'blocked by label');
    markBlocked(extraBlocked.id, 'blocked by label');

    expect(listActiveAutoMerges(2).map((row) => row.issueId)).toEqual(['PAN-1', 'PAN-2']);
    expect(listProblemAutoMerges(2).map((row) => row.issueId)).toEqual(['PAN-4', 'PAN-5']);
    expect(listActionableAutoMerges(2).map((row) => row.issueId)).toEqual(['PAN-1', 'PAN-2']);
  });

  it('lists only due pending rows from SQL-filtered hot-path reads', () => {
    schedule('PAN-1', '2026-05-25T09:59:59.000Z');
    schedule('PAN-2', '2026-05-25T10:10:00.000Z');
    const merging = schedule('PAN-3', '2026-05-25T09:58:00.000Z');
    transitionToMerging(merging.id);

    expect(listDuePendingAutoMerges('2026-05-25T10:00:00.000Z').map((row) => row.issueId)).toEqual(['PAN-1']);
  });

  it('clears pending entries and leaves non-pending history intact', () => {
    schedule('PAN-1');
    const merging = schedule('PAN-2');
    const failed = schedule('PAN-3');
    const blocked = schedule('PAN-4');

    transitionToMerging(merging.id);
    transitionToMerging(failed.id);
    markFailed(failed.id, 'x'.repeat(1100));
    markBlocked(blocked.id, 'blocked by label');

    expect(clearAllPending()).toBe(1);

    const rows = listPendingAutoMerges();
    expect(rows.map((row) => row.issueId).sort()).toEqual(['PAN-2', 'PAN-3', 'PAN-4']);
    expect(rows.find((row) => row.issueId === 'PAN-3')?.failureReason).toHaveLength(1024);
  });

  it('does not let delayed eligibility blocking overwrite a cancelled row', () => {
    const entry = schedule('PAN-1486');

    expect(cancelPending(entry.id, 'operator')).toBe(true);
    expect(markBlocked(entry.id, 'CI checks failing')).toBe(false);
    expect(listPendingAutoMerges()[0]).toMatchObject({ status: 'cancelled', cancelledBy: 'operator' });
  });
});
