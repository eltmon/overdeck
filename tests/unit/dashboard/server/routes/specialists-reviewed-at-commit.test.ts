/**
 * Regression tests for reviewedAtCommit snapshot behavior (PAN-653).
 *
 * When POST /api/specialists/done receives { specialist: 'review', status: 'passed' },
 * the route resolves the workspace path, reads the current HEAD commit via
 * getWorkspaceGitInfo(), and persists it to reviewedAtCommit via setReviewStatus().
 *
 * These tests exercise two layers:
 *
 *   1. DB persistence — setReviewStatus({ reviewedAtCommit }) round-trips through
 *      SQLite so the field survives a dashboard restart.
 *
 *   2. Deacon detection — checkPostReviewCommits() reads reviewedAtCommit, compares
 *      it to the current workspace HEAD, and resets the review pipeline when HEAD
 *      has moved (i.e. new commits pushed after review passed).
 *
 * The specialists.ts route handler is an Effect HTTP handler requiring a full
 * server stack, so the snapshot logic is covered by testing the two components
 * it depends on (DB write + deacon reader) independently.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../../src/lib/database/schema.js';

// ─── In-memory DB injection ───────────────────────────────────────────────────

let testDb: Database.Database;

vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

// ─── Mock exec for deacon's `git rev-parse HEAD` calls ───────────────────────

const mockExecCallback = vi.fn();
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return {
    ...actual,
    exec: (...args: unknown[]) => {
      // exec(cmd, opts, callback) or exec(cmd, callback)
      const callback = args[args.length - 1] as (err: null, result: { stdout: string; stderr: string }) => void;
      mockExecCallback(...args);
      callback(null, { stdout: mockExecHeadSha + '\n', stderr: '' });
      return {} as ReturnType<typeof actual.exec>;
    },
  };
});

let mockExecHeadSha = 'defaultsha';

// ─── Stub modules that deacon imports ────────────────────────────────────────

const mockResolveProject = vi.fn();
vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProject(...args),
}));

vi.mock('../../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityTts: vi.fn(),
}));

vi.mock('../../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn(),
  sendKeysAsync: vi.fn(),
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

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
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

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockResolvedValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
  transitionIssueToInReview: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(),
}));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

import { existsSync } from 'node:fs';

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
  vi.clearAllMocks();
  (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  mockExecHeadSha = 'defaultsha';
  mockResolveProject.mockReturnValue({ projectPath: '/fake/project' });
});

afterEach(() => {
  testDb.close();
});

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { setReviewStatus, getReviewStatus } from '../../../../../src/lib/review-status.js';
import { getReviewStatusFromDb } from '../../../../../src/lib/database/review-status-db.js';
import { checkPostReviewCommits } from '../../../../../src/lib/cloister/deacon.js';

// ─── 1. DB persistence ───────────────────────────────────────────────────────

describe('reviewedAtCommit DB persistence (specialists/done snapshot layer)', () => {
  it('persists reviewedAtCommit via setReviewStatus and loads it back from SQLite', () => {
    const sha = 'abc1234def5678901234567890123456789012ab';
    setReviewStatus('PAN-RAC1', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewedAtCommit: sha,
    });

    const row = getReviewStatusFromDb('PAN-RAC1');
    expect(row?.reviewedAtCommit).toBe(sha);
  });

  it('reviewedAtCommit survives a subsequent partial update (not clobbered)', () => {
    setReviewStatus('PAN-RAC2', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewedAtCommit: 'sha111',
    });

    // Simulate readyForMerge flip — must not erase reviewedAtCommit
    setReviewStatus('PAN-RAC2', { readyForMerge: true });

    const row = getReviewStatusFromDb('PAN-RAC2');
    expect(row?.reviewedAtCommit).toBe('sha111');
  });

  it('reviewedAtCommit=undefined removes the field from DB', () => {
    setReviewStatus('PAN-RAC3', { reviewStatus: 'passed', reviewedAtCommit: 'sha222' });
    setReviewStatus('PAN-RAC3', { reviewedAtCommit: undefined });

    const row = getReviewStatusFromDb('PAN-RAC3');
    expect(row?.reviewedAtCommit).toBeUndefined();
  });
});

// ─── 2. Deacon post-review commit detection ───────────────────────────────────

describe('checkPostReviewCommits — deacon detects new commits via reviewedAtCommit', () => {
  it('resets review pipeline when HEAD has moved since review passed', async () => {
    setReviewStatus('PAN-900', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'oldsha1',
    });

    mockExecHeadSha = 'newsha99';

    const actions = await checkPostReviewCommits();

    expect(actions.some((a) => a.includes('PAN-900'))).toBe(true);

    const after = getReviewStatus('PAN-900');
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    expect(after?.reviewedAtCommit).toBeUndefined();
  });

  it('does not reset review when HEAD matches reviewedAtCommit', async () => {
    setReviewStatus('PAN-901', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'unchangedsha',
    });

    mockExecHeadSha = 'unchangedsha';

    const actions = await checkPostReviewCommits();

    expect(actions.filter((a) => a.includes('PAN-901'))).toHaveLength(0);

    const after = getReviewStatus('PAN-901');
    expect(after?.reviewStatus).toBe('passed');
    expect(after?.readyForMerge).toBe(true);
  });

  it('skips issues without reviewedAtCommit (not yet reviewed)', async () => {
    setReviewStatus('PAN-902', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      // no reviewedAtCommit
    });

    mockExecHeadSha = 'anysha';

    const actions = await checkPostReviewCommits();

    expect(actions.filter((a) => a.includes('PAN-902'))).toHaveLength(0);
    expect(getReviewStatus('PAN-902')?.reviewStatus).toBe('passed');
  });

  it('skips issues that are already merged', async () => {
    setReviewStatus('PAN-903', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      reviewedAtCommit: 'oldsha',
    });

    mockExecHeadSha = 'newsha';

    const actions = await checkPostReviewCommits();
    expect(actions.filter((a) => a.includes('PAN-903'))).toHaveLength(0);
  });
});
