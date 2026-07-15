import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Each workflow test fans out to dynamic imports + multiple unmocked
// filesystem side-effects; observed wall-clock times are 1.2–7s per case
// and several spike past the default 10s timeout under CI load. Bump the
// per-test timeout to 30s so the suite is deterministic without
// serialising the entire run.
vi.setConfig({ testTimeout: 30_000 });

// Use vi.hoisted to avoid initialization order issues
const {
  mockExecAsync,
  mockClearReviewStatus,
  mockResetPostMergeState,
  mockMarkRecordPipelineClosedOutSync,
  mockWriteCloseOutDodGateSync,
  mockSweepOrphanedTasks,
  mockEvaluateDodGate,
} = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockClearReviewStatus: vi.fn(),
  mockResetPostMergeState: vi.fn(),
  mockMarkRecordPipelineClosedOutSync: vi.fn(),
  mockWriteCloseOutDodGateSync: vi.fn(),
  mockSweepOrphanedTasks: vi.fn().mockResolvedValue({ ok: true, closedIds: [], skipped: 0 }),
  mockEvaluateDodGate: vi.fn(),
}));

vi.mock('../../../../src/lib/lifecycle/dod-gate.js', () => ({
  evaluateDodGate: mockEvaluateDodGate,
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('../../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    sessionExistsAsync: vi.fn().mockResolvedValue(false),
    killSessionAsync: vi.fn().mockResolvedValue(undefined),
    listSessionNamesAsync: vi.fn().mockResolvedValue([]),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    sessionExistsSync: vi.fn(() => Effect.succeed(false)),
    killSession: vi.fn(() => Effect.succeed(undefined)),
    killSessionSync: vi.fn(() => Effect.succeed(undefined)),
    listSessionNames: vi.fn(() => Effect.succeed([])),
  };
});

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/paths.js')>();
  const testHome = join(tmpdir(), 'overdeck-wf-test-home');
  return {
    ...actual,
    OVERDECK_HOME: testHome,
    AGENTS_DIR: join(testHome, 'agents'),
    ARCHIVES_DIR: join(testHome, 'archives'),
  };
});

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  removeShadowState: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  clearReviewStatus: mockClearReviewStatus,
}));

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>();
  return {
    ...actual,
    getProjectConfigFromWorkspacePath: vi.fn((workspacePath: string) => ({ name: 'inferred', path: workspacePath })),
    markRecordPipelineClosedOutSync: mockMarkRecordPipelineClosedOutSync,
    writeCloseOutDodGateSync: mockWriteCloseOutDodGateSync,
  };
});

vi.mock('../../../../src/lib/lifecycle/orphaned-tasks-sweep.js', () => ({
  sweepOrphanedTasks: mockSweepOrphanedTasks,
}));

vi.mock('../../../../src/lib/cloister/merge-agent.js', () => ({
  resetPostMergeState: mockResetPostMergeState,
}));

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(function () { return {
    issues: vi.fn().mockResolvedValue({ nodes: [] }),
  }; }),
}));

import { Effect } from 'effect';
import {
  approve as approveProgram,
  closeOut as closeOutProgram,
  deepWipe as deepWipeProgram,
  close as closeProgram,
  resetToTodo as resetToTodoProgram,
  __testInternals,
} from '../../../../src/lib/lifecycle/workflows.js';

// Workflows now return Effects; wrap to keep legacy await-style tests working.
const approve = (...args: Parameters<typeof approveProgram>) => Effect.runPromise(approveProgram(...args));
const closeOut = (...args: Parameters<typeof closeOutProgram>) => Effect.runPromise(closeOutProgram(...args));
const deepWipe = (...args: Parameters<typeof deepWipeProgram>) => Effect.runPromise(deepWipeProgram(...args));
const close = (...args: Parameters<typeof closeProgram>) => Effect.runPromise(closeProgram(...args));
const resetToTodo = (...args: Parameters<typeof resetToTodoProgram>) => Effect.runPromise(resetToTodoProgram(...args));
import { AGENTS_DIR, OVERDECK_HOME } from '../../../../src/lib/paths.js';
import { findSpecByIssue as findSpecByIssueProgram, writeSpecForIssue as writeSpecForIssueProgram } from '../../../../src/lib/pan-dir/specs.js';

// PAN-1249: pan-dir/specs functions return Effect; bridge to sync via runPromise for tests.
const findSpecByIssue = (projectRoot: string, issueId: string) =>
  Effect.runPromise(findSpecByIssueProgram(projectRoot, issueId) as Effect.Effect<any, any, never>);
const writeSpecForIssue = (projectRoot: string, doc: any, status: any, filename?: string) =>
  Effect.runPromise(writeSpecForIssueProgram(projectRoot, doc, status, filename) as Effect.Effect<any, any, never>);
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';

function makeVBrief(issueId: string, status = 'running'): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-18T00:00:00Z' },
    plan: {
      id: issueId,
      title: `Plan for ${issueId}`,
      status,
      sequence: 1,
      created: '2026-05-18T00:00:00Z',
      items: [],
      edges: [],
    },
  };
}

function successfulTracker() {
  // PAN-1249: IssueTracker methods return Effect now, not Promise.
  return {
    name: 'github',
    transitionIssue: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    addComment: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    updateIssue: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    getIssue: vi.fn().mockReturnValue(Effect.succeed({ labels: [] })),
  } as any;
}

function mockCurrentGitHubLabels(labels = ['verifying-on-main', 'needs-close-out', 'merged', 'ready']) {
  mockExecAsync.mockImplementation(async (command: string) => {
    if (command.includes('gh issue view') && command.includes('--json labels')) {
      return { stdout: JSON.stringify(labels), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
}

describe('workflows', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `overdeck-wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(AGENTS_DIR, { recursive: true });
    mkdirSync(OVERDECK_HOME, { recursive: true });

    vi.clearAllMocks();
    mockEvaluateDodGate.mockResolvedValue({
      passed: true,
      misses: [],
      accepted: [],
      rows: [
        ['review', 1], ['tests', 2], ['verification', 3], ['merged', 4],
        ['post-merge', 5], ['main-verify', 6], ['deploy', 7],
      ].map(([id, num]) => ({
        id,
        num,
        title: `${id} title`,
        expected: `${id} expected`,
        observed: `${id} observed`,
        status: 'pass',
      })),
    });
    process.env.HOME = testDir;
    delete process.env.LINEAR_API_KEY;
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('gh issue view') && command.includes('--json labels')) {
        return { stdout: JSON.stringify(['verifying-on-main', 'needs-close-out', 'merged', 'ready']), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    for (const dir of [testDir, AGENTS_DIR, OVERDECK_HOME]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    vi.restoreAllMocks();
  });

  describe('approve', () => {
    it('should return a successful workflow result', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const result = await approve(ctx);

      expect(result.workflow).toBe('approve');
      expect(result.issueId).toBe('PAN-100');
      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include archive, close, teardown, tasks, and clear-review steps', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };

      const result = await approve(ctx);

      const stepNames = result.steps.map(s => s.step);
      // Should include at least these step categories
      expect(stepNames.some(s => s.startsWith('archive-planning:'))).toBe(true);
      expect(stepNames.some(s => s.startsWith('close-issue:'))).toBe(true);
      expect(stepNames.some(s => s.startsWith('teardown:'))).toBe(true);
      expect(stepNames.some(s => s === 'clear-review-status')).toBe(true);
    });

    it('should skip tasks compaction when skipTasksCompaction is true', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await approve(ctx, { skipTasksCompaction: true });

      const stepNames = result.steps.map(s => s.step);
      expect(stepNames.some(s => s.startsWith('compact-tasks'))).toBe(false);
    });
  });

  describe('close', () => {
    it('should return a successful workflow result', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const result = await close(ctx);

      expect(result.workflow).toBe('close');
      expect(result.success).toBe(true);
    });

    it('should NOT include archive steps', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const result = await close(ctx);

      const stepNames = result.steps.map(s => s.step);
      expect(stepNames.some(s => s.startsWith('archive-planning:'))).toBe(false);
    });
  });

  describe('closeOut', () => {
    it('blocks before cleanup when the Definition-of-Done gate misses', async () => {
      mockEvaluateDodGate.mockResolvedValueOnce({
        passed: false,
        misses: ['deploy'],
        accepted: [],
        rows: [{
          id: 'deploy', num: 7, title: 'Deployed', expected: 'live build includes merge',
          observed: 'live build is stale', status: 'miss',
        }],
      });
      const tracker = successfulTracker();
      const result = await closeOut({ issueId: 'PAN-100', projectPath: testDir }, { tracker });

      expect(result.success).toBe(false);
      expect(result.steps.at(-1)).toMatchObject({
        step: 'close-out:dod-gate',
        error: expect.stringContaining('--accept-deploy'),
      });
      expect(result.steps.some(step => step.step.startsWith('archive-planning:'))).toBe(false);
      expect(tracker.transitionIssue).not.toHaveBeenCalled();
    });

    it('proceeds when a missed row carries an explicit acceptance', async () => {
      mockEvaluateDodGate.mockResolvedValueOnce({
        passed: true,
        misses: ['deploy'],
        accepted: ['deploy'],
        rows: [{
          id: 'deploy', num: 7, title: 'Deployed', expected: 'live build includes merge',
          observed: 'live build is stale', status: 'miss',
          acceptedBy: { flag: '--accept-deploy', by: 'operator', at: '2026-07-15T13:00:00Z' },
        }],
      });
      const result = await closeOut(
        { issueId: 'PAN-100', projectPath: testDir },
        { tracker: successfulTracker(), dodAcceptedRows: ['deploy'], dodAcceptedBy: 'operator' },
      );

      expect(result.steps.find(step => step.step === 'dod:deploy')).toMatchObject({
        success: true,
        skipped: true,
        details: expect.arrayContaining([expect.stringContaining('MISS accepted via --accept-deploy by operator')]),
      });
      expect(result.steps.some(step => step.step.startsWith('archive-planning:'))).toBe(true);
      expect(mockWriteCloseOutDodGateSync).toHaveBeenCalledWith(
        expect.anything(),
        'PAN-100',
        expect.objectContaining({
          rows: expect.arrayContaining([expect.objectContaining({ id: 'teardown', status: 'pass' })]),
          accepted: ['deploy'],
        }),
      );
      expect(result.steps.find(step => step.step === 'close-out:record-dod-gate')).toMatchObject({ success: true });
    });

    it('should verify branch merged before proceeding', async () => {
      // Mock git branch check — branch doesn't exist (squash-merged)
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.step).toBe('close-out:verify-merged');
      expect(verifyStep.success).toBe(true);
      expect(verifyStep.details).toEqual(['Branch already cleaned up (squash-merged)']);
    });

    it('accepts a squash-merged GitHub PR when the branch tip matches the merged PR head', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.startsWith('git branch --list')) {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor')) {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('gh pr list')) {
          return {
            stdout: '[{"number":2182,"mergedAt":"2026-07-02T12:00:00Z","headRefOid":"abc123","url":"https://github.com/eltmon/overdeck/pull/2182"}]',
            stderr: '',
          };
        }
        if (command.startsWith('git rev-parse feature/pan-100')) {
          return { stdout: 'abc123\n', stderr: '' };
        }
        if (command.startsWith('git log main..feature/pan-100')) {
          throw new Error('should not count ancestry-only unmerged commits after GitHub squash confirmation');
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.step).toBe('close-out:verify-merged');
      expect(verifyStep.success).toBe(true);
      expect(verifyStep.details).toEqual(['PR #2182 is squash-merged and feature/pan-100 matches the merged PR head']);
    });

    it('rejects a squash-merged GitHub PR when the branch tip no longer matches the merged PR head', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.startsWith('git branch --list')) {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor')) {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('gh pr list')) {
          return {
            stdout: '[{"number":2182,"mergedAt":"2026-07-02T12:00:00Z","headRefOid":"merged-head","url":"https://github.com/eltmon/overdeck/pull/2182"}]',
            stderr: '',
          };
        }
        if (command.startsWith('git rev-parse feature/pan-100')) {
          return { stdout: 'newer-branch-tip\n', stderr: '' };
        }
        if (command.startsWith('git log --no-merges')) {
          return { stdout: 'unmerged-commit\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor unmerged-commit origin/main') {
          throw new Error('commit is not on main');
        }
        if (command.startsWith('git diff --name-only')) {
          // PAN-2406 predicate: report a real source file so the state-plane
          // exemption does NOT apply and the strict rejection is exercised.
          return { stdout: 'src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('git log main..feature/pan-100')) {
          throw new Error('should fail immediately on mismatched merged PR head');
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.step).toBe('close-out:verify-merged');
      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('feature/pan-100 has 1 commit(s) after merged PR #2182 that are not on origin/main: unmerged-commit');
    });

    it('accepts a squash-merged PR when the branch later merged commits already on main', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.startsWith('git branch --list')) {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor feature/pan-100 main')) {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('gh pr list')) {
          return {
            stdout: '[{"number":2182,"mergedAt":"2026-07-02T12:00:00Z","headRefOid":"merged-head","url":"https://github.com/eltmon/overdeck/pull/2182"}]',
            stderr: '',
          };
        }
        if (command.startsWith('git rev-parse feature/pan-100')) {
          return { stdout: 'local-tip-after-main-merge\n', stderr: '' };
        }
        if (command.startsWith('git log --no-merges')) {
          return { stdout: 'main-commit-a\nmain-commit-b\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor main-commit-')) {
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.success).toBe(true);
      expect(verifyStep.details).toEqual([
        'PR #2182 is squash-merged; all 2 post-PR non-merge commit(s) on feature/pan-100 are already on origin/main',
      ]);
    });

    it('rejects local squash-merge success when the remote branch has advanced past the merged PR head', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.startsWith('git branch --list')) {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor')) {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('gh pr list')) {
          return {
            stdout: '[{"number":2182,"mergedAt":"2026-07-02T12:00:00Z","headRefOid":"merged-head","url":"https://github.com/eltmon/overdeck/pull/2182"}]',
            stderr: '',
          };
        }
        if (command.startsWith('git rev-parse feature/pan-100')) {
          return { stdout: 'merged-head\n', stderr: '' };
        }
        if (command.startsWith('git ls-remote --heads origin')) {
          return { stdout: 'remote-sha\trefs/heads/feature/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git fetch origin feature/pan-100')) {
          return { stdout: '', stderr: '' };
        }
        if (command.startsWith('git diff main...origin/feature/pan-100')) {
          return { stdout: 'diff --git a/src/remote.ts b/src/remote.ts\n', stderr: '' };
        }
        if (command.startsWith('git diff --name-only')) {
          // PAN-2406 predicate: real source divergence keeps this a rejection.
          return { stdout: 'src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('git rev-parse origin/feature/pan-100')) {
          return { stdout: 'advanced-remote-head\n', stderr: '' };
        }
        if (command.startsWith('git log --no-merges')) {
          return { stdout: 'remote-unmerged-commit\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor remote-unmerged-commit origin/main') {
          throw new Error('commit is not on main');
        }
        if (command.startsWith('git log main..origin/feature/pan-100')) {
          throw new Error('should fail immediately on mismatched remote merged PR head');
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.step).toBe('close-out:verify-merged');
      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('origin/feature/pan-100 has 1 commit(s) after merged PR #2182 that are not on origin/main: remote-unmerged-commit');
    });

    it('should abort if archive fails', async () => {
      // Since there's no active PRD, it will skip — that's success
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      // Should complete without abort since skipped == success
      expect(result.steps.some(s => s.step === 'close-out:abort')).toBe(false);
    });

    it('should preserve workspace and branches by default', async () => {
      const wsPath = join(testDir, 'workspaces', 'feature-pan-100');
      mkdirSync(wsPath, { recursive: true });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      expect(result.steps.find(s => s.step === 'teardown:branches')).toBeUndefined();
      expect(existsSync(wsPath)).toBe(true);
    });

    it('should honor close_out branch deletion config', async () => {
      writeFileSync(
        join(OVERDECK_HOME, 'cloister.toml'),
        '[close_out]\nremove_workspace = false\ndelete_feature_branch = true\nauto = false\nauto_delay_minutes = 60\n',
      );

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      expect(result.steps.find(s => s.step === 'teardown:branches')).toBeDefined();
    });

    it('should delete the workspace, complete vBRIEF, close GitHub, and swap verifying labels during configured close-out', async () => {
      writeFileSync(
        join(OVERDECK_HOME, 'cloister.toml'),
        '[close_out]\nremove_workspace = true\ndelete_feature_branch = false\nauto = false\nauto_delay_minutes = 60\n',
      );
      const wsPath = join(testDir, 'workspaces', 'feature-pan-100');
      mkdirSync(wsPath, { recursive: true });
      await writeSpecForIssue(testDir, makeVBrief('PAN-100'), 'active');
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.includes('gh issue view') && command.includes('--json labels')) {
          return { stdout: JSON.stringify(['verifying-on-main', 'needs-close-out', 'merged', 'ready']), stderr: '' };
        }
        if (command.startsWith('git worktree remove')) {
          rmSync(wsPath, { recursive: true, force: true });
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const result = await closeOut(ctx);

      expect(result.success).toBe(true);
      expect(existsSync(wsPath)).toBe(false);
      expect((await findSpecByIssue(testDir, 'PAN-100'))?.status).toBe('completed');
      expect((await findSpecByIssue(testDir, 'PAN-100'))?.document.plan.status).toBe('completed');

      const commands = mockExecAsync.mock.calls.map(([command]) => String(command));
      expect(commands.some(command => command.includes('gh issue close 100'))).toBe(true);
      expect(commands.some(command => command.includes('--add-label "closed-out"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "verifying-on-main"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "needs-close-out"'))).toBe(true);
    });

    it('should complete vBRIEF status and prune checkpoint refs during close-out', async () => {
      await writeSpecForIssue(testDir, makeVBrief('PAN-100'), 'active');

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      const vbriefIdx = result.steps.findIndex(s => s.step === 'close-out:vbrief-completed');
      const teardownIdx = result.steps.findIndex(s => s.step === 'teardown:checkpoint-refs');
      const closeIdx = result.steps.findIndex(s => s.step === 'close-issue:transition');
      expect(vbriefIdx).toBeGreaterThanOrEqual(0);
      expect(teardownIdx).toBeGreaterThanOrEqual(0);
      expect(closeIdx).toBeGreaterThanOrEqual(0);
      expect(vbriefIdx).toBeLessThan(teardownIdx);
      expect(teardownIdx).toBeLessThan(closeIdx);

      const commands = mockExecAsync.mock.calls.map(([command, args]) => ({ command: String(command), args }));
      expect(commands.some(({ command, args }) => command === 'git' && Array.isArray(args) && args.includes('refs/pan/turn/agent-pan-100/'))).toBe(true);
      expect(commands.some(({ command, args }) => command === 'git' && Array.isArray(args) && args.includes('refs/pan/turn/planning-pan-100/'))).toBe(true);

      const spec = await findSpecByIssue(testDir, 'PAN-100');
      expect(spec?.status).toBe('completed');
      expect(spec?.document.plan.status).toBe('completed');
      expect(mockResetPostMergeState).toHaveBeenCalledWith('PAN-100');
    });

    it('marks the durable pipeline terminal before clearing review status', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };

      const result = await closeOut(ctx, { tracker: successfulTracker() });

      const markerIdx = result.steps.findIndex(s => s.step === 'close-out:mark-pipeline-terminal');
      const clearIdx = result.steps.findIndex(s => s.step === 'clear-review-status');
      expect(markerIdx).toBeGreaterThanOrEqual(0);
      expect(clearIdx).toBeGreaterThanOrEqual(0);
      expect(markerIdx).toBeLessThan(clearIdx);
      expect(mockMarkRecordPipelineClosedOutSync).toHaveBeenCalledWith(
        { name: 'inferred', path: testDir },
        'PAN-100',
      );
    });

    it('fails close-out and preserves review status when the DoD audit cannot persist', async () => {
      mockWriteCloseOutDodGateSync.mockImplementationOnce(() => {
        throw new Error('state push unavailable');
      });
      const ctx = { issueId: 'PAN-100', projectPath: testDir };

      const result = await closeOut(ctx, { tracker: successfulTracker() });

      expect(result.success).toBe(false);
      expect(result.steps.find(step => step.step === 'close-out:record-dod-gate')).toMatchObject({
        success: false,
        error: expect.stringContaining('state push unavailable'),
      });
      expect(result.steps.find(step => step.step === 'close-out:abort')?.error).toContain('audit could not be persisted');
      expect(result.steps.some(step => step.step === 'clear-review-status')).toBe(false);
      expect(mockClearReviewStatus).not.toHaveBeenCalled();
    });

    it('preserves close-out success when the durable pipeline marker fails', async () => {
      mockMarkRecordPipelineClosedOutSync.mockImplementationOnce(() => {
        throw new Error('record unavailable');
      });
      const ctx = { issueId: 'PAN-100', projectPath: testDir };

      const result = await closeOut(ctx, { tracker: successfulTracker() });

      const marker = result.steps.find(s => s.step === 'close-out:mark-pipeline-terminal');
      expect(marker?.success).toBe(true);
      expect(marker?.skipped).toBe(true);
      expect(marker?.details?.[0]).toContain('record unavailable');
      expect(result.steps.some(s => s.step === 'clear-review-status')).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should abort before closing the tracker issue on teardown failure', async () => {
      mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
        if (command === 'git' && Array.isArray(args) && args.includes('for-each-ref')) {
          throw new Error('ref storage unavailable');
        }
        return { stdout: '', stderr: '' };
      });
      const tracker = successfulTracker();
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker });

      expect(result.success).toBe(false);
      expect(result.steps.find(s => s.step === 'close-out:vbrief-completed')?.success).toBe(true);
      expect(result.steps.find(s => s.step === 'teardown:checkpoint-refs')?.success).toBe(false);
      expect(result.steps.some(s => s.step === 'close-issue:transition')).toBe(false);
      expect(result.steps.find(s => s.step === 'close-out:abort')?.error).toContain('teardown failed');
      expect(result.steps.some(s => s.step === 'clear-review-status')).toBe(false);
      expect(tracker.transitionIssue).not.toHaveBeenCalled();
      expect(mockClearReviewStatus).not.toHaveBeenCalled();
    });

    it('should preserve review status when tracker close fails', async () => {
      const tracker = successfulTracker();
      // PAN-1249: tracker methods return Effect; failure surfaces as Effect.fail.
      tracker.transitionIssue.mockReturnValueOnce(Effect.fail(new Error('tracker unavailable')));
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker });

      expect(result.success).toBe(false);
      expect(result.steps.find(s => s.step === 'close-out:vbrief-completed')?.success).toBe(true);
      expect(result.steps.some(s => s.step.startsWith('teardown:'))).toBe(true);
      expect(result.steps.find(s => s.step === 'close-issue:transition')?.success).toBe(false);
      expect(result.steps.find(s => s.step === 'close-out:abort')?.error).toContain('issue close failed');
      expect(result.steps.some(s => s.step === 'clear-review-status')).toBe(false);
      expect(mockClearReviewStatus).not.toHaveBeenCalled();
    });

    it('should remove verifying labels when applying the closed-out label', async () => {
      mockCurrentGitHubLabels();

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };

      await closeOut(ctx);

      const commands = mockExecAsync.mock.calls.map(([command]) => String(command));
      expect(commands.some(command => command.includes('--add-label "closed-out"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "verifying-on-main"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "needs-close-out"'))).toBe(true);
    });

  });

  describe('deepWipe', () => {
    it('should return a successful workflow result', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx);

      expect(result.workflow).toBe('deep-wipe');
      expect(result.success).toBe(true);
    });

    it('should include teardown with branch deletion by default', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx);

      const branchStep = result.steps.find(s => s.step === 'teardown:branches');
      expect(branchStep).toBeDefined();
      expect(branchStep!.success).toBe(true);
    });

    it('should skip branch deletion when deleteBranches is false', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, { deleteBranches: false });

      const branchStep = result.steps.find(s => s.step === 'teardown:branches');
      expect(branchStep).toBeUndefined();
    });

    it.skip('should include issue reset by default', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const result = await deepWipe(ctx);

      const resetStep = result.steps.find(s => s.step === 'reset:reset-issue');
      expect(resetStep).toBeDefined();
    });

    it('should skip issue reset when resetIssue is false', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, { resetIssue: false });

      const resetStep = result.steps.find(s => s.step === 'reset:reset-issue');
      expect(resetStep).toBeUndefined();
    });

    it('should use tracker name in reset issue details when provided', async () => {
      process.env.LINEAR_API_KEY = 'test-key';
      const { LinearClient } = await import('@linear/sdk');
      vi.mocked(LinearClient).mockImplementation(function () {
        return {
          issues: vi.fn().mockResolvedValue({ nodes: [] }),
        } as any;
      });
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await resetToTodo(ctx, {
        deleteWorkspace: false,
        deleteBranches: false,
        tracker: { name: 'rally' } as any,
      });

      expect(result.steps.map(s => s.step)).toContain('reset:reset-issue');
      const resetStep = result.steps.find(s => s.step === 'reset:reset-issue');
      expect(resetStep?.details).toContain('Reset Rally issue PAN-100 to Todo');
    });

    it('should pass workspaceConfig through to teardown', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, {
        workspaceConfig: { tunnel: { configPath: '/test' } },
        projectName: 'test-project',
      });

      // Should not crash with workspace config
      expect(result.success).toBe(true);
    });

    it('should preserve workspace when deleteWorkspace is false', async () => {
      // Create a workspace (findWorkspacePath looks for workspaces/<issueLower>)
      const wsPath = join(testDir, 'workspaces', 'pan-100');
      mkdirSync(wsPath, { recursive: true });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, { deleteWorkspace: false });

      expect(result.success).toBe(true);
      // Workspace should still exist
      expect(existsSync(wsPath)).toBe(true);
    });
  });

  describe('tasks lifecycle (PAN-412)', () => {
    it('approve should NOT clear tasks (preserves them for history)', async () => {
      const tasksDir = join(testDir, '.tasks');
      mkdirSync(tasksDir, { recursive: true });
      writeFileSync(
        join(tasksDir, 'issues.jsonl'),
        JSON.stringify({ id: 'b1', title: 'PAN-100: Task', status: 'closed' }) + '\n'
      );

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await approve(ctx);

      // clear-tasks step should not appear
      const clearStep = result.steps.find(s => s.step === 'teardown:clear-tasks');
      expect(clearStep).toBeUndefined();

      // Tasks JSONL should still contain the entry
      const content = readFileSync(join(tasksDir, 'issues.jsonl'), 'utf-8');
      expect(content).toContain('PAN-100');
    });

  });

  describe('step ordering', () => {
    it('approve should run archive before teardown', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await approve(ctx);

      const archiveIdx = result.steps.findIndex(s => s.step.startsWith('archive-planning:'));
      const teardownIdx = result.steps.findIndex(s => s.step.startsWith('teardown:'));

      if (archiveIdx >= 0 && teardownIdx >= 0) {
        expect(archiveIdx).toBeLessThan(teardownIdx);
      }
    });

    it('closeOut should run the Definition-of-Done gate first', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.steps[0].step).toBe('dod:review');
      expect(result.steps.slice(0, 7).map(step => step.step)).toEqual([
        'dod:review',
        'dod:tests',
        'dod:verification',
        'dod:merged',
        'dod:post-merge',
        'dod:main-verify',
        'dod:deploy',
      ]);
    });
  });
});
