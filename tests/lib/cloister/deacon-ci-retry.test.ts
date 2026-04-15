/**
 * Tests for checkFailedMergeRetry — CI transient retry state machine.
 * Tests for checkPostReviewCommits — ciRetryMap.delete on new-commit detection.
 *
 * Covers:
 *  - CI transient retry attempts merge (sets readyForMerge=true)
 *  - Respects 2-minute cooldown between retries
 *  - Exhausts at count=5, writes feedback + notifies agent exactly once
 *  - count>5 (post-exhaustion): just logs, no duplicate feedback
 *  - checkPostReviewCommits clears ciRetryMap when new commits arrive, enabling
 *    subsequent transient retries from checkFailedMergeRetry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { execSync } from 'child_process';

// ── Module-level mocks ──────────────────────────────────────────────────────

const mockSetReviewStatus = vi.fn();
const mockLoadReviewStatuses = vi.fn();
const mockSessionExists = vi.fn();
const mockSendKeysAsync = vi.fn();
const mockWriteFeedbackFile = vi.fn();
const mockResolveProjectFromIssue = vi.fn();

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: (...args: unknown[]) => mockSetReviewStatus(...args),
  loadReviewStatuses: (...args: unknown[]) => mockLoadReviewStatuses(...args),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
  sendKeysAsync: (...args: unknown[]) => mockSendKeysAsync(...args),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  buildTmuxCommandString: vi.fn(),
  capturePaneAsync: vi.fn(),
  createSessionAsync: vi.fn(),
  killSession: vi.fn(),
  killSessionAsync: vi.fn(),
  listPaneValues: vi.fn(),
  listPaneValuesAsync: vi.fn(),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: (...args: unknown[]) => mockWriteFeedbackFile(...args),
}));

// Stub out heavy transitive dependencies that deacon imports at module level
// Note: submitToSpecialistQueue, checkSpecialistQueue, getNextSpecialistTask,
// and completeSpecialistTask were removed from specialists.ts in PAN-722.
vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  clearSessionId: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  wakeSpecialistWithTask: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockResolvedValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  saveAgentState: vi.fn(),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  findProjectByPath: vi.fn().mockReturnValue(null),
}));

// ── Test constants ──────────────────────────────────────────────────────────

const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');
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
  mkdirSync(join(homedir(), '.panopticon'), { recursive: true });
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('checkFailedMergeRetry — CI transient retry state machine', () => {
  let originalContent: string | null = null;

  // Import after mocks are registered — we also need the ciRetryMap export
  let checkFailedMergeRetry: () => Promise<string[]>;
  let checkPostReviewCommits: () => Promise<string[]>;
  let ciRetryMap: Map<string, { count: number; lastAttempt: number }>;

  beforeEach(async () => {
    vi.resetModules();
    mockSetReviewStatus.mockReset();
    mockLoadReviewStatuses.mockReset().mockReturnValue({});
    mockSessionExists.mockReset().mockReturnValue(false);
    mockSendKeysAsync.mockReset().mockResolvedValue(undefined);
    mockWriteFeedbackFile.mockReset().mockResolvedValue(undefined);
    mockResolveProjectFromIssue.mockReset().mockReturnValue(null);

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
  });

  afterEach(() => {
    // Restore original review-status.json
    if (originalContent !== null) {
      writeFileSync(REVIEW_STATUS_FILE, originalContent, 'utf-8');
    } else if (existsSync(REVIEW_STATUS_FILE)) {
      unlinkSync(REVIEW_STATUS_FILE);
    }
  });

  it('(a) CI transient retry: sets readyForMerge=true when cooldown has passed', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    // ciRetryMap is empty → count=0, lastAttempt=0 → cooldown of 0ms has "passed"

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/CI transient retry/);
    expect(actions[0]).toContain(ISSUE_ID);
    expect(actions[0]).toMatch(/attempt 1\/5/);

    expect(mockSetReviewStatus).toHaveBeenCalledOnce();
    const [calledIssueId, update] = mockSetReviewStatus.mock.calls[0];
    expect(calledIssueId).toBe(ISSUE_ID);
    expect(update.mergeStatus).toBe('pending');
    expect(update.readyForMerge).toBe(true);
    expect(update.mergeRetryCount).toBe(0); // must not touch main counter

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
      // loadReviewStatuses returns an issue that has passed review at an OLD commit
      // (different from the current HEAD → triggers the reset path)
      mockLoadReviewStatuses.mockReturnValue({
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
      // Write a CI-failed status so checkFailedMergeRetry has something to act on
      writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
      const retryActions = await checkFailedMergeRetry();

      expect(retryActions).toHaveLength(1);
      expect(retryActions[0]).toMatch(/CI transient retry/);
      expect(retryActions[0]).toMatch(/attempt 1\/5/); // count starts at 1, not blocked at 6
      expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(1);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
