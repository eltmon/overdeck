import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  spawnRun: vi.fn(),
  saveAgentStateProgram: vi.fn(),
  getAgentStateProgram: vi.fn(),
  getAgentStateSync: vi.fn(),
  getAgentStateFileSync: vi.fn(),
  listAgentIdsByPrefixSync: vi.fn(),
  getLatestSessionIdSync: vi.fn(),
  resumeAgent: vi.fn(),
  wipeAgentStateDirs: vi.fn(),
  listSessionNames: vi.fn(),
  isPaneDead: vi.fn(),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  getReviewStatus: vi.fn(),
  getReviewStatusSync: vi.fn(),
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
  buildReviewContext: vi.fn(),
  formatTier1Summary: vi.fn(),
  archiveFeedbackFiles: vi.fn(),
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mocks.exec,
  execFile: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  spawnRun: mocks.spawnRun,
  saveAgentState: mocks.saveAgentStateProgram,
  saveAgentStateProgram: mocks.saveAgentStateProgram,
  getAgentState: mocks.getAgentStateProgram,
  getAgentStateProgram: mocks.getAgentStateProgram,
  getAgentStateSync: mocks.getAgentStateSync,
  getLatestSessionIdSync: mocks.getLatestSessionIdSync,
  resumeAgent: mocks.resumeAgent,
  wipeAgentStateDirs: mocks.wipeAgentStateDirs,
  messageAgent: vi.fn(),
}));

vi.mock('../../agents/agent-state.js', () => ({
  getAgentStateSync: mocks.getAgentStateFileSync,
}));

vi.mock('../../overdeck/agents.js', () => ({
  listAgentIdsByPrefixSync: mocks.listAgentIdsByPrefixSync,
  removeAgentSync: vi.fn(),
}));

vi.mock('../../tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
  isPaneDead: mocks.isPaneDead,
  killSession: mocks.killSession,
  killSessionSync: mocks.killSession,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: mocks.emitActivityEntry,
  emitActivityEntrySync: mocks.emitActivityEntry,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatus: mocks.getReviewStatus,
  getReviewStatusSync: mocks.getReviewStatus,
  setReviewStatus: mocks.setReviewStatus,
  setReviewStatusSync: mocks.setReviewStatus,
}));

vi.mock('../../config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({ config: {} })),
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
  archiveFeedbackFiles: mocks.archiveFeedbackFiles,
}));

vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: vi.fn(async () => ({ skip: false, reason: 'open' })),
  verifyMergedBeforeLifecycle: vi.fn(),
}));

vi.mock('../../pipeline-notifier.js', () => ({
  notifyPipeline: mocks.notifyPipeline,
}));

import { spawnReviewRoleForIssue } from '../review-agent.js';

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
    mocks.getAgentStateProgram.mockReturnValue(Effect.succeed({ hostOverride: true }));
    mocks.getAgentStateSync.mockReturnValue(undefined);
    mocks.getAgentStateFileSync.mockReturnValue(undefined);
    mocks.listAgentIdsByPrefixSync.mockReturnValue([]);
    mocks.getLatestSessionIdSync.mockReturnValue(undefined);
    mocks.resumeAgent.mockResolvedValue({ success: false, reason: 'no session' });
    mocks.wipeAgentStateDirs.mockResolvedValue(undefined);
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.isPaneDead.mockReturnValue(Effect.succeed(false));
    mocks.killSession.mockReturnValue(Effect.void);
    mocks.getReviewStatus.mockReturnValue(undefined);
    mocks.buildReviewContext.mockResolvedValue({ manifestPath: undefined, changedFiles: [] });
    mocks.formatTier1Summary.mockReturnValue('shared review context');
    mocks.archiveFeedbackFiles.mockResolvedValue(undefined);
  });

  it('inherits host override from the completed work agent for the review spawn', async () => {
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-host-override',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.getAgentStateProgram).toHaveBeenCalledWith('agent-pan-1194');
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
    mocks.getAgentStateSync.mockReturnValue(undefined);

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-stale',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.killSession).toHaveBeenCalledWith('agent-pan-1194-review');
    expect(mocks.spawnRun).toHaveBeenCalled();
  });

  it('keeps a live review session whose run identity matches current HEAD', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1194-review']));
    mocks.getAgentStateSync.mockReturnValue({ reviewRunId: 'agent-pan-1194-review-abc12345' });

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-current',
      branch: 'feature/pan-1194',
    }));

    expect(result).toEqual({
      success: false,
      message: 'Review dispatch skipped — already running: agent-pan-1194-review',
    });
    expect(mocks.killSession).not.toHaveBeenCalled();
    expect(mocks.spawnRun).not.toHaveBeenCalled();
  });

  it('re-dispatches a finished convoy when synthesis exists and a newer request is pending', async () => {
    const workspace = '/tmp/pan-review-finished-convoy';
    const reviewDir = `${workspace}/.pan/review/agent-pan-1194-review-abc12345`;
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(reviewDir, { recursive: true });
    await writeFile(`${reviewDir}/synthesis.md`, '# Review complete\n');
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1194-review']));
    mocks.getAgentStateSync.mockReturnValue({ reviewRunId: 'agent-pan-1194-review-abc12345' });
    mocks.getReviewStatus.mockReturnValue({
      reviewStatus: 'pending',
      reviewRequestedAt: '2026-07-15T19:00:00.000Z',
      reviewSpawnedAt: '2026-07-15T18:00:00.000Z',
    });
    mocks.listAgentIdsByPrefixSync.mockReturnValue(['agent-pan-1194-review']);
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
});
