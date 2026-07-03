import { Effect } from 'effect';
/**
 * Tests for runVerificationForIssue (PAN-174, updated for PAN-336)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const {
  execMock,
  setReviewStatusMock,
  getReviewStatusMock,
  runQualityGatesMock,
  writeFeedbackFileMock,
  messageAgentMock,
  setAgentPausedMock,
  stopAgentMock,
  markWorkspaceStuckMock,
  findProjectByPathMock,
  existsSyncMock,
  getVBriefACStatusSyncMock,
  resolveIssueFeedbackTargetMock,
  surfaceIssueFeedbackNeedsYouMock,
} = vi.hoisted(() => ({
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>()
    .mockResolvedValue({ stdout: 'Already up to date\n', stderr: '' }),
  setReviewStatusMock: vi.fn(),
  getReviewStatusMock: vi.fn(),
  runQualityGatesMock: vi.fn(),
  writeFeedbackFileMock: vi.fn(),
  messageAgentMock: vi.fn(),
  setAgentPausedMock: vi.fn(),
  stopAgentMock: vi.fn(),
  markWorkspaceStuckMock: vi.fn(),
  findProjectByPathMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getVBriefACStatusSyncMock: vi.fn().mockReturnValue({ allCompleted: true, totalPending: 0, totalCount: 0, items: [] }),
  resolveIssueFeedbackTargetMock: vi.fn(),
  surfaceIssueFeedbackNeedsYouMock: vi.fn(),
}));

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;

  function execFile(_file: string, _args: string[] | null, _optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof _optionsOrCb === 'function' ? _optionsOrCb : maybeCallback;
    try {
      callback(null, '', '');
    } catch (err) {
      callback(err, '', '');
    }
  }
  (execFile as any)[kCustom] = () => Promise.resolve({ stdout: '', stderr: '' });

  return { exec, execFile };
});

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('../../src/lib/review-status.js', () => ({
  getReviewStatus: getReviewStatusMock,
  getReviewStatusSync: getReviewStatusMock,
  setReviewStatus: setReviewStatusMock,
  setReviewStatusSync: setReviewStatusMock,
  markWorkspaceStuck: markWorkspaceStuckMock,
}));

vi.mock('../../src/lib/cloister/validation.js', () => ({
  runQualityGates: runQualityGatesMock,
  DEFAULT_GATES: {
    typecheck: { command: 'npm run typecheck 2>&1' },
    lint: { command: 'npm run lint 2>&1' },
    test: { command: 'npx vitest run --changed {{CHANGED_BASE}} && cd src/dashboard/frontend && npx vitest run --changed {{CHANGED_BASE}}' },
  },
}));

vi.mock('../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: writeFeedbackFileMock,
}));

vi.mock('../../src/lib/agents.js', () => ({
  messageAgent: messageAgentMock,
  setAgentPaused: setAgentPausedMock,
  stopAgent: stopAgentMock,
}));

vi.mock('../../src/lib/projects.js', () => ({
  findProjectByPath: findProjectByPathMock,
  findProjectByPathSync: findProjectByPathMock,
}));

vi.mock('../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: resolveIssueFeedbackTargetMock,
  surfaceIssueFeedbackNeedsYou: surfaceIssueFeedbackNeedsYouMock,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

vi.mock('../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: vi.fn().mockReturnValue(Effect.succeed({ allCompleted: true, totalPending: 0, totalCount: 0, items: [] })),
  getVBriefACStatusSync: getVBriefACStatusSyncMock,
}));

// Import under test after mocks
import { runVerificationForIssue, VERIFICATION_MAX_CYCLES } from '../../src/lib/cloister/verification-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const issueId = 'PAN-174';
const workspacePath = '/tmp/test-workspace';
const workspaceInfo = { isRemote: false };

function makePassedResults() {
  return [
    { name: 'typecheck', passed: true, required: true, output: 'ok', durationMs: 100 },
  ];
}

function makeFailedResults(failedCheck = 'lint') {
  return [
    { name: failedCheck, passed: false, required: true, output: 'error output', durationMs: 200 },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runVerificationForIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockReset();
    execMock.mockResolvedValue({ stdout: 'Already up to date\n', stderr: '' });
    getReviewStatusMock.mockReturnValue(null); // no existing status → 0 cycles
    runQualityGatesMock.mockReturnValue(Effect.succeed(makePassedResults()));
    writeFeedbackFileMock.mockReturnValue(Effect.succeed({ success: true, relativePath: '.pan/feedback/001-verification-failed.md' }));
    messageAgentMock.mockResolvedValue(undefined);
    setAgentPausedMock.mockReturnValue(Effect.succeed({}));
    stopAgentMock.mockReturnValue(Effect.succeed(undefined));
    findProjectByPathMock.mockReturnValue(null); // no project config → DEFAULT_GATES
    existsSyncMock.mockImplementation((p: string) => p.endsWith('/.git'));
    getVBriefACStatusSyncMock.mockReturnValue({ allCompleted: true, totalPending: 0, totalCount: 0, items: [] });
    resolveIssueFeedbackTargetMock.mockResolvedValue({ agentId: `agent-${issueId.toLowerCase()}` });
  });

  describe('circuit breaker', () => {
    it('returns skipped and sets verificationStatus:skipped when at max cycles', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: VERIFICATION_MAX_CYCLES });

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('skipped');
      expect(setReviewStatusMock).toHaveBeenCalledWith(issueId, { verificationStatus: 'skipped' });
      expect(runQualityGatesMock).not.toHaveBeenCalled();
    });

    it('runs verification when cycles are below max', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: VERIFICATION_MAX_CYCLES - 1 });

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(runQualityGatesMock).toHaveBeenCalledOnce();
    });
  });

  describe('verification passes', () => {
    it('returns passed and sets verificationStatus:passed', async () => {
      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('passed');
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ verificationStatus: 'passed' })
      );
    });

    it('sets verificationStatus:running while gate runs', async () => {
      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(setReviewStatusMock).toHaveBeenCalledWith(issueId, { verificationStatus: 'running' });
    });

    it('does not write feedback or message agent on pass', async () => {
      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(writeFeedbackFileMock).not.toHaveBeenCalled();
      expect(messageAgentMock).not.toHaveBeenCalled();
    });

    it('syncs the configured target branch before gates by default', async () => {
      findProjectByPathMock.mockReturnValue({
        name: 'my-project',
        path: '/some/path',
        workspace: { default_branch: 'develop' },
      });

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(execMock).toHaveBeenCalledWith(
        'git fetch origin develop',
        expect.objectContaining({ cwd: workspacePath })
      );
      expect(execMock).toHaveBeenCalledWith(
        'git merge origin/develop --no-edit',
        expect.objectContaining({ cwd: workspacePath })
      );
    });

    it('can verify current state without syncing target branch', async () => {
      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test', {
        syncTargetBranch: false,
      }));

      const commands = execMock.mock.calls.map(call => call[0]);
      expect(commands).not.toContain('git fetch origin main');
      expect(commands).not.toContain('git merge origin/main --no-edit');
      expect(runQualityGatesMock).toHaveBeenCalledOnce();
    });

    it('writes feedback and stops when syncing target branch fails without merge conflicts', async () => {
      execMock
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockRejectedValueOnce(Object.assign(new Error('fetch rejected'), {
          stdout: '',
          stderr: 'fatal: Not possible to fast-forward, aborting.\n',
        }));

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.failedCheck).toBe('sync-target-branch');
        expect(result.cycleCount).toBe(1);
      }
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({
          reviewStatus: 'pending',
          verificationStatus: 'failed',
          verificationCycleCount: 1,
        })
      );
      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId,
          workspacePath,
          specialist: 'verification-gate',
          outcome: 'failed',
          summary: expect.stringContaining('Sync FAILED'),
          markdownBody: expect.stringContaining('fatal: Not possible to fast-forward, aborting.'),
        })
      );
      expect(messageAgentMock).toHaveBeenCalledWith(
        `agent-${issueId.toLowerCase()}`,
        expect.stringContaining('Failed check: sync-target-branch')
      );
      expect(runQualityGatesMock).not.toHaveBeenCalled();
    });
  });

  describe('verification fails', () => {
    beforeEach(() => {
      runQualityGatesMock.mockReturnValue(Effect.succeed(makeFailedResults('lint')));
    });

    it('returns failed with correct failedCheck and cycleCount', async () => {
      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.failedCheck).toBe('lint');
        expect(result.cycleCount).toBe(1);
        expect(result.maxCycles).toBe(VERIFICATION_MAX_CYCLES);
      }
    });

    it('resets reviewStatus to pending on failure', async () => {
      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({
          reviewStatus: 'pending',
          verificationStatus: 'failed',
          verificationNotes: expect.stringContaining('Verification FAILED at lint'),
        })
      );
    });

    it('increments verificationCycleCount correctly', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: 1 });

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      if (result.outcome === 'failed') {
        expect(result.cycleCount).toBe(2);
      }
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ verificationCycleCount: 2 })
      );
    });

    it('writes feedback file and messages agent on failure', async () => {
      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ issueId, workspacePath, specialist: 'verification-gate' })
      );
      expect(messageAgentMock).toHaveBeenCalledWith(
        `agent-${issueId.toLowerCase()}`,
        expect.stringContaining('VERIFICATION FAILED')
      );
    });

    it('uses workspacePath directly for writeFeedbackFile', async () => {
      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath })
      );
    });

    it('treats first failed required gate as failedCheck', async () => {
      // Multiple gates: optional failure then required failure
      runQualityGatesMock.mockReturnValue(Effect.succeed([
        { name: 'format', passed: false, required: false, output: 'style issues', durationMs: 50 },
        { name: 'typecheck', passed: false, required: true, output: 'type error', durationMs: 200 },
      ]));

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.failedCheck).toBe('typecheck');
      }
    });

    it('continues and returns failed even if feedback writing throws', async () => {
      writeFeedbackFileMock.mockReturnValue(Effect.fail(new Error('disk full')));

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('failed');
    });

    it('marks the issue stuck and pauses the work agent after the final failed attempt', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: VERIFICATION_MAX_CYCLES - 1 });

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result).toMatchObject({
        outcome: 'failed',
        failedCheck: 'lint',
        cycleCount: VERIFICATION_MAX_CYCLES,
        maxCycles: VERIFICATION_MAX_CYCLES,
      });
      expect(markWorkspaceStuckMock).toHaveBeenCalledWith(
        issueId,
        'verification_stuck',
        expect.objectContaining({
          failedCheck: 'lint',
          cycleCount: VERIFICATION_MAX_CYCLES,
          maxCycles: VERIFICATION_MAX_CYCLES,
        })
      );
      expect(setAgentPausedMock).toHaveBeenCalledWith(
        `agent-${issueId.toLowerCase()}`,
        expect.stringContaining('needs-you: verification stuck'),
        true
      );
      expect(stopAgentMock).toHaveBeenCalledWith(`agent-${issueId.toLowerCase()}`);
      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          markdownBody: expect.stringContaining('NEEDS-YOU: Verification stuck'),
        })
      );
      expect(messageAgentMock).toHaveBeenCalledWith(
        `agent-${issueId.toLowerCase()}`,
        expect.not.stringContaining('Do NOT stop until')
      );
    });

    it('escalates early when the same required gate fails in consecutive cycles', async () => {
      getReviewStatusMock.mockReturnValue({
        verificationCycleCount: 1,
        verificationStatus: 'failed',
        verificationNotes: 'Verification FAILED at lint (200ms):\n\nprevious error output',
      });

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result).toMatchObject({
        outcome: 'failed',
        failedCheck: 'lint',
        cycleCount: 2,
        maxCycles: VERIFICATION_MAX_CYCLES,
      });
      expect(markWorkspaceStuckMock).toHaveBeenCalledWith(
        issueId,
        'verification_stuck',
        expect.objectContaining({
          failedCheck: 'lint',
          cycleCount: 2,
          maxCycles: VERIFICATION_MAX_CYCLES,
        })
      );
      expect(setAgentPausedMock).toHaveBeenCalledWith(
        `agent-${issueId.toLowerCase()}`,
        expect.stringContaining('needs-you: verification stuck'),
        true
      );
      expect(stopAgentMock).toHaveBeenCalledWith(`agent-${issueId.toLowerCase()}`);
      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          markdownBody: expect.stringContaining('NEEDS-YOU: Verification stuck'),
        })
      );
    });
  });

  describe('state-derived verification gates', () => {
    beforeEach(() => {
      runQualityGatesMock.mockReturnValue(Effect.succeed(makePassedResults()));
      getVBriefACStatusSyncMock.mockReturnValue({
        allCompleted: false,
        totalPending: 1,
        totalCount: 2,
        items: [
          {
            itemTitle: 'FR-16',
            pending: 1,
            total: 2,
            criteria: [
              { title: 'preserve passed review verdict', status: 'pending' },
              { title: 'code gate behavior unchanged', status: 'completed' },
            ],
          },
        ],
      });
    });

    it('preserves a passed review verdict when vbrief-ac fails', async () => {
      getReviewStatusMock.mockReturnValue({ reviewStatus: 'passed', verificationCycleCount: 0 });

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result).toMatchObject({
        outcome: 'failed',
        failedCheck: 'vbrief-ac',
        cycleCount: 1,
      });
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({
          verificationStatus: 'failed',
          verificationNotes: expect.stringContaining('Acceptance criteria check FAILED'),
          verificationCycleCount: 1,
        }),
      );
      expect(setReviewStatusMock).not.toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ reviewStatus: 'pending' }),
      );
    });

    it('emits needs-you when a passed review is held by vbrief-ac state', async () => {
      getReviewStatusMock.mockReturnValue({ reviewStatus: 'passed', verificationCycleCount: 0 });

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(markWorkspaceStuckMock).toHaveBeenCalledWith(
        issueId,
        'state_derived_verification_hold',
        expect.objectContaining({
          failedCheck: 'vbrief-ac',
          summary: expect.stringContaining('Acceptance criteria check FAILED'),
          reviewStatus: 'passed',
        }),
      );
    });

    it('does not emit needs-you for vbrief-ac before review has passed', async () => {
      getReviewStatusMock.mockReturnValue({ reviewStatus: 'pending', verificationCycleCount: 0 });

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(markWorkspaceStuckMock).not.toHaveBeenCalledWith(
        issueId,
        'state_derived_verification_hold',
        expect.any(Object),
      );
    });
  });

  describe('infrastructure error', () => {
    it('returns error outcome and sets verificationStatus:failed', async () => {
      runQualityGatesMock.mockReturnValue(Effect.fail(new Error('exec failed')));

      const result = await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(result.outcome).toBe('error');
      if (result.outcome === 'error') {
        expect(result.message).toContain('exec failed');
      }
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ verificationStatus: 'failed', reviewStatus: 'pending' })
      );
    });

    it('does not throw — returns error outcome instead', async () => {
      runQualityGatesMock.mockReturnValue(Effect.fail(new Error('unexpected')));

      await expect(Effect.runPromise(
        runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test')
      )).resolves.toMatchObject({ outcome: 'error' });
    });
  });

  describe('remote workspace', () => {
    it('passes isRemote and vmName to runQualityGates', async () => {
      const remoteInfo = { isRemote: true, vmName: 'my-vm' };

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, remoteInfo, 'test'));

      expect(runQualityGatesMock).toHaveBeenCalledWith(
        expect.any(Object), // gates (DEFAULT_GATES since findProjectByPath returns null)
        workspacePath,
        'pre_push',
        expect.objectContaining({ isRemote: true, vmName: 'my-vm' })
      );
    });
  });

  describe('project quality gates config', () => {
    it('uses project quality gates when available', async () => {
      const projectGates = {
        'custom-lint': { command: 'pnpm lint', required: true },
      };
      findProjectByPathMock.mockReturnValue({ quality_gates: projectGates });

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(runQualityGatesMock).toHaveBeenCalledWith(
        projectGates,
        workspacePath,
        'pre_push',
        expect.any(Object)
      );
    });

    it('falls back to DEFAULT_GATES when project has no quality_gates', async () => {
      findProjectByPathMock.mockReturnValue({ name: 'my-project', path: '/some/path' }); // no quality_gates

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(runQualityGatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ typecheck: expect.any(Object), lint: expect.any(Object) }),
        workspacePath,
        'pre_push',
        expect.any(Object)
      );
    });

    it('falls back to DEFAULT_GATES when no project found', async () => {
      findProjectByPathMock.mockReturnValue(null);

      await Effect.runPromise(runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test'));

      expect(runQualityGatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ typecheck: expect.any(Object) }),
        workspacePath,
        'pre_push',
        expect.any(Object)
      );
    });
  });
});
