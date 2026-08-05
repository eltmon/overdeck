import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveJournalReconciledReviewStatusSync, type ReviewStatusReadHooks } from '../review-status-read.js';
import { readMemoizedArtifactVerdict } from '../cloister/synthesis-verdict.js';
import { readActiveReviewArtifactContext } from '../agents/agent-state-source.js';
import { readJournalStatusSync } from '../overdeck/review-status-record-sync.js';
import { reconcileJournalIntoCacheSync } from '../review-status-reconcile.js';
import { staleVerdictSnapshotAgainstLiveCycle } from '../pan-dir/pipeline-verdict-merge.js';

vi.mock('../agents/agent-state-source.js', () => ({ readActiveReviewArtifactContext: vi.fn() }));
vi.mock('../cloister/synthesis-verdict.js', () => ({ readMemoizedArtifactVerdict: vi.fn() }));
vi.mock('../overdeck/review-status-record-sync.js', () => ({
  readJournalStatusSync: vi.fn(),
  enrichReviewNotesFromRecordSync: vi.fn((_issueId: string, status: unknown) => status),
}));
vi.mock('../review-status-reconcile.js', () => ({ reconcileJournalIntoCacheSync: vi.fn() }));
vi.mock('../pan-dir/pipeline-verdict-merge.js', () => ({ staleVerdictSnapshotAgainstLiveCycle: vi.fn() }));

const ISSUE = 'PAN-3511';
const DB_ROW = { reviewStatus: 'reviewing', updatedAt: '2026-08-03T00:00:00.000Z' } as never;
const RECONCILED = { reviewStatus: 'passed', updatedAt: '2026-08-03T01:00:00.000Z' } as never;

const readArtifact = vi.mocked(readMemoizedArtifactVerdict);
const readJournal = vi.mocked(readJournalStatusSync);
const readReviewArtifactContext = vi.mocked(readActiveReviewArtifactContext);
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

function terminalJournal(reviewStatus: string): void {
  readJournal.mockReturnValue({
    durable: { reviewStatus },
    updatedAt: '2026-08-03T01:00:00.000Z',
  } as never);
}

describe('resolveJournalReconciledReviewStatusSync — active-run artifact corroboration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcile.mockReturnValue(RECONCILED);
    readReviewArtifactContext.mockReturnValue({
      runId: 'host-recorded-run',
      workspacePath: '/workspace',
    });
  });

  it('reconciles a stale terminal journal only when active-run evidence corroborates it', () => {
    terminalJournal('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'passed', runId: 'host-recorded-run', mtimeMs: 1 });

    const result = resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(readArtifact).toHaveBeenCalledWith(ISSUE, {
      runId: 'host-recorded-run',
      workspacePath: '/workspace',
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result).toBe(RECONCILED);
  });

  it('refuses a stale journal when active-run evidence disagrees', () => {
    terminalJournal('passed');
    staleSnapshot.mockReturnValue({ liveCycle: Date.parse('2026-08-03T00:30:00.000Z') } as never);
    readArtifact.mockReturnValue({ verdict: 'blocked', runId: 'host-recorded-run', mtimeMs: 1 });

    expect(resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks())).toBe(DB_ROW);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('does not consult artifact evidence before the stale-refusal predicate', () => {
    terminalJournal('passed');
    staleSnapshot.mockReturnValue(null);

    resolveJournalReconciledReviewStatusSync(ISSUE, DB_ROW, hooks());

    expect(readArtifact).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
