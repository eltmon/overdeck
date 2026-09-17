/**
 * PAN-3848 (W25, FR-20): `pan done` writes its review request in one record
 * write — prUrl, reviewRequestedAt, completedAt, and the reviewStaleSince
 * clear in a single mutator — retried three times on the state lock's backoff
 * ladder. The failure path writes the completion marker anyway and records a
 * `review-request-unrecorded` needs-you, so a pushed PR with no review request
 * is never silent (the loud replacement for the soak-gated
 * checkOrphanedCompletions patrol).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateIssueRecord = vi.hoisted(() => vi.fn());
const mockCapturePipelineStage = vi.hoisted(() => vi.fn());
const mockResolveProjectForIssue = vi.hoisted(() => vi.fn());
const mockAgentsDir = vi.hoisted(() => ({ dir: '' }));

vi.mock('../../../src/lib/pan-dir/record.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/pan-dir/record.js')>()),
  resolveProjectForIssue: mockResolveProjectForIssue,
}));
vi.mock('../../../src/lib/pan-dir/record-update.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/pan-dir/record-update.js')>()),
  updateIssueRecord: mockUpdateIssueRecord,
}));
vi.mock('../../../src/lib/telemetry/pipeline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/telemetry/pipeline.js')>()),
  capturePipelineStageForIssue: mockCapturePipelineStage,
}));
vi.mock('../../../src/lib/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/paths.js')>()),
  get AGENTS_DIR() {
    return mockAgentsDir.dir;
  },
}));

import { persistDoneReviewIntent } from '../../../src/cli/commands/done-review-intent.js';
import { writeDoneCompletionMarker } from '../../../src/cli/commands/done.js';
import type { PanIssueRecord } from '../../../src/lib/pan-dir/record.js';

const ISSUE_ID = 'PAN-3848';
const NOW = '2026-09-17T00:00:00.000Z';

describe('pan done review-request record write (PAN-3848 W25)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-done-intent-'));
    mockAgentsDir.dir = join(root, 'agents');
    mockUpdateIssueRecord.mockReset();
    mockCapturePipelineStage.mockReset();
    mockResolveProjectForIssue.mockReset();
    mockResolveProjectForIssue.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('writes prUrl, reviewRequestedAt and completedAt, and clears reviewStaleSince, in one mutator call', async () => {
    let mutated: PanIssueRecord | undefined;
    mockUpdateIssueRecord.mockImplementation(async (_project: unknown, _id: string, mutator: (record: PanIssueRecord) => void) => {
      const record = {
        issueId: ISSUE_ID,
        schemaVersion: 2,
        pipeline: {
          issueId: ISSUE_ID,
          reviewStatus: 'passed',
          testStatus: 'passed',
          readyForMerge: true,
          reviewStaleSince: '2026-09-16T00:00:00.000Z',
          prUrl: 'https://example.invalid/old-pr',
          updatedAt: '2026-09-16T00:00:00.000Z',
        },
        closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
      } as PanIssueRecord;
      await mutator(record);
      mutated = record;
      return record;
    });

    await persistDoneReviewIntent(ISSUE_ID, '/tmp/workspace', {
      reviewRequestedAt: NOW,
      prUrl: 'https://example.invalid/new-pr',
    });

    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(1);
    expect(mutated?.pipeline).toMatchObject({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      reviewRequestedAt: NOW,
      completedAt: NOW,
      prUrl: 'https://example.invalid/new-pr',
      updatedAt: NOW,
    });
    expect(mutated?.pipeline.reviewStaleSince).toBeUndefined();
    expect(mockCapturePipelineStage).toHaveBeenCalledWith(ISSUE_ID, 'work_done');
  });

  it('retries the write three times on the lock backoff ladder, then throws', async () => {
    vi.useFakeTimers();
    mockUpdateIssueRecord.mockRejectedValue(new Error('The record lock for PAN-3848 is held'));

    const promise = persistDoneReviewIntent(ISSUE_ID, '/tmp/workspace', { reviewRequestedAt: NOW });
    const rejection = expect(promise).rejects.toThrow('The record lock for PAN-3848 is held');

    // Initial attempt plus three retries gated by 10ms, 20ms, 40ms sleeps.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(40);

    await rejection;
    expect(mockUpdateIssueRecord).toHaveBeenCalledTimes(4);
    expect(mockCapturePipelineStage).not.toHaveBeenCalled();
  });

  it('the failure path still writes the completion marker (work is real: branch pushed, PR exists)', () => {
    writeDoneCompletionMarker('agent-pan-3848', 'done comment', false);

    const completedFile = join(mockAgentsDir.dir, 'agent-pan-3848', 'completed');
    expect(existsSync(completedFile)).toBe(true);
    const marker = JSON.parse(readFileSync(completedFile, 'utf8'));
    expect(marker.trackerUpdated).toBe(false);
    expect(marker.comment).toBe('done comment');
    expect(typeof marker.timestamp).toBe('string');
  });

  it('marker write clears a stale processed marker so the completion is re-observed', () => {
    const agentDir = join(mockAgentsDir.dir, 'agent-pan-3848');
    mkdirSync(agentDir, { recursive: true });
    writeDoneCompletionMarker('agent-pan-3848', undefined, true);
    // Simulate the pipeline consuming the marker, then a failing re-run of
    // pan done: the processed marker must not mask the new completion.
    const processed = join(agentDir, 'completed.processed');
    writeFileSync(processed, '');
    writeDoneCompletionMarker('agent-pan-3848', undefined, true);
    expect(existsSync(processed)).toBe(false);
  });
});
