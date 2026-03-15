/**
 * Tests for runVerificationForIssue (PAN-174)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { setReviewStatusMock, getReviewStatusMock, runVerificationGateMock, writeFeedbackFileMock, messageAgentMock } = vi.hoisted(() => ({
  setReviewStatusMock: vi.fn(),
  getReviewStatusMock: vi.fn(),
  runVerificationGateMock: vi.fn(),
  writeFeedbackFileMock: vi.fn(),
  messageAgentMock: vi.fn(),
}));

vi.mock('../../src/lib/review-status.js', () => ({
  getReviewStatus: getReviewStatusMock,
  setReviewStatus: setReviewStatusMock,
}));

vi.mock('../../src/lib/cloister/verification-gate.js', () => ({
  runVerificationGate: runVerificationGateMock,
}));

vi.mock('../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: writeFeedbackFileMock,
}));

vi.mock('../../src/lib/agents.js', () => ({
  messageAgent: messageAgentMock,
}));

// Import under test after mocks
import { runVerificationForIssue, VERIFICATION_MAX_CYCLES } from '../../src/lib/cloister/verification-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const issueId = 'PAN-174';
const workspacePath = '/tmp/test-workspace';
const workspaceInfo = { isRemote: false };

function makePassedResult() {
  return {
    passed: true,
    checks: [{ name: 'typecheck', passed: true, output: '', durationMs: 100 }],
    summary: 'All checks passed: typecheck (100ms)',
  };
}

function makeFailedResult(failedCheck = 'lint') {
  return {
    passed: false,
    failedCheck,
    checks: [{ name: failedCheck, passed: false, output: 'error output', durationMs: 200 }],
    summary: `Verification FAILED at ${failedCheck} (200ms):\n\nerror output`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runVerificationForIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReviewStatusMock.mockReturnValue(null); // no existing status → 0 cycles
    runVerificationGateMock.mockResolvedValue(makePassedResult());
    writeFeedbackFileMock.mockResolvedValue({ success: true, relativePath: '.planning/feedback/001-verification-failed.md' });
    messageAgentMock.mockResolvedValue(undefined);
  });

  describe('circuit breaker', () => {
    it('returns skipped and sets verificationStatus:skipped when at max cycles', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: VERIFICATION_MAX_CYCLES });

      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(result.outcome).toBe('skipped');
      expect(setReviewStatusMock).toHaveBeenCalledWith(issueId, { verificationStatus: 'skipped' });
      expect(runVerificationGateMock).not.toHaveBeenCalled();
    });

    it('runs verification when cycles are below max', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: VERIFICATION_MAX_CYCLES - 1 });

      await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(runVerificationGateMock).toHaveBeenCalledOnce();
    });
  });

  describe('verification passes', () => {
    it('returns passed and sets verificationStatus:passed', async () => {
      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(result.outcome).toBe('passed');
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ verificationStatus: 'passed' })
      );
    });

    it('sets verificationStatus:running while gate runs', async () => {
      await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(setReviewStatusMock).toHaveBeenCalledWith(issueId, { verificationStatus: 'running' });
    });

    it('does not write feedback or message agent on pass', async () => {
      await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(writeFeedbackFileMock).not.toHaveBeenCalled();
      expect(messageAgentMock).not.toHaveBeenCalled();
    });
  });

  describe('verification fails', () => {
    beforeEach(() => {
      runVerificationGateMock.mockResolvedValue(makeFailedResult('lint'));
    });

    it('returns failed with correct failedCheck and cycleCount', async () => {
      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.failedCheck).toBe('lint');
        expect(result.cycleCount).toBe(1);
        expect(result.maxCycles).toBe(VERIFICATION_MAX_CYCLES);
      }
    });

    it('resets reviewStatus to pending on failure', async () => {
      await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ reviewStatus: 'pending', verificationStatus: 'failed' })
      );
    });

    it('increments verificationCycleCount correctly', async () => {
      getReviewStatusMock.mockReturnValue({ verificationCycleCount: 1 });

      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      if (result.outcome === 'failed') {
        expect(result.cycleCount).toBe(2);
      }
      expect(setReviewStatusMock).toHaveBeenCalledWith(
        issueId,
        expect.objectContaining({ verificationCycleCount: 2 })
      );
    });

    it('writes feedback file and messages agent on failure', async () => {
      await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ issueId, workspacePath, specialist: 'review-agent' })
      );
      expect(messageAgentMock).toHaveBeenCalledWith(
        `agent-${issueId.toLowerCase()}`,
        expect.stringContaining('VERIFICATION FAILED')
      );
    });

    it('uses workspacePath directly (not localPath) for writeFeedbackFile', async () => {
      await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(writeFeedbackFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath })
      );
    });

    it('handles missing failedCheck gracefully (falls back to unknown)', async () => {
      runVerificationGateMock.mockResolvedValue({
        passed: false,
        failedCheck: undefined,
        checks: [],
        summary: 'failed',
      });

      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      if (result.outcome === 'failed') {
        expect(result.failedCheck).toBe('unknown');
      }
    });

    it('continues and returns failed even if feedback writing throws', async () => {
      writeFeedbackFileMock.mockRejectedValue(new Error('disk full'));

      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

      expect(result.outcome).toBe('failed');
    });
  });

  describe('infrastructure error', () => {
    it('returns error outcome and sets verificationStatus:failed', async () => {
      runVerificationGateMock.mockRejectedValue(new Error('exec failed'));

      const result = await runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test');

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
      runVerificationGateMock.mockRejectedValue(new Error('unexpected'));

      await expect(
        runVerificationForIssue(issueId, workspacePath, workspaceInfo, 'test')
      ).resolves.toMatchObject({ outcome: 'error' });
    });
  });

  describe('remote workspace', () => {
    it('passes isRemote and vmName to runVerificationGate', async () => {
      const remoteInfo = { isRemote: true, vmName: 'my-vm' };

      await runVerificationForIssue(issueId, workspacePath, remoteInfo, 'test');

      expect(runVerificationGateMock).toHaveBeenCalledWith(
        workspacePath,
        { isRemote: true, vmName: 'my-vm' }
      );
    });
  });
});
