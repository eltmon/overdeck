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
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/database/schema.js';

// ── In-memory DB injection ────────────────────────────────────────────────────

let testDb: Database.Database;
let projectStub: { projectPath: string } | null = null;

vi.mock('../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
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
  for (const [issueId, s] of Object.entries(data)) {
    const row = s as Record<string, unknown>;
    testDb.prepare(`
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
  return testDb.prepare('SELECT * FROM review_status WHERE issue_id = ?').get(issueId) as Record<string, unknown> | null;
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
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
  projectStub = null;
});

afterEach(() => {
  testDb.close();
});

// ── Import under test (after mocks) ─────────────────────────────────────────

import { reopenWorkspaceState } from '../../src/lib/reopen.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reopenWorkspaceState', () => {
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

  // PAN-946 regression: when a continue file already exists at the canonical path,
  // reopen MUST append the resume breadcrumb to that file rather than creating
  // a new one alongside a lifecycle directory.
  describe('lifecycle-aware continue file appends', () => {
    function seedContinueFile(projectRoot: string, issueId: string): string {
      const continueDir = join(projectRoot, '.pan', 'continues');
      mkdirSync(continueDir, { recursive: true });
      const continuePath = join(continueDir, `${issueId.toLowerCase()}.vbrief.json`);
      writeFileSync(
        continuePath,
        JSON.stringify({
          version: '1',
          issueId,
          created: '2026-05-04T00:00:00Z',
          updated: '2026-05-04T00:00:00Z',
          gitState: {},
          decisions: [],
          hazards: [],
          resumePoint: null,
          beadsMapping: {},
          sessionHistory: [
            { timestamp: '2026-05-04T00:00:00Z', reason: 'planning', note: 'initial seed' },
          ],
        }),
        'utf-8',
      );
      return continuePath;
    }

    it('appends to a continue file in .pan/continues/ rather than creating a new one', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'pan-reopen-project-'));
      const continuePath = seedContinueFile(projectRoot, 'PAN-901');
      const activeContinuePath = join(projectRoot, 'vbrief', 'active', 'continue-PAN-901.vbrief.json');
      projectStub = { projectPath: projectRoot };

      seedStatus({
        'PAN-901': { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged', readyForMerge: false },
      });
      const wsDir = createWorkspace();

      const result = await Effect.runPromise(reopenWorkspaceState('PAN-901', wsDir, { reason: 'redo merge' }));
      expect(result.continueFileUpdated).toBe(true);

      // Active dir must NOT have been auto-created with a fresh continue file.
      expect(existsSync(activeContinuePath)).toBe(false);

      // Existing continue file in .pan/continues/ should have grown by exactly one entry.
      const updated = JSON.parse(readFileSync(continuePath, 'utf-8'));
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

    it('appends to existing continue file without creating one in vbrief/active/', async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'pan-reopen-project-'));
      const continuePath = seedContinueFile(projectRoot, 'PAN-902');
      const activeContinuePath = join(projectRoot, 'vbrief', 'active', 'continue-PAN-902.vbrief.json');
      projectStub = { projectPath: projectRoot };

      seedStatus({
        'PAN-902': { reviewStatus: 'failed', testStatus: 'pending', readyForMerge: false },
      });
      const wsDir = createWorkspace();

      await Effect.runPromise(reopenWorkspaceState('PAN-902', wsDir));

      expect(existsSync(activeContinuePath)).toBe(false);

      const updated = JSON.parse(readFileSync(continuePath, 'utf-8'));
      expect(updated.sessionHistory.length).toBe(2);
      expect(updated.sessionHistory[1].reason).toBe('resume');

      rmSync(wsDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    });
  });
});
