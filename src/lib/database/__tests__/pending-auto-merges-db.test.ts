import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cancelPending,
  clearAllPending,
  getPendingAutoMerge,
  listPendingAutoMerges,
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

  it('clears pending entries and leaves non-pending history intact', () => {
    schedule('PAN-1');
    const merging = schedule('PAN-2');
    const failed = schedule('PAN-3');
    const blocked = schedule('PAN-4');

    transitionToMerging(merging.id);
    markFailed(failed.id, 'x'.repeat(1100));
    markBlocked(blocked.id, 'blocked by label');

    expect(clearAllPending()).toBe(1);

    const rows = listPendingAutoMerges();
    expect(rows.map((row) => row.issueId).sort()).toEqual(['PAN-2', 'PAN-3', 'PAN-4']);
    expect(rows.find((row) => row.issueId === 'PAN-3')?.failureReason).toHaveLength(1024);
  });
});
