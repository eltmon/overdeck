import { Effect } from 'effect';
/**
 * Tests for checkFailedMergeRetry — CI failure notification state machine.
 * Tests for checkPostReviewCommits — ciRetryMap.delete on new-commit detection.
 *
 * Covers:
 *  - CI failure: notifies work agent to re-submit via pan done (no status mutation)
 *  - Respects 2-minute cooldown between notifications
 *  - Exhausts at count=5, writes feedback + notifies agent exactly once
 *  - count>5 (post-exhaustion): just logs, no duplicate feedback
 *  - checkPostReviewCommits clears ciRetryMap when new commits arrive, enabling
 *    fresh notifications on next patrol
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { getOverdeckHome } from '../../../src/lib/paths.js';

// ── Module-level mocks ──────────────────────────────────────────────────────

const mockSetReviewStatus = vi.fn();
const mockLoadReviewStatuses = vi.fn();
const mockSessionExists = vi.fn();
const mockSendKeysAsync = vi.fn();
const mockWriteFeedbackFile = vi.fn();
const mockResolveProjectFromIssue = vi.fn();
const mockGetAgentRuntimeState = vi.fn().mockReturnValue(null);
const mockIsIssueClosed = vi.fn();

vi.mock('../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: (...args: unknown[]) => mockIsIssueClosed(...args),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
  setReviewStatus: (...args: unknown[]) => mockSetReviewStatus(...args),
  setReviewStatusSync: (...args: unknown[]) => mockSetReviewStatus(...args),
  loadReviewStatuses: (...args: unknown[]) => mockLoadReviewStatuses(...args),
  MAX_AUTO_REQUEUE: 25,
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    sessionExists: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockSessionExists(...args))),
    sessionExistsSync: (...args: unknown[]) => mockSessionExists(...args),
    sendKeys: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockSendKeysAsync(...args))),
    sendKeysProgram: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockSendKeysAsync(...args))),
    buildTmuxCommandString: vi.fn(),
    capturePane: vi.fn(() => Effect.succeed('')),
    createSession: vi.fn(() => Effect.succeed(undefined)),
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    killSession: vi.fn(),
  killSessionSync: vi.fn(),
    killSession: vi.fn(() => Effect.succeed(undefined)),
    listPaneValues: vi.fn(),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    listSessionNames: vi.fn(() => Effect.succeed([])),
  };
});

vi.mock('../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockWriteFeedbackFile(...args))),
}));

// Stub out heavy transitive dependencies that deacon imports at module level.
vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  getAgentRuntimeStateSync: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  getAgentStateSync: vi.fn().mockReturnValue(null),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
}));

const mockSpawnReviewRoleForIssue = vi.fn();

vi.mock('../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: (...args: unknown[]) => Effect.tryPromise({
    try: () => Promise.resolve(mockSpawnReviewRoleForIssue(...args)),
    catch: (cause) => cause as any,
  }),
}));

vi.mock('../../../src/lib/cloister/concurrency.js', () => ({
  resetPatrolDispatchBudget: () => {},
  tryReserveAdvancingSlot: () => true,
  canDispatchAdvancing: () => true,
  releaseAdvancingSlot: () => {},
  tryReserveSwarmSlot: () => true,
  releaseSwarmSlot: () => {},
  getConcurrencyLimits: () => ({ maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 }),
  countRunningAgents: () => ({ work: 0, advancing: 0, total: 0 }),
  workResumeSlotsAvailable: () => 6,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  resolveProjectFromIssueSync: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  findProjectByPath: vi.fn().mockReturnValue(null),
  findProjectByPathSync: vi.fn().mockReturnValue(null),
}));

// ── Test constants ──────────────────────────────────────────────────────────

const REVIEW_STATUS_FILE = join(getOverdeckHome(), 'review-status.json');
const ISSUE_ID = 'PAN-714-CI-TEST';
// Status entry that represents a CI check failure (review + test passed, but
// the merge blocked due to "failing required checks")
const CI_FAILED_STATUS = {
  issueId: ISSUE_ID,
  reviewStatus: 'passed',
  testStatus: 'passed',
  mergeStatus: 'failed',
  mergeNotes: 'Merge failed: failing required checks',
  readyForMerge: false,
  mergeRetryCount: 0,
  updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
};

function writeStatusFile(statuses: Record<string, unknown>): void {
  mkdirSync(getOverdeckHome(), { recursive: true });
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('checkFailedMergeRetry — CI transient retry state machine', () => {
  let originalContent: string | null = null;

  // Import after mocks are registered — we also need the ciRetryMap export
  let checkFailedMergeRetry: () => Promise<string[]>;
  let checkPostReviewCommits: () => Promise<string[]>;
  let ciRetryMap: Map<string, { count: number; lastAttempt: number }>;
  let mockGetReviewStatusSync: (issueId: string) => unknown;

  beforeEach(async () => {
    vi.resetModules();
    mockSetReviewStatus.mockReset();
    mockSessionExists.mockReset().mockReturnValue(false);
    mockSendKeysAsync.mockReset().mockResolvedValue(undefined);
    mockWriteFeedbackFile.mockReset().mockResolvedValue(undefined);
    mockResolveProjectFromIssue.mockReset().mockReturnValue(null);
    mockSpawnReviewRoleForIssue.mockReset().mockResolvedValue({ success: true, message: 'dispatched' });
    mockIsIssueClosed.mockReset().mockResolvedValue(false);
    // Default: read the real review-status.json so tests that write to it work
    mockLoadReviewStatuses.mockReset().mockImplementation(() => {
      try {
        const raw = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
        return JSON.parse(raw);
      } catch {
        return {};
      }
    });

    // Back up existing file
    if (existsSync(REVIEW_STATUS_FILE)) {
      originalContent = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    } else {
      originalContent = null;
    }

    const mod = await import('../../../src/lib/cloister/deacon.js');
    checkFailedMergeRetry = mod.checkFailedMergeRetry;
    checkPostReviewCommits = mod.checkPostReviewCommits;
    ciRetryMap = mod.ciRetryMap;
    ciRetryMap.clear(); // Reset in-memory state for each test

    const reviewStatusMod = await import('../../../src/lib/review-status.js');
    mockGetReviewStatusSync = reviewStatusMod.getReviewStatusSync as (issueId: string) => unknown;
  });

  afterEach(() => {
    // Restore original review-status.json
    if (originalContent !== null) {
      writeFileSync(REVIEW_STATUS_FILE, originalContent, 'utf-8');
    } else if (existsSync(REVIEW_STATUS_FILE)) {
      unlinkSync(REVIEW_STATUS_FILE);
    }
  });

  it('(a) CI failure: notifies agent to re-submit when cooldown has passed', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    // ciRetryMap is empty → count=0, lastAttempt=0 → cooldown of 0ms has "passed"

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/CI failure notification/);
    expect(actions[0]).toContain(ISSUE_ID);
    expect(actions[0]).toMatch(/attempt 1\/5/);

    // writeFeedbackFile must have been called to notify the agent
    expect(mockWriteFeedbackFile).toHaveBeenCalledOnce();
    const feedbackArg = mockWriteFeedbackFile.mock.calls[0][0];
    expect(feedbackArg.issueId).toBe(ISSUE_ID);
    expect(feedbackArg.outcome).toBe('ci-failure');

    // setReviewStatus must NOT be called — deacon does not mutate merge status
    expect(mockSetReviewStatus).not.toHaveBeenCalled();

    // ciRetryMap should have recorded count=1
    expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(1);
  });

  it('(b) respects 2-minute cooldown: does nothing when last attempt was < 2 min ago', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    // Set lastAttempt to 1 minute ago — still in cooldown
    ciRetryMap.set(ISSUE_ID, { count: 1, lastAttempt: Date.now() - 60_000 });

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('(c) exhaustion at count=5: writes feedback file + notifies agent exactly once', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    // Pre-seed count=5 so this call is the exhaustion trigger
    ciRetryMap.set(ISSUE_ID, { count: 5, lastAttempt: Date.now() - 5 * 60_000 });
    mockSessionExists.mockReturnValue(true); // agent session is live

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/CI retry exhausted/);
    expect(actions[0]).toContain(ISSUE_ID);

    // writeFeedbackFile must have been called exactly once
    expect(mockWriteFeedbackFile).toHaveBeenCalledOnce();
    const feedbackArg = mockWriteFeedbackFile.mock.calls[0][0];
    expect(feedbackArg.issueId).toBe(ISSUE_ID);
    expect(feedbackArg.outcome).toBe('ci-failure');

    // Agent should have been notified
    expect(mockSendKeysAsync).toHaveBeenCalledOnce();
    expect(mockSendKeysAsync.mock.calls[0][0]).toBe(`agent-${ISSUE_ID.toLowerCase()}`);

    // ciRetryMap count must be incremented past 5 so this block does NOT fire again
    expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(6);

    // setReviewStatus must NOT have been called (we're blocking, not retrying)
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('(d) count>5 (post-exhaustion): just logs, no duplicate feedback', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    // Already exhausted and notified in a previous cycle
    ciRetryMap.set(ISSUE_ID, { count: 6, lastAttempt: Date.now() - 5 * 60_000 });

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(0); // no new actions
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('(e) no-op when REVIEW_STATUS_FILE does not exist', async () => {
    if (existsSync(REVIEW_STATUS_FILE)) {
      unlinkSync(REVIEW_STATUS_FILE);
      // DO NOT set originalContent = null — afterEach needs it to restore the real file
    }

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('checkPostReviewCommits skips review re-dispatch when the issue is closed', async () => {
    mockIsIssueClosed.mockResolvedValue(true);
    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        readyForMerge: true,
        reviewedAtCommit: 'deadbeef00000000000000000000000000000000',
      },
    });

    const actions = await checkPostReviewCommits();

    expect(actions).toEqual([]);
    expect(mockResolveProjectFromIssue).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
    expect(mockIsIssueClosed).toHaveBeenCalledWith(ISSUE_ID);
  });

  it('(f) checkPostReviewCommits clears ciRetryMap on new commits, enabling retry on next patrol', async () => {
    // Set up a real git workspace so execAsync('git rev-parse HEAD') works
    const projectPath = mkdtempSync(join(tmpdir(), 'pan-deacon-ci-retry-'));
    const workspacePath = join(projectPath, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    execSync('git init && git commit --allow-empty -m "fix: ci checks"', {
      cwd: workspacePath,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });

    try {
      // Write an issue that has passed review at an OLD commit
      // (different from the current HEAD → triggers the reset path)
      writeStatusFile({
        [ISSUE_ID]: {
          reviewStatus: 'passed',
          readyForMerge: true,
          mergeStatus: undefined,
          reviewedAtCommit: 'deadbeef00000000000000000000000000000000',
        },
      });
      // resolveProjectFromIssue returns our temp project so the workspace path resolves
      mockResolveProjectFromIssue.mockReturnValue({ projectPath });

      // Simulate exhausted CI retries from a previous merge failure
      ciRetryMap.set(ISSUE_ID, { count: 6, lastAttempt: Date.now() - 5 * 60_000 });
      expect(ciRetryMap.has(ISSUE_ID)).toBe(true);

      // checkPostReviewCommits detects new commits and should clear the CI retry counter
      const resetActions = await checkPostReviewCommits();

      expect(resetActions).toHaveLength(1);
      expect(resetActions[0]).toContain(ISSUE_ID);
      // ciRetryMap must be cleared — the fix under test
      expect(ciRetryMap.has(ISSUE_ID)).toBe(false);
      // mergeRetryCount also reset to 0
      expect(mockSetReviewStatus).toHaveBeenCalledWith(
        ISSUE_ID,
        expect.objectContaining({ mergeRetryCount: 0 }),
      );

      // On the next patrol: checkFailedMergeRetry should now treat this as a fresh start
      // Reset mock to read from the file (mockReturnValue above overrode mockImplementation)
      mockLoadReviewStatuses.mockImplementation(() => {
        if (existsSync(REVIEW_STATUS_FILE)) {
          return JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
        }
        return {};
      });
      // Write a CI-failed status so checkFailedMergeRetry has something to act on
      writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
      const retryActions = await checkFailedMergeRetry();

      expect(retryActions).toHaveLength(1);
      expect(retryActions[0]).toMatch(/CI failure notification/);
      expect(retryActions[0]).toMatch(/attempt 1\/5/); // count starts at 1, not blocked at 6
      expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(1);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('(g) checkPostReviewCommits records Deferred and leaves reviewRetryCount unchanged when spawnReviewRoleForIssue is gated', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'pan-deacon-ci-retry-gated-'));
    const workspacePath = join(projectPath, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    execSync('git init && git commit --allow-empty -m "fix: ci checks"', {
      cwd: workspacePath,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });

    try {
      writeStatusFile({
        [ISSUE_ID]: {
          reviewStatus: 'passed',
          readyForMerge: true,
          mergeStatus: undefined,
          reviewedAtCommit: 'deadbeef00000000000000000000000000000000',
          reviewRetryCount: 0,
        },
      });
      mockResolveProjectFromIssue.mockReturnValue({ projectPath });
      mockSpawnReviewRoleForIssue.mockResolvedValue({
        gated: true,
        success: false,
        message: 'Review deferred: merge conflict with main must be resolved first',
      });
      // After the status reset, checkPostReviewCommits re-reads the status to
      // decide whether to dispatch. Make it see a pending review so the gated
      // path is exercised.
      (mockGetReviewStatusSync as any).mockReturnValue({ reviewStatus: 'pending' });

      const actions = await checkPostReviewCommits();

      expect(actions.length).toBeGreaterThanOrEqual(1);
      const deferredAction = actions.find((a) => a.includes('Deferred post-review re-dispatch'));
      expect(deferredAction).toBeDefined();
      expect(deferredAction).toContain(ISSUE_ID);

      // reviewRetryCount must NOT be incremented on a gated deferral; if it is
      // reset to 0 by the new-commit path, that is acceptable.
      const incrementedCalls = mockSetReviewStatus.mock.calls.filter(
        (call) => call[1] && typeof call[1] === 'object' && (call[1] as any).reviewRetryCount > 0,
      );
      expect(incrementedCalls).toHaveLength(0);

      // A successful dispatch was attempted exactly once
      expect(mockSpawnReviewRoleForIssue).toHaveBeenCalledTimes(1);
      expect(mockSpawnReviewRoleForIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: ISSUE_ID, workspace: workspacePath, force: true }),
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});

// ── Dead-end CI recovery path ────────────────────────────────────────────────

describe('checkDeadEndAgents — dead-end CI recovery path', () => {
  let originalContent: string | null = null;
  let checkDeadEndAgents: () => Promise<string[]>;
  let checkFailedMergeRetry: () => Promise<string[]>;
  let ciRetryMap: Map<string, { count: number; lastAttempt: number }>;
  let tempProjectPath: string;
  let deadEndIssueId: string;
  let issueLower: string;

  beforeEach(async () => {
    vi.resetModules();
    deadEndIssueId = `PAN-714-DEAD-END-TEST-${process.pid}-${Date.now()}`;
    issueLower = deadEndIssueId.toLowerCase();
    mockSetReviewStatus.mockReset();
    mockSessionExists.mockReset().mockReturnValue(false);
    mockSendKeysAsync.mockReset().mockResolvedValue(undefined);
    mockWriteFeedbackFile.mockReset().mockResolvedValue(undefined);
    mockResolveProjectFromIssue.mockReset().mockReturnValue(null);
    // Make agent appear idle so isAgentIdleForNudge returns true and dead-end
    // detection can proceed to the setReviewStatus / ciRetryMap.delete paths.
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    });
    // Default: read the real review-status.json so tests that write to it work
    mockLoadReviewStatuses.mockReset().mockImplementation(() => {
      try {
        const raw = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
        return JSON.parse(raw);
      } catch {
        return {};
      }
    });

    if (existsSync(REVIEW_STATUS_FILE)) {
      originalContent = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    } else {
      originalContent = null;
    }

    const mod = await import('../../../src/lib/cloister/deacon.js');
    checkDeadEndAgents = mod.checkDeadEndAgents;
    checkFailedMergeRetry = mod.checkFailedMergeRetry;
    ciRetryMap = mod.ciRetryMap;
    ciRetryMap.clear();
  });

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(REVIEW_STATUS_FILE, originalContent, 'utf-8');
    } else if (existsSync(REVIEW_STATUS_FILE)) {
      unlinkSync(REVIEW_STATUS_FILE);
    }
    if (tempProjectPath) {
      rmSync(tempProjectPath, { recursive: true, force: true });
    }
  });

  it('clears stale CI feedback file and resets merge status for idle CI-blocked agent', async () => {
    // Create a temp workspace with a stale merge-agent ci-failure feedback file
    tempProjectPath = mkdtempSync(join(tmpdir(), 'pan-dead-end-test-'));
    const feedbackDir = join(
      tempProjectPath, 'workspaces', `feature-${issueLower}`, '.pan', 'feedback',
    );
    mkdirSync(feedbackDir, { recursive: true });
    const staleFeedbackFile = join(feedbackDir, '013-merge-agent-ci-failure.md');
    writeFileSync(staleFeedbackFile, 'CI checks failed', 'utf-8');

    // Write a CI-blocked merge status that is old enough (> 5 min staleness threshold)
    writeStatusFile({
      [deadEndIssueId]: {
        issueId: deadEndIssueId,
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'failed',
        mergeNotes: 'Merge failed: failing required checks',
        readyForMerge: false,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
      },
    });

    // Agent session exists; captured pane output is blank → isAgentActiveInTmux = false (idle)
    mockSessionExists.mockReturnValue(true);
    // resolveProjectFromIssue returns our temp project so the workspace path resolves
    mockResolveProjectFromIssue.mockReturnValue({ projectPath: tempProjectPath });

    const actions = await checkDeadEndAgents();

    // Merge status must be reset to allow re-entry into the merge flow
    expect(mockSetReviewStatus).toHaveBeenCalledOnce();
    const [calledId, update] = mockSetReviewStatus.mock.calls[0];
    expect(calledId).toBe(deadEndIssueId);
    expect(update.mergeStatus).toBe('pending');
    expect(update.readyForMerge).toBe(true);

    // Stale CI feedback file must be deleted so the work agent cannot read it on resume
    expect(existsSync(staleFeedbackFile)).toBe(false);

    // Action entry must be recorded for audit/logging
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Dead-end recovery/);
    expect(actions[0]).toContain(deadEndIssueId);
  });

  it('resets ciRetryMap on dead-end recovery so next CI failure re-enters at attempt 1/5', async () => {
    // Create a workspace so clearStaleCiFeedback has somewhere to look
    tempProjectPath = mkdtempSync(join(tmpdir(), 'pan-dead-end-ci-reset-'));
    mkdirSync(
      join(tempProjectPath, 'workspaces', `feature-${issueLower}`, '.pan', 'feedback'),
      { recursive: true },
    );

    const ciBlockedStatus = {
      issueId: deadEndIssueId,
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'failed',
      mergeNotes: 'Merge failed: failing required checks',
      readyForMerge: false,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    };
    writeStatusFile({ [deadEndIssueId]: ciBlockedStatus });

    mockSessionExists.mockReturnValue(true); // idle agent session
    mockResolveProjectFromIssue.mockReturnValue({ projectPath: tempProjectPath });

    // Seed ciRetryMap past exhaustion (count=6)
    ciRetryMap.set(deadEndIssueId, { count: 6, lastAttempt: Date.now() - 5 * 60_000 });
    expect(ciRetryMap.has(deadEndIssueId)).toBe(true);

    // Dead-end recovery resets merge status and must clear ciRetryMap
    await checkDeadEndAgents();

    expect(ciRetryMap.has(deadEndIssueId)).toBe(false);

    // Now simulate the next CI failure for this issue
    writeStatusFile({ [deadEndIssueId]: ciBlockedStatus });
    const retryActions = await checkFailedMergeRetry();

    // Should re-enter at attempt 1/5, not silently dead-end
    expect(retryActions).toHaveLength(1);
    expect(retryActions[0]).toMatch(/CI failure notification/);
    expect(retryActions[0]).toMatch(/attempt 1\/5/);
    expect(ciRetryMap.get(deadEndIssueId)?.count).toBe(1);
  });
});
