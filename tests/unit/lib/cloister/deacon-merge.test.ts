import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mockLoadReviewStatuses = vi.fn();
const mockSetReviewStatusSync = vi.fn();
const mockResolveProjectFromIssueSync = vi.fn();
const mockGetAgentStateSync = vi.fn();
const mockEnqueuePostMergeLifecycle = vi.fn();
const mockFindSpecByIssue = vi.fn();
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  mockExecFile[Symbol.for('nodejs.util.promisify.custom')] = mockExecFile;
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: (...args: Parameters<typeof mockLoadReviewStatuses>) => mockLoadReviewStatuses(...args),
  setReviewStatusSync: (...args: Parameters<typeof mockSetReviewStatusSync>) => mockSetReviewStatusSync(...args),
  reviewGatesPassedSync: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: Parameters<typeof mockResolveProjectFromIssueSync>) => mockResolveProjectFromIssueSync(...args),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: (...args: Parameters<typeof mockGetAgentStateSync>) => mockGetAgentStateSync(...args),
  getAgentRuntimeStateSync: vi.fn(),
  listRunningAgentsSync: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: vi.fn(() => ({ isGitHub: true, owner: 'eltmon', repo: 'overdeck' })),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExistsSync: vi.fn(() => false),
  sendKeys: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: (...args: Parameters<typeof mockFindSpecByIssue>) => mockFindSpecByIssue(...args),
}));

vi.mock('../../../../src/lib/cloister/post-merge-lifecycle-worker.js', () => ({
  enqueuePostMergeLifecycle: (...args: Parameters<typeof mockEnqueuePostMergeLifecycle>) => mockEnqueuePostMergeLifecycle(...args),
}));

vi.mock('../../../../src/lib/cloister/merge-agent.js', () => ({ syncMainIntoWorkspace: vi.fn() }));

vi.mock('../../../../src/lib/concurrency.js', () => ({
  withConcurrencyLimit: vi.fn((fn: () => unknown) => fn()),
}));

import { reconcileStaleMergeStatus } from '../../../../src/lib/cloister/deacon-merge.js';

function makeStatus(mergeStatus = 'failed', mergeStep?: string) {
  return { mergeStatus, mergeStep, readyForMerge: false };
}

describe('reconcileStaleMergeStatus (PAN-2420)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project' });
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ status: 'active' }));
    mockEnqueuePostMergeLifecycle.mockImplementation(
      (issueId: string) => `Queued pending post-merge lifecycle for ${issueId}`,
    );
    mockExecFile.mockImplementation((cmd: string, args: string[]) => {
      const joined = `${cmd} ${args.join(' ')}`;
      if (joined.includes('gh pr list')) {
        return Promise.resolve({ stdout: JSON.stringify([{ number: 2420, mergedAt: '2026-07-06T20:00:00Z', mergeCommit: { sha: 'def5678' } }]) });
      }
      if (joined.includes('git rev-parse')) {
        return Promise.resolve({ stdout: 'abc1234\n' });
      }
      return Promise.resolve({ stdout: '' });
    });
  });

  it('terminalizes a confirmed-merged PR even when a zombie work agent is running', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-2420': makeStatus('failed') });
    mockGetAgentStateSync.mockImplementation((agentId: string) => {
      if (agentId === 'agent-pan-2420') return { status: 'running' };
      return null;
    });

    const actions = await reconcileStaleMergeStatus();

    expect(actions.some(a => a.includes('Reconciled stale mergeStatus'))).toBe(true);
    expect(mockSetReviewStatusSync).toHaveBeenCalledWith('PAN-2420', {
      mergeStatus: 'merged',
      mergeStep: 'post-merge-cleanup',
      readyForMerge: false,
    });
    expect(mockEnqueuePostMergeLifecycle).toHaveBeenCalledWith(
      'PAN-2420', '/tmp/project', 'feature/pan-2420',
    );
  });

  it('queues an incomplete post-merge lifecycle without running it in patrol', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-2421': makeStatus('merged', 'post-merge-cleanup'),
    });

    const actions = await reconcileStaleMergeStatus();

    expect(actions).toContain('Queued pending post-merge lifecycle for PAN-2421');
    expect(mockEnqueuePostMergeLifecycle).toHaveBeenCalledWith(
      'PAN-2421', '/tmp/project', 'feature/pan-2421',
    );
  });

  it('defers terminalization when a planning agent is actively running', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-2420': makeStatus('failed') });
    mockGetAgentStateSync.mockImplementation((agentId: string) => {
      if (agentId === 'planning-pan-2420') return { status: 'running' };
      return null;
    });

    const actions = await reconcileStaleMergeStatus();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockEnqueuePostMergeLifecycle).not.toHaveBeenCalled();
  });

  it('defers terminalization when the spec is back at draft/proposed', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-2420': makeStatus('failed') });
    mockGetAgentStateSync.mockReturnValue(null);
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ status: 'draft' }));

    const actions = await reconcileStaleMergeStatus();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockEnqueuePostMergeLifecycle).not.toHaveBeenCalled();
  });

  it('skips issues whose PR is not merged', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-2420': makeStatus('failed') });
    mockGetAgentStateSync.mockReturnValue(null);
    mockExecFile.mockImplementation((cmd: string, args: string[]) => {
      const joined = `${cmd} ${args.join(' ')}`;
      if (joined.includes('gh pr list')) {
        return Promise.resolve({ stdout: JSON.stringify([{ number: 2420, mergedAt: null, mergeCommit: null }]) });
      }
      return Promise.resolve({ stdout: 'abc1234\n' });
    });

    const actions = await reconcileStaleMergeStatus();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
  });

  it('skips completed/cancelled specs (PAN-1190 guard)', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-2420': makeStatus('failed') });
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ status: 'completed' }));

    const actions = await reconcileStaleMergeStatus();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
  });
});
