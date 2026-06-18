/**
 * Tests for merge-sync.ts pending auto-merge functions (PAN-1938).
 *
 * Ports auto-merge-executor integration-adjacent tests onto overdeck.db via
 * setupOverdeckTestDb / teardownOverdeckTestDb. Verifies that the six
 * executor-facing functions work correctly against the overdeck schema
 * (snake_case columns, integer millisecond timestamps, no pr_number column).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  listDuePendingAutoMerges,
  transitionToMerging,
  markFailed,
  markBlocked,
  markMerged,
  requeueToPending,
} from '../../../../src/lib/overdeck/merge-sync.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(()  => { teardownOverdeckTestDb(odb); });

// ── seed helpers ─────────────────────────────────────────────────────────────

function seedIssue(db: ReturnType<typeof odb.raw>, id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(id, Date.now());
}

function seedPendingAutoMerge(db: ReturnType<typeof odb.raw>, opts: {
  issueId: string;
  status?: string;
  scheduledMergeAt?: string;
}): number {
  const now = Date.now();
  const scheduledMergeAt = opts.scheduledMergeAt ? Date.parse(opts.scheduledMergeAt) : now;
  const result = db.prepare(`
    INSERT INTO pending_auto_merges
      (issue_id, pr_url, project_key, forge, status, scheduled_merge_at, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.issueId,
    'https://github.com/org/repo/pull/99',
    'pan',
    'github',
    opts.status ?? 'pending',
    scheduledMergeAt,
    now,
  );
  return Number(result.lastInsertRowid);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('listDuePendingAutoMerges', () => {
  it('returns only pending entries whose scheduled_merge_at <= nowIso', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');
    seedIssue(db, 'PAN-3');

    seedPendingAutoMerge(db, { issueId: 'PAN-1', scheduledMergeAt: '2026-06-10T00:00:00.000Z' });
    seedPendingAutoMerge(db, { issueId: 'PAN-2', scheduledMergeAt: '2026-06-10T02:00:00.000Z' });
    // PAN-3 is merging, should not appear
    seedPendingAutoMerge(db, { issueId: 'PAN-3', status: 'merging', scheduledMergeAt: '2026-06-09T00:00:00.000Z' });

    const due = listDuePendingAutoMerges('2026-06-10T01:00:00.000Z');
    expect(due.map((e) => e.issueId)).toEqual(['PAN-1']);
  });

  it('maps snake_case integer columns to old PendingAutoMerge shape', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedPendingAutoMerge(db, { issueId: 'PAN-1', scheduledMergeAt: '2026-06-10T00:00:00.000Z' });

    const due = listDuePendingAutoMerges('2026-06-10T23:59:59.000Z');
    expect(due).toHaveLength(1);
    const entry = due[0]!;
    expect(entry.issueId).toBe('PAN-1');
    expect(entry.prUrl).toBe('https://github.com/org/repo/pull/99');
    expect(entry.projectKey).toBe('pan');
    expect(entry.forge).toBe('github');
    expect(entry.status).toBe('pending');
    // ISO string round-trip (not raw millis)
    expect(entry.scheduledMergeAt).toBe('2026-06-10T00:00:00.000Z');
    expect(typeof entry.scheduledAt).toBe('string');
    expect(entry.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // pr_number not in overdeck schema — should be undefined
    expect(entry.prNumber).toBeUndefined();
  });
});

describe('transitionToMerging', () => {
  it('transitions pending → merging and returns true', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1' });

    expect(transitionToMerging(id)).toBe(true);
    const row = db.prepare('SELECT status FROM pending_auto_merges WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('merging');
  });

  it('returns false if already merging', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1', status: 'merging' });
    expect(transitionToMerging(id)).toBe(false);
  });
});

describe('markFailed', () => {
  it('marks merging → failed and stores failure_reason', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1', status: 'merging' });

    expect(markFailed(id, 'merge conflict')).toBe(true);
    const row = db.prepare('SELECT status, failure_reason FROM pending_auto_merges WHERE id = ?').get(id) as any;
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('merge conflict');
  });

  it('returns false if not in merging state', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1', status: 'pending' });
    expect(markFailed(id, 'oops')).toBe(false);
  });
});

describe('markBlocked', () => {
  it('marks pending → blocked and stores failure_reason', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1' });

    expect(markBlocked(id, 'CI failing')).toBe(true);
    const row = db.prepare('SELECT status, failure_reason FROM pending_auto_merges WHERE id = ?').get(id) as any;
    expect(row.status).toBe('blocked');
    expect(row.failure_reason).toBe('CI failing');
  });
});

describe('markMerged', () => {
  it('marks merging → merged and sets merged_at', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1', status: 'merging' });

    expect(markMerged(id)).toBe(true);
    const row = db.prepare('SELECT status, merged_at FROM pending_auto_merges WHERE id = ?').get(id) as any;
    expect(row.status).toBe('merged');
    expect(row.merged_at).toBeGreaterThan(0); // stored as integer millis
  });
});

describe('requeueToPending', () => {
  it('requeues merging → pending with a new scheduled_merge_at', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1', status: 'merging' });

    const nextAt = '2026-06-11T08:00:00.000Z';
    expect(requeueToPending(id, nextAt)).toBe(true);

    const row = db.prepare('SELECT status, scheduled_merge_at FROM pending_auto_merges WHERE id = ?').get(id) as any;
    expect(row.status).toBe('pending');
    // scheduled_merge_at stored as millis — verify it matches the ISO we passed
    expect(new Date(row.scheduled_merge_at).toISOString()).toBe(nextAt);
  });

  it('returns false if not in merging state', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    const id = seedPendingAutoMerge(db, { issueId: 'PAN-1', status: 'pending' });
    expect(requeueToPending(id, '2026-06-11T08:00:00.000Z')).toBe(false);
  });
});
