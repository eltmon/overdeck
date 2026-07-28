/**
 * Tests for PAN-2689: flushReviewStatusJournalWrites drains the fire-and-forget
 * journal writes so a short-lived CLI process cannot exit past an in-flight
 * verdict write (the incident: `pan admin specialists done` exited in <1s and
 * the sandboxed review verdict vanished while the CLI printed success).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

const mockUpdateIssueRecordForIssue = vi.hoisted(() => vi.fn());

// PAN-3092: the backoff suite needs a real workspace so it can assert whether a
// fallback file was written; the PAN-2689 suite keeps its unresolvable project
// so its fallback branch stays a filesystem no-op.
const state = vi.hoisted(() => ({ backoffProjectPath: '' }));
const BACKOFF_ISSUE = 'PAN-3092';

vi.mock('../../../../src/lib/pan-dir/records.js', () => ({
  updateIssueRecordForIssue: mockUpdateIssueRecordForIssue,
}));

// The workspace-fallback path resolves the project; return null so the
// fallback branch is a no-op instead of touching the filesystem.
vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn((issueId: string) => (
    issueId === BACKOFF_ISSUE && state.backoffProjectPath
      ? { projectKey: 'overdeck', projectName: 'overdeck', projectPath: state.backoffProjectPath }
      : null
  )),
  getProjectSync: vi.fn(() => undefined),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: vi.fn(() => null),
}));

import {
  updateIssueRecordForReviewStatusSync,
  flushReviewStatusJournalWrites,
  workspaceVerdictFallbackPath,
} from '../../../../src/lib/overdeck/review-status-record-sync.js';

const status: ReviewStatus = {
  issueId: 'PAN-2689',
  reviewStatus: 'passed',
  testStatus: 'pending',
  readyForMerge: false,
  updatedAt: '2026-07-15T05:12:52.000Z',
} as ReviewStatus;

beforeEach(() => {
  mockUpdateIssueRecordForIssue.mockReset();
});

describe('flushReviewStatusJournalWrites (PAN-2689)', () => {
  it('resolves immediately when no journal writes are pending', async () => {
    await expect(flushReviewStatusJournalWrites()).resolves.toBeUndefined();
  });

  it('waits for an in-flight journal write to land before resolving', async () => {
    let resolveWrite!: (landed: boolean) => void;
    mockUpdateIssueRecordForIssue.mockReturnValue(
      new Promise<boolean>((resolve) => { resolveWrite = resolve; }),
    );

    updateIssueRecordForReviewStatusSync('PAN-2689', status);

    let flushed = false;
    const flush = flushReviewStatusJournalWrites().then(() => { flushed = true; });

    await new Promise((r) => setImmediate(r));
    expect(flushed).toBe(false);

    resolveWrite(true);
    await flush;
    expect(flushed).toBe(true);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledWith('PAN-2689', status);
  });

  it('drains multiple pending writes', async () => {
    const resolvers: Array<(landed: boolean) => void> = [];
    mockUpdateIssueRecordForIssue.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolvers.push(resolve); }),
    );

    updateIssueRecordForReviewStatusSync('PAN-2689', status);
    updateIssueRecordForReviewStatusSync('PAN-2690', status);

    let flushed = false;
    const flush = flushReviewStatusJournalWrites().then(() => { flushed = true; });

    resolvers[0](true);
    await new Promise((r) => setImmediate(r));
    expect(flushed).toBe(false);

    resolvers[1](true);
    await flush;
    expect(flushed).toBe(true);
  });

  it('resolves even when the journal write rejects (fallback ran via catch)', async () => {
    mockUpdateIssueRecordForIssue.mockRejectedValue(new Error('EROFS: sandbox'));

    updateIssueRecordForReviewStatusSync('PAN-2689', status);

    await expect(flushReviewStatusJournalWrites()).resolves.toBeUndefined();
  });
});

/**
 * PAN-3092: MIN-902's reviewer retried its verdict signal for an hour at LLM-turn
 * cost because a contended record lock dropped the write on the first collision
 * and nothing waited. A verdict write now waits out the contention in-process.
 */
describe('verdict-write backoff (PAN-3092)', () => {
  const BACKOFF_SCHEDULE_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 80_000];

  function fallbackPathOrThrow(): string {
    const p = workspaceVerdictFallbackPath(BACKOFF_ISSUE);
    if (!p) throw new Error('expected a resolvable fallback path');
    return p;
  }

  /** Advance through the whole schedule, letting each attempt settle. */
  async function advanceThroughSchedule(steps = BACKOFF_SCHEDULE_MS.length): Promise<void> {
    for (let i = 0; i < steps; i += 1) {
      await vi.advanceTimersByTimeAsync(BACKOFF_SCHEDULE_MS[i]!);
    }
  }

  beforeEach(() => {
    state.backoffProjectPath = mkdtempSync(join(tmpdir(), 'pan-3092-backoff-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(state.backoffProjectPath, { recursive: true, force: true });
    state.backoffProjectPath = '';
  });

  it('retries a contended verdict write on the backoff schedule and writes no fallback once it lands', async () => {
    mockUpdateIssueRecordForIssue
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    updateIssueRecordForReviewStatusSync(BACKOFF_ISSUE, status, { verdictWrite: true });
    const flush = flushReviewStatusJournalWrites();

    await vi.advanceTimersByTimeAsync(0);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(3);

    await flush;
    expect(existsSync(fallbackPathOrThrow())).toBe(false);
  });

  it('writes the workspace fallback only after the full schedule is exhausted', async () => {
    mockUpdateIssueRecordForIssue.mockResolvedValue(false);

    updateIssueRecordForReviewStatusSync(BACKOFF_ISSUE, status, { verdictWrite: true });
    const flush = flushReviewStatusJournalWrites();

    await vi.advanceTimersByTimeAsync(0);
    expect(existsSync(fallbackPathOrThrow())).toBe(false);

    // One delay short of the end: still retrying, still no fallback.
    await advanceThroughSchedule(BACKOFF_SCHEDULE_MS.length - 1);
    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(BACKOFF_SCHEDULE_MS.length);
    expect(existsSync(fallbackPathOrThrow())).toBe(false);

    await vi.advanceTimersByTimeAsync(BACKOFF_SCHEDULE_MS.at(-1)!);
    await flush;

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(BACKOFF_SCHEDULE_MS.length + 1);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);
  });

  it('never retries a bookkeeping write — one attempt, then the fallback', async () => {
    mockUpdateIssueRecordForIssue.mockResolvedValue(false);

    updateIssueRecordForReviewStatusSync(BACKOFF_ISSUE, status);
    await flushReviewStatusJournalWrites();

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);
    expect(existsSync(fallbackPathOrThrow())).toBe(true);
  });
});
