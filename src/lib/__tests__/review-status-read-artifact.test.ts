/*
 * PAN-3511 — the artifact's say in the journal-reconcile refusal.
 *
 * `resolveJournalReconciledReviewStatusSync` runs on every `getReviewStatusSync`
 * call in the system, so the artifact consult must be one-directional, guarded
 * by the reviewed HEAD, and free on the common path.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveJournalReconciledReviewStatusSync, type ReviewStatusReadHooks } from '../review-status-read.js';
import { readMemoizedArtifactVerdict } from '../cloister/synthesis-verdict.js';
import { reviewArtifactCapabilityMarker } from '../cloister/review-artifact-capability.js';
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
const RUN_ID = 'agent-pan-3511-review-run-1';
const CAPABILITY = 'host-issued-capability';
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

function dbRow(lastVerifiedCommit = 'head-current') {
  return {
    reviewStatus: 'reviewing',
    lastVerifiedCommit,
    updatedAt: '2026-08-03T00:00:00.000Z',
  } as never;
}

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

  it('reconciles when a fresh artifact corroborates the journal verdict and live HEAD', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'passed', headSha: 'head-current', runId: RUN_ID, mtimeMs: 1 });

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, dbRow(), hooks());

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result).toBe(RECONCILED);
  });

  it('retains the stale-journal refusal when artifact and live-row heads disagree', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'passed', headSha: 'head-old', runId: RUN_ID, mtimeMs: 1 });
    const row = dbRow('head-current');

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, row, hooks());

    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toBe(row);
  });

  it('still refuses the replay when the artifact disagrees with the journal verdict', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'blocked', runId: RUN_ID, mtimeMs: 1 });
    const row = dbRow();

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, row, hooks());

    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toBe(row);
  });

  it('still refuses the replay when no artifact exists — absence never approves', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue(null);
    const row = dbRow();

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, row, hooks());

    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toBe(row);
  });

  it('never reads the artifact on the common path where nothing is being refused', () => {
    journalCarrying('passed');
    staleSnapshot.mockReturnValue(null);

    resolveJournalReconciledReviewStatusSync(ISSUE, dbRow(), hooks());

    expect(readArtifact).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('never reads the artifact when there is no journal at all', () => {
    readJournal.mockReturnValue(null);

    resolveJournalReconciledReviewStatusSync(ISSUE, dbRow(), hooks());

    expect(readArtifact).not.toHaveBeenCalled();
  });
});

describe('readMemoizedArtifactVerdict — freshness and capacity', () => {
  let workspacePath: string;
  let real: typeof import('../cloister/synthesis-verdict.js');

  function artifactOptions(now: number, issueId = ISSUE, workspace = workspacePath) {
    const runId = `agent-${issueId.toLowerCase()}-review-run-1`;
    return {
      now,
      workspacePath: workspace,
      reviewRunId: runId,
      reviewArtifactCapability: CAPABILITY,
    };
  }

  function writeArtifact(issueId: string, workspace: string, body = '## Verdict: APPROVED\n'): string {
    const runId = `agent-${issueId.toLowerCase()}-review-run-1`;
    const runDir = join(workspace, '.pan', 'review', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'synthesis.md'), `${reviewArtifactCapabilityMarker(CAPABILITY)}\n${body}`, 'utf-8');
    writeFileSync(join(runDir, 'context.json'), JSON.stringify({ issueId, runId }), 'utf-8');
    return runDir;
  }

  beforeEach(async () => {
    real = await vi.importActual<typeof import('../cloister/synthesis-verdict.js')>(
      '../cloister/synthesis-verdict.js',
    );
    real.__resetArtifactVerdictMemo();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan3511-memo-'));
    writeArtifact(ISSUE, workspacePath);
  });

  afterEach(() => {
    real.__resetArtifactVerdictMemo();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('serves the second read inside the TTL from the memo without touching the filesystem', () => {
    const now = Date.now();
    expect(real.readMemoizedArtifactVerdict(ISSUE, artifactOptions(now))?.verdict).toBe('passed');
    rmSync(join(workspacePath, '.pan'), { recursive: true, force: true });

    const cached = real.readMemoizedArtifactVerdict(ISSUE, artifactOptions(now + real.ARTIFACT_VERDICT_MEMO_TTL_MS - 1));
    expect(cached?.verdict).toBe('passed');
  });

  it('re-scans once the memo TTL expires', () => {
    const now = Date.now();
    expect(real.readMemoizedArtifactVerdict(ISSUE, artifactOptions(now))?.verdict).toBe('passed');
    rmSync(join(workspacePath, '.pan'), { recursive: true, force: true });

    expect(real.readMemoizedArtifactVerdict(ISSUE, artifactOptions(now + real.ARTIFACT_VERDICT_MEMO_TTL_MS))).toBeNull();
  });

  it('expires a non-null memo entry at the artifact freshness boundary', () => {
    const now = Date.now();
    const first = real.readMemoizedArtifactVerdict(ISSUE, artifactOptions(now));
    expect(first?.verdict).toBe('passed');
    rmSync(join(workspacePath, '.pan'), { recursive: true, force: true });

    const boundary = first!.mtimeMs + real.SYNTHESIS_ARTIFACT_FRESH_MS;
    expect(real.readMemoizedArtifactVerdict(ISSUE, artifactOptions(boundary))).toBeNull();
  });

  it('memoizes absence too until the null-entry TTL expires', () => {
    const empty = mkdtempSync(join(tmpdir(), 'pan3511-memo-empty-'));
    const issueId = 'PAN-9999';
    const now = Date.now();
    try {
      expect(real.readMemoizedArtifactVerdict(issueId, artifactOptions(now, issueId, empty))).toBeNull();
      writeArtifact(issueId, empty);
      expect(real.readMemoizedArtifactVerdict(issueId, artifactOptions(now + 1, issueId, empty))).toBeNull();
      expect(real.readMemoizedArtifactVerdict(issueId, artifactOptions(
        now + real.ARTIFACT_VERDICT_MEMO_TTL_MS,
        issueId,
        empty,
      ))?.verdict).toBe('passed');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('evicts least-recently-used issue keys once the capacity is exceeded', () => {
    const now = Date.now();
    for (let i = 0; i <= real.ARTIFACT_VERDICT_MEMO_MAX_ENTRIES; i += 1) {
      const issueId = `PAN-${10_000 + i}`;
      real.readMemoizedArtifactVerdict(issueId, artifactOptions(now, issueId, workspacePath));
    }
    expect(real.__artifactVerdictMemoSize()).toBe(real.ARTIFACT_VERDICT_MEMO_MAX_ENTRIES);
  });
});
