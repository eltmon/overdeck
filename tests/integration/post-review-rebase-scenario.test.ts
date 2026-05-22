import { Effect } from 'effect';
/**
 * PAN-1215 Integration Test: Full post-review-rebase scenario end-to-end
 *
 * Covers three substrate gaps that compose into one failure mode:
 *   A) Deacon redispatches review convoy after post-review reset
 *   B) Checkpoint excludes workspace-only .pan/ artifacts from commits
 *   C) Review override clears stale verificationStatus
 *
 * Scenario: review passes → main drifts → rebase → deacon resets → convoy
 * redispatches → AC gate passes → readyForMerge=true.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/database/schema.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// ─── In-memory DB injection ───────────────────────────────────────────────────

let testDb: Database.Database;

vi.mock('../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

// ─── Mock exec for deacon's git calls ─────────────────────────────────────────

const mockExecCallback = vi.fn();
let mockExecHeadSha = 'newsha99';
let mockOldTreeSha = 'old-tree';
let mockNewTreeSha = 'new-tree';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: (...args: unknown[]) => {
      const command = String(args[0] ?? '');
      const callback = args[args.length - 1] as (
        err: null,
        result: { stdout: string; stderr: string },
      ) => void;
      mockExecCallback(...args);
      const stdout = command.includes('^{tree}')
        ? command.includes('oldsha1') ? mockOldTreeSha : mockNewTreeSha
        : mockExecHeadSha;
      callback(null, { stdout: `${stdout}\n`, stderr: '' });
      return {} as ReturnType<typeof actual['exec']>;
    },
  };
});

// ─── Stub modules that deacon and done.ts import ──────────────────────────────

const mockResolveProject = vi.fn();

vi.mock('../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProject(...args),
  resolveProjectFromIssueSync: (...args: unknown[]) => mockResolveProject(...args),
}));

vi.mock('../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../src/dashboard/server/event-store.js', () => ({
  EventStoreService: {},
  initEventStore: vi.fn(async () => ({ appendAsync: vi.fn().mockResolvedValue(undefined) })),
  getEventStore: () => ({
    append: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue({ events: [] }),
    subscribe: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: async function* () {} }),
  }),
}));

vi.mock('../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn(),
  sessionExistsSync: vi.fn(),
  sendKeysAsync: vi.fn(),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  buildTmuxCommandString: vi.fn(),
  capturePaneAsync: vi.fn(),
  createSessionAsync: vi.fn(),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSessionAsync: vi.fn(),
  listPaneValues: vi.fn(),
  listPaneValuesAsync: vi.fn().mockResolvedValue([]),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn().mockReturnValue(null),
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockResolvedValue([]),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  getAgentStateSync: vi.fn().mockReturnValue(null),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
  transitionIssueToInReview: vi.fn(),
}));

vi.mock('../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(() => Effect.succeed({ feedbackPath: '/tmp/feedback.md' })),
}));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

// Mock review-agent.js to capture spawnReviewRoleForIssue calls
const mockSpawnReviewRoleForIssue = vi
  .fn()
  .mockResolvedValue({ success: true, message: 'spawned' });

vi.mock('../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: (...args: unknown[]) => Effect.promise(() => mockSpawnReviewRoleForIssue(...args)),
}));

vi.mock('../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: vi.fn().mockResolvedValue({
    feedbackPath: '/workspace/.pan/feedback/001-review-agent-passed.md',
    prCommentPosted: true,
    agentMessageSent: true,
  }),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { setReviewStatusSync, getReviewStatusSync, verificationSatisfied } from '../../src/lib/review-status.js';
import { checkPostReviewCommits } from '../../src/lib/cloister/deacon.js';
import { doneCommand } from '../../src/cli/commands/specialists/done.js';
import { captureCheckpoint, hasCheckpoint } from '../../src/lib/checkpoint/checkpoint-manager.js';

describe('PAN-1215 post-review-rebase scenario', () => {
  let testRepoDir: string;

  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    initSchema(testDb);
    vi.clearAllMocks();
    mockExecHeadSha = 'newsha99';
    mockOldTreeSha = 'old-tree';
    mockNewTreeSha = 'new-tree';
    mockSpawnReviewRoleForIssue.mockResolvedValue({ success: true, message: 'spawned' });
    mockResolveProject.mockReturnValue({ projectPath: '/fake/project' });
    vi.mocked(existsSync).mockReturnValue(true);

    // Create a real git repo for checkpoint and git-utils tests
    testRepoDir = mkdtempSync(join(tmpdir(), 'pan-1215-test-'));
    execSync('git init', { cwd: testRepoDir });
    execSync('git config user.email "test@test.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test"', { cwd: testRepoDir });

    // Seed with a tracked .pan/continue.json (simulates pre-fix branch state)
    mkdirSync(join(testRepoDir, '.pan'), { recursive: true });
    writeFileSync(join(testRepoDir, '.pan', 'continue.json'), '{"version":"1"}');
    writeFileSync(join(testRepoDir, '.pan', 'spec.vbrief.json'), '{"plan":{}}');
    writeFileSync(join(testRepoDir, 'readme.md'), '# test');
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "initial"', { cwd: testRepoDir });

    // Add gitignore (mimics the real repo where these are ignored)
    writeFileSync(
      join(testRepoDir, '.gitignore'),
      '.pan/continue.json\n.pan/spec.vbrief.json\n',
    );
    execSync('git add .gitignore', { cwd: testRepoDir });
    execSync('git commit -m "add gitignore"', { cwd: testRepoDir });
  });

  afterEach(() => {
    testDb.close();
    if (existsSync(testRepoDir)) {
      rmSync(testRepoDir, { recursive: true, force: true });
    }
  });

  // ─── Gap A: Deacon redispatches review convoy after post-review reset ───────

  it('resets review and redispatches convoy after tree-changing rebase', async () => {
    setReviewStatusSync('PAN-1215-A', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'oldsha1',
    });

    const actions = await checkPostReviewCommits();

    // AC1 + AC4: actions include both reset and re-dispatch lines
    expect(
      actions.some((a) => a.includes('PAN-1215-A') && a.includes('Reset review')),
    ).toBe(true);
    expect(
      actions.some((a) => a.includes('PAN-1215-A') && a.includes('Re-dispatched review')),
    ).toBe(true);

    // AC2: review status reset to pending, readyForMerge cleared
    const after = getReviewStatusSync('PAN-1215-A');
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    expect(after?.reviewedAtCommit).toBeUndefined();

    // AC5 + AC6: spawn called exactly once with correct args including force:true
    expect(mockSpawnReviewRoleForIssue).toHaveBeenCalledTimes(1);
    expect(mockSpawnReviewRoleForIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'PAN-1215-A',
        branch: 'feature/pan-1215-a',
        force: true,
      }),
    );
  });

  it('does NOT redispatch on tree-identical rebases (PAN-1213 short-circuit)', async () => {
    setReviewStatusSync('PAN-1215-A2', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'oldsha1',
    });

    // Force identical tree SHAs by making the module-level mock variables equal
    mockOldTreeSha = 'sametree';
    mockNewTreeSha = 'sametree';

    const actions = await checkPostReviewCommits();

    expect(actions.filter((a) => a.includes('PAN-1215-A2'))).toHaveLength(0);
    expect(mockSpawnReviewRoleForIssue).not.toHaveBeenCalled();

    const after = getReviewStatusSync('PAN-1215-A2');
    expect(after?.reviewStatus).toBe('passed');
    expect(after?.reviewedAtCommit).toBe('newsha99');
  });

  // ─── Gap C: Review override clears stale verificationStatus ─────────────────

  it('clears stale verificationStatus when review override signals passed', async () => {
    // Pre-seed a status with failed verification (e.g. from a prior cycle)
    setReviewStatusSync('PAN-1215-C', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'failed',
      readyForMerge: false,
    });

    // Point the project resolver at the real test repo so getWorkspaceGitInfo works
    mockResolveProject.mockReturnValue({ projectPath: testRepoDir });
    vi.mocked(existsSync).mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('feature-pan-1215-c')) {
        return true;
      }
      return true;
    });

    await doneCommand('review', 'pan-1215-c', { status: 'passed' });

    const after = getReviewStatusSync('PAN-1215-C');
    expect(after?.reviewStatus).toBe('passed');
    expect(after?.verificationStatus).toBe('passed');
    expect(after?.verificationNotes).toContain('PAN-1215');
    expect(after?.verificationNotes).toContain('override');
    expect(verificationSatisfied(after!)).toBe(true);
  });

  // ─── Gap B.1: Checkpoint excludes workspace-only .pan/ artifacts ────────────

  it('excludes .pan/continue.json and .pan/spec.vbrief.json from checkpoint commits', async () => {
    // Modify the tracked workspace-only files
    writeFileSync(join(testRepoDir, '.pan', 'continue.json'), '{"version":"2"}');
    writeFileSync(join(testRepoDir, '.pan', 'spec.vbrief.json'), '{"plan":{"updated":true}}');

    // Capture a checkpoint
    await Effect.runPromise(captureCheckpoint(testRepoDir, 'agent-pan-1215', 'turn-1'));

    // Verify the checkpoint ref was created
    expect(await Effect.runPromise(hasCheckpoint(testRepoDir, 'agent-pan-1215', 'turn-1'))).toBe(true);

    // List files in the checkpoint tree
    const ref = 'refs/pan/turn/agent-pan-1215/turn-1';
    const commit = execSync(`git rev-parse ${ref}`, {
      cwd: testRepoDir,
      encoding: 'utf-8',
    }).trim();

    const files = execSync(`git ls-tree -r --name-only ${commit}`, {
      cwd: testRepoDir,
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    // These files should NOT be in the checkpoint tree
    expect(files).not.toContain('.pan/continue.json');
    expect(files).not.toContain('.pan/spec.vbrief.json');

    // Other files should still be present
    expect(files).toContain('readme.md');
    expect(files).toContain('.gitignore');
  });

  it('excludes untracked-on-disk .pan/continue.json from checkpoint commits (AC15)', async () => {
    // Remove the tracked file from the index so it exists on disk but is untracked
    execSync('git rm --cached .pan/continue.json', { cwd: testRepoDir });
    writeFileSync(join(testRepoDir, '.pan', 'continue.json'), '{"version":"untracked"}');
    // Ensure it is not in the index
    const tracked = execSync('git ls-files .pan/continue.json', { cwd: testRepoDir, encoding: 'utf-8' }).trim();
    expect(tracked).toBe('');

    await Effect.runPromise(captureCheckpoint(testRepoDir, 'agent-pan-1215', 'turn-untracked'));

    const ref = 'refs/pan/turn/agent-pan-1215/turn-untracked';
    const commit = execSync(`git rev-parse ${ref}`, { cwd: testRepoDir, encoding: 'utf-8' }).trim();
    const files = execSync(`git ls-tree -r --name-only ${commit}`, { cwd: testRepoDir, encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(files).not.toContain('.pan/continue.json');
  });

  it('after cleanup, checkpoint no longer includes previously tracked .pan/ artifacts (AC28)', async () => {
    // Seed a tracked .pan/continue.json (simulates pre-fix branch state)
    writeFileSync(join(testRepoDir, '.pan', 'continue.json'), '{"version":"3"}');
    execSync('git add .pan/continue.json', { cwd: testRepoDir });
    execSync('git commit -m "tracked continue"', { cwd: testRepoDir });

    // Run the cleanup logic (same commands spawnAgent uses)
    execSync('git rm --cached --ignore-unmatch .pan/continue.json .pan/spec.vbrief.json', { cwd: testRepoDir });
    execSync('git commit -m "chore: untrack workspace .pan/ artifacts (PAN-1215)"', { cwd: testRepoDir });

    // Modify the now-untracked file
    writeFileSync(join(testRepoDir, '.pan', 'continue.json'), '{"version":"4"}');

    // Capture checkpoint — file should be excluded because it is no longer tracked
    await Effect.runPromise(captureCheckpoint(testRepoDir, 'agent-pan-1215', 'turn-post-cleanup'));

    const ref = 'refs/pan/turn/agent-pan-1215/turn-post-cleanup';
    const commit = execSync(`git rev-parse ${ref}`, { cwd: testRepoDir, encoding: 'utf-8' }).trim();
    const files = execSync(`git ls-tree -r --name-only ${commit}`, { cwd: testRepoDir, encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(files).not.toContain('.pan/continue.json');
    expect(files).toContain('readme.md');
  });
});
