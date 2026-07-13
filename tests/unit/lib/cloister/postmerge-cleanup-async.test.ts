/**
 * Tests that post-merge cleanup does not wait for the release engine.
 *
 * PAN-399: triggerPostMergeReleaseIfConfigured used to be awaited inside
 * postMergeLifecycle, blocking bead compaction, agent pausing, and tmux
 * cleanup while runRelease polled health and ran smoke tests. These tests
 * verify the trigger is fired asynchronously and cleanup proceeds.
 */

import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Deferred release promise ──────────────────────────────────────────────────
let releaseResolve: (() => void) | null = null;
let releaseStarted = false;
const mockRunRelease = vi.hoisted(() =>
  vi.fn(async () => {
    releaseStarted = true;
    return new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
  }),
);

// ── Track cleanup side effects ────────────────────────────────────────────────
const mockCompactBeads = vi.hoisted(() => vi.fn(() => Effect.succeed({ success: true, skipped: false, details: ['compacted'] })));
const mockCleanupMergedLabels = vi.hoisted(() => vi.fn(() => Effect.succeed({ success: true, skipped: true, details: ['skipped'] })));
const mockSetAgentPaused = vi.hoisted(() => vi.fn(() => Effect.succeed(null)));
const mockCreateResetMarker = vi.hoisted(() => vi.fn(async (input: unknown) => ({ id: 'reset-1', ...(input as Record<string, unknown>) })));
const mockSetReviewStatusSync = vi.hoisted(() => vi.fn());
const mockKillAllReviewerSessions = vi.hoisted(() => vi.fn(() => Effect.succeed({ killed: [] as string[] })));

// ── child_process / fs mocks ──────────────────────────────────────────────────
const mockExecAsync = vi.hoisted(() =>
  vi.fn(async (cmd: string) => {
    if (cmd.includes('gh pr list')) {
      return { stdout: '[{"number":399,"state":"closed","mergedAt":"2026-07-12T00:00:00Z"}]', stderr: '' };
    }
    if (cmd.includes('gh label create')) return { stdout: '', stderr: '' };
    if (cmd.includes('gh issue edit')) return { stdout: '', stderr: '' };
    if (cmd.includes('git rev-parse --verify')) return { stdout: 'deadbeef\n', stderr: '' };
    if (cmd.includes('git merge-base --is-ancestor')) return { stdout: '', stderr: '' };
    return { stdout: '', stderr: '' };
  }),
);

const mockExec = vi.hoisted(() =>
  vi.fn((cmd: string, optionsOrCb?: any, maybeCb?: any) => {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    if (typeof callback === 'function') {
      mockExecAsync(cmd).then(
        ({ stdout, stderr }) => callback(null, stdout, stderr),
        (error) => callback(error, '', error instanceof Error ? error.message : String(error)),
      );
    }
  }),
);

vi.mock('child_process', () => {
  (mockExec as any)[Symbol.for('nodejs.util.promisify.custom')] = mockExecAsync;
  return {
    exec: mockExec,
    execFile: mockExec,
    spawn: vi.fn(() => ({ pid: 12345, unref: vi.fn(), once: vi.fn() })),
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

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
  };
});

// ── Dependency mocks ──────────────────────────────────────────────────────────
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
  capturePane: vi.fn(() => Effect.succeed('')),
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

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: vi.fn().mockReturnValue({ isGitHub: true, owner: 'test', repo: 'test', number: 399 }),
  resolveGitHubIssueSync: vi.fn().mockReturnValue({ isGitHub: true, owner: 'test', repo: 'test', number: 399 }),
  resolveTrackerType: vi.fn().mockReturnValue('github'),
  resolveTrackerTypeSync: vi.fn().mockReturnValue('github'),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue({ projectKey: 'overdeck' }),
  resolveProjectFromIssueSync: vi.fn().mockReturnValue({ projectKey: 'overdeck' }),
  getProjectSync: vi.fn().mockReturnValue({
    name: 'Overdeck',
    path: '/repo/overdeck',
    release: {
      components: {
        api: { trigger: 'auto', smoke_test: 'npm run smoke:api' },
      },
    },
  }),
  findProjectByPathSync: vi.fn().mockReturnValue(null),
  loadProjectsConfig: vi.fn().mockReturnValue({ projects: {} }),
  loadProjectsConfigSync: vi.fn().mockReturnValue({ projects: {} }),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
  setReviewStatusSync: mockSetReviewStatusSync,
  setReviewStatus: vi.fn(),
}));

vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: vi.fn(() => ({ config: { knowledge: { postMergeAutoRetro: false } } })),
}));

vi.mock('../../../../src/lib/memory/cli.js', () => ({
  createResetMarker: mockCreateResetMarker,
}));

vi.mock('../../../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockResolvedValue({ found: [], removed: [], errors: [] }),
}));

vi.mock('../../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: vi.fn().mockReturnValue(false),
  listPullRequestsForHead: vi.fn().mockReturnValue(Effect.succeed([])),
}));

vi.mock('../../../../src/lib/activity-log.js', () => ({
  logActivity: vi.fn(),
}));

vi.mock('../../../../src/lib/lifecycle/compact-beads.js', () => ({
  compactBeads: mockCompactBeads,
}));

vi.mock('../../../../src/lib/lifecycle/label-cleanup.js', () => ({
  cleanupMergedLabels: mockCleanupMergedLabels,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  setAgentPaused: mockSetAgentPaused,
  getAgentState: vi.fn(() => Effect.succeed(null)),
  getAgentStateSync: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/lib/cloister/review-agent.js', () => ({
  killAllReviewerSessions: mockKillAllReviewerSessions,
}));

vi.mock('../../../../src/lib/release/release-engine.js', () => ({
  runRelease: mockRunRelease,
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  runMergeValidation: vi.fn(),
  autoRevertMerge: vi.fn(),
  runQualityGates: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn().mockReturnValue('test-session'),
  spawnEphemeralSpecialist: vi.fn().mockResolvedValue({ success: false }),
  isRunning: vi.fn().mockResolvedValue(false),
}));

// ── Subject ───────────────────────────────────────────────────────────────────
import { postMergeLifecycle, resetPostMergeState } from '../../../../src/lib/cloister/merge-agent.js';

const ISSUE_ID = 'PAN-399';
const PROJECT_PATH = '/tmp/test-project';
const SOURCE_BRANCH = 'feature/pan-399';

describe('postMergeLifecycle — release trigger does not block cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPostMergeState(ISSUE_ID);
    releaseResolve = null;
    releaseStarted = false;
  });

  afterEach(() => {
    // Ensure any pending release promise resolves so the test file can exit.
    if (releaseResolve) releaseResolve();
  });

  it('runs bead compaction while the release engine is still pending', async () => {
    const lifecyclePromise = postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH, { skipDeploy: true });

    // Wait for the release engine to have started but NOT resolve it yet.
    // The release path begins behind several dynamic imports. Under the full
    // parallel suite those imports can take longer than waitFor's 1s default;
    // this assertion is about ordering, not wall-clock performance.
    await vi.waitFor(() => expect(releaseStarted).toBe(true), { timeout: 10_000 });

    // Cleanup must have proceeded before release resolves.
    expect(mockCompactBeads).toHaveBeenCalled();
    expect(mockSetAgentPaused).toHaveBeenCalled();
    expect(mockCreateResetMarker).toHaveBeenCalled();

    // Now let the release finish.
    expect(releaseResolve).not.toBeNull();
    releaseResolve!();

    await lifecyclePromise;
  }, 30_000);
});
