import { Effect } from 'effect';
/**
 * Deacon safety-net: re-dispatch ship when review+test passed but the reactive
 * shipping trigger was swallowed (e.g. by a stale/zombie ship session).
 *
 * The only thing that normally dispatches ship is the reactive scheduler's
 * onIssueStateChange('shipping') event. If that event is lost, the issue jams
 * forever — review/test green, readyForMerge false, Merge button never lights.
 * checkUndispatchedShip() is the backstop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/agents.js', () => ({
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  saveSessionId: vi.fn(),
}));

vi.mock('../../../lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatusSync: vi.fn(() => undefined),
  getReviewStatus: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../../lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => {
      if (value && typeof value === 'object' && 'pipe' in value) return value;
      return Effect.succeed(value);
    };
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    const originalMockImplementation = fn.mockImplementation.bind(fn);
    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => originalMockImplementation((...args: unknown[]) => {
      const result = impl(...args);
      if (result && typeof result === 'object' && 'pipe' in result) return result;
      return Effect.promise(() => Promise.resolve(result));
    });
    return fn;
  };
  return {
  buildTmuxCommandString: vi.fn(() => 'tmux'),
  capturePane: effectMock(''),
  createSession: effectMock(undefined),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSession: effectMock(undefined),
  listPaneValues: vi.fn(() => []),
  listPaneValues: effectMock([]),
  listSessionNames: effectMock([]),
  sessionExists: vi.fn(() => false),
  sessionExistsSync: vi.fn(() => false),
  sessionExists: effectMock(false),
  sendKeysProgram: effectMock(undefined),
  };
});

vi.mock('../specialists.js', () => ({
  getTmuxSessionName: vi.fn((t: string) => `specialist-${t}`),
  isRunning: vi.fn(async () => false),
  checkSpecialistQueue: vi.fn(() => ({ hasWork: false, items: [] })),
  completeSpecialistTask: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn(() => []),
}));

vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({})),
  loadCloisterConfigSync: vi.fn(() => ({})),
}));

vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/test-panopticon',
  AGENTS_DIR: '/tmp/test-agents',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false, mtimeMs: 0 })),
    rmSync: vi.fn(),
  };
});

// The patrol re-triggers the shipping lifecycle via a dynamic import of
// service.js — stub onIssueStateChange so the test asserts the dispatch
// without spinning up the real scheduler.
vi.mock('../service.js', () => ({
  onIssueStateChange: vi.fn(() => Effect.succeed(undefined)),
}));

import { checkUndispatchedShip } from '../deacon.js';
import { loadReviewStatuses } from '../../../lib/review-status.js';
import { onIssueStateChange } from '../service.js';

const mockLoadReviewStatuses = vi.mocked(loadReviewStatuses);
const mockOnIssueStateChange = vi.mocked(onIssueStateChange);

// A status updated long enough ago to clear the 2-min staleness guard.
const STALE_TS = new Date(Date.now() - 10 * 60 * 1000).toISOString();

describe('checkUndispatchedShip — undispatched-ship safety-net', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-dispatches ship when review+test passed but readyForMerge is false', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-977': {
        issueId: 'PAN-977',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        mergeStatus: 'pending',
        updatedAt: STALE_TS,
      },
    } as unknown as ReturnType<typeof loadReviewStatuses>);

    const actions = await checkUndispatchedShip();

    expect(mockOnIssueStateChange).toHaveBeenCalledWith('PAN-977', 'shipping');
    expect(actions).toHaveLength(1);
  });

  it('leaves an issue alone once it has reached readyForMerge', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-977': {
        issueId: 'PAN-977',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: true,
        mergeStatus: 'pending',
        updatedAt: STALE_TS,
      },
    } as unknown as ReturnType<typeof loadReviewStatuses>);

    const actions = await checkUndispatchedShip();

    expect(mockOnIssueStateChange).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('does not race the primary trigger — skips a status changed within the staleness window', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-977': {
        issueId: 'PAN-977',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        mergeStatus: 'pending',
        updatedAt: new Date().toISOString(),
      },
    } as unknown as ReturnType<typeof loadReviewStatuses>);

    const actions = await checkUndispatchedShip();

    expect(mockOnIssueStateChange).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips merging/merged/failed issues — those paths are owned elsewhere', async () => {
    for (const mergeStatus of ['merging', 'merged', 'failed'] as const) {
      vi.clearAllMocks();
      mockLoadReviewStatuses.mockReturnValue({
        'PAN-977': {
          issueId: 'PAN-977',
          reviewStatus: 'passed',
          testStatus: 'passed',
          readyForMerge: false,
          mergeStatus,
          updatedAt: STALE_TS,
        },
      } as unknown as ReturnType<typeof loadReviewStatuses>);

      const actions = await checkUndispatchedShip();
      expect(mockOnIssueStateChange).not.toHaveBeenCalled();
      expect(actions).toHaveLength(0);
    }
  });

  it('applies a per-issue cooldown so a ship run in flight is not re-poked every tick', async () => {
    // Distinct issueId — the module-level cooldown map persists across tests in
    // this file, so the first test's PAN-977 entry would mask this assertion.
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-888': {
        issueId: 'PAN-888',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        mergeStatus: 'pending',
        updatedAt: STALE_TS,
      },
    } as unknown as ReturnType<typeof loadReviewStatuses>);

    await checkUndispatchedShip();
    expect(mockOnIssueStateChange).toHaveBeenCalledTimes(1);

    // Immediate second patrol tick — cooldown must suppress the re-dispatch.
    await checkUndispatchedShip();
    expect(mockOnIssueStateChange).toHaveBeenCalledTimes(1);
  });
});
