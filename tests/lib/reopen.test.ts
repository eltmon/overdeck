/**
 * Tests for src/lib/reopen.ts — reopenWorkspaceState()
 *
 * Uses an in-memory SQLite DB (injected via database/index.js mock) so no
 * JSON files are needed and the test path matches the production SQLite path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/database/schema.js';

// ── In-memory DB injection ────────────────────────────────────────────────────

let testDb: Database.Database;

vi.mock('../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

vi.mock('../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
}));

vi.mock('../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedStatus(data: Record<string, unknown>) {
  for (const [issueId, s] of Object.entries(data)) {
    const row = s as Record<string, unknown>;
    testDb.prepare(`
      INSERT OR REPLACE INTO review_status
        (issue_id, review_status, test_status, merge_status, ready_for_merge,
         pr_url, auto_requeue_count, stuck, stuck_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      issueId,
      row.reviewStatus ?? 'pending',
      row.testStatus ?? 'pending',
      row.mergeStatus ?? null,
      row.readyForMerge ? 1 : 0,
      row.prUrl ?? null,
      row.autoRequeueCount ?? 0,
      row.stuck ? 1 : 0,
      row.stuckReason ?? null,
      row.updatedAt ?? new Date().toISOString(),
    );
  }
}

function readStatus(issueId: string): Record<string, unknown> | null {
  return testDb.prepare('SELECT * FROM review_status WHERE issue_id = ?').get(issueId) as Record<string, unknown> | null;
}

/** Create a minimal workspace with a .planning/STATE.md */
function createWorkspace(content?: string): string {
  const wsDir = mkdtempSync(join(tmpdir(), 'pan-reopen-ws-'));
  const planningDir = join(wsDir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(
    join(planningDir, 'STATE.md'),
    content ?? '# PAN-999\n\n**STATUS: Implementation complete**\n\nSome previous content.\n',
  );
  return wsDir;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ── Import under test (after mocks) ─────────────────────────────────────────

import { reopenWorkspaceState } from '../../src/lib/reopen.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reopenWorkspaceState', () => {
  it('resets review/test/merge to pending', () => {
    seedStatus({
      'PAN-999': { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged', readyForMerge: false },
    });
    const wsDir = createWorkspace();

    const result = reopenWorkspaceState('PAN-999', wsDir);

    expect(result.specialistStatesReset).toBe(true);
    expect(result.previousReviewStatus).toBe('passed');
    expect(result.previousTestStatus).toBe('passed');
    expect(result.previousMergeStatus).toBe('merged');

    const row = readStatus('PAN-999')!;
    expect(row.review_status).toBe('pending');
    expect(row.test_status).toBe('pending');
    expect(row.merge_status).toBe('pending');
    expect(row.ready_for_merge).toBe(0);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('creates initial pending status when no prior status exists', () => {
    const wsDir = createWorkspace();

    const result = reopenWorkspaceState('PAN-999', wsDir);

    expect(result.specialistStatesReset).toBe(true);
    expect(result.previousReviewStatus).toBeNull();
    expect(result.previousTestStatus).toBeNull();

    const row = readStatus('PAN-999')!;
    expect(row.review_status).toBe('pending');
    expect(row.test_status).toBe('pending');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('appends Reopened section to STATE.md', () => {
    const wsDir = createWorkspace('# PAN-999\n\n**STATUS: Implementation complete**\n\nSome work.\n');

    const result = reopenWorkspaceState('PAN-999', wsDir, { reason: 'Post-merge regression' });

    expect(result.stateMdUpdated).toBe(true);

    const content = readFileSync(join(wsDir, '.planning', 'STATE.md'), 'utf-8');
    expect(content).toContain('## Reopened —');
    expect(content).toContain('Post-merge regression');
    expect(content).toContain('**Previous status:** Implementation complete');
    expect(content).toContain('Specialist states reset to pending');
    expect(content).toContain('**STATUS: Implementation complete**');
    expect(content).toContain('Some work.');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('appends tracker context to STATE.md when provided', () => {
    const wsDir = createWorkspace();

    reopenWorkspaceState('PAN-999', wsDir, {
      trackerContext: '## Tracker Status\n\nUser requested fix for login bug.',
    });

    const content = readFileSync(join(wsDir, '.planning', 'STATE.md'), 'utf-8');
    expect(content).toContain('Tracker context at reopen:');
    expect(content).toContain('User requested fix for login bug.');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('does not modify STATE.md if it does not exist', () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'pan-reopen-nows-'));
    mkdirSync(join(wsDir, '.planning'), { recursive: true });

    const result = reopenWorkspaceState('PAN-999', wsDir);

    expect(result.stateMdUpdated).toBe(false);
    expect(existsSync(join(wsDir, '.planning', 'STATE.md'))).toBe(false);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('preserves prUrl in status after reset', () => {
    seedStatus({
      'PAN-999': {
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: true,
        prUrl: 'https://github.com/org/repo/pull/42',
      },
    });
    const wsDir = createWorkspace();

    reopenWorkspaceState('PAN-999', wsDir);

    const row = readStatus('PAN-999')!;
    expect(row.pr_url).toBe('https://github.com/org/repo/pull/42');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('resets autoRequeueCount to 0', () => {
    seedStatus({
      'PAN-999': { reviewStatus: 'failed', testStatus: 'failed', readyForMerge: false, autoRequeueCount: 3 },
    });
    const wsDir = createWorkspace();

    reopenWorkspaceState('PAN-999', wsDir);

    const row = readStatus('PAN-999')!;
    expect(row.auto_requeue_count).toBe(0);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('returns empty queueItemsRemoved when no queue items exist', () => {
    const wsDir = createWorkspace();

    const result = reopenWorkspaceState('PAN-999', wsDir);

    expect(result.queueItemsRemoved).toEqual({});

    rmSync(wsDir, { recursive: true, force: true });
  });
});
