import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const tmux = vi.hoisted(() => ({
  liveSessions: new Set<string>(),
}));
const filesystem = vi.hoisted(() => ({
  existingPaths: new Set<string>(),
}));
const spawn = vi.hoisted(() => ({
  workAgent: vi.fn(),
}));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  existsSync: (path: string) => filesystem.existingPaths.has(String(path)),
}));
vi.mock('../../tmux.js', () => ({
  sessionExists: (name: string) => Effect.succeed(tmux.liveSessions.has(name)),
  listSessionNames: () => Effect.succeed([...tmux.liveSessions]),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'test', projectPath: '/repo' })),
  getProjectSync: vi.fn(() => null),
}));
vi.mock('../../pan-dir/record.js', () => ({
  readIssueRecordSync: vi.fn(() => null),
  writeIssueRecordSync: vi.fn(),
}));

const agentState = vi.hoisted(() => ({
  states: new Map<string, Record<string, unknown>>(),
  clearPaused: vi.fn(),
  clearTroubled: vi.fn(),
}));
vi.mock('../../agents/agent-state.js', () => ({
  getAgentStateSync: (id: string) => agentState.states.get(id) ?? null,
  clearAgentPausedSync: agentState.clearPaused,
  clearAgentTroubledSync: agentState.clearTroubled,
}));
vi.mock('../../overdeck/agent-review-provenance.js', () => ({
  getReviewArtifactProvenanceSync: (id: string) => agentState.states.get(id) ?? null,
}));

const resume = vi.hoisted(() => ({
  resumeAgent: vi.fn(),
}));
vi.mock('../../agents/resume.js', () => ({
  resumeAgent: resume.resumeAgent,
}));
vi.mock('../work-agent-start.js', () => ({
  spawnWorkAgentThroughAgentsEndpoint: spawn.workAgent,
}));

// PAN-3511: surfaceIssueFeedbackNeedsYou dynamically imports review-status for
// the stuck mark, and the artifact restore writes through the same module.
const reviewStatus = vi.hoisted(() => ({
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: vi.fn(),
  getReviewStatusSync: vi.fn(() => ({ reviewStatus: 'reviewing' })),
}));
vi.mock('../../review-status.js', () => ({
  markWorkspaceStuck: reviewStatus.markWorkspaceStuck,
  setReviewStatusSync: reviewStatus.setReviewStatusSync,
  getReviewStatusSync: reviewStatus.getReviewStatusSync,
  FEEDBACK_DELIVERY_STUCK_REASON: 'feedback_delivery_needs_you',
}));

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from '../feedback-target.js';
import { resolveProjectFromIssueSync } from '../../projects.js';
import { VERDICT_REPORT_FILENAMES, type VerdictReportFilename } from '../review-verdict-report.js';
import { installTestReviewAttestationKey, writeAttestedReviewArtifact } from './review-artifact-test-helpers.js';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('resolveIssueFeedbackTarget — resurrection-first delivery (PAN-2209 + PAN-2461)', () => {
  const AGENT = 'agent-pan-9999';

  beforeEach(() => {
    vi.clearAllMocks();
    tmux.liveSessions.clear();
    filesystem.existingPaths.clear();
    agentState.states.clear();
    // Default: a successful resume brings the session up.
    resume.resumeAgent.mockImplementation(async (id: string) => {
      tmux.liveSessions.add(id);
      return { success: true };
    });
    spawn.workAgent.mockImplementation(async (issueId: string) => {
      const agentId = `agent-${issueId.toLowerCase()}`;
      tmux.liveSessions.add(agentId);
      return { spawned: true, agentId };
    });
  });

  it('returns the live whole-issue agent without any resurrection', async () => {
    tmux.liveSessions.add(AGENT);

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(target).toEqual({ agentId: AGENT });
    expect(resume.resumeAgent).not.toHaveBeenCalled();
  });

  it('resurrects a plain STOPPED work agent instead of parking needs-you (PAN-2209)', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped' });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('unpauses + resumes a pipeline needs-you paused agent (PAN-2461)', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'needs-you: verification failed 3x',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('unpauses + resumes a governor/scheduler-yielded agent', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'yielded', yieldedByScheduler: true,
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('NEVER overrides an operator pause — parks needs-you instead', async () => {
    agentState.states.set(AGENT, {
      id: AGENT, status: 'stopped', paused: true, pausedReason: 'operator investigating flaky build',
    });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearPaused).not.toHaveBeenCalled();
    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });

  it('clears a troubled gate for one resurrection attempt', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped', troubled: true, consecutiveFailures: 3 });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(agentState.clearTroubled).toHaveBeenCalledWith(AGENT);
    expect(target).toEqual({ agentId: AGENT });
  });

  it('starts a missing registry agent when its workspace continue state is healthy', async () => {
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck/continue.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(spawn.workAgent).toHaveBeenCalledWith('PAN-9999', undefined, false, 'resume-agent');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agent registry row is missing'));
    expect(target).toEqual({ agentId: AGENT });
    warn.mockRestore();
  });

  it('parks needs-you only after resume and start both fail', async () => {
    agentState.states.set(AGENT, { id: AGENT, status: 'stopped' });
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck');
    filesystem.existingPaths.add('/repo/workspaces/feature-pan-9999/.overdeck/continue.json');
    resume.resumeAgent.mockResolvedValue({ success: false, error: 'resume failed' });
    spawn.workAgent.mockResolvedValue({ spawned: false, error: 'start failed' });

    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).toHaveBeenCalledWith(AGENT);
    expect(spawn.workAgent).toHaveBeenCalledWith('PAN-9999', undefined, false, 'resume-agent');
    expect(target).toMatchObject({ needsYou: true });
    expect((target as { reason: string }).reason).toContain('resurrection');
  });

  it('parks needs-you when no agent state or continue state exists', async () => {
    const target = await resolveIssueFeedbackTarget('PAN-9999');

    expect(resume.resumeAgent).not.toHaveBeenCalled();
    expect(spawn.workAgent).not.toHaveBeenCalled();
    expect(target).toMatchObject({ needsYou: true });
  });
});

describe('surfaceIssueFeedbackNeedsYou — verdict repair preserves the delivery gate (PAN-3511)', () => {
  const ISSUE = 'PAN-9999';
  const REVIEW_RUN_ID = 'agent-pan-9999-review-run-1-att1';
  let projectPath: string;
  let workspacePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    installTestReviewAttestationKey();
    filesystem.existingPaths.clear();
    agentState.states.clear();
    reviewStatus.getReviewStatusSync.mockReturnValue({ reviewStatus: 'reviewing' });
    const { __resetArtifactVerdictMemo } = await import('../synthesis-verdict.js');
    __resetArtifactVerdictMemo();
    projectPath = mkdtempSync(join(tmpdir(), 'pan3511-feedback-'));
    workspacePath = join(projectPath, 'workspaces', `feature-${ISSUE.toLowerCase()}`);
    agentState.states.set(`agent-${ISSUE.toLowerCase()}-review`, {
      id: `agent-${ISSUE.toLowerCase()}-review`,
      workspace: workspacePath,
      reviewRunId: REVIEW_RUN_ID,
    });
    vi.mocked(resolveProjectFromIssueSync).mockReturnValue({ projectKey: 'test', projectPath } as never);
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  /** Write a host-attested artifact and register it with the suite's existsSync mock. */
  function writeArtifact(filename: VerdictReportFilename, body: string, headSha?: string): void {
    const path = writeAttestedReviewArtifact({
      workspacePath,
      issueId: ISSUE,
      runId: REVIEW_RUN_ID,
      filename,
      body,
      ...(headSha ? { headSha } : {}),
    });
    filesystem.existingPaths.add(path);
  }

  // Both shapes: synthesis.md is the convoy artifact, review.md is quick
  // self-review — the fleet default. A synthesis-only fixture would miss it.
  it.each(VERDICT_REPORT_FILENAMES)(
    'restores a fresh approved %s and still records failed feedback delivery (ac1, ac2)',
    async (filename) => {
      writeArtifact(filename, '## Verdict: APPROVED\n\n## Summary\nEverything checks out cleanly.\n');

      await surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target', { agentId: 'agent-pan-9999' });

      expect(reviewStatus.markWorkspaceStuck).toHaveBeenCalledWith(
        ISSUE,
        'feedback_delivery_needs_you',
        { reason: 'no live feedback target', agentId: 'agent-pan-9999' },
      );
      expect(reviewStatus.setReviewStatusSync).toHaveBeenCalledTimes(1);
      expect(reviewStatus.setReviewStatusSync.mock.calls[0]![1]).toMatchObject({ reviewStatus: 'passed' });
    },
  );

  it('preserves a test-feedback delivery gate after review already passed', async () => {
    reviewStatus.getReviewStatusSync.mockReturnValue({ reviewStatus: 'passed', testStatus: 'failed' });
    writeArtifact('synthesis.md', '## Verdict: APPROVED\n');

    await surfaceIssueFeedbackNeedsYou(ISSUE, 'test feedback could not be delivered', { phase: 'test' });

    expect(reviewStatus.markWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE,
      'feedback_delivery_needs_you',
      { reason: 'test feedback could not be delivered', phase: 'test' },
    );
  });

  it('marks stuck with the unchanged details payload when no artifact exists (ac3)', async () => {
    await surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target', { agentId: 'agent-pan-9999' });

    expect(reviewStatus.setReviewStatusSync).not.toHaveBeenCalled();
    expect(reviewStatus.markWorkspaceStuck).toHaveBeenCalledTimes(1);
    expect(reviewStatus.markWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE,
      'feedback_delivery_needs_you',
      { reason: 'no live feedback target', agentId: 'agent-pan-9999' },
    );
  });

  it('still marks stuck when the artifact consult throws (ac4)', async () => {
    // The consult must fail TOWARD the flag that protects delivery today.
    reviewStatus.getReviewStatusSync.mockImplementation(() => { throw new Error('db locked'); });
    writeArtifact('synthesis.md', '## Verdict: APPROVED\n');

    await expect(
      surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target', { agentId: 'agent-pan-9999' }),
    ).resolves.toBeUndefined();

    expect(reviewStatus.markWorkspaceStuck).toHaveBeenCalledTimes(1);
  });

  it('still marks feedback delivery stuck when the artifact head disagrees', async () => {
    reviewStatus.getReviewStatusSync.mockReturnValue({ reviewStatus: 'reviewing', lastVerifiedCommit: 'b'.repeat(40) });
    writeArtifact('synthesis.md', '## Verdict: APPROVED\n', 'a'.repeat(40));

    await surfaceIssueFeedbackNeedsYou(ISSUE, 'no live feedback target', {});

    expect(reviewStatus.setReviewStatusSync).not.toHaveBeenCalled();
    expect(reviewStatus.markWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE,
      'feedback_delivery_needs_you',
      { reason: 'no live feedback target' },
    );
  });
});
