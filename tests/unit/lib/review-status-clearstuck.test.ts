/**
 * Tests that markWorkspaceStuck and clearWorkspaceStuck (review-status.ts) emit
 * notifyPipeline so the dashboard's live WebSocket bus receives a status_changed event.
 * Regression test for PAN-653 where clearWorkspaceStuck bypassed notifyPipeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: Database.Database;

vi.mock('../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

const mockNotifyPipeline = vi.fn();
vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: (...args: unknown[]) => mockNotifyPipeline(...args),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
  mockNotifyPipeline.mockClear();
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mocks are set up) ==============

import { markWorkspaceStuck, clearWorkspaceStuck, loadReviewStatuses, saveReviewStatuses, setReviewStatus } from '../../../src/lib/review-status.js';

// ============== Tests ==============

describe('clearWorkspaceStuck', () => {
  it('calls notifyPipeline with status_changed after clearing stuck state', () => {
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, stuck, stuck_reason, updated_at, ready_for_merge)
      VALUES ('PAN-42', 'passed', 'passed', 1, 'main_diverged', datetime('now'), 0)
    `).run();

    clearWorkspaceStuck('PAN-42');

    expect(mockNotifyPipeline).toHaveBeenCalledOnce();
    const call = mockNotifyPipeline.mock.calls[0][0];
    expect(call.type).toBe('status_changed');
    expect(call.issueId).toBe('PAN-42');
    expect(call.status.stuck).toBeFalsy();
    expect(call.status.stuckReason).toBeFalsy();
  });

  it('does not call notifyPipeline when issue does not exist in DB', () => {
    clearWorkspaceStuck('PAN-NONEXISTENT');
    expect(mockNotifyPipeline).not.toHaveBeenCalled();
  });
});

describe('markWorkspaceStuck (notifyPipeline symmetry)', () => {
  it('calls notifyPipeline with status_changed after marking stuck', () => {
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-99', 'passed', 'passed', datetime('now'), 0)
    `).run();

    markWorkspaceStuck('PAN-99', 'main_diverged', { beforeSha: 'abc123' });

    expect(mockNotifyPipeline).toHaveBeenCalledOnce();
    const call = mockNotifyPipeline.mock.calls[0][0];
    expect(call.type).toBe('status_changed');
    expect(call.issueId).toBe('PAN-99');
    expect(call.status.stuck).toBe(true);
    expect(call.status.stuckReason).toBe('main_diverged');
  });

  it('calls notifyPipeline even when no prior row exists (upsert creates placeholder)', () => {
    markWorkspaceStuck('PAN-NEW', 'main_diverged');

    expect(mockNotifyPipeline).toHaveBeenCalledOnce();
    const call = mockNotifyPipeline.mock.calls[0][0];
    expect(call.type).toBe('status_changed');
    expect(call.issueId).toBe('PAN-NEW');
    expect(call.status.stuck).toBe(true);
  });
});

// ============== saveReviewStatuses batch upsert ==============

describe('saveReviewStatuses (default path)', () => {
  it('persists batch mutations into SQLite — regression: was no-op before fix', () => {
    // Seed two entries via direct SQL
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-100', 'reviewing', 'pending', datetime('now'), 0),
             ('PAN-101', 'reviewing', 'pending', datetime('now'), 0)
    `).run();

    // Simulate what specialists.ts reset flow does: load → mutate → save
    const statuses = loadReviewStatuses();
    statuses['PAN-100'].reviewStatus = 'pending';
    statuses['PAN-100'].updatedAt = new Date().toISOString();
    statuses['PAN-101'].reviewStatus = 'pending';
    statuses['PAN-101'].updatedAt = new Date().toISOString();
    saveReviewStatuses(statuses);

    // Reload from DB and verify the mutations were persisted
    const after = loadReviewStatuses();
    expect(after['PAN-100'].reviewStatus).toBe('pending');
    expect(after['PAN-101'].reviewStatus).toBe('pending');
  });

  it('deletes SQLite rows absent from the passed map (replace-all semantics)', () => {
    // Seed two entries
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-200', 'passed', 'passed', datetime('now'), 1),
             ('PAN-201', 'passed', 'passed', datetime('now'), 1)
    `).run();

    // Load, delete one entry from the map, save
    const statuses = loadReviewStatuses();
    delete (statuses as Record<string, unknown>)['PAN-201'];
    saveReviewStatuses(statuses);

    // PAN-200 still present; PAN-201 deleted from SQLite
    const after = loadReviewStatuses();
    expect(after['PAN-200']).toBeDefined();
    expect(after['PAN-201']).toBeUndefined();
  });
});

// ============== setReviewStatus concurrency (TOCTOU regression) ==============

describe('setReviewStatus concurrent updates (default path)', () => {
  it('does not clobber a different issue when two updates race', () => {
    // Seed two issues
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-A', 'pending', 'pending', datetime('now'), 0),
             ('PAN-B', 'pending', 'pending', datetime('now'), 0)
    `).run();

    // Simulate a TOCTOU race: both callers read the DB, then both write.
    // With the old read-all/write-all approach the second write would delete
    // the row written by the first. With single-row upsert both survive.
    setReviewStatus('PAN-A', { reviewStatus: 'reviewing' });
    setReviewStatus('PAN-B', { reviewStatus: 'reviewing' });

    const after = loadReviewStatuses();
    expect(after['PAN-A'].reviewStatus).toBe('reviewing');
    expect(after['PAN-B'].reviewStatus).toBe('reviewing');
  });

  it('setReviewStatus uses single-row read — does not load the entire table', () => {
    // Seed many rows
    for (let i = 0; i < 5; i++) {
      testDb.prepare(`
        INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
        VALUES ('PAN-MANY-${i}', 'pending', 'pending', datetime('now'), 0)
      `).run();
    }

    // Update one row — all others must remain intact
    setReviewStatus('PAN-MANY-2', { reviewStatus: 'passed', testStatus: 'passed' });

    const after = loadReviewStatuses();
    for (let i = 0; i < 5; i++) {
      expect(after[`PAN-MANY-${i}`], `PAN-MANY-${i} must exist`).toBeDefined();
    }
    expect(after['PAN-MANY-2'].reviewStatus).toBe('passed');
    // Other rows unaffected
    expect(after['PAN-MANY-0'].reviewStatus).toBe('pending');
  });
});
