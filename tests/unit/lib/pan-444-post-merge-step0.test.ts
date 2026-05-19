/**
 * Tests for PAN-444: postMergeLifecycle step 0 — pending file write + deploy spawn.
 * Covers the new step 0 logic in src/lib/cloister/merge-agent.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

// ── child_process mock — spawn ────────────────────────────────────────────────
const mockUnref = vi.hoisted(() => vi.fn());
const mockSpawnChild = vi.hoisted(() => ({ pid: 12345, unref: mockUnref }));
const mockSpawn = vi.hoisted(() => vi.fn(() => mockSpawnChild));
const mockExecAsync = vi.hoisted(() => vi.fn(async (cmd: string) => {
  if (cmd.includes('git rev-parse --verify')) return { stdout: 'deadbeef\n', stderr: '' };
  if (cmd.includes('git merge-base --is-ancestor')) return { stdout: '', stderr: '' };
  if (cmd.includes('git diff origin/main...')) return { stdout: '', stderr: '' };
  if (cmd.includes('gh pr list')) return { stdout: '[]', stderr: '' };
  return { stdout: '', stderr: '' };
}));
const mockCreateResetMarker = vi.hoisted(() => vi.fn(async (input: unknown) => ({ id: 'reset-1', ...(input as Record<string, unknown>) })));
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

// ── fs/promises mock ──────────────────────────────────────────────────────────
const mockWriteFile = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: mockWriteFile,
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

// ── fs mock ───────────────────────────────────────────────────────────────────
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

// ── Other dependency mocks ────────────────────────────────────────────────────
vi.mock('../../../src/lib/tmux.js', () => ({
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn().mockReturnValue(false),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
  killSession: vi.fn(),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/paths.js', () => ({
  PANOPTICON_HOME: '/tmp/panopticon-test',
  AGENTS_DIR: '/tmp/panopticon-test/agents',
  getPanopticonHome: vi.fn(() => '/tmp/panopticon-test'),
  PROJECT_DOCS_SUBDIR: 'docs',
  PROJECT_PRDS_SUBDIR: 'prds',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
}));

vi.mock('../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: vi.fn().mockReturnValue({ isGitHub: false }),
}));

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn().mockReturnValue('test-session'),
  spawnEphemeralSpecialist: vi.fn().mockResolvedValue({ success: false }),
  isRunning: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
  loadProjectsConfig: vi.fn().mockReturnValue({ projects: {} }),
}));

vi.mock('../../../src/lib/cloister/validation.js', () => ({
  runMergeValidation: vi.fn(),
  autoRevertMerge: vi.fn(),
  runQualityGates: vi.fn(),
}));

vi.mock('../../../src/lib/activity-log.js', () => ({
  logActivity: vi.fn(),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
}));

vi.mock('../../../src/lib/memory/cli.js', () => ({
  createResetMarker: mockCreateResetMarker,
}));

vi.mock('../../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockResolvedValue({ found: [], removed: [], errors: [] }),
}));

// ── Subject ───────────────────────────────────────────────────────────────────
import { postMergeLifecycle, resetPostMergeState } from '../../../src/lib/cloister/merge-agent.js';

const ISSUE_ID = 'PAN-444';
const PROJECT_PATH = '/tmp/test-project';
const SOURCE_BRANCH = 'feature/pan-444';
const PENDING_FILE = '/tmp/panopticon-test/pending-post-merge.json';

describe('postMergeLifecycle — step 0 deploy handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPostMergeState(ISSUE_ID);
    mockWriteFile.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(mockSpawnChild);
  });

  it('writes pending lifecycle file with correct data', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [filePath, content, encoding] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe(PENDING_FILE);
    expect(encoding).toBe('utf-8');

    const parsed = JSON.parse(content as string);
    expect(parsed.issueId).toBe(ISSUE_ID);
    expect(parsed.projectPath).toBe(PROJECT_PATH);
    expect(parsed.sourceBranch).toBe(SOURCE_BRANCH);
    expect(typeof parsed.timestamp).toBe('number');
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it('defaults sourceBranch to empty string when not provided', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH);

    const [, content] = mockWriteFile.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed.sourceBranch).toBe('');
  });

  it('spawns deploy script with detached:true and stdio:ignore', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [, , spawnOpts] = mockSpawn.mock.calls[0];
    expect(spawnOpts.detached).toBe(true);
    expect(spawnOpts.stdio).toBe('ignore');
  });

  it('calls child.unref() to allow parent process to exit independently', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);
    expect(mockUnref).toHaveBeenCalledOnce();
  });

  it('passes repoRoot, issueId, projectPath, sourceBranch to deploy script', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args[1]).toBe(ISSUE_ID);
    expect(args[2]).toBe(PROJECT_PATH);
    expect(args[3]).toBe(SOURCE_BRANCH);
    // args[0] is repoRoot — just verify it's a non-empty string
    expect(typeof args[0]).toBe('string');
    expect(args[0].length).toBeGreaterThan(0);
  });

  it('returns immediately after successful spawn (does not run in-process lifecycle)', async () => {
    const result = await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    expect(result).toBeUndefined();
    // If lifecycle ran in-process, it would try to dynamic import lifecycle modules.
    // Since we only mocked spawn and writeFile, reaching this point means it returned early.
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  // The in-process fallback path exercises several real dynamic imports and
  // unmocked side-effects (review-status writes, git-activity append, etc.)
  // that can cumulatively run past the default 10s vitest timeout on a busy
  // CI host. The 30s timeout below is well over the observed ~13s real-clock
  // duration and matches what the verification gate retry budget allows.
  it('falls through to in-process lifecycle when writeFile throws', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'));

    // Should not throw — catches the error and falls through
    await expect(postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH)).resolves.not.toThrow();

    // Spawn should not be called since writeFile threw
    expect(mockSpawn).not.toHaveBeenCalled();
  }, 30_000);

  it('falls through to in-process lifecycle when spawn throws', async () => {
    mockSpawn.mockImplementation(() => { throw new Error('spawn ENOENT'); });

    // Should not throw — catches and falls through
    await expect(postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH)).resolves.not.toThrow();
  }, 30_000);

  it('creates a workspace-scoped memory reset marker in the in-process lifecycle', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH, { skipDeploy: true });

    expect(mockCreateResetMarker).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'test-project',
      scope: 'workspace',
      scopeId: 'feature-pan-444',
      reason: 'post-merge cleanup',
    }));
  }, 30_000);

  it('step 0 does not run when idempotency guard is set', async () => {
    // Guard is set externally (simulating a second invocation after in-process lifecycle ran).
    // The guard check fires before step 0, so writeFile is never called.
    // We verify this by NOT calling resetPostMergeState before a second invocation.
    // First, run with writeFile failing so the in-process path runs and sets the guard.
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    // Now the guard is set. On re-entry, step 0 must not fire.
    vi.clearAllMocks();
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  }, 30_000);

  it('coalesces concurrent post-merge lifecycle calls before step 0 repeats', async () => {
    const first = postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);
    const second = postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    await Promise.all([first, second]);

    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledOnce();
  });
});

describe('postMergeLifecycle — repoRoot derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPostMergeState(ISSUE_ID);
    mockWriteFile.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue(mockSpawnChild);
  });

  it('deploy script path ends with scripts/post-merge-deploy.sh', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    const [scriptPath] = mockSpawn.mock.calls[0];
    expect(scriptPath).toMatch(/scripts\/post-merge-deploy\.sh$/);
  });

  it('deploy script path does not traverse through src/ (repoRoot is stripped above src/)', async () => {
    await postMergeLifecycle(ISSUE_ID, PROJECT_PATH, SOURCE_BRANCH);

    const [scriptPath] = mockSpawn.mock.calls[0];
    // scripts/post-merge-deploy.sh should be a direct child of repoRoot,
    // not nested inside src/ or lib/
    expect(scriptPath).not.toMatch(/\/src\/scripts\//);
    expect(scriptPath).not.toMatch(/\/lib\/scripts\//);
  });
});
