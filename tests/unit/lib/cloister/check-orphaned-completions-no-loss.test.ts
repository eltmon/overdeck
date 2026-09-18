/**
 * PAN-3848 (W25) — no-loss audit for patrol #33 `checkOrphanedCompletions`.
 *
 * Deletion gate evidence (the patrol's deletion itself is soak-gated and NOT
 * in this branch): the state the patrol repaired — a completion marker on disk
 * and an open PR, but no reviewRequestedAt anywhere — is unreachable now that
 * `pan done` writes the review request synchronously:
 *
 *   1. persistDoneReviewIntent sets reviewRequestedAt, prUrl and completedAt
 *      in ONE record mutator, so "PR URL recorded but review never requested"
 *      cannot be produced by the write door.
 *   2. The write is retried on the state lock's backoff ladder, and if every
 *      attempt fails, `pan done` writes the completion marker anyway, records
 *      a `review-request-unrecorded` needs-you naming the missing
 *      reviewRequestedAt, prints the error, and exits 1 — the loud
 *      replacement for the patrol's silent repair.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateIssueRecord = vi.hoisted(() => vi.fn());
const mockCapturePipelineStage = vi.hoisted(() => vi.fn());
const mockResolveProjectForIssue = vi.hoisted(() => vi.fn());
const mockRecordDeadEndNeedsYou = vi.hoisted(() => vi.fn());
const mockAgentsDir = vi.hoisted(() => ({ dir: '' }));

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>()),
  resolveProjectForIssue: mockResolveProjectForIssue,
}));
vi.mock('../../../../src/lib/pan-dir/record-update.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/pan-dir/record-update.js')>()),
  updateIssueRecord: mockUpdateIssueRecord,
}));
vi.mock('../../../../src/lib/telemetry/pipeline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/telemetry/pipeline.js')>()),
  capturePipelineStageForIssue: mockCapturePipelineStage,
}));
vi.mock('../../../../src/lib/cloister/dead-end-trip.js', () => ({
  recordDeadEndNeedsYou: mockRecordDeadEndNeedsYou,
}));
vi.mock('../../../../src/lib/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/paths.js')>()),
  get AGENTS_DIR() {
    return mockAgentsDir.dir;
  },
}));

import { persistDoneReviewIntent } from '../../../../src/cli/commands/done-review-intent.js';
import { handleUnrecordedReviewRequest } from '../../../../src/cli/commands/done.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';

const ISSUE_ID = 'PAN-3848';
const NOW = '2026-09-17T00:00:00.000Z';
const PR_URL = 'https://github.com/eltmon/overdeck/pull/3873';

describe('checkOrphanedCompletions no-loss audit (PAN-3848 W25)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-orphaned-completions-audit-'));
    mockAgentsDir.dir = join(root, 'agents');
    mockUpdateIssueRecord.mockReset();
    mockCapturePipelineStage.mockReset();
    mockResolveProjectForIssue.mockReset().mockReturnValue(null);
    mockRecordDeadEndNeedsYou.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('the write door can never produce "PR recorded but review never requested": one mutator sets all three fields', async () => {
    mockUpdateIssueRecord.mockImplementation(async (_project: unknown, _id: string, mutator: (record: PanIssueRecord) => void) => {
      const record = {
        issueId: ISSUE_ID,
        schemaVersion: 2,
        pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: 'old' },
        closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
      } as PanIssueRecord;
      await mutator(record);
      return record;
    });

    await persistDoneReviewIntent(ISSUE_ID, '/tmp/workspace', { reviewRequestedAt: NOW, prUrl: PR_URL });

    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(1);
    const [, , mutator] = mockUpdateIssueRecord.mock.calls[0]!;
    const probe = { pipeline: {} } as PanIssueRecord;
    await mutator(probe);
    expect(probe.pipeline.reviewRequestedAt).toBe(NOW);
    expect(probe.pipeline.prUrl).toBe(PR_URL);
    expect(probe.pipeline.completedAt).toBe(NOW);
  });

  it('even without a PR URL the request timestamp is always written (unconditional field)', async () => {
    mockUpdateIssueRecord.mockImplementation(async (_project: unknown, _id: string, mutator: (record: PanIssueRecord) => void) => {
      const record = { pipeline: {} } as PanIssueRecord;
      await mutator(record);
      return record;
    });

    await persistDoneReviewIntent(ISSUE_ID, '/tmp/workspace', { reviewRequestedAt: NOW });

    const [, , mutator] = mockUpdateIssueRecord.mock.calls[0]!;
    const probe = { pipeline: {} } as PanIssueRecord;
    await mutator(probe);
    expect(probe.pipeline.reviewRequestedAt).toBe(NOW);
    expect(probe.pipeline.completedAt).toBe(NOW);
  });

  it('a write that fails every retry still lands the completion marker and a review-request-unrecorded needs-you', async () => {
    vi.useFakeTimers();
    mockUpdateIssueRecord.mockRejectedValue(new Error('The record lock for PAN-3848 is held by another writer'));

    const write = persistDoneReviewIntent(ISSUE_ID, '/tmp/workspace', { reviewRequestedAt: NOW, prUrl: PR_URL });
    const rejection = expect(write).rejects.toThrow('The record lock for PAN-3848');
    await vi.runAllTimersAsync();
    await rejection;
    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(4);
    vi.useRealTimers();

    // The done.ts failure path (what the patrol's silent repair is replaced by):
    await handleUnrecordedReviewRequest(ISSUE_ID, 'agent-pan-3848', PR_URL, 'done', new Error('The record lock for PAN-3848 is held by another writer'));

    // The completion marker exists — the work is real (branch pushed, PR open)...
    const markerPath = join(mockAgentsDir.dir, 'agent-pan-3848', 'completed');
    expect(existsSync(markerPath)).toBe(true);
    // ...and the failure is loud: a needs-you that names the missing field and
    // carries the PR URL as the generation anchor.
    expect(mockRecordDeadEndNeedsYou).toHaveBeenCalledTimes(1);
    const [issueId, recoveryPath, generation, message] = mockRecordDeadEndNeedsYou.mock.calls[0]!;
    expect(issueId).toBe(ISSUE_ID);
    expect(recoveryPath).toBe('review-request-unrecorded');
    expect(generation).toBe(PR_URL);
    expect(message).toContain('reviewRequestedAt');
    expect(message).toContain('record lock');
  });

  it('the marker payload is intact for the pipeline consumers the patrol used to serve', async () => {
    await handleUnrecordedReviewRequest(ISSUE_ID, 'agent-pan-3848', PR_URL, 'comment text', new Error('boom'));

    const marker = JSON.parse(
      readFileSync(join(mockAgentsDir.dir, 'agent-pan-3848', 'completed'), 'utf8'),
    );
    expect(marker.comment).toBe('comment text');
    expect(marker.trackerUpdated).toBe(false);
    expect(typeof marker.timestamp).toBe('string');
  });
});
