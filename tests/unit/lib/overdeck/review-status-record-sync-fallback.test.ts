/**
 * PAN-2583: workspace verdict fallback — a sandboxed reviewer that cannot write the
 * state-dir journal drops its verdict into <workspace>/.overdeck/pipeline-verdict.json,
 * and readJournalStatusSync overlays it (strictly newer fallback wins over the record).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
  projectPath: '',
  pipeline: null as Record<string, unknown> | null,
  recordLanded: true,
}));

const dbMocks = vi.hoisted(() => ({
  getReviewStatusFromDbSync: vi.fn(),
  upsertReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (issueId: string) =>
    issueId.startsWith('PAN-')
      ? { projectKey: 'overdeck', projectName: 'overdeck', projectPath: state.projectPath }
      : null,
  getProjectSync: () => ({ key: 'overdeck', path: state.projectPath }),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: () => (state.pipeline ? { pipeline: state.pipeline } : null),
}));

vi.mock('../../../../src/lib/pan-dir/records.js', () => ({
  updateIssueRecordForIssue: vi.fn(async () => state.recordLanded),
}));

vi.mock('../../../../src/lib/overdeck/review-status-sync.js', () => ({
  clearWorkspaceStuck: vi.fn(),
  deleteReviewStatus: vi.fn(),
  getAllReviewStatusesFromDb: vi.fn(() => ({})),
  getReviewStatusFromDbSync: dbMocks.getReviewStatusFromDbSync,
  getReviewStatusesFromDb: vi.fn(() => ({})),
  markWorkspaceStuck: vi.fn(),
  upsertReviewStatusSync: dbMocks.upsertReviewStatusSync,
}));

import {
  readJournalStatusSync,
  updateIssueRecordForReviewStatusSync,
  workspaceVerdictFallbackPath,
} from '../../../../src/lib/overdeck/review-status-record-sync.js';
import { getReviewStatusSync, type ReviewStatus } from '../../../../src/lib/review-status.js';

const ISSUE = 'PAN-9999';

function fallbackPathOrThrow(): string {
  const p = workspaceVerdictFallbackPath(ISSUE);
  if (!p) throw new Error('expected a fallback path');
  return p;
}

function writeFallback(
  updatedAt: string,
  pipeline: Record<string, unknown>,
  clearedFields?: string[],
): void {
  const p = fallbackPathOrThrow();
  mkdirSync(join(state.projectPath, 'workspaces', 'feature-pan-9999', '.overdeck'), { recursive: true });
  writeFileSync(p, JSON.stringify({ issueId: ISSUE, updatedAt, pipeline, clearedFields }));
}

describe('workspace verdict fallback (PAN-2583)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projectPath = mkdtempSync(join(tmpdir(), 'pan-2583-'));
    state.pipeline = null;
    state.recordLanded = true;
  });

  afterEach(() => {
    rmSync(state.projectPath, { recursive: true, force: true });
  });

  it('returns null with no record and no fallback', () => {
    expect(readJournalStatusSync(ISSUE)).toBeNull();
  });

  it('returns the record when no fallback exists', () => {
    state.pipeline = { reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-07-11T10:00:00.000Z' };
    const result = readJournalStatusSync(ISSUE);
    expect(result?.durable.reviewStatus).toBe('reviewing');
  });

  it('overlays a strictly newer fallback over the record', () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      prUrl: 'https://example.com/pr/1',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    writeFallback('2026-07-11T12:00:00.000Z', { reviewStatus: 'blocked', reviewNotes: 'changes requested' });

    const result = readJournalStatusSync(ISSUE);
    expect(result?.updatedAt).toBe('2026-07-11T12:00:00.000Z');
    expect(result?.durable.reviewStatus).toBe('blocked');
    expect(result?.durable.reviewNotes).toBe('changes requested');
    // Record fields the fallback did not carry survive the overlay.
    expect(result?.durable.prUrl).toBe('https://example.com/pr/1');
  });

  it('applies explicit strike transport clears from a newer fallback', () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-11T12:30:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    writeFallback(
      '2026-07-11T12:00:00.000Z',
      { reviewStatus: 'reviewing', testStatus: 'pending' },
      ['strikeTransportRetryCount', 'strikeNextAttemptAt'],
    );

    const result = readJournalStatusSync(ISSUE);
    expect(result?.durable.strikeTransportRetryCount).toBeUndefined();
    expect(result?.durable.strikeNextAttemptAt).toBeUndefined();
    expect(result?.clearedFields).toEqual([
      'strikeTransportRetryCount',
      'strikeNextAttemptAt',
    ]);
  });

  it('ignores clear markers outside the allowlisted transport fields', () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    writeFallback(
      '2026-07-11T12:00:00.000Z',
      { reviewStatus: 'blocked', testStatus: 'pending' },
      ['reviewStatus', 'strikeNextAttemptAt'],
    );

    const result = readJournalStatusSync(ISSUE);
    expect(result?.durable.reviewStatus).toBe('blocked');
    expect(result?.clearedFields).toEqual(['strikeNextAttemptAt']);
  });

  it('clears stale backoff fields when reconciling the fallback into the DB cache', () => {
    state.pipeline = {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-11T12:30:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    writeFallback(
      '2026-07-11T12:00:00.000Z',
      { reviewStatus: 'reviewing', testStatus: 'pending' },
      ['strikeTransportRetryCount', 'strikeNextAttemptAt'],
    );
    dbMocks.getReviewStatusFromDbSync.mockReturnValue({
      issueId: ISSUE,
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-11T11:00:00.000Z',
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-11T12:30:00.000Z',
    } satisfies ReviewStatus);

    const result = getReviewStatusSync(ISSUE);

    expect(result?.strikeTransportRetryCount).toBeUndefined();
    expect(result?.strikeNextAttemptAt).toBeUndefined();
    expect(dbMocks.upsertReviewStatusSync).toHaveBeenCalledOnce();
    const reconciled = dbMocks.upsertReviewStatusSync.mock.calls[0]?.[0] as ReviewStatus;
    expect(reconciled.issueId).toBe(ISSUE);
    expect(reconciled).not.toHaveProperty('strikeTransportRetryCount');
    expect(reconciled).not.toHaveProperty('strikeNextAttemptAt');
  });

  it('ignores a fallback older than the record', () => {
    state.pipeline = { reviewStatus: 'passed', testStatus: 'pending', updatedAt: '2026-07-11T12:00:00.000Z' };
    writeFallback('2026-07-11T10:00:00.000Z', { reviewStatus: 'blocked' });

    const result = readJournalStatusSync(ISSUE);
    expect(result?.durable.reviewStatus).toBe('passed');
  });

  it('returns the fallback when no record exists at all', () => {
    writeFallback('2026-07-11T12:00:00.000Z', { reviewStatus: 'blocked', testStatus: 'pending' });
    const result = readJournalStatusSync(ISSUE);
    expect(result?.durable.reviewStatus).toBe('blocked');
  });

  it('writes the fallback when the journal write does not land', async () => {
    state.recordLanded = false;
    updateIssueRecordForReviewStatusSync(ISSUE, {
      issueId: ISSUE,
      reviewStatus: 'blocked',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-11T13:00:00.000Z',
      reviewNotes: 'sandboxed verdict',
    } as ReviewStatus);

    await vi.waitFor(() => {
      expect(existsSync(fallbackPathOrThrow())).toBe(true);
    });
    const written = JSON.parse(readFileSync(fallbackPathOrThrow(), 'utf-8'));
    expect(written.pipeline.reviewStatus).toBe('blocked');
    expect(written.clearedFields).toEqual([
      'strikeTransportRetryCount',
      'strikeNextAttemptAt',
    ]);
    expect(written.updatedAt).toBe('2026-07-11T13:00:00.000Z');
  });

  it('does not write the fallback when the journal write lands', async () => {
    state.recordLanded = true;
    updateIssueRecordForReviewStatusSync(ISSUE, {
      issueId: ISSUE,
      reviewStatus: 'passed',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-11T13:00:00.000Z',
    } as ReviewStatus);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });
});
