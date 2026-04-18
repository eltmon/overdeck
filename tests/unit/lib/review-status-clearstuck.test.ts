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

import { markWorkspaceStuck, clearWorkspaceStuck } from '../../../src/lib/review-status.js';

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
