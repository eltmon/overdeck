/**
 * Deacon safety-net (PAN-1178): detect swarm slot PRs that merged into their
 * parent feature branch but whose `/api/swarm/slot-merged` loopback never fired.
 *
 * Slot branches merge into `feature/<parent>`, not into main, so neither the
 * stale-merge reconciler (scans for merges into main) nor the main-PR patrol
 * sees them. Without `detectMergedSwarmSlots`, `postMergeLifecycle` is never
 * called for the slot branch and the swarm's auto-advance stalls forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
const readdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: readdirSyncMock,
    statSync: vi.fn(() => ({ isDirectory: () => false, mtimeMs: 0 })),
    rmSync: vi.fn(),
  };
});

// ── Deacon import-safety mocks ──────────────────────────────────────────────
vi.mock('../../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../paths.js')>();
  return { ...actual, PANOPTICON_HOME: '/tmp/test-panopticon', AGENTS_DIR: '/tmp/test-agents' };
});

vi.mock('../../agents.js', async () => {
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
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  getAgentStateProgram: effectMock(null),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  saveAgentStateProgram: effectMock(undefined),
  saveSessionId: vi.fn(),
  resumeAgent: vi.fn(),
  recordAgentFailureProgram: effectMock(null),
  };
});

vi.mock('../../review-status.js', () => ({
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatusSync: vi.fn(() => undefined),
  getReviewStatus: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../tmux.js', async () => {
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
  isPaneDead: effectMock(false),
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
  getAllProjectSpecialistStatuses: vi.fn(() => []),
}));

vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({})),
  loadCloisterConfigSync: vi.fn(() => ({})),
}));

// ── Patrol-specific mocks ───────────────────────────────────────────────────
vi.mock('../../projects.js', () => ({
  listProjects: vi.fn(() => [{ config: { path: '/tmp/proj' } }]),
  listProjectsSync: vi.fn(() => [{ config: { path: '/tmp/proj' } }]),
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/proj' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/proj' })),
  getProject: vi.fn(),
}));

const postMergeLifecycleMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../merge-agent.js', async (importOriginal) => {
  // Keep the real `parseSlotBranch` (a pure regex) — only stub the loopback.
  const actual = await importOriginal<typeof import('../merge-agent.js')>();
  return { ...actual, postMergeLifecycle: postMergeLifecycleMock };
});

const resolveGitHubIssueMock = vi.hoisted(() => vi.fn(() => ({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli' })));
vi.mock('../../tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tracker-utils.js')>();
  return { ...actual, resolveGitHubIssue: resolveGitHubIssueMock, resolveGitHubIssueSync: resolveGitHubIssueMock };
});

const readContinueStateProgramMock = vi.hoisted(() => vi.fn());
vi.mock('../../vbrief/continue-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vbrief/continue-state.js')>();
  const { Effect } = await import('effect');
  return {
    ...actual,
    readContinueState: (...args: unknown[]) => Effect.promise(() => readContinueStateProgramMock(...args)),
    readContinueStateProgram: (...args: unknown[]) => Effect.promise(() => readContinueStateProgramMock(...args)),
  };
});

import { detectMergedSwarmSlots } from '../deacon.js';

/** Make `readdirSync` report the given workspace directory names. */
function setWorkspaceDirs(names: string[]): void {
  readdirSyncMock.mockReturnValue(
    names.map(name => ({ name, isDirectory: () => true })),
  );
}

/** Make the mocked `gh pr list` return the given merged PRs as JSON stdout. */
function setMergedPrs(prs: Array<{ number: number; headRefName: string; mergedAt: string | null; url: string }>): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, out: { stdout: string; stderr: string }) => void;
    cb(null, { stdout: JSON.stringify(prs), stderr: '' });
  });
}

function runningSlot(slotId: number) {
  return {
    slotId,
    itemId: `item-${slotId}`,
    itemTitle: `Item ${slotId}`,
    sessionName: `agent-pan-1148-slot-${slotId}`,
    workspace: `/tmp/proj/workspaces/feature-pan-1148-slot-${slotId}`,
    status: 'running' as const,
  };
}

describe('detectMergedSwarmSlots — swarm slot-merge safety-net', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMergeLifecycleMock.mockResolvedValue(undefined);
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli' });
  });

  it('fires postMergeLifecycle for each running slot whose PR has merged', async () => {
    setWorkspaceDirs(['feature-pan-1148']);
    readContinueStateProgramMock.mockResolvedValue({
      swarmRuntime: { slots: [runningSlot(1), runningSlot(2)] },
    });
    setMergedPrs([
      { number: 1177, headRefName: 'feature/pan-1148-slot-1', mergedAt: '2026-05-18T10:00:00Z', url: 'u1' },
      { number: 1176, headRefName: 'feature/pan-1148-slot-2', mergedAt: '2026-05-18T10:05:00Z', url: 'u2' },
    ]);

    const actions = await detectMergedSwarmSlots();

    expect(postMergeLifecycleMock).toHaveBeenCalledTimes(2);
    expect(postMergeLifecycleMock).toHaveBeenCalledWith(
      'PAN-1148', '/tmp/proj', 'feature/pan-1148-slot-1', { skipDeploy: true },
    );
    expect(postMergeLifecycleMock).toHaveBeenCalledWith(
      'PAN-1148', '/tmp/proj', 'feature/pan-1148-slot-2', { skipDeploy: true },
    );
    expect(actions).toHaveLength(2);
  });

  it('does not fire when a running slot has no merged PR', async () => {
    setWorkspaceDirs(['feature-pan-1300']);
    readContinueStateProgramMock.mockResolvedValue({
      swarmRuntime: { slots: [runningSlot(1)] },
    });
    setMergedPrs([]); // gh reports nothing merged into the feature branch

    const actions = await detectMergedSwarmSlots();

    expect(postMergeLifecycleMock).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips workspaces with no swarm runtime — never queries GitHub', async () => {
    setWorkspaceDirs(['feature-pan-1301']);
    readContinueStateProgramMock.mockResolvedValue({ version: '1', issueId: 'PAN-1301' });

    const actions = await detectMergedSwarmSlots();

    expect(execFileMock).not.toHaveBeenCalled();
    expect(postMergeLifecycleMock).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('ignores already-terminal slots — only running slots can have a lost callback', async () => {
    setWorkspaceDirs(['feature-pan-1302']);
    readContinueStateProgramMock.mockResolvedValue({
      swarmRuntime: { slots: [{ ...runningSlot(1), status: 'merged' }, { ...runningSlot(2), status: 'pending' }] },
    });

    const actions = await detectMergedSwarmSlots();

    expect(execFileMock).not.toHaveBeenCalled();
    expect(postMergeLifecycleMock).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips slot sub-workspaces — they are not swarm parents', async () => {
    setWorkspaceDirs(['feature-pan-1303-slot-1', 'feature-pan-1303-slot-2']);

    const actions = await detectMergedSwarmSlots();

    expect(readContinueStateProgramMock).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('applies a per-branch cooldown so an in-flight loopback is not re-fired every tick', async () => {
    // Distinct issue id — the cooldown map is module-level and persists across
    // tests in this file.
    setWorkspaceDirs(['feature-pan-2000']);
    readContinueStateProgramMock.mockResolvedValue({
      swarmRuntime: { slots: [{ ...runningSlot(1), sessionName: 'agent-pan-2000-slot-1' }] },
    });
    setMergedPrs([
      { number: 2001, headRefName: 'feature/pan-2000-slot-1', mergedAt: '2026-05-18T10:00:00Z', url: 'u1' },
    ]);

    await detectMergedSwarmSlots();
    expect(postMergeLifecycleMock).toHaveBeenCalledTimes(1);

    // Immediate second patrol tick — the slot is still 'running' in the mocked
    // runtime, but the cooldown must suppress a duplicate loopback.
    await detectMergedSwarmSlots();
    expect(postMergeLifecycleMock).toHaveBeenCalledTimes(1);
  });
});
