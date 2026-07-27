import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnqueuePostMergeLifecycle,
  mockExecFile,
  mockFindSpecByIssue,
  mockGetAgentStateSync,
  mockGetMergeSetSync,
  mockLoadReviewStatuses,
  mockObserveForgeMergeState,
  mockResolveGitHubIssueSync,
  mockResolveProjectFromIssueSync,
  mockSetReviewStatusSync,
} = vi.hoisted(() => ({
  mockEnqueuePostMergeLifecycle: vi.fn(),
  mockExecFile: vi.fn(),
  mockFindSpecByIssue: vi.fn(),
  mockGetAgentStateSync: vi.fn(),
  mockGetMergeSetSync: vi.fn(),
  mockLoadReviewStatuses: vi.fn(),
  mockObserveForgeMergeState: vi.fn(),
  mockResolveGitHubIssueSync: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockSetReviewStatusSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  mockExecFile[Symbol.for('nodejs.util.promisify.custom')] = mockExecFile;
  return { ...actual, execFile: mockExecFile };
});

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: mockLoadReviewStatuses,
  setReviewStatusSync: mockSetReviewStatusSync,
  reviewGatesPassedSync: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: mockResolveGitHubIssueSync,
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSetSync: mockGetMergeSetSync,
}));

vi.mock('../../../../src/lib/cloister/merge-completeness.js', () => ({
  observeForgeMergeState: mockObserveForgeMergeState,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: mockGetAgentStateSync,
  getAgentRuntimeStateSync: vi.fn(),
  listRunningAgentsSync: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExistsSync: vi.fn(() => false),
  sendKeys: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: mockFindSpecByIssue,
}));

vi.mock('../../../../src/lib/cloister/post-merge-lifecycle-worker.js', () => ({
  enqueuePostMergeLifecycle: mockEnqueuePostMergeLifecycle,
}));

vi.mock('../../../../src/lib/cloister/merge-agent.js', () => ({ syncMainIntoWorkspace: vi.fn() }));
vi.mock('../../../../src/lib/concurrency.js', () => ({
  withConcurrencyLimit: vi.fn((fn: () => unknown) => fn()),
}));

import { reconcileStaleMergeStatus } from '../../../../src/lib/cloister/deacon-merge.js';

function status(mergeStatus = 'failed', readyForMerge = false) {
  return { mergeStatus, readyForMerge };
}

function mergeSet(state: 'ready' | 'merging' | 'failed' = 'failed') {
  return {
    status: state,
    repos: [{ forge: 'gitlab', repoKey: 'api' }],
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    complete: true,
    hasPositiveMergedEvidence: true,
    mergeSet: mergeSet(),
    repos: [{ repoKey: 'api', state: 'merged', aheadCount: 1, reason: 'api merged' }],
    summary: 'Merge complete across 1 repository',
    ...overrides,
  };
}

describe('reconcileStaleMergeStatus forge observation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/myn' });
    mockResolveGitHubIssueSync.mockReturnValue({ isGitHub: false });
    mockGetMergeSetSync.mockReturnValue(mergeSet());
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ status: 'active' }));
    mockGetAgentStateSync.mockReturnValue(null);
    mockObserveForgeMergeState.mockResolvedValue(observation());
    mockEnqueuePostMergeLifecycle.mockImplementation(
      (issueId: string) => `Queued pending post-merge lifecycle for ${issueId}`,
    );
    mockExecFile.mockResolvedValue({ stdout: 'abc1234\n' });
  });

  it('terminalizes a forge-complete non-GitHub issue and queues post-merge lifecycle', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-898': status('failed') });

    const actions = await reconcileStaleMergeStatus();

    expect(mockObserveForgeMergeState).toHaveBeenCalledWith('MIN-898');
    expect(mockSetReviewStatusSync).toHaveBeenCalledWith('MIN-898', {
      mergeStatus: 'merged',
      mergeStep: 'post-merge-cleanup',
      readyForMerge: false,
    });
    expect(mockEnqueuePostMergeLifecycle).toHaveBeenCalledWith(
      'MIN-898',
      '/tmp/myn',
      'feature/min-898',
    );
    expect(actions).toEqual(expect.arrayContaining([
      expect.stringContaining('Reconciled stale mergeStatus for MIN-898'),
      'Queued pending post-merge lifecycle for MIN-898',
    ]));
  });

  it('preserves non-terminal issue state after a partial per-repo forge refresh', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-858': status('failed') });
    mockObserveForgeMergeState.mockResolvedValue(observation({
      complete: false,
      mergeSet: {
        ...mergeSet(),
        repos: [
          { forge: 'gitlab', repoKey: 'fe', mergeStatus: 'merged' },
          { forge: 'gitlab', repoKey: 'api', mergeStatus: 'failed' },
        ],
      },
      repos: [
        { repoKey: 'fe', state: 'merged', aheadCount: 1, reason: 'fe merged' },
        { repoKey: 'api', state: 'unmerged', aheadCount: 1, reason: 'api open' },
      ],
      summary: 'api open',
    }));

    const actions = await reconcileStaleMergeStatus();

    expect(mockObserveForgeMergeState).toHaveBeenCalledWith('MIN-858');
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockEnqueuePostMergeLifecycle).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('defers forge terminalization while a planning agent is active', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-899': status('failed') });
    mockGetAgentStateSync.mockImplementation((agentId: string) => (
      agentId === 'planning-min-899' ? { status: 'running' } : null
    ));

    const actions = await reconcileStaleMergeStatus();

    expect(mockObserveForgeMergeState).toHaveBeenCalledWith('MIN-899');
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockEnqueuePostMergeLifecycle).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('defers forge terminalization while the spec is draft or proposed', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-900': status('failed') });
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ status: 'proposed' }));

    const actions = await reconcileStaleMergeStatus();

    expect(mockObserveForgeMergeState).toHaveBeenCalledWith('MIN-900');
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockEnqueuePostMergeLifecycle).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('skips closed-out specs before polling the forge', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-901': status('failed') });
    mockFindSpecByIssue.mockReturnValue(Effect.succeed({ status: 'completed' }));

    const actions = await reconcileStaleMergeStatus();

    expect(mockObserveForgeMergeState).not.toHaveBeenCalled();
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('does not poll non-GitHub issues outside the merge-relevant scope', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-902': status('pending') });
    mockGetMergeSetSync.mockReturnValue(mergeSet('ready'));

    const actions = await reconcileStaleMergeStatus();

    expect(mockObserveForgeMergeState).not.toHaveBeenCalled();
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('leaves expired transient rows to the stuck-state patrol instead of polling twice', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'MIN-904': {
        mergeStatus: 'merging',
        readyForMerge: false,
        updatedAt: '2020-01-01T00:00:00.000Z',
        history: [{ type: 'merge', status: 'merging', timestamp: '2020-01-01T00:00:00.000Z' }],
      },
    });

    const actions = await reconcileStaleMergeStatus();

    expect(mockResolveProjectFromIssueSync).not.toHaveBeenCalled();
    expect(mockObserveForgeMergeState).not.toHaveBeenCalled();
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('warns and writes no terminal state when forge evidence is unverifiable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockLoadReviewStatuses.mockReturnValue({ 'MIN-903': status('failed') });
    mockObserveForgeMergeState.mockResolvedValue(observation({
      complete: false,
      hasPositiveMergedEvidence: false,
      repos: [{
        repoKey: 'api',
        state: 'unverifiable',
        aheadCount: 0,
        reason: 'api merge state is unverifiable: glab authentication failed',
      }],
      summary: 'api merge state is unverifiable',
    }));

    const actions = await reconcileStaleMergeStatus();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('forge merge state is unverifiable'));
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    expect(mockEnqueuePostMergeLifecycle).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
    warn.mockRestore();
  });
});
