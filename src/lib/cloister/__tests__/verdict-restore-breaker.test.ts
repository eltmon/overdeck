/**
 * PAN-3511 — the review-infrastructure breaker must consult the verdict of
 * record before it marks a row stuck.
 *
 * Retries exhausted while a verdict already sits on disk means the recovery was
 * chasing a review that had already FINISHED. Tripping the breaker there strands
 * a completed review behind an operator gate, which is the PAN-1577 wipe wearing
 * a different hat.
 *
 * Both breaker sites are driven END TO END through their real exported entry
 * points, and the artifact is a real file read by the real reader — a mocked
 * reader would prove the helper works, not that the patrol calls it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERDICT_REPORT_FILENAMES } from '../review-verdict-report.js';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  loadReviewStatuses: vi.fn(),
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  markWorkspaceStuck: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  isIssueClosed: vi.fn(),
  emitActivityEntryOnce: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../overdeck/review-status-sync.js', () => ({
  markWorkspaceStuck: mocks.markWorkspaceStuck,
}));

// Shared by the deacon module AND by the real artifact reader in
// synthesis-verdict.ts, which resolves <projectPath>/workspaces/feature-<issue>.
vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../issue-closed.js', () => ({ isIssueClosed: mocks.isIssueClosed }));

vi.mock('../../agents.js', () => ({
  getAgentStateSync: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
  listRunningAgents: vi.fn(() => Effect.succeed([])),
  spawnRun: vi.fn(),
}));

vi.mock('../../overdeck/agents.js', () => ({ listAllAgentsSync: vi.fn(() => []) }));

vi.mock('../../tmux.js', () => ({
  isPaneDead: vi.fn(() => false),
  sessionExistsSync: vi.fn(() => false),
}));

vi.mock('../specialists.js', () => ({
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
  getTmuxSessionName: vi.fn((type: string) => type),
}));

vi.mock('../review-convoy-liveness.js', () => ({
  evaluateReviewConvoyLiveness: vi.fn(() => ({ active: false, reason: 'no convoy in test' })),
}));

vi.mock('../concurrency.js', () => ({
  describeRunningAgents: vi.fn(() => 'counts: work=0 advancing=0 total=0/9'),
  releaseAdvancingSlot: vi.fn(),
  tryReserveAdvancingSlot: vi.fn(() => true),
}));

vi.mock('../preemption.js', () => ({ tryYieldForAdvancingDispatch: vi.fn(async () => false) }));

vi.mock('../../lifecycle/archive-planning.js', () => ({
  findWorkspacePath: vi.fn(() => null),
  inferBranchFromWorkspace: vi.fn((_w: string, i: string) => `feature/${i}`),
}));

vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: vi.fn(async () => ({ skip: false })),
}));

vi.mock('../review-agent.js', () => ({
  spawnReviewRoleForIssue: vi.fn(() => Effect.succeed({ success: true, message: 'spawned' })),
}));

vi.mock('../test-agent-queue.js', () => ({ buildTestRolePrompt: vi.fn(() => 'prompt') }));

vi.mock('../../workspace/stack-health.js', () => ({
  getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [] })),
}));

// emitActivityEntrySync belongs to the deacon; emitActivityEntryOnce is what the
// restore helper reaches for on the blocked path. Both live in this module.
vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityEntryOnce: mocks.emitActivityEntryOnce,
}));

vi.mock('../../persistent-logger.js', () => ({ logDeaconEventSync: vi.fn() }));
vi.mock('../deacon-nudge-log.js', () => ({ recordDeaconNudge: vi.fn() }));
vi.mock('../event-store-provider.js', () => ({ getCloisterEventStore: vi.fn(() => null) }));

const ISSUE = 'PAN-3511';
const BREAKER_THRESHOLD = 3;

let projectPath: string;

function workspacePath(): string {
  return join(projectPath, 'workspaces', `feature-${ISSUE.toLowerCase()}`);
}

/** Writes a real reviewer artifact where the real reader will find it. */
function writeArtifact(filename: string, body: string): void {
  const runDir = join(workspacePath(), '.pan', 'review', 'run-1');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, filename), body, 'utf-8');
}

const APPROVED = '## Verdict: APPROVED\n\n## Summary\nNo blocking findings in this pass.\n';

function status(fields: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: ISSUE,
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    updatedAt: '2026-08-03T00:00:00.000Z',
    readyForMerge: false,
    prUrl: `https://github.com/eltmon/overdeck/pull/3511`,
    reviewRetryCount: BREAKER_THRESHOLD,
    recoveryStartedAt: '2026-08-03T00:00:00.000Z',
    ...fields,
  } as ReviewStatus;
}

/** The row shape that reaches the orphan re-dispatch breaker: pending + a PR. */
function orphanBreakerStatus(fields: Partial<ReviewStatus> = {}): ReviewStatus {
  return status({ reviewStatus: 'pending', reviewNotes: 'infra flake', ...fields });
}

beforeEach(async () => {
  vi.clearAllMocks();
  projectPath = mkdtempSync(join(tmpdir(), 'pan3511-breaker-'));
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath });
  mocks.isIssueClosed.mockResolvedValue(false);
  mocks.emitActivityEntryOnce.mockResolvedValue('appended');
  mocks.getReviewStatusSync.mockReturnValue(status());
  mocks.loadReviewStatuses.mockReturnValue({});
  // The memo would otherwise carry one test's artifact into the next.
  const { __resetArtifactVerdictMemo } = await import('../synthesis-verdict.js');
  __resetArtifactVerdictMemo();
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
});

describe('handleReviewCoordinatorDied breaker (ac1)', () => {
  it('restores the artifact verdict and never marks the row stuck', async () => {
    writeArtifact('synthesis.md', APPROVED);

    const { handleReviewCoordinatorDied } = await import('../deacon-review-status.js');
    const actions = await handleReviewCoordinatorDied(ISSUE, 'agent-pan-3511-review', 'pane died');

    expect(mocks.markWorkspaceStuck).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
      ISSUE,
      expect.objectContaining({ reviewStatus: 'passed', reviewRetryCount: 0 }),
    );
    expect(actions.join(' ')).toContain('superseded by a fresh passed artifact');
  });

  it('clears the infra-failure gate the breaker itself owns', async () => {
    // A row already held by a previous breaker trip must come back out of the
    // gate, not merely flip its verdict.
    writeArtifact('synthesis.md', APPROVED);
    mocks.getReviewStatusSync.mockReturnValue(
      status({ stuckReason: 'review_infrastructure_failure' } as Partial<ReviewStatus>),
    );

    const { handleReviewCoordinatorDied } = await import('../deacon-review-status.js');
    await handleReviewCoordinatorDied(ISSUE, 'agent-pan-3511-review', 'pane died');

    expect(mocks.setReviewStatusSync.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'passed',
      stuck: false,
      stuckReason: undefined,
    });
  });
});

describe('orphan re-dispatch breaker (ac2)', () => {
  it('restores the artifact verdict and never marks the row stuck', async () => {
    writeArtifact('synthesis.md', APPROVED);
    const row = orphanBreakerStatus();
    mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: row });
    mocks.getReviewStatusSync.mockReturnValue(row);

    const { checkOrphanedReviewStatuses } = await import('../deacon-review-status.js');
    const actions = await checkOrphanedReviewStatuses();

    expect(mocks.markWorkspaceStuck).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
      ISSUE,
      expect.objectContaining({ reviewStatus: 'passed', reviewRetryCount: 0 }),
    );
    expect(actions.join(' ')).toContain('superseded by a fresh passed artifact');
  });
});

describe('no artifact on disk (ac3)', () => {
  it('marks stuck with the unchanged details payload at the coordinator-died site', async () => {
    const { handleReviewCoordinatorDied } = await import('../deacon-review-status.js');
    const actions = await handleReviewCoordinatorDied(ISSUE, 'agent-pan-3511-review', 'pane died');

    expect(mocks.markWorkspaceStuck).toHaveBeenCalledWith(ISSUE, 'review_infrastructure_failure', {
      reviewRetryCount: BREAKER_THRESHOLD,
      recoveryStartedAt: '2026-08-03T00:00:00.000Z',
    });
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
    expect(actions.join(' ')).toContain('Review recovery stopped');
  });

  it('marks stuck with the unchanged details payload at the orphan re-dispatch site', async () => {
    const row = orphanBreakerStatus();
    mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: row });
    mocks.getReviewStatusSync.mockReturnValue(row);

    const { checkOrphanedReviewStatuses } = await import('../deacon-review-status.js');
    const actions = await checkOrphanedReviewStatuses();

    // lastReviewNotes is part of this site's payload and must survive the retrofit.
    expect(mocks.markWorkspaceStuck).toHaveBeenCalledWith(ISSUE, 'review_infrastructure_failure', {
      reviewRetryCount: BREAKER_THRESHOLD,
      recoveryStartedAt: '2026-08-03T00:00:00.000Z',
      lastReviewNotes: 'infra flake',
    });
    expect(actions.join(' ')).toContain('Tripped review-infra breaker');
  });

  it('still marks stuck when the artifact carries a non-terminal verdict line', async () => {
    // An unparseable artifact is no evidence, so protection must survive it.
    writeArtifact('synthesis.md', '## Verdict: still deliberating\n');

    const { handleReviewCoordinatorDied } = await import('../deacon-review-status.js');
    await handleReviewCoordinatorDied(ISSUE, 'agent-pan-3511-review', 'pane died');

    expect(mocks.markWorkspaceStuck).toHaveBeenCalledTimes(1);
  });
});

describe('quick-mode review.md — the fleet default (ac4)', () => {
  it.each(VERDICT_REPORT_FILENAMES)(
    'restores an approved %s at the coordinator-died site',
    async (filename) => {
      writeArtifact(filename, APPROVED);

      const { handleReviewCoordinatorDied } = await import('../deacon-review-status.js');
      await handleReviewCoordinatorDied(ISSUE, 'agent-pan-3511-review', 'pane died');

      expect(mocks.markWorkspaceStuck).not.toHaveBeenCalled();
      expect(mocks.setReviewStatusSync.mock.calls[0]![1]).toMatchObject({ reviewStatus: 'passed' });
    },
  );

  it.each(VERDICT_REPORT_FILENAMES)(
    'restores an approved %s at the orphan re-dispatch site',
    async (filename) => {
      writeArtifact(filename, APPROVED);
      const row = orphanBreakerStatus();
      mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: row });
      mocks.getReviewStatusSync.mockReturnValue(row);

      const { checkOrphanedReviewStatuses } = await import('../deacon-review-status.js');
      await checkOrphanedReviewStatuses();

      expect(mocks.markWorkspaceStuck).not.toHaveBeenCalled();
      expect(mocks.setReviewStatusSync.mock.calls[0]![1]).toMatchObject({ reviewStatus: 'passed' });
    },
  );

  it('carries a CHANGES REQUESTED review.md through as blocked, not stuck', async () => {
    // Quick mode's blocked vocabulary. A blocked verdict is still a FINISHED
    // review, so the breaker must stand down for it too.
    writeArtifact('review.md', '## Verdict: CHANGES REQUESTED — unhandled null in the parser\n');

    const { handleReviewCoordinatorDied } = await import('../deacon-review-status.js');
    await handleReviewCoordinatorDied(ISSUE, 'agent-pan-3511-review', 'pane died');

    expect(mocks.markWorkspaceStuck).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'blocked',
      reviewNotes: 'unhandled null in the parser',
    });
  });
});
