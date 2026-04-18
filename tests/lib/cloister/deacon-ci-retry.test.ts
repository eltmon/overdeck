/**
 * Tests for checkFailedMergeRetry — CI failure notification state machine.
 * Tests for checkPostReviewCommits — ciRetryMap.delete on new-commit detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { execSync } from 'child_process';

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

const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');
const ISSUE_ID = 'PAN-714-CI-TEST';
const CI_FAILED_STATUS = {
  issueId: ISSUE_ID,
  reviewStatus: 'passed',
  testStatus: 'passed',
  mergeStatus: 'failed',
  mergeNotes: 'Merge failed: failing required checks',
  readyForMerge: false,
  mergeRetryCount: 0,
  updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
};

function writeStatusFile(statuses: Record<string, unknown>): void {
  mkdirSync(join(homedir(), '.panopticon'), { recursive: true });
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
}

describe('checkFailedMergeRetry — CI transient retry state machine', () => {
  let originalContent: string | null = null;
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

    if (existsSync(REVIEW_STATUS_FILE)) {
      originalContent = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    } else {
      originalContent = null;
    }

    const mod = await import('../../../src/lib/cloister/deacon.js');
    checkFailedMergeRetry = mod.checkFailedMergeRetry;
    checkPostReviewCommits = mod.checkPostReviewCommits;
    ciRetryMap = mod.ciRetryMap;
    ciRetryMap.clear();
  });

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(REVIEW_STATUS_FILE, originalContent, 'utf-8');
    } else if (existsSync(REVIEW_STATUS_FILE)) {
      unlinkSync(REVIEW_STATUS_FILE);
    }
  });

  it('notifies agent to re-submit when cooldown has passed', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/CI failure notification/);
    expect(actions[0]).toContain(ISSUE_ID);
    expect(actions[0]).toMatch(/attempt 1\/5/);
    expect(mockWriteFeedbackFile).toHaveBeenCalledOnce();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
    expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(1);
  });

  it('respects 2-minute cooldown', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    ciRetryMap.set(ISSUE_ID, { count: 1, lastAttempt: Date.now() - 60_000 });

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('writes feedback and notifies agent exactly once at exhaustion', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    ciRetryMap.set(ISSUE_ID, { count: 5, lastAttempt: Date.now() - 5 * 60 * 1000 });
    mockSessionExists.mockReturnValue(true);

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/CI retry exhausted/);
    expect(mockWriteFeedbackFile).toHaveBeenCalledOnce();
    expect(mockSendKeysAsync).toHaveBeenCalledOnce();
    expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(6);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('does nothing after exhaustion has already been reported', async () => {
    writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
    ciRetryMap.set(ISSUE_ID, { count: 6, lastAttempt: Date.now() - 5 * 60 * 1000 });

    const actions = await checkFailedMergeRetry();

    expect(actions).toHaveLength(0);
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('clears ciRetryMap on new commits', async () => {
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
      mockLoadReviewStatuses.mockReturnValue({
        [ISSUE_ID]: {
          reviewStatus: 'passed',
          readyForMerge: true,
          mergeStatus: undefined,
          reviewedAtCommit: 'deadbeef00000000000000000000000000000000',
        },
      });
      mockResolveProjectFromIssue.mockReturnValue({ projectPath });
      ciRetryMap.set(ISSUE_ID, { count: 6, lastAttempt: Date.now() - 5 * 60 * 1000 });

      const resetActions = await checkPostReviewCommits();

      expect(resetActions).toHaveLength(1);
      expect(ciRetryMap.has(ISSUE_ID)).toBe(false);
      expect(mockSetReviewStatus).toHaveBeenCalledWith(
        ISSUE_ID,
        expect.objectContaining({ mergeRetryCount: 0 }),
      );

      writeStatusFile({ [ISSUE_ID]: CI_FAILED_STATUS });
      const retryActions = await checkFailedMergeRetry();

      expect(retryActions).toHaveLength(1);
      expect(retryActions[0]).toMatch(/attempt 1\/5/);
      expect(ciRetryMap.get(ISSUE_ID)?.count).toBe(1);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
