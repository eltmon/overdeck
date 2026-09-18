/**
 * PAN-3848 (W27) — no-loss audit for patrol #4 `reconcileInFlightJournals`.
 *
 * Deletion gate evidence (the patrol's deletion itself is soak-gated and NOT
 * in this branch): the state the patrol repaired — a journaled advancing
 * verdict that never reached the SQLite row — is unreachable because
 * journal-to-row reconciliation already happens inside every
 * `getReviewStatusSync` read (review-status-read.ts → review-status-reconcile.ts).
 * These fixtures use the REAL read door, the REAL journal (a per-issue record
 * on disk), and a REAL test overdeck.db — no patrol runs anywhere in them.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
  getProjectSync: mockGetProjectSync,
}));

// Keep the notification side channels quiet; everything under audit — the
// journal read, the reconcile, the cache upsert — is real.
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
vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: vi.fn(),
}));

import { getReviewStatusSync } from '../../../../src/lib/review-status.js';
import {
  getReviewStatusFromDbSync,
  upsertReviewStatusSync,
} from '../../../../src/lib/overdeck/review-status-sync.js';
import { writeIssueRecordSync, type PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import type { ReviewStatus } from '../../../../src/lib/review-status-reconcile.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

const ISSUE_ID = 'PAN-999';
const OLD = '2026-09-17T00:00:00.000Z';
const NEW = '2026-09-17T01:00:00.000Z';

function journalRecord(updatedAt: string): PanIssueRecord {
  return {
    issueId: ISSUE_ID,
    schemaVersion: 2,
    statusOverrides: {},
    pipeline: {
      issueId: ISSUE_ID,
      // The advancing verdict: written to the journal by the verdict door, but
      // (the repaired state) never applied to the SQLite row.
      reviewStatus: 'passed',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt,
    },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
  } as PanIssueRecord;
}

function staleRow(updatedAt: string): ReviewStatus {
  return {
    issueId: ISSUE_ID,
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    readyForMerge: false,
    updatedAt,
  } as ReviewStatus;
}

describe('journaled advancing verdict reconciles inside the read door (PAN-3848 W27)', () => {
  let odb: OverdeckTestDb;
  let projectDir: string;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
    projectDir = join(odb.home, 'project');
    const project = { name: 'audit', path: projectDir };
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'audit', projectPath: projectDir });
    mockGetProjectSync.mockReturnValue(project);
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
    mockResolveProjectFromIssueSync.mockReset();
    mockGetProjectSync.mockReset();
  });

  it('a journaled verdict newer than the row reconciles into the read — and into the cache — with no patrol', () => {
    upsertReviewStatusSync(staleRow(OLD));
    expect(getReviewStatusFromDbSync(ISSUE_ID)?.reviewStatus).toBe('reviewing');

    // The journal carries the advancing verdict (newer updatedAt).
    writeIssueRecordSync({ name: 'audit', path: projectDir }, ISSUE_ID, journalRecord(NEW));

    const read = getReviewStatusSync(ISSUE_ID);

    // The read returns the journaled verdict...
    expect(read?.reviewStatus).toBe('passed');
    expect(read?.updatedAt).toBe(NEW);
    // ...and the reconcile wrote the cache row — reconcileInFlightJournals'
    // only repair now happens inside every read.
    expect(getReviewStatusFromDbSync(ISSUE_ID)?.reviewStatus).toBe('passed');
  });

  it('a journal with no row at all reconciles into existence on read', () => {
    expect(getReviewStatusFromDbSync(ISSUE_ID)).toBeNull();

    writeIssueRecordSync({ name: 'audit', path: projectDir }, ISSUE_ID, journalRecord(NEW));

    const read = getReviewStatusSync(ISSUE_ID);

    expect(read?.reviewStatus).toBe('passed');
    expect(getReviewStatusFromDbSync(ISSUE_ID)?.reviewStatus).toBe('passed');
  });

  it('a row newer than the journal is left alone (no patrol-equivalent clobber)', () => {
    upsertReviewStatusSync(staleRow(NEW));
    writeIssueRecordSync({ name: 'audit', path: projectDir }, ISSUE_ID, {
      ...journalRecord(OLD),
      pipeline: { ...journalRecord(OLD).pipeline, reviewStatus: 'reviewing' },
    });

    const read = getReviewStatusSync(ISSUE_ID);

    expect(read?.reviewStatus).toBe('reviewing');
    expect(read?.updatedAt).toBe(NEW);
  });
});
