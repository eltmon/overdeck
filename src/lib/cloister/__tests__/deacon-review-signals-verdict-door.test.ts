/**
 * PAN-3512 — the Deacon fallback routes its terminal verdict through the write
 * door, and its convoy-parent kill is conditional on the verdict having landed.
 *
 * Before PAN-3512 the fallback killed the synthesis parent unconditionally. When
 * the write door rejected the verdict, that left an issue with no session left to
 * re-signal it — the failure mode that destroyed five APPROVED verdicts on
 * PAN-1577 on 2026-08-02.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  recordReviewVerdict: vi.fn(),
  deliverReviewVerdictFeedback: vi.fn(),
  killSession: vi.fn(),
  sessionExists: vi.fn(),
  isPaneDead: vi.fn(),
  getReviewStatusSync: vi.fn(),
  findVerdictReport: vi.fn(),
  snapshotWorkspaceHeadsPromise: vi.fn(),
  logDeaconEventSync: vi.fn(),
}));

vi.mock('../review-verdict-writer.js', () => ({
  recordReviewVerdict: mocks.recordReviewVerdict,
}));
vi.mock('../review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mocks.deliverReviewVerdictFeedback,
}));
vi.mock('../../tmux.js', () => ({
  killSession: mocks.killSession,
  sessionExists: mocks.sessionExists,
  isPaneDead: mocks.isPaneDead,
  capturePane: vi.fn(() => Effect.succeed('')),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  listSessions: vi.fn(() => Effect.succeed([])),
  sessionExistsSync: vi.fn(() => false),
}));
vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));
vi.mock('../review-verdict-report.js', () => ({
  findVerdictReport: mocks.findVerdictReport,
}));
vi.mock('../../git-utils.js', () => ({
  snapshotWorkspaceHeadsPromise: mocks.snapshotWorkspaceHeadsPromise,
}));
vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

const { nudgeSynthesisForCompleteReviewerReports } = await import('../deacon-review-signals.js');
const { REVIEW_SUB_ROLES } = await import('../review-monitor.js');

const RUN_ID = 'agent-pan-1577-review-abc123';
const FALLBACK_HEAD = 'ffffffffffffffffffffffffffffffffffffffff';

let workspace: string;

/** A synthesis parent state that satisfies every filter guard in the fallback. */
function parentState(workspacePath: string) {
  return {
    id: 'agent-pan-1577-review',
    role: 'review',
    issueId: 'PAN-1577',
    workspace: workspacePath,
    reviewRunId: RUN_ID,
    // Reports are written after this, so the mtime freshness check passes.
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  } as never;
}

/** Writes one report per sub-role; `blocking` makes the synthesis verdict 'blocked'. */
function writeReports(workspacePath: string, blocking: boolean): void {
  const reviewDir = join(workspacePath, '.pan', 'review', RUN_ID);
  mkdirSync(reviewDir, { recursive: true });
  const body = blocking
    ? '## Findings\n\n### ! Terminal verdict is silently dropped\nSome detail.\n'
    : '## Findings\n\nNone.\n';
  for (const subRole of REVIEW_SUB_ROLES) {
    writeFileSync(join(reviewDir, `${subRole}.md`), body);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  workspace = mkdtempSync(join(tmpdir(), 'pan3512-fallback-'));

  mocks.getReviewStatusSync.mockReturnValue({ reviewStatus: 'reviewing', prUrl: 'https://example.test/pr/1' });
  // A synthesis already on disk is what lets the fallback run while the parent
  // session is still alive — the exact shape of the PAN-1577 incident.
  mocks.findVerdictReport.mockReturnValue(join(workspace, '.pan', 'review', RUN_ID, 'synthesis.md'));
  mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue(FALLBACK_HEAD);
  mocks.sessionExists.mockReturnValue(Effect.succeed(true));
  mocks.isPaneDead.mockReturnValue(Effect.succeed(false));
  mocks.killSession.mockReturnValue(Effect.succeed(undefined));
  mocks.deliverReviewVerdictFeedback.mockReturnValue(Effect.succeed(undefined));
  mocks.recordReviewVerdict.mockResolvedValue({ landed: true, classification: 'dispatched' });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Deacon fallback — verdict write door (PAN-3512)', () => {
  it('records a passed verdict through the door with writer "fallback" and an evidence head', async () => {
    writeReports(workspace, false);

    await nudgeSynthesisForCompleteReviewerReports([parentState(workspace)]);

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    const [issueId, input] = mocks.recordReviewVerdict.mock.calls[0]!;
    expect(issueId).toBe('PAN-1577');
    expect(input.verdict).toBe('passed');
    expect(input.writer).toBe('fallback');
    // The anchor travels for passed verdicts too, not only blocked ones — it is
    // what makes the downstream test-gate comparison meaningful.
    expect(input.evidenceHead).toBe(FALLBACK_HEAD);
    expect(input.runId).toBe(RUN_ID);
  });

  it('kills neither the parent session nor delivers feedback when the verdict does not land', async () => {
    writeReports(workspace, true);
    mocks.recordReviewVerdict.mockResolvedValue({ landed: false, reason: 'stale-evidence-head' });

    const actions = await nudgeSynthesisForCompleteReviewerReports([parentState(workspace)]);

    expect(mocks.killSession).not.toHaveBeenCalled();
    expect(mocks.deliverReviewVerdictFeedback).not.toHaveBeenCalled();
    expect(actions.some(a => a.includes('stale-evidence-head'))).toBe(true);
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(
      expect.stringContaining('stale-evidence-head'),
    );
  });

  it('delivers blocked feedback and then kills the parent exactly once when the verdict lands', async () => {
    writeReports(workspace, true);

    await nudgeSynthesisForCompleteReviewerReports([parentState(workspace)]);

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.recordReviewVerdict.mock.calls[0]![1].verdict).toBe('blocked');
    expect(mocks.deliverReviewVerdictFeedback).toHaveBeenCalledTimes(1);
    expect(mocks.killSession).toHaveBeenCalledTimes(1);
    expect(mocks.killSession).toHaveBeenCalledWith('agent-pan-1577-review');
  });
});
