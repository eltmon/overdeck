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
  mockHealUatPromotionVerification,
  mockCapturePipelineStage,
  mockResolvePipelineTelemetryContext,
  mockGetReviewStatus,
  mockReadIssueRecord,
  mockReadCompletedCloseOut,
  mockResolveProjectReposForIssueSync,
  mockAcknowledgeAllOpenRecoveryTrips,
  mockClearAgentOperatorGatesForIssueSync,
} = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockClearReviewStatus: vi.fn(),
  mockResetPostMergeState: vi.fn(),
  mockMarkRecordPipelineClosedOutSync: vi.fn(),
  mockWriteCloseOutDodGateSync: vi.fn(),
  mockSweepOrphanedTasks: vi.fn().mockResolvedValue({ ok: true, closedIds: [], skipped: 0 }),
  mockEvaluateDodGate: vi.fn().mockResolvedValue({
    passed: true,
    misses: [],
    accepted: [],
    rows: [{
      id: 'review', num: 1, title: 'Review', expected: 'recorded verdict',
      observed: 'reviewStatus: passed', status: 'pass',
    }],
  }),
  mockHealUatPromotionVerification: vi.fn(),
  mockCapturePipelineStage: vi.fn(),
  mockResolvePipelineTelemetryContext: vi.fn(async () => null),
  mockGetReviewStatus: vi.fn(),
  mockReadIssueRecord: vi.fn(),
  mockReadCompletedCloseOut: vi.fn().mockResolvedValue(null),
  mockResolveProjectReposForIssueSync: vi.fn(() => null),
  mockAcknowledgeAllOpenRecoveryTrips: vi.fn().mockResolvedValue(0),
  mockClearAgentOperatorGatesForIssueSync: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../../src/lib/lifecycle/dod-gate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/lifecycle/dod-gate.js')>();
  return {
    ...actual,
    evaluateDodGate: mockEvaluateDodGate,
    readCompletedCloseOut: mockReadCompletedCloseOut,
  };
});

vi.mock('../../../../src/lib/cloister/uat-promote-verification.js', () => ({
  healUatPromotionVerification: mockHealUatPromotionVerification,
}));

vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStage: mockCapturePipelineStage,
  resolvePipelineTelemetryContext: mockResolvePipelineTelemetryContext,
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
  getReviewStatus: mockGetReviewStatus,
}));

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>();
  return {
    ...actual,
    getProjectConfigFromWorkspacePath: vi.fn((workspacePath: string) => ({ name: 'inferred', path: workspacePath })),
    markRecordPipelineClosedOutSync: mockMarkRecordPipelineClosedOutSync,
    writeCloseOutDodGate: mockWriteCloseOutDodGateSync,
    readIssueRecord: mockReadIssueRecord,
  };
});

vi.mock('../../../../src/lib/lifecycle/orphaned-tasks-sweep.js', () => ({
  sweepOrphanedTasks: mockSweepOrphanedTasks,
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveProjectReposForIssueSync: mockResolveProjectReposForIssueSync,
}));

vi.mock('../../../../src/lib/cloister/merge-agent.js', () => ({
  resetPostMergeState: mockResetPostMergeState,
}));

vi.mock('../../../../src/lib/cloister/recovery-trip.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/cloister/recovery-trip.js')>();
  return {
    ...actual,
    acknowledgeAllOpenRecoveryTrips: mockAcknowledgeAllOpenRecoveryTrips,
  };
});

vi.mock('../../../../src/lib/agents/agent-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/agent-state.js')>();
  return {
    ...actual,
    clearAgentOperatorGatesForIssueSync: mockClearAgentOperatorGatesForIssueSync,
  };
});

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
  verifyBranchMergedImpl,
  verifyConventionBranchMerged,
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
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';

function makeXBrief(issueId: string, status = 'running'): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-05-18T00:00:00Z' },
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
    mockResolveProjectReposForIssueSync.mockReturnValue(null);
    mockHealUatPromotionVerification.mockResolvedValue(null);
    mockGetReviewStatus.mockResolvedValue(null);
    mockReadIssueRecord.mockResolvedValue(null);
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
    it('heals UAT promotion evidence before evaluating the verification row', async () => {
      const callOrder: string[] = [];
      mockHealUatPromotionVerification.mockImplementationOnce(async () => {
        callOrder.push('heal');
        return { generation: 'uat/pan-cedar-0726', mergeSha: '546d05b989abcdef' };
      });
      mockEvaluateDodGate.mockImplementationOnce(async () => {
        callOrder.push('gate');
        return {
          passed: true,
          misses: [],
          accepted: [],
          rows: [{
            id: 'verification', num: 3, title: 'Verification', expected: 'recorded verdict',
            observed: 'verificationStatus: passed', status: 'pass',
          }],
        };
      });

      const result = await closeOut(
        { issueId: 'PAN-3037', projectPath: testDir },
        { tracker: successfulTracker() },
      );

      expect(callOrder).toEqual(['heal', 'gate']);
      expect(result.steps.find(step => step.step === 'dod:uat-promotion-evidence')).toMatchObject({
        success: true,
        skipped: false,
        details: expect.arrayContaining([
          'Recorded verification from uat/pan-cedar-0726',
          'Promoted to main at 546d05b98',
        ]),
      });
      expect(result.steps.find(step => step.step === 'dod:verification')).toMatchObject({ success: true });
      expect(mockEvaluateDodGate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        acceptedRows: undefined,
      }));
    });

    it('continues to the DoD gate when UAT evidence recovery fails', async () => {
      mockHealUatPromotionVerification.mockRejectedValueOnce(new Error('generation store unavailable'));

      const result = await closeOut(
        { issueId: 'PAN-100', projectPath: testDir },
        { tracker: successfulTracker() },
      );

      expect(result.success).toBe(true);
      expect(result.steps.find(step => step.step === 'dod:uat-promotion-evidence')).toMatchObject({
        success: true,
        skipped: true,
        details: [expect.stringContaining('generation store unavailable')],
      });
      expect(mockEvaluateDodGate).toHaveBeenCalledOnce();
    });

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

    it('skips the gate and records the disposition for an abandoned issue (PAN-3211)', async () => {
      const tracker = successfulTracker();
      const result = await closeOut(
        { issueId: 'PAN-2794', projectPath: testDir },
        { tracker, abandonDisposition: { reason: 'no landing evidence — closed without work', by: 'conv-test' } },
      );

      expect(result.success).toBe(true);
      // The gate is never evaluated — every override would record fiction.
      expect(mockEvaluateDodGate).not.toHaveBeenCalled();
      // Every gate row is recorded skipped with the disposition note — never
      // silently green. (The teardown row legitimately passes: teardown ran.)
      const gateRows = result.dodGate?.rows.filter(row => row.id !== 'teardown') ?? [];
      expect(gateRows.length).toBeGreaterThan(0);
      expect(gateRows.every(row => row.status === 'skip')).toBe(true);
      expect(gateRows[0]?.observed).toContain('abandoned disposition recorded by conv-test');
      // The durable record carries the disposition beside the gate rows.
      expect(mockWriteCloseOutDodGateSync).toHaveBeenCalledWith(
        expect.anything(),
        'PAN-2794',
        expect.objectContaining({
          disposition: { reason: 'no landing evidence — closed without work', by: 'conv-test' },
        }),
      );
      // The tracker comment names the disposition, not the generic ceremony text.
      expect(tracker.addComment).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Closed without landing evidence — disposition recorded'),
      );
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

    it('does not abort when telemetry attribution fails', async () => {
      mockResolvePipelineTelemetryContext.mockImplementationOnce(() => {
        throw new Error('legacy agent row is malformed');
      });

      const result = await closeOut(
        { issueId: 'PAN-100', projectPath: testDir },
        { tracker: successfulTracker() },
      );

      expect(result.success).toBe(true);
      expect(mockCapturePipelineStage).toHaveBeenCalledWith('closed_out', null);
    });

    it('rejects branch absence instead of assuming a squash merge', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.step).toBe('close-out:verify-merged');
      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('Feature branch is absent; positive merge evidence is required');
    });

    it('accepts a squash-merged strike branch when the feature branch retains superseded commits', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git branch --list "strike/pan-100" 2>/dev/null || true') {
          return { stdout: '  strike/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor')) {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/feature.ts b/src/feature.ts\n', stderr: '' };
        }
        if (command.startsWith('git diff main...strike/pan-100')) {
          return { stdout: 'diff --git a/src/strike.ts b/src/strike.ts\n', stderr: '' };
        }
        if (command.includes('--head "feature/pan-100"')) {
          return { stdout: '[]', stderr: '' };
        }
        if (command.includes('--head "strike/pan-100"')) {
          return {
            stdout: '[{"number":3152,"mergedAt":"2026-07-26T12:00:00Z","headRefOid":"strike-head","url":"https://github.com/eltmon/overdeck/pull/3152"}]',
            stderr: '',
          };
        }
        if (command === 'git rev-parse strike/pan-100 2>/dev/null') {
          return { stdout: 'strike-head\n', stderr: '' };
        }
        if (command === 'git log main..feature/pan-100 --oneline 2>/dev/null || true') {
          return { stdout: 'feature-a\nfeature-b\n', stderr: '' };
        }
        if (command.startsWith('gh issue view')) {
          return { stdout: 'OPEN\n', stderr: '' };
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
        'PR #3152 is squash-merged and strike/pan-100 matches the merged PR head',
        'Superseded feature/pan-100 residual: 2 unmerged commit(s) on feature/pan-100. Merge before closing out.',
      ]);
    });

    it('preserves the feature-branch failure when the strike branch is absent', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command.startsWith('git merge-base --is-ancestor feature/pan-100')) {
          throw new Error('feature is not merged');
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/feature.ts b/src/feature.ts\n', stderr: '' };
        }
        if (command.includes('--head "feature/pan-100"')) {
          return { stdout: '[]', stderr: '' };
        }
        if (command === 'git log main..feature/pan-100 --oneline 2>/dev/null || true') {
          return { stdout: 'feature-a\nfeature-b\n', stderr: '' };
        }
        if (command.startsWith('gh issue view')) {
          return { stdout: 'OPEN\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'overdeck', number: 100 },
      };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('2 unmerged commit(s) on feature/pan-100. Merge before closing out.');
    });

    it('returns the branch-absence sentinel when both convention branches are absent', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('Feature branch is absent; positive merge evidence is required');
    });

    it('aggregates merged evidence from required polyrepo roots with repo-qualified details', async () => {
      const fePath = join(testDir, 'fe');
      const apiPath = join(testDir, 'api');
      mockResolveProjectReposForIssueSync.mockReturnValue([
        { projectKey: 'myn', projectPath: testDir, repoKey: 'fe', repoPath: fePath, forge: 'gitlab', sourceBranch: 'feature/pan-100', targetBranch: 'main', mergeOrder: 0, required: true },
        { projectKey: 'myn', projectPath: testDir, repoKey: 'api', repoPath: apiPath, forge: 'gitlab', sourceBranch: 'feature/pan-100', targetBranch: 'main', mergeOrder: 1, required: true },
      ]);
      mockExecAsync.mockImplementation(async (command: string, options?: { cwd?: string }) => {
        if (options?.cwd === fePath && command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (options?.cwd === fePath && command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not an ancestor after squash merge');
        }
        if (options?.cwd === fePath && command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'fe-head\n', stderr: '' };
        }
        if (options?.cwd === fePath && command === 'glab mr list --source-branch feature/pan-100 --all --output json') {
          return {
            stdout: '[{"iid":75,"web_url":"https://gitlab.com/acme/fe/-/merge_requests/75","state":"merged","source_branch":"feature/pan-100","target_branch":"main","sha":"fe-head"}]',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyBranchMergedImpl({ issueId: 'PAN-100', projectPath: testDir });

      expect(verifyStep.success).toBe(true);
      expect(verifyStep.details).toEqual([
        'fe: MR !75 is merged and feature/pan-100 matches the merged MR head (https://gitlab.com/acme/fe/-/merge_requests/75)',
      ]);
      for (const [, options] of mockExecAsync.mock.calls) {
        expect([fePath, apiPath]).toContain(options?.cwd);
        expect(options?.cwd).not.toBe(testDir);
      }
    });

    it('names the failing repo when a required polyrepo root has unmerged commits', async () => {
      const fePath = join(testDir, 'fe');
      const apiPath = join(testDir, 'api');
      mockResolveProjectReposForIssueSync.mockReturnValue([
        { projectKey: 'myn', projectPath: testDir, repoKey: 'fe', repoPath: fePath, forge: 'github', sourceBranch: 'feature/pan-100', targetBranch: 'main', mergeOrder: 0, required: true },
        { projectKey: 'myn', projectPath: testDir, repoKey: 'api', repoPath: apiPath, forge: 'github', sourceBranch: 'feature/pan-100', targetBranch: 'main', mergeOrder: 1, required: true },
      ]);
      mockExecAsync.mockImplementation(async (command: string, options?: { cwd?: string }) => {
        if (options?.cwd === apiPath && command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (options?.cwd === apiPath && command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not merged');
        }
        if (options?.cwd === apiPath && command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/api.ts b/src/api.ts\n', stderr: '' };
        }
        if (options?.cwd === apiPath && command === 'git log main..feature/pan-100 --oneline 2>/dev/null || true') {
          return { stdout: 'api-unmerged\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyBranchMergedImpl({ issueId: 'PAN-100', projectPath: testDir });

      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('api: 1 unmerged commit(s) on feature/pan-100. Merge before closing out.');
    });

    it('preserves the branch-absence sentinel when all required polyrepo roots are absent', async () => {
      mockResolveProjectReposForIssueSync.mockReturnValue([
        { projectKey: 'myn', projectPath: testDir, repoKey: 'fe', repoPath: join(testDir, 'fe'), forge: 'gitlab', sourceBranch: 'feature/pan-100', targetBranch: 'main', mergeOrder: 0, required: true },
        { projectKey: 'myn', projectPath: testDir, repoKey: 'api', repoPath: join(testDir, 'api'), forge: 'gitlab', sourceBranch: 'feature/pan-100', targetBranch: 'main', mergeOrder: 1, required: true },
      ]);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const verifyStep = await verifyBranchMergedImpl({ issueId: 'PAN-100', projectPath: testDir });

      expect(verifyStep.success).toBe(false);
      expect(verifyStep.error).toBe('Feature branch is absent; positive merge evidence is required');
    });

    it('does not inspect the strike branch after the feature branch passes', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.success).toBe(true);
      expect(mockExecAsync.mock.calls.map(([command]) => command)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('strike/pan-100')]),
      );
    });

    it('uses the repo target branch for convention-branch ancestry checks', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const verifyStep = await verifyConventionBranchMerged(ctx, {
        repoKey: 'overdeck',
        dir: testDir,
        sourceBranch: 'feature/pan-100',
        targetBranch: 'master',
        forge: 'github',
      });

      expect(verifyStep?.success).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledWith(
        'git merge-base --is-ancestor feature/pan-100 master',
        { cwd: testDir, encoding: 'utf-8' },
      );
    });

    it('accepts a squash-merged GitLab MR when the branch tip matches the MR head', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'gitlab-head\n', stderr: '' };
        }
        if (command === 'glab mr list --source-branch feature/pan-100 --all --output json') {
          return {
            stdout: '[{"iid":75,"web_url":"https://gitlab.com/acme/app/-/merge_requests/75","state":"merged","source_branch":"feature/pan-100","target_branch":"main","sha":"gitlab-head"}]',
            stderr: '',
          };
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          throw new Error('containment fallback must not run after GitLab MR confirmation');
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir },
        { repoKey: 'fe', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'main', forge: 'gitlab' },
      );

      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.details).toEqual([
        'MR !75 is merged and feature/pan-100 matches the merged MR head (https://gitlab.com/acme/app/-/merge_requests/75)',
      ]);
      expect(mockExecAsync.mock.calls.map(([command]) => command)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('git diff main...feature/pan-100')]),
      );
    });

    it('reuses one GitLab MR lookup when the merged branch exists locally and remotely', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'gitlab-head\n', stderr: '' };
        }
        if (command === 'glab mr list --source-branch feature/pan-100 --all --output json') {
          return {
            stdout: '[{"iid":75,"web_url":"https://gitlab.com/acme/app/-/merge_requests/75","state":"merged","source_branch":"feature/pan-100","target_branch":"main","sha":"gitlab-head"}]',
            stderr: '',
          };
        }
        if (command === 'git ls-remote --heads origin "feature/pan-100" 2>/dev/null || true') {
          return { stdout: 'gitlab-head\trefs/heads/feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor origin/feature/pan-100 main') {
          throw new Error('remote is squash-merged');
        }
        if (command.startsWith('git diff main...origin/feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command === 'git rev-parse origin/feature/pan-100 2>/dev/null') {
          return { stdout: 'gitlab-head\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir },
        { repoKey: 'fe', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'main', forge: 'gitlab' },
      );

      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.details).toEqual([
        'MR !75 is merged and feature/pan-100 matches the merged MR head (https://gitlab.com/acme/app/-/merge_requests/75)',
        'Remote origin/feature/pan-100 matches the merged MR head',
      ]);
      const commands = mockExecAsync.mock.calls.map(([command]) => command);
      expect(commands.filter(command => command === 'glab mr list --source-branch feature/pan-100 --all --output json')).toHaveLength(1);
      expect(verifyStep?.details?.filter(detail => detail.includes('MR !75'))).toHaveLength(1);
    });

    it('falls through when a merged GitLab MR head does not match the branch tip', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'newer-tip\n', stderr: '' };
        }
        if (command === 'glab mr list --source-branch feature/pan-100 --all --output json') {
          return {
            stdout: '[{"iid":75,"web_url":"https://gitlab.com/acme/app/-/merge_requests/75","state":"merged","source_branch":"feature/pan-100","target_branch":"main","sha":"merged-head"}]',
            stderr: '',
          };
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command === 'git log main..feature/pan-100 --oneline 2>/dev/null || true') {
          return { stdout: 'unmerged-commit\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir },
        { repoKey: 'fe', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'main', forge: 'gitlab' },
      );

      expect(verifyStep?.success).toBe(false);
      expect(verifyStep?.error).toBe('1 unmerged commit(s) on feature/pan-100. Merge before closing out.');
    });

    it('preserves the diff-empty fallback when GitLab has no merged MR', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'branch-tip\n', stderr: '' };
        }
        if (command === 'glab mr list --source-branch feature/pan-100 --all --output json') {
          return { stdout: '[]', stderr: '' };
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir },
        { repoKey: 'fe', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'main', forge: 'gitlab' },
      );

      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.details).toEqual([
        'Code changes squash-merged to main (only planning artifacts remain on branch)',
      ]);
    });

    it('does not run the GitHub closed-issue probe for a GitLab root', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 main') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'branch-tip\n', stderr: '' };
        }
        if (command === 'glab mr list --source-branch feature/pan-100 --all --output json') {
          return { stdout: '[]', stderr: '' };
        }
        if (command.startsWith('git diff main...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command === 'git log main..feature/pan-100 --oneline 2>/dev/null || true') {
          return { stdout: 'unmerged-commit\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir, github: { owner: 'eltmon', repo: 'overdeck', number: 100 } },
        { repoKey: 'fe', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'main', forge: 'gitlab' },
      );

      expect(mockExecAsync.mock.calls.map(([command]) => command)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('gh issue view')]),
      );
    });

    it('accepts a squash-merged GitHub PR when the branch tip matches the merged PR head', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
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
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
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
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
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

    it('checks post-PR commits against a configured non-main target branch', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 master') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff master...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('gh pr list')) {
          return {
            stdout: '[{"number":2182,"mergedAt":"2026-07-02T12:00:00Z","headRefOid":"merged-head","url":"https://github.com/eltmon/overdeck/pull/2182"}]',
            stderr: '',
          };
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'tip-after-target-merge\n', stderr: '' };
        }
        if (command.startsWith('git log --no-merges')) {
          return { stdout: 'target-commit\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor target-commit origin/master') {
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir, github: { owner: 'eltmon', repo: 'overdeck', number: 100 } },
        { repoKey: 'legacy', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'master', forge: 'github' },
      );

      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.details).toEqual([
        'PR #2182 is squash-merged; all 1 post-PR non-merge commit(s) on feature/pan-100 are already on origin/master',
      ]);
    });

    it('checks state-plane-only branch work against a configured non-main target branch', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
          return { stdout: '  feature/pan-100\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor feature/pan-100 master') {
          throw new Error('not an ancestor after squash merge');
        }
        if (command.startsWith('git diff master...feature/pan-100')) {
          return { stdout: 'diff --git a/src/example.ts b/src/example.ts\n', stderr: '' };
        }
        if (command.startsWith('gh pr list')) {
          return {
            stdout: '[{"number":2182,"mergedAt":"2026-07-02T12:00:00Z","headRefOid":"merged-head","url":"https://github.com/eltmon/overdeck/pull/2182"}]',
            stderr: '',
          };
        }
        if (command === 'git rev-parse feature/pan-100 2>/dev/null') {
          return { stdout: 'tip-with-state\n', stderr: '' };
        }
        if (command.startsWith('git log --no-merges')) {
          return { stdout: 'state-commit\n', stderr: '' };
        }
        if (command === 'git merge-base --is-ancestor state-commit origin/master') {
          throw new Error('state commit is not on the target');
        }
        if (command === 'git diff --name-only merged-head..tip-with-state') {
          return { stdout: 'src/from-target.ts\n', stderr: '' };
        }
        if (command === 'git diff --name-only origin/master...tip-with-state') {
          return { stdout: '.pan/records/pan-100.json\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const verifyStep = await verifyConventionBranchMerged(
        { issueId: 'PAN-100', projectPath: testDir, github: { owner: 'eltmon', repo: 'overdeck', number: 100 } },
        { repoKey: 'legacy', dir: testDir, sourceBranch: 'feature/pan-100', targetBranch: 'master', forge: 'github' },
      );

      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.details).toEqual([
        'PR #2182 is squash-merged; feature/pan-100 is ahead only by state-plane commits (1 file(s): .pan) — accepted per state-plane policy',
      ]);
      expect(mockExecAsync).toHaveBeenCalledWith(
        'git diff --name-only origin/master...tip-with-state',
        { cwd: testDir, encoding: 'utf-8' },
      );
    });

    it('rejects local squash-merge success when the remote branch has advanced past the merged PR head', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command === 'git branch --list "feature/pan-100" 2>/dev/null || true') {
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
        if (command === 'git ls-remote --heads origin "feature/pan-100" 2>/dev/null || true') {
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

    it('should delete the workspace, complete xBRIEF, close GitHub, and swap verifying labels during configured close-out', async () => {
      writeFileSync(
        join(OVERDECK_HOME, 'cloister.toml'),
        '[close_out]\nremove_workspace = true\ndelete_feature_branch = false\nauto = false\nauto_delay_minutes = 60\n',
      );
      const wsPath = join(testDir, 'workspaces', 'feature-pan-100');
      mkdirSync(wsPath, { recursive: true });
      await writeSpecForIssue(testDir, makeXBrief('PAN-100'), 'active');
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

    it('should complete xBRIEF status and prune checkpoint refs during close-out', async () => {
      await writeSpecForIssue(testDir, makeXBrief('PAN-100'), 'active');

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      const xbriefIdx = result.steps.findIndex(s => s.step === 'close-out:vbrief-completed');
      const teardownIdx = result.steps.findIndex(s => s.step === 'teardown:checkpoint-refs');
      const closeIdx = result.steps.findIndex(s => s.step === 'close-issue:transition');
      expect(xbriefIdx).toBeGreaterThanOrEqual(0);
      expect(teardownIdx).toBeGreaterThanOrEqual(0);
      expect(closeIdx).toBeGreaterThanOrEqual(0);
      expect(xbriefIdx).toBeLessThan(teardownIdx);
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

    it('acknowledges open recovery trips and clears operator-gate residue on close-out (PAN-3727)', async () => {
      const fixtureRecord = {
        recoveryTrips: [{ issue: 'PAN-100', recoveryPath: 'orphan-proposed-pickup-gate', obligationGeneration: 'wi-1', tripCount: 5, open: true }],
      };
      const fixtureAgent = { id: 'agent-pan-100-work', stoppedByUser: true };
      mockAcknowledgeAllOpenRecoveryTrips.mockImplementationOnce(async (issueId: string) => {
        expect(issueId).toBe('PAN-100');
        const acked = fixtureRecord.recoveryTrips.length;
        fixtureRecord.recoveryTrips = [];
        return acked;
      });
      mockClearAgentOperatorGatesForIssueSync.mockImplementationOnce((issueId: string) => {
        expect(issueId).toBe('PAN-100');
        delete fixtureAgent.stoppedByUser;
        return [fixtureAgent.id];
      });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      expect(result.success).toBe(true);
      expect(fixtureRecord.recoveryTrips).toHaveLength(0);
      expect(fixtureAgent.stoppedByUser).toBeUndefined();
      const step = result.steps.find(s => s.step === 'close-out:ack-parked-residue');
      expect(step).toMatchObject({ success: true, skipped: false });
      expect(step?.details?.[0]).toContain('Acked 1 open trip(s)');
      expect(step?.details?.[0]).toContain('cleared operator gates on 1 agent row(s)');
    });

    it('records the residue-ack step as skipped (non-blocking) when the ack door throws, but still clears operator gates (PAN-3727 review finding)', async () => {
      mockAcknowledgeAllOpenRecoveryTrips.mockImplementationOnce(async () => {
        throw new Error('record lock unavailable');
      });
      mockClearAgentOperatorGatesForIssueSync.mockImplementationOnce((issueId: string) => {
        expect(issueId).toBe('PAN-100');
        return ['agent-pan-100-work'];
      });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      expect(result.success).toBe(true);
      expect(mockClearAgentOperatorGatesForIssueSync).toHaveBeenCalledWith('PAN-100');
      const step = result.steps.find(s => s.step === 'close-out:ack-parked-residue');
      expect(step).toMatchObject({ success: true, skipped: true });
      expect(step?.details?.join(' ')).toContain('record lock unavailable');
      expect(step?.details?.join(' ')).toContain('cleared operator gates on 1 agent row(s)');
    });

    it('records the residue-ack step as skipped (non-blocking) when the gate door throws, but still acknowledges trips (PAN-3727 review finding)', async () => {
      mockAcknowledgeAllOpenRecoveryTrips.mockImplementationOnce(async (issueId: string) => {
        expect(issueId).toBe('PAN-100');
        return 2;
      });
      mockClearAgentOperatorGatesForIssueSync.mockImplementationOnce(() => {
        throw new Error('agents db unavailable');
      });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx, { tracker: successfulTracker() });

      expect(result.success).toBe(true);
      expect(mockAcknowledgeAllOpenRecoveryTrips).toHaveBeenCalledWith('PAN-100');
      const step = result.steps.find(s => s.step === 'close-out:ack-parked-residue');
      expect(step).toMatchObject({ success: true, skipped: true });
      expect(step?.details?.join(' ')).toContain('agents db unavailable');
      expect(step?.details?.join(' ')).toContain('Acked 2 open trip(s)');
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

    it('idempotent guard is called on close-out workflow entry (PAN-3025 WI-4)', async () => {
      // This test verifies that the workflow invokes readCompletedCloseOut and handles its result.
      // The three cases (short-circuit / fall-through / error) are covered by focused
      // dod-gate-idempotent-guard.test.ts which exercises the real helper with controllable deps.
      // This test confirms the wiring: when the helper returns a timestamp, the workflow skips.
      mockReadCompletedCloseOut.mockResolvedValueOnce('2026-07-28T08:00:00Z');

      const result = await closeOut(
        { issueId: 'PAN-3050', projectPath: testDir },
        { tracker: successfulTracker() },
      );

      expect(result.success).toBe(true);
      // Early return means exactly one step (the idempotent skip step)
      expect(result.steps).toHaveLength(1);
      const idempotentStep = result.steps[0];
      expect(idempotentStep.step).toBe('close-out:idempotent');
      expect(idempotentStep.skipped).toBe(true);
      // Verify ceremony was skipped (gate not called, status mutations not run)
      expect(mockEvaluateDodGate).not.toHaveBeenCalled();
      expect(mockClearReviewStatus).not.toHaveBeenCalled();
      expect(mockMarkRecordPipelineClosedOutSync).not.toHaveBeenCalled();
    });

    it('workflow proceeds to gate when guard returns null (normal path)', async () => {
      // When readCompletedCloseOut returns null, the workflow proceeds to the DoD gate
      // (this covers both "not closed out" and "live row still present" scenarios)
      mockReadCompletedCloseOut.mockResolvedValueOnce(null);

      const result = await closeOut(
        { issueId: 'PAN-3051', projectPath: testDir },
        { tracker: successfulTracker() },
      );

      expect(result.success).toBe(true);
      // Gate runs normally because the guard did not short-circuit
      expect(mockEvaluateDodGate).toHaveBeenCalledOnce();
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

    it('closeOut should heal UAT evidence before the Definition-of-Done rows', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.steps.slice(0, 8).map(step => step.step)).toEqual([
        'dod:uat-promotion-evidence',
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
