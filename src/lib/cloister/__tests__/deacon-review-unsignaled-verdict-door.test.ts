/**
 * PAN-3512 — the two unsignaled-recovery auto-completes route their terminal
 * verdict through the write door instead of writing the review row directly.
 *
 * Both pass no evidence head, so the door takes its no-evidence path and the
 * landing behavior is unchanged; what changes is that the write is now
 * attributable (writer 'unsignaled-recovery') and a refusal is reported instead
 * of being announced as a completed auto-complete.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  recordReviewVerdict: vi.fn(),
  loadReviewStatuses: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  findWorkspacePath: vi.fn(),
  findVerdictReport: vi.fn(),
  parseVerdictReport: vi.fn(),
  sessionExistsSync: vi.fn(),
  isPaneDead: vi.fn(),
  getAgentStateSync: vi.fn(),
  messageAgent: vi.fn(),
}));

vi.mock('../review-verdict-writer.js', () => ({ recordReviewVerdict: mocks.recordReviewVerdict }));
vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
  setReviewStatusSync: vi.fn(),
}));
vi.mock('../../projects.js', () => ({ resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync }));
vi.mock('../../lifecycle/archive-planning.js', () => ({ findWorkspacePath: mocks.findWorkspacePath }));
vi.mock('../review-verdict-report.js', () => ({
  findVerdictReport: mocks.findVerdictReport,
  findVerdictReportAsync: vi.fn(),
  parseVerdictReport: mocks.parseVerdictReport,
}));
vi.mock('../../tmux.js', () => ({
  sessionExistsSync: mocks.sessionExistsSync,
  isPaneDead: mocks.isPaneDead,
}));
vi.mock('../../agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  getAgentRuntimeStateSync: vi.fn(),
  listRunningAgents: vi.fn(() => Effect.succeed([])),
  messageAgent: mocks.messageAgent,
}));

const { checkCompletedButUnsignaledReviews } = await import('../deacon-review-unsignaled.js');

const ISSUE = 'PAN-1577';
const RUN_DIR_NAME = 'agent-pan-1577-review-abc123';

let workspace: string;
let reportPath: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  workspace = mkdtempSync(join(tmpdir(), 'pan3512-unsignaled-'));
  const runDir = join(workspace, '.pan', 'review', RUN_DIR_NAME);
  mkdirSync(runDir, { recursive: true });
  reportPath = join(runDir, 'synthesis.md');
  writeFileSync(reportPath, '## Verdict: CHANGES REQUESTED — terminal verdicts are dropped\n');
  // Age the synthesis past the 5-minute settle window so the sweep intervenes.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(reportPath, tenMinutesAgo, tenMinutesAgo);

  // No reviewSpawnedAt means isSynthesisForActiveReviewRun accepts the run.
  mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: { reviewStatus: 'reviewing' } });
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/does/not/matter' });
  mocks.findWorkspacePath.mockReturnValue(workspace);
  mocks.findVerdictReport.mockReturnValue({ path: reportPath, filename: 'synthesis.md' });
  mocks.parseVerdictReport.mockReturnValue({ verdict: 'blocked', topBlocker: 'terminal verdicts are dropped' });
  mocks.isPaneDead.mockReturnValue(Effect.succeed(true));
  mocks.getAgentStateSync.mockReturnValue(null);
  mocks.recordReviewVerdict.mockResolvedValue({ landed: true, classification: 'no-evidence' });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('unsignaled-recovery auto-complete — verdict write door (PAN-3512)', () => {
  it('records the dead-session auto-complete through the door with writer "unsignaled-recovery"', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);

    const actions = await checkCompletedButUnsignaledReviews();

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    const [issueId, input] = mocks.recordReviewVerdict.mock.calls[0]!;
    expect(issueId).toBe(ISSUE);
    expect(input.verdict).toBe('blocked');
    expect(input.writer).toBe('unsignaled-recovery');
    expect(input.notes).toBe('terminal verdicts are dropped');
    // No evidence head — the door takes its no-evidence path, behavior unchanged.
    expect(input.evidenceHead).toBeUndefined();
    expect(actions.some(a => a.includes('Auto-completed review'))).toBe(true);
  });

  it('reports the rejection reason instead of announcing an auto-complete that did not land', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.recordReviewVerdict.mockResolvedValue({ landed: false, reason: 'issue-not-found' });

    const actions = await checkCompletedButUnsignaledReviews();

    expect(actions.some(a => a.includes('not recorded (issue-not-found)'))).toBe(true);
    expect(actions.some(a => a.includes('Auto-completed review'))).toBe(false);
  });

  it('nudges a live parent first, then routes the unresponsive auto-complete through the door', async () => {
    mocks.sessionExistsSync.mockReturnValue(true);
    mocks.isPaneDead.mockReturnValue(Effect.succeed(false));

    const firstPass = await checkCompletedButUnsignaledReviews();
    expect(mocks.messageAgent).toHaveBeenCalledTimes(1);
    expect(mocks.recordReviewVerdict).not.toHaveBeenCalled();
    expect(firstPass.some(a => a.includes('Nudged'))).toBe(true);

    // 31 minutes later the nudge dedup window has expired and the parent still
    // has not signaled — that is the auto-complete branch.
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 31 * 60 * 1000);

    const secondPass = await checkCompletedButUnsignaledReviews();

    expect(mocks.recordReviewVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.recordReviewVerdict.mock.calls[0]![1].writer).toBe('unsignaled-recovery');
    expect(secondPass.some(a => a.includes('alive but unresponsive after nudge'))).toBe(true);
  });
});
