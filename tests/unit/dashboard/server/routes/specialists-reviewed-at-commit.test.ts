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

// PAN-1938: the production code now reads/writes overdeck.db via
// src/lib/overdeck/review-status-sync.ts. The old in-memory panopticon.db
// injection no longer applies — port the test to the shared overdeck-test-db
// helper so setReviewStatusSync / getReviewStatusFromDbSync round-trip through
// the real overdeck schema.
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb | undefined;

// ─── Mock exec for deacon's `git rev-parse HEAD` calls ───────────────────────

const mockExecCallback = vi.fn();
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return {
    ...actual,
    exec: (...args: unknown[]) => {
      // exec(cmd, opts, callback) or exec(cmd, callback)
      const command = String(args[0]);
      const callback = args[args.length - 1] as (err: null, result: { stdout: string; stderr: string }) => void;
      mockExecCallback(...args);
      const treeMatch = command.match(/^git rev-parse (.+)\^\{tree\}$/);
      const stdout = treeMatch
        ? mockTreeShaByCommit.get(treeMatch[1]!) ?? `${treeMatch[1]}-tree`
        : mockExecHeadSha;
      callback(null, { stdout: `${stdout}\n`, stderr: '' });
      return {} as ReturnType<typeof actual.exec>;
    },
  };
});

let mockExecHeadSha = 'defaultsha';
const mockTreeShaByCommit = new Map<string, string>();

// ─── Stub modules that deacon imports ────────────────────────────────────────

const mockResolveProject = vi.fn();
vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProject(...args),
  resolveProjectFromIssueSync: (...args: unknown[]) => mockResolveProject(...args),
}));

vi.mock('../../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

// checkPostReviewCommits now gates on isIssueClosed (PAN-1613). Its tracker
// fallback shells out to `gh issue view`, which in CI resolves the test's
// `PAN-900` against the real repo (and reads it as closed) — making the patrol
// skip the issue and breaking these commit-detection assertions. Mock the
// module so the gate is deterministic (never closed) and the unit test stays
// isolated from the network, matching the other deacon-patrol tests.
vi.mock('../../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
  isTrackerIssueClosed: vi.fn(async () => false),
  clearIssueClosedCache: vi.fn(),
  TRACKER_CLOSED_CACHE_TTL_MS: 5 * 60 * 1000,
}));

vi.mock('../../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
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
  listPaneValuesAsync: vi.fn(),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn().mockReturnValue(null),
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockResolvedValue([]),
  listRunningAgentsSync: vi.fn().mockResolvedValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  getAgentStateSync: vi.fn().mockReturnValue(null),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
  transitionIssueToInReview: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: vi.fn().mockResolvedValue({ success: true, message: 'spawned' }),
}));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

import { existsSync } from 'node:fs';
import { getRealExistsSync } from './_real-exists-sync.js';

let realExistsSync: (path: string) => boolean = () => false;

beforeEach(async () => {
  realExistsSync = await getRealExistsSync();
  // PAN-1938: re-apply the smart existsSync mock AFTER vi.clearAllMocks so
  // setupOverdeckTestDb's createOverdeckDatabase sees the fresh temp home as
  // empty (it relies on the real fs for overdeck.db paths).
  (existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (typeof path === 'string' && (path.includes('pan-overdeck-test-') || path.endsWith('/overdeck.db'))) {
      return realExistsSync(path);
    }
    return true;
  });
  odb = setupOverdeckTestDb();
  vi.clearAllMocks();
  (existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (typeof path === 'string' && (path.includes('pan-overdeck-test-') || path.endsWith('/overdeck.db'))) {
      return realExistsSync(path);
    }
    return true;
  });
  mockExecHeadSha = 'defaultsha';
  mockTreeShaByCommit.clear();
  mockResolveProject.mockReturnValue({ projectPath: '/fake/project' });
}, 30_000);

afterEach(() => {
  if (odb) teardownOverdeckTestDb(odb);
  odb = undefined;
});

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { setReviewStatusSync, getReviewStatusSync } from '../../../../../src/lib/review-status.js';
import { getReviewStatusFromDbSync } from '../../../../../src/lib/overdeck/review-status-sync.js';
import { checkPostReviewCommits } from '../../../../../src/lib/cloister/deacon.js';

// ─── 1. DB persistence ───────────────────────────────────────────────────────

describe('reviewedAtCommit DB persistence (specialists/done snapshot layer)', () => {
  it('persists reviewedAtCommit via setReviewStatus and loads it back from SQLite', () => {
    const sha = 'abc1234def5678901234567890123456789012ab';
    setReviewStatusSync('PAN-RAC1', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewedAtCommit: sha,
    });

    const row = getReviewStatusFromDbSync('PAN-RAC1');
    expect(row?.reviewedAtCommit).toBe(sha);
  });

  it('reviewedAtCommit survives a subsequent partial update (not clobbered)', () => {
    setReviewStatusSync('PAN-RAC2', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewedAtCommit: 'sha111',
    });

    // Simulate readyForMerge flip — must not erase reviewedAtCommit
    setReviewStatusSync('PAN-RAC2', { readyForMerge: true });

    const row = getReviewStatusFromDbSync('PAN-RAC2');
    expect(row?.reviewedAtCommit).toBe('sha111');
  });

  it('reviewedAtCommit=undefined removes the field from DB', () => {
    setReviewStatusSync('PAN-RAC3', { reviewStatus: 'passed', reviewedAtCommit: 'sha222' });
    setReviewStatusSync('PAN-RAC3', { reviewedAtCommit: undefined });

    const row = getReviewStatusFromDbSync('PAN-RAC3');
    expect(row?.reviewedAtCommit).toBeUndefined();
  });
});

// ─── 2. Deacon post-review commit detection ───────────────────────────────────

describe('checkPostReviewCommits — deacon detects new commits via reviewedAtCommit', () => {
  it('resets review pipeline when HEAD has moved since review passed', async () => {
    setReviewStatusSync('PAN-900', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'oldsha1',
    });

    mockExecHeadSha = 'newsha99';
    mockTreeShaByCommit.set('oldsha1', 'oldtree');
    mockTreeShaByCommit.set('newsha99', 'newtree');

    const actions = await checkPostReviewCommits();

    expect(actions.some((a) => a.includes('PAN-900'))).toBe(true);

    const after = getReviewStatusSync('PAN-900');
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    expect(after?.reviewedAtCommit).toBeUndefined();
  });

  it('preserves review when HEAD changed but the tree did not', async () => {
    setReviewStatusSync('PAN-904', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'oldsha1',
    });

    mockExecHeadSha = 'newsha99';
    mockTreeShaByCommit.set('oldsha1', 'sametree');
    mockTreeShaByCommit.set('newsha99', 'sametree');

    const actions = await checkPostReviewCommits();

    expect(actions.filter((a) => a.includes('PAN-904'))).toHaveLength(0);

    const after = getReviewStatusSync('PAN-904');
    expect(after?.reviewStatus).toBe('passed');
    expect(after?.testStatus).toBe('passed');
    expect(after?.readyForMerge).toBe(true);
    expect(after?.reviewedAtCommit).toBe('newsha99');
  });

  it('does not reset review when HEAD matches reviewedAtCommit', async () => {
    setReviewStatusSync('PAN-901', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'unchangedsha',
    });

    mockExecHeadSha = 'unchangedsha';

    const actions = await checkPostReviewCommits();

    expect(actions.filter((a) => a.includes('PAN-901'))).toHaveLength(0);

    const after = getReviewStatusSync('PAN-901');
    expect(after?.reviewStatus).toBe('passed');
    expect(after?.readyForMerge).toBe(true);
  });

  it('skips issues without reviewedAtCommit (not yet reviewed)', async () => {
    setReviewStatusSync('PAN-902', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      // no reviewedAtCommit
    });

    mockExecHeadSha = 'anysha';

    const actions = await checkPostReviewCommits();

    expect(actions.filter((a) => a.includes('PAN-902'))).toHaveLength(0);
    expect(getReviewStatusSync('PAN-902')?.reviewStatus).toBe('passed');
  });

  it('skips issues that are already merged', async () => {
    setReviewStatusSync('PAN-903', {
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
