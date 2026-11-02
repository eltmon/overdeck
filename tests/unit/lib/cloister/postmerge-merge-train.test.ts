import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUnref = vi.hoisted(() => vi.fn());
const mockOnce = vi.hoisted(() => vi.fn());
const mockSpawnChild = vi.hoisted(() => ({ pid: 2468, unref: mockUnref, once: mockOnce }));
const mockSpawn = vi.hoisted(() => vi.fn(() => mockSpawnChild));
const { defaultExecAsync, mockExecAsync } = vi.hoisted(() => {
  const defaultExecAsync = async (cmd: string) => {
    if (cmd.includes('git rev-parse --verify')) return { stdout: 'deadbeef\n', stderr: '' };
    if (cmd.includes('git merge-base --is-ancestor')) return { stdout: '', stderr: '' };
    if (cmd.includes('git diff origin/main...')) return { stdout: '', stderr: '' };
    if (cmd.includes('gh pr list')) return { stdout: '[{"number":2468,"state":"closed","mergedAt":"2026-07-07T00:00:00Z"}]', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  return {
    defaultExecAsync,
    mockExecAsync: vi.fn(defaultExecAsync),
  };
});
const mockLoadConfigSync = vi.hoisted(() => vi.fn());
const mockCreateResetMarker = vi.hoisted(() => vi.fn(async (input: unknown) => ({ id: 'reset-1', ...(input as Record<string, unknown>) })));
const mockSetReviewStatusSync = vi.hoisted(() => vi.fn());
const mockIsGitHubAppConfigured = vi.hoisted(() => vi.fn(() => false));
const mockListPullRequestsForHead = vi.hoisted(() => vi.fn(async () => []));
const mockSweepOrphanedTasks = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, closedIds: [], skipped: 0 }));
const mockExec = vi.hoisted(() => vi.fn((cmd: string, optionsOrCb?: any, maybeCb?: any) => {
  const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
  if (typeof callback === 'function') {
    mockExecAsync(cmd).then(
      ({ stdout, stderr }) => callback(null, stdout, stderr),
      (error) => callback(error, '', error instanceof Error ? error.message : String(error)),
    );
  }
}));

vi.mock('child_process', () => {
  (mockExec as any)[Symbol.for('nodejs.util.promisify.custom')] = mockExecAsync;
  return {
    spawn: mockSpawn,
    exec: mockExec,
    execFile: mockExec,
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: mockLoadConfigSync,
}));

vi.mock('../../../../src/lib/paths.js', () => ({
  OVERDECK_HOME: '/tmp/overdeck-test',
  AGENTS_DIR: '/tmp/overdeck-test/agents',
  COSTS_DIR: '/tmp/overdeck-test/costs',
  getOverdeckHome: vi.fn(() => '/tmp/overdeck-test'),
  PROJECT_DOCS_SUBDIR: 'docs',
  PROJECT_PRDS_SUBDIR: 'prds',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
  packageRoot: '/tmp/overdeck-test',
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sendKeys: vi.fn(() => Effect.void),
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn(() => Effect.succeed(false)),
  sessionExistsSync: vi.fn().mockReturnValue(false),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
  killSession: vi.fn(() => Effect.void),
  killSessionSync: vi.fn(() => Effect.void),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: vi.fn().mockReturnValue({ isGitHub: true, owner: 'test', repo: 'test', number: 2468 }),
  resolveTrackerType: vi.fn().mockReturnValue('github'),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
  resolveProjectFromIssueSync: vi.fn().mockReturnValue(null),
  getProjectSync: vi.fn().mockReturnValue(null),
  findProjectByPath: vi.fn().mockReturnValue(null),
  loadProjectsConfig: vi.fn().mockReturnValue({ projects: {} }),
  loadProjectsConfigSync: vi.fn().mockReturnValue({ projects: {} }),
}));

vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn().mockReturnValue('test-session'),
  spawnEphemeralSpecialist: vi.fn().mockResolvedValue({ success: false }),
  isRunning: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  runMergeValidation: vi.fn(),
  autoRevertMerge: vi.fn(),
  runQualityGates: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-log.js', () => ({
  logActivity: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
  setReviewStatus: vi.fn(),
  setReviewStatusSync: mockSetReviewStatusSync,

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../../../src/lib/memory/cli.js', () => ({
  createResetMarker: mockCreateResetMarker,
}));

vi.mock('../../../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockResolvedValue({ found: [], removed: [], errors: [] }),
}));

vi.mock('../../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: mockIsGitHubAppConfigured,
  listPullRequestsForHead: mockListPullRequestsForHead,
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSet: vi.fn().mockReturnValue({ repos: [{ repoKey: 'overdeck' }] }),
}));

vi.mock('../../../../src/lib/lifecycle/orphaned-tasks-sweep.js', () => ({
  sweepOrphanedTasks: mockSweepOrphanedTasks,
}));

const mockRunMergeTrainReconcile = vi.hoisted(() => vi.fn(async (_issueId: string) => [] as unknown[]));
vi.mock('../../../../src/lib/cloister/merge-train.js', () => ({
  runMergeTrainReconcile: mockRunMergeTrainReconcile,
}));

import { postMergeLifecycle, resetPostMergeState } from '../../../../src/lib/cloister/merge-agent.js';

const ISSUE_ID = 'PAN-2468';
const PROJECT_PATH = '/tmp/test-project';
const SOURCE_BRANCH = 'feature/pan-2468';

/** Let the lifecycle's fire-and-forget reconcile start. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('postMergeLifecycle rolls the merge train (PAN-4801)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockImplementation(defaultExecAsync);
    mockSpawn.mockReturnValue(mockSpawnChild);
    mockIsGitHubAppConfigured.mockReturnValue(false);
    mockListPullRequestsForHead.mockResolvedValue([]);
    mockLoadConfigSync.mockReturnValue({ config: {} });
    mockRunMergeTrainReconcile.mockResolvedValue([]);
    resetPostMergeState(ISSUE_ID);
  });

  it('starts the reconcile exactly once for a verified merge, however many doors run the lifecycle', async () => {
    await Promise.all([
      postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH),
      postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH),
    ]);
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);
    await settle();

    expect(mockRunMergeTrainReconcile).toHaveBeenCalledOnce();
    expect(mockRunMergeTrainReconcile).toHaveBeenCalledWith(ISSUE_ID);
  }, 30_000);

  it('does not hold the lifecycle for the sibling rebases', async () => {
    mockRunMergeTrainReconcile.mockImplementation(() => new Promise(() => undefined));

    await expect(postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH)).resolves.toBeUndefined();
    await settle();

    expect(mockRunMergeTrainReconcile).toHaveBeenCalledOnce();
  }, 30_000);

  it('logs a failed reconcile and never rejects the lifecycle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRunMergeTrainReconcile.mockRejectedValue(new Error('gh down'));

    await expect(postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH)).resolves.toBeUndefined();
    await settle();

    expect(warn).toHaveBeenCalledWith(`[merge-train] reconcile after ${ISSUE_ID} failed: gh down`);
    warn.mockRestore();
  }, 30_000);

  it('does not roll the train when the merge cannot be verified', async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (cmd.includes('git merge-base --is-ancestor')) throw new Error('not an ancestor');
      if (cmd.includes('gh pr list')) return { stdout: '[{"number":2468,"state":"open","mergedAt":null}]', stderr: '' };
      return defaultExecAsync(cmd);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Refusing post-merge lifecycle'));
    expect(mockRunMergeTrainReconcile).not.toHaveBeenCalled();
    warn.mockRestore();
  }, 30_000);
});
