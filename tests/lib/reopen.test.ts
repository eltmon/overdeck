import { Effect } from 'effect';
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
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../helpers/overdeck-test-db.js';

// ── Overdeck DB fixture ───────────────────────────────────────────────────────

let odb: OverdeckTestDb;
let projectStub: { projectPath: string } | null = null;
const mockClearIssueClosedCache = vi.fn();

vi.mock('../../src/lib/cloister/issue-closed.js', () => ({
  clearIssueClosedCache: (...args: unknown[]) => mockClearIssueClosedCache(...args),
}));

vi.mock('../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

// PAN-946 regression: the reopen flow now resolves the project path so it can
// append a session breadcrumb beside the issue's current vBRIEF (which may live
// in completed/ or cancelled/). Stub the resolver so the test controls the
// project root and can seed the lifecycle layout below.
vi.mock('../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/projects.js')>(
    '../../src/lib/projects.js',
  );
  return {
    ...actual,
    resolveProjectFromIssue: () => projectStub,
    resolveProjectFromIssueSync: () => projectStub,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedStatus(data: Record<string, unknown>) {
  const db = odb.raw();
  for (const [issueId, s] of Object.entries(data)) {
    const row = s as Record<string, unknown>;
    db.prepare(`
      INSERT OR REPLACE INTO review_status
        (issue_id, review_status, test_status, merge_status, ready_for_merge,
         pr_url, auto_requeue_count, stuck, stuck_reason, stuck_at,
         reviewed_at_commit, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      row.stuckAt ?? null,
      row.reviewedAtCommit ?? null,
      row.updatedAt ?? new Date().toISOString(),
    );
  }
}

function readStatus(issueId: string): Record<string, unknown> | null {
  return odb.raw().prepare('SELECT * FROM review_status WHERE issue_id = ?').get(issueId) as Record<string, unknown> | null;
}

/** Create a minimal workspace directory (no longer used directly by reopen, but
 * kept for parity with callers that still pass workspacePath). */
function createWorkspace(): string {
  const wsDir = mkdtempSync(join(tmpdir(), 'pan-reopen-ws-'));
  const planningDir = join(wsDir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  return wsDir;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectStub = null;
  mockClearIssueClosedCache.mockClear();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

// ── Import under test (after mocks) ─────────────────────────────────────────

import { reopenWorkspaceState } from '../../src/lib/reopen.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reopenWorkspaceState', () => {
  it('clears the closed-issue cache for the reopened issue', async () => {
    const wsDir = createWorkspace();

    await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    expect(mockClearIssueClosedCache).toHaveBeenCalledWith('PAN-999');
  });

  it('resets review/test/merge to pending', async () => {
    seedStatus({
      'PAN-999': { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged', readyForMerge: false },
    });
    const wsDir = createWorkspace();

    const result = await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

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

  it('creates initial pending status when no prior status exists', async () => {
    const wsDir = createWorkspace();

    const result = await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    expect(result.specialistStatesReset).toBe(true);
    expect(result.previousReviewStatus).toBeNull();
    expect(result.previousTestStatus).toBeNull();

    const row = readStatus('PAN-999')!;
    expect(row.review_status).toBe('pending');
    expect(row.test_status).toBe('pending');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('preserves prUrl in status after reset', async () => {
    seedStatus({
      'PAN-999': {
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: true,
        prUrl: 'https://github.com/org/repo/pull/42',
      },
    });
    const wsDir = createWorkspace();

    await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    const row = readStatus('PAN-999')!;
    expect(row.pr_url).toBe('https://github.com/org/repo/pull/42');

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('resets autoRequeueCount to 0', async () => {
    seedStatus({
      'PAN-999': { reviewStatus: 'failed', testStatus: 'failed', readyForMerge: false, autoRequeueCount: 3 },
    });
    const wsDir = createWorkspace();

    await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    const row = readStatus('PAN-999')!;
    expect(row.auto_requeue_count).toBe(0);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('returns empty queueItemsRemoved when no queue items exist', async () => {
    const wsDir = createWorkspace();

    const result = await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    expect(result.queueItemsRemoved).toEqual({});

    rmSync(wsDir, { recursive: true, force: true });
  });

  // PAN-653 regression: reopen must clear stuck state and reviewedAtCommit
  it('clears stuck fields on reopen-after-stuck so Deacon resumes the issue', async () => {
    seedStatus({
      'PAN-999': {
        reviewStatus: 'passed',
        testStatus: 'passed',
        stuck: true,
        stuckReason: 'main_diverged',
        stuckAt: '2026-04-19T00:00:00Z',
        readyForMerge: false,
      },
    });
    const wsDir = createWorkspace();

    await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    const row = readStatus('PAN-999')!;
    expect(row.stuck).toBeFalsy();
    expect(row.stuck_reason).toBeNull();
    expect(row.stuck_at).toBeNull();

    rmSync(wsDir, { recursive: true, force: true });
  });

  it('clears reviewedAtCommit on reopen-after-reviewed so next approve records the new commit', async () => {
    seedStatus({
      'PAN-999': {
        reviewStatus: 'passed',
        testStatus: 'passed',
        reviewedAtCommit: 'abc1234',
        readyForMerge: true,
      },
    });
    const wsDir = createWorkspace();

    await Effect.runPromise(reopenWorkspaceState('PAN-999', wsDir));

    const row = readStatus('PAN-999')!;
    expect(row.reviewed_at_commit).toBeNull();

    rmSync(wsDir, { recursive: true, force: true });
  });

  // PAN-946 regression: reopen MUST append a resume breadcrumb to the per-issue
  // record. PAN-1919: the old .pan/continues/ files are retired; all session
  // history now goes through the per-issue record at .pan/records/<issue>.json.
  describe('record-aware session history appends', () => {
    function seedRecord(projectRoot: string, issueId: string): void {
      const recordDir = join(projectRoot, '.pan', 'records');
      mkdirSync(recordDir, { recursive: true });
      const now = '2026-05-04T00:00:00Z';
      writeFileSync(
        join(recordDir, `${issueId.toLowerCase()}.json`),
        JSON.stringify({
          issueId,
          schemaVersion: 2,
          created: now,
          updated: now,
          decisions: [],
          hazards: [],
          resumePoint: null,
          beadsMapping: {},
          statusOverrides: {},
          sessionHistory: [
            { timestamp: now, reason: 'planning', note: 'initial seed' },
          ],
          feedback: [],
          pipeline: null,
          closeOut: null,
        }),
        'utf-8',
      );
    }

    it('appends a resume breadcrumb to the per-issue record (PAN-1919)', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'pan-reopen-project-'));
      seedRecord(projectRoot, 'PAN-901');
      projectStub = { projectPath: projectRoot };

      seedStatus({
        'PAN-901': { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged', readyForMerge: false },
      });
      const wsDir = createWorkspace();

      const result = await Effect.runPromise(reopenWorkspaceState('PAN-901', wsDir, { reason: 'redo merge' }));
      expect(result.continueFileUpdated).toBe(true);

      const recordPath = join(projectRoot, '.pan', 'records', 'pan-901.json');
      const updated = JSON.parse(readFileSync(recordPath, 'utf-8'));
      expect(updated.sessionHistory.length).toBe(2);
      const last = updated.sessionHistory[1];
      expect(last.reason).toBe('resume');
      expect(last.timestamp).toBeTypeOf('string');
      expect(last.note).toContain('Reopened on');
      expect(last.note).toContain('reason: redo merge');
      expect(last.note).toContain('review: passed → pending');
      expect(last.note).toContain('merge: merged → pending');

      rmSync(wsDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it('appends session breadcrumb to record on review-failed reopen', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'pan-reopen-project-'));
      seedRecord(projectRoot, 'PAN-902');
      projectStub = { projectPath: projectRoot };

      seedStatus({
        'PAN-902': { reviewStatus: 'failed', testStatus: 'pending', readyForMerge: false },
      });
      const wsDir = createWorkspace();

      await Effect.runPromise(reopenWorkspaceState('PAN-902', wsDir));

      const recordPath = join(projectRoot, '.pan', 'records', 'pan-902.json');
      const updated = JSON.parse(readFileSync(recordPath, 'utf-8'));
      expect(updated.sessionHistory.length).toBe(2);
      expect(updated.sessionHistory[1].reason).toBe('resume');

      rmSync(wsDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    });
  });
});
