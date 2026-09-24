import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  spawnRun: vi.fn(),
  saveAgentStateProgram: vi.fn(),
  getAgentStateProgram: vi.fn(),
  getAgentState: vi.fn(),
  getAgentStateFileSync: vi.fn(),
  listAgentIdsByPrefix: vi.fn(),
  removeAgent: vi.fn(),
  getLatestSessionId: vi.fn(),
  resumeAgent: vi.fn(),
  wipeAgentStateDirs: vi.fn(),
  listSessionNames: vi.fn(),
  isPaneDead: vi.fn(),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  emitActivityEntry: vi.fn(),
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
  buildReviewContext: vi.fn(),
  formatTier1Summary: vi.fn(),
  clearFeedbackFiles: vi.fn(),
  convergeRowFromVerdictOfRecord: vi.fn(),
  notifyPipeline: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mocks.exec,
  execFile: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  stopAgent: vi.fn(() => Effect.void),
  spawnRun: mocks.spawnRun,
  saveAgentState: mocks.saveAgentStateProgram,
  saveAgentStateProgram: mocks.saveAgentStateProgram,
  getAgentStateProgram: mocks.getAgentStateProgram,
  getAgentState: mocks.getAgentState,
  getLatestSessionId: mocks.getLatestSessionId,
  resumeAgent: mocks.resumeAgent,
  wipeAgentStateDirs: mocks.wipeAgentStateDirs,
  messageAgent: vi.fn(),
}));

vi.mock('../../agents/agent-state.js', () => ({
  getAgentState: mocks.getAgentStateFileSync,
}));

vi.mock('../../overdeck/agents.js', () => ({
  listAgentIdsByPrefix: mocks.listAgentIdsByPrefix,
}));

vi.mock('../../agents/removal.js', () => ({
  removeAgent: mocks.removeAgent,
}));

vi.mock('../../tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
  isPaneDead: mocks.isPaneDead,
  killSession: mocks.killSession,
  killSessionSync: mocks.killSession,
}));

// PAN-3939: the dispatch guard asks the liveness oracle and the reviewer kill
// closes through the terminal backend. Both are modeled on the tmux mocks above
// so these tests keep their session-list / pane-dead / kill semantics.
vi.mock('../../agents/liveness.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../agents/liveness.js')>(),
  isAlive: vi.fn(async (agentId: string) => {
    let names: readonly string[];
    try {
      names = await Effect.runPromise(mocks.listSessionNames() as Effect.Effect<readonly string[], Error>);
    } catch {
      return { alive: false, reason: 'runtime-indeterminate' };
    }
    if (!names.includes(agentId)) return { alive: false, reason: 'no-session' };
    return await Effect.runPromise(mocks.isPaneDead(agentId) as Effect.Effect<boolean>)
      ? { alive: false, reason: 'pane-dead' }
      : { alive: true, paneAlive: true };
  }),
}));

vi.mock('../../terminal-backends/launch.js', () => ({
  closeAgentPaneDetailed: vi.fn(async (agentId: string) => {
    try {
      await Effect.runPromise(mocks.killSession(agentId) as Effect.Effect<void, Error>);
      return { outcome: 'closed' };
    } catch (err) {
      return { outcome: 'failed', reason: String(err) };
    }
  }),
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: mocks.emitActivityEntry,
}));

// PAN-3917: the conflict gate asks the forge; keep the subprocess out of the test.
vi.mock('../pr-facts.js', () => ({
  getPrFacts: async (issueId: string) => ({
    issueId, forge: 'github', url: null, number: null, exists: true, open: true,
    merged: false, closed: false, draft: false, headSha: null, headBranch: null,
    reviewDecision: null, approved: false, changesRequested: false,
    mergeable: true, mergeableState: 'clean', checks: 'green',
  }),
}));

vi.mock('../../config-yaml.js', () => ({
  loadConfigSync: vi.fn(() => ({ config: {} })),
  resolveModel: vi.fn(() => 'sonnet'),
}));

vi.mock('../review-context.js', () => ({
  buildReviewContext: mocks.buildReviewContext,
  formatTier1Summary: mocks.formatTier1Summary,
}));

vi.mock('../review-monitor.js', () => ({
  REVIEW_SUB_ROLES: ['security'],
}));

vi.mock('../feedback-writer.js', () => ({
  clearFeedbackFiles: mocks.clearFeedbackFiles,
}));

vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: vi.fn(async () => ({ skip: false, reason: 'open' })),
  verifyMergedBeforeLifecycle: vi.fn(),
}));

vi.mock('../verdict-restore.js', () => ({
  convergeRowFromVerdictOfRecord: mocks.convergeRowFromVerdictOfRecord,
}));

vi.mock('../../pipeline-notifier.js', () => ({
  notifyPipeline: mocks.notifyPipeline,
}));

import { buildReviewRolePrompt, purgeReviewAgentsForIssue, spawnReviewRoleForIssue } from '../review-agent.js';

describe('spawnReviewRoleForIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exec.mockImplementation((command: string, options: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof options === 'function' ? options : callback;
      const stdout = command.includes('rev-parse') ? 'abc12345\n' : '';
      cb?.(null, { stdout, stderr: '' });
      return {};
    });
    mocks.spawnRun.mockImplementation(async (issueId: string, role: string, options: { subRole?: string; workspace: string; model?: string }) => ({
      id: options.subRole ? `agent-${issueId.toLowerCase()}-review-${options.subRole}` : `agent-${issueId.toLowerCase()}-review`,
      issueId,
      workspace: options.workspace,
      harness: 'claude-code',
      role,
      model: options.model ?? 'sonnet',
      status: 'running',
      startedAt: '2026-05-18T00:00:00.000Z',
    }));
    mocks.saveAgentStateProgram.mockReturnValue(Effect.void);
    mocks.getAgentState.mockImplementation((id: string) => (id === 'agent-pan-1194' ? { hostOverride: true } : undefined));
    mocks.getAgentStateFileSync.mockReturnValue(undefined);
    mocks.getAgentStateFileSync.mockReturnValue(undefined);
    mocks.listAgentIdsByPrefix.mockReturnValue([]);
    mocks.removeAgent.mockResolvedValue({ removedDir: false, preservedTranscripts: 1 });
    mocks.getLatestSessionId.mockReturnValue(undefined);
    mocks.resumeAgent.mockResolvedValue({ success: false, reason: 'no session' });
    mocks.wipeAgentStateDirs.mockResolvedValue(undefined);
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.isPaneDead.mockReturnValue(Effect.succeed(false));
    mocks.killSession.mockReturnValue(Effect.void);
    mocks.buildReviewContext.mockResolvedValue({ manifestPath: undefined, changedFiles: [] });
    mocks.formatTier1Summary.mockReturnValue('shared review context');
    mocks.clearFeedbackFiles.mockResolvedValue(undefined);
    mocks.convergeRowFromVerdictOfRecord.mockResolvedValue({ converged: false });
  });

  it('dispatches quick review without convoy wait instructions', async () => {
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-quick-contract',
      branch: 'feature/pan-1194',
    }));
    expect(result.success).toBe(true);
    const options = mocks.spawnRun.mock.calls[0][2];
    const prompt = options.prompt;
    expect(prompt).toContain('sole reviewer');
    expect(prompt).toContain('second coverage pass');
    expect(prompt).toContain('AC evidence');
    expect(prompt).not.toContain('STANDBY');
    expect(prompt).not.toContain('REVIEWER_READY');
    expect(prompt).not.toContain('synthesis.md');
  });

  it('keeps convoy wait, failure, and report obligations in the full dispatch', () => {
    const prompt = buildReviewRolePrompt({
      issueId: 'PAN-1194', workspace: '/tmp/full', branch: 'feature/pan-1194',
      runId: 'run-full', reviewDir: '/tmp/full/review', contextManifestPath: '/tmp/context.json',
    });
    expect(prompt).toContain('STANDBY');
    expect(prompt).toContain('REVIEWER_READY');
    expect(prompt).toContain('REVIEWER_FAILED');
    expect(prompt).toContain('REVIEWER_TIMEOUT');
    expect(prompt).toContain('block approval');
    expect(prompt).toContain('Operator-requested early reads');
    expect(prompt).toContain('STALE-SIGNAL GUARD');
    expect(prompt).toContain('synthesis.md');
    expect(prompt).toContain('--run-id "run-full"');
    expect(prompt).not.toContain('sole reviewer');
  });

  it('inherits host override from the completed work agent for the review spawn', async () => {
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-host-override',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.getAgentState).toHaveBeenCalledWith('agent-pan-1194');
    expect(mocks.spawnRun).toHaveBeenCalledWith(
      'PAN-1194',
      'review',
      expect.objectContaining({ allowHost: true, workspace: '/tmp/pan-review-host-override' }),
    );
  });


  it('threads explicit model and harness overrides to the review spawn', async () => {
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-harness',
      branch: 'feature/pan-1194',
      model: 'gpt-5.5',
      harness: 'ohmypi',
    }));

    expect(result.success).toBe(true);
    expect(mocks.spawnRun).toHaveBeenCalledWith(
      'PAN-1194',
      'review',
      expect.objectContaining({ model: 'gpt-5.5', harness: 'ohmypi', workspace: '/tmp/pan-review-harness' }),
    );
  });

  it('PAN-2534: replaces a lingering review session whose run identity is missing', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1194-review']));
    mocks.getAgentStateFileSync.mockReturnValue(undefined);

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-stale',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.killSession).toHaveBeenCalledWith('agent-pan-1194-review');
    expect(mocks.spawnRun).toHaveBeenCalled();
  });

  it('aborts force replacement when a live review session cannot be stopped', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1194-review']));
    mocks.killSession.mockReturnValue(Effect.fail(new Error('tmux refused')));

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-stop-failed',
      branch: 'feature/pan-1194',
      force: true,
    }));

    expect(result).toEqual({
      success: false,
      message: 'Review replacement aborted — could not stop agent-pan-1194-review',
      error: 'Review sessions still live: agent-pan-1194-review',
    });
    expect(mocks.wipeAgentStateDirs).not.toHaveBeenCalled();
    expect(mocks.spawnRun).not.toHaveBeenCalled();
  });

  it('aborts force replacement when live review sessions cannot be enumerated', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.fail(new Error('tmux unavailable')));

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-list-failed',
      branch: 'feature/pan-1194',
      force: true,
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-pan-1194-review');
    expect(mocks.wipeAgentStateDirs).not.toHaveBeenCalled();
    expect(mocks.spawnRun).not.toHaveBeenCalled();
  });


  it('does not clear pending feedback when the dispatch is skipped as already running (PR #3870 finding 4)', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1194-review']));
    mocks.getAgentStateFileSync.mockReturnValue({ reviewRunId: 'agent-pan-1194-review-abc12345' });

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-current',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('already running');
    // A duplicate dispatch must not delete feedback the skipped cycle still owns.
    expect(mocks.clearFeedbackFiles).not.toHaveBeenCalled();
    expect(mocks.spawnRun).not.toHaveBeenCalled();
  });

  it('clears previous-cycle feedback once a real dispatch passes the checks', async () => {
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-fresh',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.clearFeedbackFiles).toHaveBeenCalledWith('/tmp/pan-review-fresh');
  });


  it('re-dispatches a finished convoy when synthesis exists and a newer request is pending', async () => {
    const workspace = '/tmp/pan-review-finished-convoy';
    const reviewDir = `${workspace}/.pan/review/agent-pan-1194-review-abc12345`;
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(reviewDir, { recursive: true });
    await writeFile(`${reviewDir}/synthesis.md`, '# Review complete\n');
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1194-review']));
    mocks.getAgentStateFileSync.mockReturnValue({ reviewRunId: 'agent-pan-1194-review-abc12345' });
    mocks.listAgentIdsByPrefix.mockReturnValue(['agent-pan-1194-review']);
    mocks.getAgentStateFileSync.mockReturnValue({
      id: 'agent-pan-1194-review',
      issueId: 'PAN-1194',
      role: 'review',
      status: 'running',
      lastActivity: '2099-01-01T00:00:00.000Z',
    });

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace,
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.killSession).toHaveBeenCalledWith('agent-pan-1194-review');
    expect(mocks.spawnRun).toHaveBeenCalled();
  });

  it('purges every reviewer through canonical transcript-preserving removal', async () => {
    mocks.listAgentIdsByPrefix.mockReturnValue([
      'agent-pan-1194-review',
      'agent-pan-1194-review-correctness',
    ]);

    const result = await purgeReviewAgentsForIssue(undefined, 'PAN-1194');

    expect(mocks.removeAgent).toHaveBeenCalledTimes(2);
    expect(mocks.removeAgent).toHaveBeenCalledWith('agent-pan-1194-review');
    expect(mocks.removeAgent).toHaveBeenCalledWith('agent-pan-1194-review-correctness');
    expect(result.removed).toEqual([
      'agent-pan-1194-review',
      'agent-pan-1194-review-correctness',
    ]);
  });
});
