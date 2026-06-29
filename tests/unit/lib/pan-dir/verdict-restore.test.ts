/**
 * Tests for PAN-1922 verdict restoration from per-issue permanent records.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

// ============== In-memory overdeck DB (for no-loss audit tests) ==============
// verdict-restore writes review_status through review-status.js which uses overdeck.
// We keep testDb for schema-audit tests (which inspect the panopticon.db DDL).

let testDb: SqliteDatabase;
let odb: OverdeckTestDb;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

const mockUpdateIssueRecordForIssue = vi.hoisted(() => vi.fn());
const mockLoadProjectsConfigSync = vi.hoisted(() => vi.fn());
const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/records.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/records.js')>(
    '../../../../src/lib/pan-dir/records.js',
  );
  return {
    ...actual,
    updateIssueRecordForIssue: mockUpdateIssueRecordForIssue,
  };
});

vi.mock('../../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/projects.js')>(
    '../../../../src/lib/projects.js',
  );
  return {
    ...actual,
    loadProjectsConfigSync: mockLoadProjectsConfigSync,
    resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
    getProjectSync: mockGetProjectSync,
  };
});

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

const mockRefreshMergeStateFromGitHub = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/webhook-handlers.js', () => ({
  refreshMergeStateFromGitHub: mockRefreshMergeStateFromGitHub,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
  odb = setupOverdeckTestDb();
  mockUpdateIssueRecordForIssue.mockClear();
  mockRefreshMergeStateFromGitHub.mockClear();
}, 30_000);

afterEach(() => {
  testDb?.close();
  if (odb) teardownOverdeckTestDb(odb);
});

// ============== Import after mocks ==============

import {
  restoreReviewStatusFromRecords,
  type RestoreVerdictsResult,
} from '../../../../src/lib/pan-dir/verdict-restore.js';
import { getReviewStatusSync } from '../../../../src/lib/review-status.js';
import { getReviewStatusFromDbSync } from '../../../../src/lib/overdeck/review-status-sync.js';

describe('restoreReviewStatusFromRecords', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-verdict-restore-'));

    mockLoadProjectsConfigSync.mockReturnValue({
      projects: {
        pan: {
          name: 'Overdeck',
          path: projectRoot,
          issue_prefix: 'PAN',
          pan_records: { repo: '.', path: '.pan' },
        },
      },
    });

    mockResolveProjectFromIssueSync.mockImplementation((issueId: string) => {
      if (!issueId.toUpperCase().startsWith('PAN-')) return null;
      return {
        projectKey: 'pan',
        projectName: 'Overdeck',
        projectPath: projectRoot,
        linearTeam: 'PAN',
      };
    });

    mockGetProjectSync.mockImplementation((key: string) => {
      if (key !== 'pan') return null;
      return {
        name: 'Overdeck',
        path: projectRoot,
        issue_prefix: 'PAN',
        pan_records: { repo: '.', path: '.pan' },
      };
    });
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeRecord(issueId: string, pipeline: Record<string, unknown>): void {
    const path = join(projectRoot, '.pan', 'records', `${issueId.toLowerCase()}.json`);
    mkdirSync(join(projectRoot, '.pan', 'records'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          issueId: issueId.toUpperCase(),
          schemaVersion: 2,
          pipeline: {
            issueId: issueId.toUpperCase(),
            reviewStatus: 'pending',
            testStatus: 'pending',
            readyForMerge: false,
            updatedAt: '2026-06-15T00:00:00.000Z',
            ...pipeline,
          },
          closeOut: {
            usage: { byStage: {}, totals: {} },
            merges: [],
            ranOn: 'test',
          },
        },
        null,
        2,
      ),
    );
  }

  it('restores durable verdicts from a record into an empty review_status', async () => {
    writeRecord('PAN-1922', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'pending',
      inspectStatus: 'passed',
      inspectNotes: 'inspect ok',
      verificationStatus: 'passed',
      verificationNotes: 'verif ok',
      reviewNotes: 'review ok',
      testNotes: 'test ok',
      mergeNotes: 'merge ok',
      prUrl: 'https://github.com/eltmon/overdeck/pull/1922',
      prNumber: 1922,
      prHeadSha: 'abc123',
      reviewedAtCommit: 'def456',
      lastVerifiedCommit: 'def456',
      autoMerge: true,
      deaconIgnored: true,
      deaconIgnoredAt: '2026-06-15T01:00:00.000Z',
      deaconIgnoredReason: 'operator request',
    });

    const result = await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const status = getReviewStatusSync('PAN-1922');
    expect(status).not.toBeNull();
    expect(status!.reviewStatus).toBe('passed');
    expect(status!.testStatus).toBe('passed');
    expect(status!.mergeStatus).toBe('pending');
    expect(status!.inspectStatus).toBe('passed');
    expect(status!.inspectNotes).toBe('inspect ok');
    expect(status!.verificationStatus).toBe('passed');
    expect(status!.verificationNotes).toBe('verif ok');
    expect(status!.reviewNotes).toBe('review ok');
    expect(status!.testNotes).toBe('test ok');
    expect(status!.mergeNotes).toBe('merge ok');
    expect(status!.prUrl).toBe('https://github.com/eltmon/overdeck/pull/1922');
    expect(status!.prNumber).toBe(1922);
    expect(status!.prHeadSha).toBe('abc123');
    expect(status!.reviewedAtCommit).toBe('def456');
    expect(status!.lastVerifiedCommit).toBe('def456');
    expect(status!.autoMerge).toBe(true);
    expect(status!.deaconIgnored).toBe(true);
    expect(status!.deaconIgnoredAt).toBe('2026-06-15T01:00:00.000Z');
    expect(status!.deaconIgnoredReason).toBe('operator request');
  });

  it('skips issues with no per-issue record and creates no row', async () => {
    const result = await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

    expect(result.skipped).toBe(1);
    expect(result.restored).toBe(0);
    expect(result.failed).toBe(0);
    expect(getReviewStatusSync('PAN-1922')).toBeNull();
  });

  it('is idempotent for durable columns', async () => {
    writeRecord('PAN-1922', {
      reviewStatus: 'passed',
      testStatus: 'skipped',
      verificationStatus: 'passed',
      prNumber: 1922,
    });

    const first = await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });
    const firstStatus = getReviewStatusSync('PAN-1922');

    const second = await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });
    const secondStatus = getReviewStatusSync('PAN-1922');

    expect(first.restored).toBe(1);
    expect(second.restored).toBe(1);

    // updatedAt is refreshed by the write path; compare only durable verdicts.
    const durable = (s: NonNullable<typeof firstStatus>) => ({
      reviewStatus: s.reviewStatus,
      testStatus: s.testStatus,
      verificationStatus: s.verificationStatus,
      prNumber: s.prNumber,
      readyForMerge: s.readyForMerge,
    });
    expect(durable(secondStatus!)).toEqual(durable(firstStatus!));
  });

  it('does not restore blockerReasons or readyForMerge from the record', async () => {
    writeRecord('PAN-1922', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      readyForMerge: true,
      blockerReasons: [{ type: 'draft_pr', summary: 'Draft', detectedAt: '2026-06-15T00:00:00.000Z' }],
    });

    await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

    const status = getReviewStatusSync('PAN-1922');
    expect(status!.blockerReasons).toBeUndefined();
    // With no live blockers, the gate re-derives readyForMerge=true.
    expect(status!.readyForMerge).toBe(true);
  });

  it('leaves ephemeral counters at schema defaults', async () => {
    writeRecord('PAN-1922', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
    });

    await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

    const status = getReviewStatusSync('PAN-1922');
    expect(status!.mergeRetryCount).toBeUndefined();
    expect(status!.verificationCycleCount).toBeUndefined();
    expect(status!.autoRequeueCount).toBeUndefined();
    expect(status!.reviewRetryCount).toBeUndefined();
    expect(status!.testRetryCount).toBeUndefined();
    expect(status!.stuck).toBeUndefined();
  });

  it('returns a tally and details array', async () => {
    writeRecord('PAN-1922', { reviewStatus: 'passed', testStatus: 'passed' });

    const result: RestoreVerdictsResult = await restoreReviewStatusFromRecords({
      issueId: 'PAN-1922',
    });

    expect(typeof result.restored).toBe('number');
    expect(typeof result.skipped).toBe('number');
    expect(typeof result.failed).toBe('number');
    expect(result.details).toEqual([
      { issueId: 'PAN-1922', action: 'restored' },
    ]);
  });

  it('tallies dry runs without writing', async () => {
    writeRecord('PAN-1922', { reviewStatus: 'passed', testStatus: 'passed' });

    const result = await restoreReviewStatusFromRecords({
      issueId: 'PAN-1922',
      dryRun: true,
    });

    expect(result.restored).toBe(1);
    expect(getReviewStatusFromDbSync('PAN-1922')).toBeNull();
  });

  it('no-loss audit: every review_status column is accounted for', () => {
    const rows = testDb.prepare('PRAGMA table_info(review_status)').all() as Array<{ name: string }>;
    const actual = new Set(rows.map((r) => r.name));

    // Primary key
    const primaryKey = new Set(['issue_id']);

    // Columns restored directly from the durable per-issue record
    const durable = new Set([
      'review_status',
      'test_status',
      'merge_status',
      'inspect_status',
      'inspect_notes',
      'verification_status',
      'verification_notes',
      'review_notes',
      'test_notes',
      'merge_notes',
      'pr_url',
      'pr_head_sha',
      'pr_number',
      'reviewed_at_commit',
      'last_verified_commit',
      'auto_merge',
      'deacon_ignored',
      'deacon_ignored_at',
      'deacon_ignored_reason',
      'merge_step',
    ]);

    // Columns re-derived live or computed by the write path after restore
    const derived = new Set([
      'ready_for_merge',
      'blocker_reasons',
      'updated_at',
    ]);

    // Ephemeral / derived counters and timestamps reset to schema defaults
    const ephemeralDefaults = new Set([
      'auto_requeue_count',
      'merge_retry_count',
      'verification_cycle_count',
      'verification_max_cycles',
      'stuck',
      'stuck_reason',
      'stuck_at',
      'stuck_details',
      'review_spawned_at',
      'conflict_resolution_dispatched_at',
      'test_retry_count',
      'review_retry_count',
      'recovery_started_at',
      'inspect_started_at',
      'inspect_bead_id',
    ]);

    const accountedFor = new Set([...primaryKey, ...durable, ...derived, ...ephemeralDefaults]);

    const missingFromAudit = [...actual].filter((col) => !accountedFor.has(col));
    const unknownColumns = [...accountedFor].filter((col) => !actual.has(col));

    expect(missingFromAudit).toEqual([]);
    expect(unknownColumns).toEqual([]);
    expect(actual.size).toBe(accountedFor.size);
  });

  describe('PR-owned merge-state re-derivation', () => {
    it('calls refreshMergeStateFromGitHub for issues with a tracked PR', async () => {
      writeRecord('PAN-1922', {
        reviewStatus: 'passed',
        testStatus: 'passed',
        prUrl: 'https://github.com/eltmon/overdeck/pull/1922',
        prNumber: 1922,
      });

      await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

      expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledTimes(1);
      expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledWith(
        'PAN-1922',
        'eltmon/overdeck',
        1922,
      );
    });

    it('does not call refreshMergeStateFromGitHub when prUrl is missing', async () => {
      writeRecord('PAN-1922', {
        reviewStatus: 'passed',
        testStatus: 'passed',
        prNumber: 1922,
      });

      await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

      expect(mockRefreshMergeStateFromGitHub).not.toHaveBeenCalled();
    });

    it('does not call refreshMergeStateFromGitHub when prNumber is missing', async () => {
      writeRecord('PAN-1922', {
        reviewStatus: 'passed',
        testStatus: 'passed',
        prUrl: 'https://github.com/eltmon/overdeck/pull/1922',
      });

      await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

      expect(mockRefreshMergeStateFromGitHub).not.toHaveBeenCalled();
    });

    it('tolerates a GitHub refresh failure without failing the restore', async () => {
      mockRefreshMergeStateFromGitHub.mockRejectedValueOnce(new Error('gh auth missing'));

      writeRecord('PAN-1922', {
        reviewStatus: 'passed',
        testStatus: 'passed',
        prUrl: 'https://github.com/eltmon/overdeck/pull/1922',
        prNumber: 1922,
      });

      const result = await restoreReviewStatusFromRecords({ issueId: 'PAN-1922' });

      expect(result.restored).toBe(1);
      expect(result.failed).toBe(0);
      expect(getReviewStatusSync('PAN-1922')?.reviewStatus).toBe('passed');
    });

    it('skips live GitHub refresh under dryRun', async () => {
      writeRecord('PAN-1922', {
        reviewStatus: 'passed',
        testStatus: 'passed',
        prUrl: 'https://github.com/eltmon/overdeck/pull/1922',
        prNumber: 1922,
      });

      await restoreReviewStatusFromRecords({ issueId: 'PAN-1922', dryRun: true });

      expect(mockRefreshMergeStateFromGitHub).not.toHaveBeenCalled();
    });
  });
});
