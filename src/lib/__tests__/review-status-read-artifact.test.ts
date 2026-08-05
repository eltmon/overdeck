/**
 * PAN-3511 — the artifact's say in the journal-reconcile refusal.
 *
 * `resolveJournalReconciledReviewStatusSync` runs on every `getReviewStatusSync`
 * call in the system, so the artifact consult must be BOTH one-directional (it
 * can lift a refusal the resolver was already making, never invent an approval)
 * and free on the common path (zero filesystem work when nothing is being
 * refused).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveJournalReconciledReviewStatusSync, type ReviewStatusReadHooks } from '../review-status-read.js';
import { readMemoizedArtifactVerdict } from '../cloister/synthesis-verdict.js';
import { readJournalStatusSync } from '../overdeck/review-status-record-sync.js';
import { reconcileJournalIntoCacheSync } from '../review-status-reconcile.js';
import { staleVerdictSnapshotAgainstLiveCycle } from '../pan-dir/pipeline-verdict-merge.js';

vi.mock('../cloister/synthesis-verdict.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cloister/synthesis-verdict.js')>();
  return { ...actual, readMemoizedArtifactVerdict: vi.fn() };
});
vi.mock('../overdeck/review-status-record-sync.js', () => ({
  readJournalStatusSync: vi.fn(),
  enrichReviewNotesFromRecordSync: vi.fn((_issueId: string, status: unknown) => status),
}));
vi.mock('../review-status-reconcile.js', () => ({ reconcileJournalIntoCacheSync: vi.fn() }));
vi.mock('../pan-dir/pipeline-verdict-merge.js', () => ({ staleVerdictSnapshotAgainstLiveCycle: vi.fn() }));

const ISSUE = 'PAN-3511';
const RECONCILED = { reviewStatus: 'passed', updatedAt: '2026-08-03T01:00:00.000Z' };

const readArtifact = vi.mocked(readMemoizedArtifactVerdict);
const readJournal = vi.mocked(readJournalStatusSync);
const reconcile = vi.mocked(reconcileJournalIntoCacheSync);
const staleSnapshot = vi.mocked(staleVerdictSnapshotAgainstLiveCycle);

function hooks(): ReviewStatusReadHooks {
  return {
    deleteStatus: vi.fn(),
    notifyStatusChanged: vi.fn(),
    deliverReviewVerdictFeedbackHostSide: vi.fn(async () => {}),
    emitReactiveLifecycleEvent: vi.fn(),
    maybeAutoDispatchReviewHostSide: vi.fn(),
    maybeRecoverTestVerdictHostSide: vi.fn(),
  };
}

/** A db row the journal is newer than, so the resolver reaches the stale check. */
const DB_ROW = { reviewStatus: 'reviewing', updatedAt: '2026-08-03T00:00:00.000Z' } as never;

function journalCarrying(reviewStatus: string): void {
  readJournal.mockReturnValue({
    durable: { reviewStatus },
    updatedAt: '2026-08-03T01:00:00.000Z',
  } as never);
}

describe('resolveJournalReconciledReviewStatusSync — artifact consult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcile.mockReturnValue(RECONCILED as never);
  });

  it('reconciles instead of refusing when a fresh artifact corroborates the journal verdict (ac1)', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'passed', mtimeMs: 1 } as never);

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result).toBe(RECONCILED);
  });

  it('still refuses the replay when the artifact disagrees with the journal verdict (ac2)', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'blocked', mtimeMs: 1 } as never);

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toBe(DB_ROW);
  });

  it('still refuses the replay when no artifact exists — absence never approves (ac2, NFR-4)', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue(null);

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toBe(DB_ROW);
  });

  it('never reads the artifact on the common path where nothing is being refused (ac4)', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue(null);

    resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(readArtifact).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('never reads the artifact when there is no journal at all', () => {
    readJournal.mockReturnValue(null);

    resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(readArtifact).not.toHaveBeenCalled();
  });
});

describe('readMemoizedArtifactVerdict — TTL (ac3)', () => {
  let workspacePath: string;
  let real: typeof import('../cloister/synthesis-verdict.js');

  beforeEach(async () => {
    real = await vi.importActual<typeof import('../cloister/synthesis-verdict.js')>(
      '../cloister/synthesis-verdict.js',
    );
    real.__resetArtifactVerdictMemo();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan3511-memo-'));
    const runDir = join(workspacePath, '.pan', 'review', 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'synthesis.md'), '## Verdict: APPROVED\n', 'utf-8');
  });

  afterEach(() => {
    real.__resetArtifactVerdictMemo();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('serves the second read inside the TTL from the memo without touching the filesystem', () => {
    const now = 1_000_000;
    expect(real.readMemoizedArtifactVerdict(ISSUE, { now, workspacePath })?.verdict).toBe('passed');

    // Delete the artifact. A read that re-scanned would now return null; the
    // memo must still serve the cached verdict, which proves no second stat.
    rmSync(join(workspacePath, '.pan'), { recursive: true, force: true });

    const cached = real.readMemoizedArtifactVerdict(ISSUE, { now: now + real.ARTIFACT_VERDICT_MEMO_TTL_MS - 1, workspacePath });
    expect(cached?.verdict).toBe('passed');
  });

  it('re-scans once the TTL expires', () => {
    const now = 1_000_000;
    expect(real.readMemoizedArtifactVerdict(ISSUE, { now, workspacePath })?.verdict).toBe('passed');

    rmSync(join(workspacePath, '.pan'), { recursive: true, force: true });

    expect(real.readMemoizedArtifactVerdict(ISSUE, { now: now + real.ARTIFACT_VERDICT_MEMO_TTL_MS, workspacePath })).toBeNull();
  });

  it('memoizes absence too, so an issue with no artifact does not re-scan every read', () => {
    const empty = mkdtempSync(join(tmpdir(), 'pan3511-memo-empty-'));
    const now = 2_000_000;
    try {
      expect(real.readMemoizedArtifactVerdict('PAN-9999', { now, workspacePath: empty })).toBeNull();

      // Write an artifact the memo must NOT see until the TTL expires.
      const runDir = join(empty, '.pan', 'review', 'run-1');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'review.md'), '## Verdict: APPROVED\n', 'utf-8');

      expect(real.readMemoizedArtifactVerdict('PAN-9999', { now: now + 1, workspacePath: empty })).toBeNull();
      expect(real.readMemoizedArtifactVerdict('PAN-9999', {
        now: now + real.ARTIFACT_VERDICT_MEMO_TTL_MS,
        workspacePath: empty,
      })?.verdict).toBe('passed');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('keeps memo entries separate per issue', () => {
    const now = 3_000_000;
    expect(real.readMemoizedArtifactVerdict(ISSUE, { now, workspacePath })?.verdict).toBe('passed');
    // A different issue pointed at an empty workspace must not be served the
    // first issue's cached verdict.
    const empty = mkdtempSync(join(tmpdir(), 'pan3511-memo-other-'));
    try {
      expect(real.readMemoizedArtifactVerdict('PAN-8888', { now, workspacePath: empty })).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
