import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mockSpawnRun = vi.fn();
const mockShouldSkipDispatchAsMerged = vi.fn();
const mockResolveProjectFromIssueSync = vi.fn();
const mockSetReviewStatusSync = vi.fn();
const mockSessionExists = vi.fn();
const mockGetAgentStateSync = vi.fn();
const mockGetLatestSessionIdSync = vi.fn();
const mockSaveAgentState = vi.fn();
const mockResolveModel = vi.fn();
const mockEmitActivityEntrySync = vi.fn();
const mockGetPrFacts = vi.fn();

vi.mock('../../../../src/lib/agents.js', () => ({
  spawnRun: (...args: Parameters<typeof mockSpawnRun>) => mockSpawnRun(...args),
  messageAgent: vi.fn(),
  getAgentState: (...args: Parameters<typeof mockGetAgentStateSync>) => mockGetAgentStateSync(...args),
  getLatestSessionId: (...args: Parameters<typeof mockGetLatestSessionIdSync>) => mockGetLatestSessionIdSync(...args),
  saveAgentState: (...args: Parameters<typeof mockSaveAgentState>) => mockSaveAgentState(...args),
  resumeAgent: vi.fn(async () => ({ success: false })),
  wipeAgentStateDirs: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: (...args: Parameters<typeof mockGetPrFacts>) => mockGetPrFacts(...args),
}));

vi.mock('../../../../src/lib/cloister/merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: (...args: Parameters<typeof mockShouldSkipDispatchAsMerged>) => mockShouldSkipDispatchAsMerged(...args),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: Parameters<typeof mockResolveProjectFromIssueSync>) => mockResolveProjectFromIssueSync(...args),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  setReviewStatusSync: (...args: Parameters<typeof mockSetReviewStatusSync>) => mockSetReviewStatusSync(...args),
  getReviewStatusSync: vi.fn(() => null),

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: vi.fn(() => ({ config: { roles: { review: { mode: 'quick' } } } })),
  resolveModel: (...args: Parameters<typeof mockResolveModel>) => mockResolveModel(...args),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExists: (...args: Parameters<typeof mockSessionExists>) => mockSessionExists(...args),
  killSession: vi.fn(() => Effect.succeed(undefined)),
  listSessionNames: vi.fn(() => Effect.succeed([])),
}));

// PAN-3939: the review dispatch guard asks the liveness oracle; no reviewer is alive here.
vi.mock('../../../../src/lib/agents/liveness.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/agents/liveness.js')>(),
  isAlive: vi.fn(async () => ({ alive: false, reason: 'no-session' })),
}));

vi.mock('../../../../src/lib/cloister/autonomous-work-dispatch.js', () => ({
  gatherAutonomousWorkDispatchInput: vi.fn(async () => ({})),
  decideAutonomousWorkDispatch: vi.fn(() => ({ allow: true })),
}));

vi.mock('../../../../src/lib/cloister/conflict-gate.js', () => ({
  getCachedConflictGateMergeability: vi.fn(() => null),
  resolveConflictGate: vi.fn(async () => ({ gated: false })),
  buildRealConflictGateDeps: vi.fn(() => ({})),
}));

vi.mock('../../../../src/lib/cloister/review-context.js', () => ({
  buildReviewContext: vi.fn(async () => ({ manifestPath: '/tmp/manifest.json', changedFiles: [] })),
  formatTier1Summary: vi.fn(() => ''),
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  clearFeedbackFiles: vi.fn(async () => undefined),
}));


vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: (...args: Parameters<typeof mockEmitActivityEntrySync>) => mockEmitActivityEntrySync(...args),
}));

import { beforeEach } from 'vitest';
import { dispatchTestAgentAndNotify } from '../../../../src/lib/cloister/test-agent-queue.js';
import { spawnReviewRoleForIssue } from '../../../../src/lib/cloister/review-agent.js';
import { onIssueStateChange } from '../../../../src/lib/cloister/service.js';

describe('guard-advancing-dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionExists.mockReturnValue(Effect.succeed(false));
  });
  // PAN-3917 (FR-8): the test role runs against a pull request, so the dispatch
  // gate is the PR's own state, not a stored merge status.
  it('test-agent-queue Effect variant skips spawnRun when the PR is already merged', async () => {
    mockResolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project' });
    mockGetPrFacts.mockResolvedValue({ issueId: 'PAN-2420', exists: true, open: false, merged: true });
    mockSpawnRun.mockRejectedValue(new Error('spawnRun should not be called'));

    const result = await Effect.runPromise(dispatchTestAgentAndNotify('PAN-2420', '/tmp/workspace', 'feature/pan-2420'));

    expect(mockGetPrFacts).toHaveBeenCalledWith('PAN-2420');
    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('no-open-pr');
  });

  it('test-agent-queue Effect variant still dispatches when the PR is open', async () => {
    mockResolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project' });
    mockGetPrFacts.mockResolvedValue({ issueId: 'PAN-2420', exists: true, open: true, merged: false });
    mockSpawnRun.mockResolvedValue({ id: 'test-run-123' });

    const result = await Effect.runPromise(dispatchTestAgentAndNotify('PAN-2420', '/tmp/workspace', 'feature/pan-2420'));

    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-2420', 'test', expect.objectContaining({ workspace: '/tmp/workspace' }));
    expect(result.delivered).toBe(true);
    expect(result.runId).toBe('test-run-123');
  });

  it('review-agent spawnReviewRoleForIssue skips spawnRun when the PR is already merged', async () => {
    mockShouldSkipDispatchAsMerged.mockResolvedValue({ skip: true, reason: 'GitHub PR #2420 is merged' });
    mockSessionExists.mockReturnValue(Effect.succeed(false));
    mockGetAgentStateSync.mockReturnValue(null);
    mockGetLatestSessionIdSync.mockReturnValue(null);
    mockResolveModel.mockReturnValue('claude-sonnet-4-6');
    mockSpawnRun.mockRejectedValue(new Error('spawnRun should not be called'));

    const result = await Effect.runPromise(spawnReviewRoleForIssue({ issueId: 'PAN-2420', workspace: '/tmp/workspace', branch: 'feature/pan-2420' }));

    expect(mockShouldSkipDispatchAsMerged).toHaveBeenCalledWith('PAN-2420');
    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain('GitHub PR #2420 is merged');
  });

  it('review-agent spawnReviewRoleForIssue still dispatches when the PR is open', async () => {
    mockShouldSkipDispatchAsMerged.mockResolvedValue({ skip: false, reason: 'open' });
    mockSessionExists.mockReturnValue(Effect.succeed(false));
    mockGetAgentStateSync.mockReturnValue(null);
    mockGetLatestSessionIdSync.mockReturnValue(null);
    mockResolveModel.mockReturnValue('claude-sonnet-4-6');
    mockSpawnRun.mockResolvedValue({ id: 'review-run-123' });

    const result = await Effect.runPromise(spawnReviewRoleForIssue({ issueId: 'PAN-2420', workspace: '/tmp/workspace', branch: 'feature/pan-2420' }));

    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-2420', 'review', expect.objectContaining({ workspace: '/tmp/workspace' }));
    expect(result.success).toBe(true);
  });

  it('service onIssueStateChange skips work-role spawnRun when the PR is already merged', async () => {
    mockShouldSkipDispatchAsMerged.mockResolvedValue({ skip: true, reason: 'GitHub PR #2420 is merged' });
    mockSpawnRun.mockRejectedValue(new Error('spawnRun should not be called'));

    await onIssueStateChange('PAN-2420', 'in_progress');

    expect(mockShouldSkipDispatchAsMerged).toHaveBeenCalledWith('PAN-2420');
    expect(mockSpawnRun).not.toHaveBeenCalled();
  });

  it('service onIssueStateChange still dispatches work role when the PR is open', async () => {
    mockShouldSkipDispatchAsMerged.mockResolvedValue({ skip: false, reason: 'open' });
    mockSpawnRun.mockResolvedValue({ id: 'work-run-123' });

    await onIssueStateChange('PAN-2420', 'in_progress');

    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-2420', 'work', expect.objectContaining({
      prompt: expect.stringContaining('in_progress'),
      startedBy: 'reactive-lifecycle',
    }));
  });
});
