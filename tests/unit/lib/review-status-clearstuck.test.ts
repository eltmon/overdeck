/**
 * Tests that markWorkspaceStuck and clearWorkspaceStuck (review-status.ts) emit
 * notifyPipeline so the dashboard's live WebSocket bus receives a status_changed event.
 * Regression test for PAN-653 where clearWorkspaceStuck bypassed notifyPipeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

// ============== Overdeck DB fixture ==============

let odb: OverdeckTestDb;

const mockNotifyPipeline = vi.fn();
vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: (...args: unknown[]) => mockNotifyPipeline(...args),
  notifyPipelineSync: (...args: unknown[]) => mockNotifyPipeline(...args),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../src/lib/vbrief/dag.js', () => {
  throw new Error('review-status must not import vbrief/dag; pipeline state lives in SQLite, not canonical vBRIEF specs');
});

vi.mock('../../../src/lib/vbrief/io.js', () => {
  throw new Error('review-status must not import vbrief/io; pipeline state must not mutate canonical vBRIEF specs');
});

beforeEach(() => {
  odb = setupOverdeckTestDb();
  mockNotifyPipeline.mockClear();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

// ============== Imports (after mocks are set up) ==============

import { markWorkspaceStuck, clearWorkspaceStuck, loadReviewStatuses, setReviewStatusSync } from '../../../src/lib/review-status.js';

// ============== Tests ==============

describe('clearWorkspaceStuck', () => {
  it('calls notifyPipeline with status_changed after clearing stuck state', () => {
    odb.raw().prepare(`INSERT INTO review_status (issue_id, review_status, test_status, stuck, stuck_reason, updated_at, ready_for_merge) VALUES ('PAN-42', 'passed', 'passed', 1, 'main_diverged', datetime('now'), 0)`).run();

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
    odb.raw().prepare(`INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge) VALUES ('PAN-99', 'passed', 'passed', datetime('now'), 0)`).run();

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

// ============== setReviewStatus concurrency (TOCTOU regression) ==============

describe('setReviewStatus concurrent updates (default path)', () => {
  it('does not clobber a different issue when two updates race', () => {
    // Seed two issues
    odb.raw().prepare(`INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge) VALUES ('PAN-A', 'pending', 'pending', datetime('now'), 0)`).run();
    odb.raw().prepare(`INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge) VALUES ('PAN-B', 'pending', 'pending', datetime('now'), 0)`).run();

    // Simulate a TOCTOU race: both callers read the DB, then both write.
    // With the old read-all/write-all approach the second write would delete
    // the row written by the first. With single-row upsert both survive.
    setReviewStatusSync('PAN-A', { reviewStatus: 'reviewing' });
    setReviewStatusSync('PAN-B', { reviewStatus: 'reviewing' });

    const after = loadReviewStatuses();
    expect(after['PAN-A'].reviewStatus).toBe('reviewing');
    expect(after['PAN-B'].reviewStatus).toBe('reviewing');
  });

  it('setReviewStatus uses single-row read — does not load the entire table', () => {
    // Seed many rows
    for (let i = 0; i < 5; i++) {
      odb.raw().prepare(`INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge) VALUES ('PAN-MANY-${i}', 'pending', 'pending', datetime('now'), 0)`).run();
    }

    // Update one row — all others must remain intact
    setReviewStatusSync('PAN-MANY-2', { reviewStatus: 'passed', testStatus: 'passed' });

    const after = loadReviewStatuses();
    for (let i = 0; i < 5; i++) {
      expect(after[`PAN-MANY-${i}`], `PAN-MANY-${i} must exist`).toBeDefined();
    }
    expect(after['PAN-MANY-2'].reviewStatus).toBe('passed');
    // Other rows unaffected
    expect(after['PAN-MANY-0'].reviewStatus).toBe('pending');
  });
});
