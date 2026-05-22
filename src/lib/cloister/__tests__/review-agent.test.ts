import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  spawnRun: vi.fn(),
  saveAgentStateEffect: vi.fn(),
  getAgentStateEffect: vi.fn(),
  listSessionNames: vi.fn(),
  isPaneDead: vi.fn(),
  killSession: vi.fn(),
  emitActivityEntry: vi.fn(),
  getReviewStatus: vi.fn(),
  setReviewStatus: vi.fn(),
  listStashes: vi.fn(),
  dropStash: vi.fn(),
  createNamedStash: vi.fn(),
  buildReviewContext: vi.fn(),
  formatTier1Summary: vi.fn(),
  archiveFeedbackFiles: vi.fn(),
  notifyPipeline: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mocks.exec,
}));

vi.mock('../../agents.js', () => ({
  spawnRun: mocks.spawnRun,
  saveAgentStateEffect: mocks.saveAgentStateEffect,
  getAgentStateEffect: mocks.getAgentStateEffect,
  messageAgent: vi.fn(),
}));

vi.mock('../../tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
  isPaneDead: mocks.isPaneDead,
  killSession: mocks.killSession,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: mocks.emitActivityEntry,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatus: mocks.getReviewStatus,
  setReviewStatus: mocks.setReviewStatus,
}));

vi.mock('../../stashes.js', () => ({
  buildStashMessage: vi.fn(() => 'review-temp:PAN-1194:1'),
  createNamedStash: mocks.createNamedStash,
  dropStash: mocks.dropStash,
  getNextReviewTempSequence: vi.fn(() => 1),
  listStashes: mocks.listStashes,
}));

vi.mock('../../config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({ config: {} })),
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
    mocks.saveAgentStateEffect.mockReturnValue(Effect.void);
    mocks.getAgentStateEffect.mockReturnValue(Effect.succeed({ hostOverride: true }));
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.getReviewStatus.mockReturnValue(undefined);
    mocks.listStashes.mockResolvedValue([]);
    mocks.createNamedStash.mockResolvedValue(null);
    mocks.buildReviewContext.mockResolvedValue({ manifestPath: undefined, changedFiles: [] });
    mocks.formatTier1Summary.mockReturnValue('shared review context');
    mocks.archiveFeedbackFiles.mockResolvedValue(undefined);
  });

  it('inherits host override from the completed work agent for synthesis and reviewer spawns', async () => {
    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1194',
      workspace: '/tmp/pan-review-host-override',
      branch: 'feature/pan-1194',
    }));

    expect(result.success).toBe(true);
    expect(mocks.getAgentStateEffect).toHaveBeenCalledWith('agent-pan-1194');
    expect(mocks.spawnRun).toHaveBeenCalledWith(
      'PAN-1194',
      'review',
      expect.objectContaining({ allowHost: true, workspace: '/tmp/pan-review-host-override' }),
    );
    expect(mocks.spawnRun).toHaveBeenCalledWith(
      'PAN-1194',
      'review',
      expect.objectContaining({ allowHost: true, subRole: 'security' }),
    );
  });
});
