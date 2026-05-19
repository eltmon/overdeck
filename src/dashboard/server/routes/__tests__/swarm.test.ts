import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VBriefDocument } from '../../../../lib/vbrief/types.js';
import * as agentsRoute from '../agents.js';
import * as systemHealthService from '../../services/system-health-service.js';
import * as projects from '../../../../lib/projects.js';
import * as vbriefIo from '../../../../lib/vbrief/io.js';
import * as agents from '../../../../lib/agents.js';
import * as tmux from '../../../../lib/tmux.js';
import * as trackerUtils from '../../../../lib/tracker-utils.js';
import * as activityLogger from '../../../../lib/activity-logger.js';

const ghExecFileMock = vi.hoisted(() => vi.fn());

vi.mock('../agents.js', () => ({
  evaluateSpawnGuardrails: vi.fn(),
}));

vi.mock('../../services/system-health-service.js', () => ({
  getSystemHealthSnapshot: vi.fn(),
  getResourceConfig: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(),
  // PAN-977: pollSwarmAutoAdvance enumerates active swarms via listProjects;
  // the tests stub it to an empty list and rely on the legacy sidecar fallback.
  listProjects: vi.fn(() => []),
}));

vi.mock('../../../../lib/tracker-utils.js', () => ({
  resolveGitHubIssue: vi.fn(),
}));

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

// PAN-977: createSlotWorktree shells out to `git fetch`/`git worktree add`. The
// test temp directories are not git repos, so stub child_process.execFile to
// resolve successfully — the alternative (running real git) was never the
// behavior under test.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: ((...args: any[]) => {
      const commandArgs = Array.isArray(args[1]) ? args[1] : [];
      const cb = args[args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string }) => void;
      if (args[0] === 'gh') {
        if (ghExecFileMock.getMockImplementation()) {
          return ghExecFileMock(...args);
        }
        if (typeof cb === 'function') {
          cb(null, { stdout: '[]', stderr: '' });
        }
        return undefined;
      }
      let stdout = '';
      if (args[0] === 'git' && commandArgs[0] === 'branch' && commandArgs[1] === '--show-current') {
        stdout = 'feature/971\n';
      } else if (args[0] === 'git' && commandArgs[0] === 'branch' && commandArgs[1] === '--list') {
        stdout = 'feature/971\n';
      } else if (args[0] === 'git' && commandArgs[0] === 'branch' && commandArgs[1] === '-r') {
        stdout = 'origin/feature/971\n';
      }
      if (typeof cb === 'function') {
        cb(null, { stdout, stderr: '' });
      }
      return undefined;
    }) as any,
  };
});

vi.mock('../../../../lib/vbrief/io.js', () => ({
  findPlan: vi.fn(),
  findPlanAsync: vi.fn(),
  readWorkspacePlan: vi.fn(),
  readPlanAsync: vi.fn(),
  applyStatusOverrides: vi.fn((doc: any) => doc),
  VBriefMergeConflictError: class VBriefMergeConflictError extends Error {},
}));

vi.mock('../../../../lib/agents.js', () => ({
  spawnAgent: vi.fn(),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionNamesAsync: vi.fn(),
  isPaneDeadAsync: vi.fn(),
  killSessionAsync: vi.fn(),
  listPaneValuesAsync: vi.fn(),
}));

const PLAN_DOC: VBriefDocument = {
  vBRIEFInfo: {
    version: '0.5',
    created: '2026-05-07T00:00:00Z',
    updated: '2026-05-07T00:00:00Z',
    author: 'panopticon-cli/test',
  },
  plan: {
    id: 'PAN-971',
    title: 'Swarm dispatch',
    status: 'approved',
    items: [
      {
        id: 'wave-0-item',
        title: 'Prepare slot input',
        status: 'pending',
        subItems: [
          {
            id: 'ac-0',
            title: 'Keep plain-language slot guardrails',
            status: 'pending',
            metadata: { kind: 'acceptance_criterion' },
          },
        ],
      },
      {
        id: 'wave-1-item',
        title: 'Dispatch next wave',
        status: 'pending',
        subItems: [
          {
            id: 'ac-1',
            title: 'Emit AgentTaskInput JSON block',
            status: 'pending',
            metadata: { kind: 'acceptance_criterion' },
          },
          {
            id: 'ac-2',
            title: 'Target parent feature branch instead of main',
            status: 'pending',
            metadata: { kind: 'acceptance_criterion' },
          },
        ],
      },
    ],
    edges: [
      { from: 'wave-0-item', to: 'wave-1-item', type: 'blocks' },
    ],
  },
};

describe('swarm route helpers', () => {
  let testHome: string;
  let projectPath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    ghExecFileMock.mockReset();
    vi.useFakeTimers();

    testHome = mkdtempSync(join(tmpdir(), 'pan-971-swarm-test-'));
    projectPath = join(testHome, 'repo');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan'), { recursive: true });
    writeFileSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'), JSON.stringify(PLAN_DOC, null, 2));
    mkdirSync(join(testHome, '.panopticon', 'swarms'), { recursive: true });

    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';

    vi.mocked(projects.resolveProjectFromIssue).mockReturnValue({
      projectPath,
      repo: 'owner/repo',
      key: 'panopticon',
      tracker: 'github',
    } as any);
    vi.mocked(trackerUtils.resolveGitHubIssue).mockReturnValue({
      isGitHub: true,
      owner: 'owner',
      repo: 'repo',
      prefix: 'PAN',
      number: 971,
    });
    vi.mocked(vbriefIo.readWorkspacePlan).mockReturnValue(PLAN_DOC);
    vi.mocked(vbriefIo.readPlanAsync).mockResolvedValue(PLAN_DOC);
    vi.mocked(vbriefIo.findPlan).mockReturnValue(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'));
    vi.mocked(vbriefIo.findPlanAsync).mockResolvedValue(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'));
    vi.mocked(systemHealthService.getSystemHealthSnapshot).mockResolvedValue({
      summary: { workAgentCount: 0 },
    } as any);
    vi.mocked(systemHealthService.getResourceConfig).mockReturnValue({
      agentBlockCount: 4,
    } as any);
    vi.mocked(agentsRoute.evaluateSpawnGuardrails).mockReturnValue({
      blocked: false,
    } as any);
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(false);
    vi.mocked(tmux.killSessionAsync).mockResolvedValue(undefined);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);
    vi.mocked(agents.spawnAgent).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    delete process.env.PANOPTICON_INTERNAL_TOKEN;
    rmSync(testHome, { recursive: true, force: true });
  });

  function mockGhPrList(prs: unknown[]): void {
    ghExecFileMock.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string }) => void;
      cb(null, { stdout: JSON.stringify(prs), stderr: '' });
      return undefined;
    });
  }

  function baseSwarmState(overrides: Record<string, unknown> = {}) {
    return {
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'completed' as const,
          phase: 'implementation' as const,
          startedAt: '2026-05-07T00:00:00Z',
          completedAt: '2026-05-07T00:05:00Z',
          ...overrides,
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    };
  }

  // PAN-977 review-round-18 regression: `continueDirForWorkspace` must return
  // the workspace root, not `${workspacePath}/.pan`. Internally
  // `writeContinueStateAsync` appends `.pan/continues/` via getContinuesDir, so
  // a `.pan/`-suffixed argument produced `${workspace}/.pan/.pan/continues/`
  // that `work-agent-prompt.ts:99` (which reads from the correct path) could
  // never see — silently dropping synthesisOutputs delivery for every
  // convergence-item work agent after its initial spawn.
  it('persists swarm runtime to the canonical .pan/continues/ path (not the double-.pan bug)', async () => {
    const { existsSync } = await import('node:fs');
    const cont = await import('../../../../lib/vbrief/continue-state.js');
    const { __testInternals } = await import('../swarm.js');

    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    const runtimeState = {
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 1,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'First',
          sessionName: 'agent-pan-971-1',
          workspace: join(featureWorkspace, 'slot-1'),
          status: 'running' as const,
          phase: 'implementation' as const,
          startedAt: '2026-05-12T00:00:00Z',
        },
      ],
      createdAt: '2026-05-12T00:00:00Z',
      updatedAt: '2026-05-12T00:00:00Z',
    };
    await __testInternals.persistSwarmRuntime(featureWorkspace, runtimeState as any);

    // Canonical path — what work-agent-prompt.ts:99 reads.
    expect(existsSync(join(featureWorkspace, '.pan', 'continues', 'pan-971.vbrief.json'))).toBe(true);
    // The double-.pan path must NEVER be created.
    expect(existsSync(join(featureWorkspace, '.pan', '.pan', 'continues', 'pan-971.vbrief.json'))).toBe(false);

    // Round-trip via the public reader using the workspace-root argument.
    const persisted = await cont.readContinueStateAsync(featureWorkspace, 'PAN-971');
    expect(persisted).not.toBeNull();
    expect(persisted?.swarmRuntime?.slots?.[0]?.itemId).toBe('wave-0-item');
  });

  it('round-trips failed-merge slot state through the canonical swarm runtime', async () => {
    const cont = await import('../../../../lib/vbrief/continue-state.js');
    const { __testInternals } = await import('../swarm.js');
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    const runtimeState = {
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 1,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'First',
          sessionName: 'agent-pan-971-1',
          workspace: join(featureWorkspace, 'slot-1'),
          status: 'failed-merge' as const,
          phase: 'implementation' as const,
          failureReason: 'PR #1188 is conflicting',
          consecutiveConflictCount: 2,
          prUrl: 'https://github.com/owner/repo/pull/1188',
          startedAt: '2026-05-12T00:00:00Z',
          completedAt: '2026-05-12T00:05:00Z',
        },
        {
          slot: 2,
          itemId: 'wave-1-item',
          itemTitle: 'Second',
          sessionName: 'agent-pan-971-2',
          workspace: join(featureWorkspace, 'slot-2'),
          status: 'running' as const,
          phase: 'implementation' as const,
          startedAt: '2026-05-12T00:01:00Z',
        },
      ],
      createdAt: '2026-05-12T00:00:00Z',
      updatedAt: '2026-05-12T00:05:00Z',
    };

    await __testInternals.persistSwarmRuntime(featureWorkspace, runtimeState as any);

    const persisted = (await cont.readContinueStateAsync(featureWorkspace, 'PAN-971'))!.swarmRuntime!;
    expect(persisted.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 is conflicting',
      consecutiveConflictCount: 2,
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
    expect('consecutiveConflictCount' in persisted.slots[1]!).toBe(false);
    expect('prUrl' in persisted.slots[1]!).toBe(false);

    const loaded = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(loaded.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 is conflicting',
      consecutiveConflictCount: 2,
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
    expect('consecutiveConflictCount' in loaded.slots[1]!).toBe(false);
    expect('prUrl' in loaded.slots[1]!).toBe(false);
  });

  it('skips mergeability refresh for completed synthesis slots', async () => {
    mockGhPrList([{ number: 1 }]);
    const { __testInternals } = await import('../swarm.js');

    const refreshed = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState({ phase: 'synthesis' }) as any, projectPath);

    expect(refreshed.changed).toBe(false);
    expect(ghExecFileMock).not.toHaveBeenCalled();
  });

  it('treats legacy slots without phase as implementation slots for mergeability refresh', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const { __testInternals } = await import('../swarm.js');
    const state = baseSwarmState();
    delete (state.slots[0] as any).phase;

    const refreshed = await __testInternals.refreshSwarmSlotMergeability(state as any, projectPath);

    expect(refreshed.changed).toBe(true);
    expect(refreshed.state.slots[0]).toMatchObject({
      status: 'completed',
      consecutiveConflictCount: 1,
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
  });

  it('skips mergeability refresh for non-GitHub projects', async () => {
    vi.mocked(trackerUtils.resolveGitHubIssue).mockReturnValue({ isGitHub: false });
    mockGhPrList([{ number: 1 }]);
    const { __testInternals } = await import('../swarm.js');

    const refreshed = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState() as any, projectPath);

    expect(refreshed.changed).toBe(false);
    expect(ghExecFileMock).not.toHaveBeenCalled();
  });

  it('debounces conflicting PRs before marking a slot failed-merge', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const { __testInternals } = await import('../swarm.js');

    const first = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState() as any, projectPath);
    expect(first.changed).toBe(true);
    expect(first.state.slots[0]).toMatchObject({
      status: 'completed',
      consecutiveConflictCount: 1,
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });

    const second = await __testInternals.refreshSwarmSlotMergeability(first.state as any, projectPath);
    expect(second.changed).toBe(true);
    expect(second.state.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 not mergeable: CONFLICTING',
      consecutiveConflictCount: 2,
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
  });

  it('marks a completed slot failed-merge when no PR is found but leaves running slots alone', async () => {
    mockGhPrList([]);
    const { __testInternals } = await import('../swarm.js');

    const completed = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState() as any, projectPath);
    expect(completed.changed).toBe(true);
    expect(completed.state.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'No open PR found for feature/pan-971-slot-1',
    });

    const running = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState({ status: 'running' }) as any, projectPath);
    expect(running.changed).toBe(false);
    expect(running.state.slots[0]?.status).toBe('running');
  });

  it('marks a closed unmerged PR as failed-merge', async () => {
    mockGhPrList([{ number: 1188, mergeable: null, mergeableState: null, state: 'CLOSED', url: 'https://github.com/owner/repo/pull/1188', mergedAt: null }]);
    const { __testInternals } = await import('../swarm.js');

    const refreshed = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState() as any, projectPath);

    expect(refreshed.changed).toBe(true);
    expect(refreshed.state.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 closed without merge',
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
  });

  it('resets conflict debounce state when the PR becomes mergeable', async () => {
    mockGhPrList([{ number: 1188, mergeable: true, mergeableState: 'CLEAN', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const { __testInternals } = await import('../swarm.js');

    const refreshed = await __testInternals.refreshSwarmSlotMergeability(baseSwarmState({ consecutiveConflictCount: 1 }) as any, projectPath);

    expect(refreshed.changed).toBe(true);
    expect(refreshed.state.slots[0]).toMatchObject({
      status: 'completed',
      consecutiveConflictCount: 0,
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
  });

  it('treats gh failures as transient for mergeability refresh', async () => {
    ghExecFileMock.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return undefined;
    });
    const { __testInternals } = await import('../swarm.js');

    const state = baseSwarmState({ consecutiveConflictCount: 1 });
    const refreshed = await __testInternals.refreshSwarmSlotMergeability(state as any, projectPath);

    expect(refreshed.changed).toBe(false);
    expect(refreshed.state).toBe(state);
  });

  it('mutates only the latest implementation slot record for mergeability refresh', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const { __testInternals } = await import('../swarm.js');
    const state = {
      ...baseSwarmState(),
      slots: [
        {
          slot: 1,
          itemId: 'old-item',
          itemTitle: 'Old item',
          sessionName: 'agent-pan-971-1-old',
          workspace: '/tmp/old',
          status: 'merged' as const,
          phase: 'implementation' as const,
          startedAt: '2026-05-07T00:00:00Z',
          completedAt: '2026-05-07T00:05:00Z',
        },
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running' as const,
          phase: 'implementation' as const,
          startedAt: '2026-05-07T00:10:00Z',
        },
      ],
    };

    const refreshed = await __testInternals.refreshSwarmSlotMergeability(state as any, projectPath);

    expect(refreshed.changed).toBe(true);
    expect(refreshed.state.slots[0]).toEqual(state.slots[0]);
    expect(refreshed.state.slots[1]).toMatchObject({
      status: 'running',
      consecutiveConflictCount: 1,
    });
  });

  it('does not use blocking filesystem or process APIs in the swarm route', () => {
    const source = readFileSync(join(process.cwd(), 'src/dashboard/server/routes/swarm.ts'), 'utf-8');
    expect(source).not.toMatch(/\bexecSync\b|\breadFileSync\b|\breaddirSync\b/);
  });

  it('builds structured AgentTaskInput with dependencies and acceptance criteria', async () => {
    const { __testInternals } = await import('../swarm.js');

    const taskInput = __testInternals.buildStructuredSlotTaskInput(
      PLAN_DOC,
      'PAN-971',
      {
        id: 'wave-1-item',
        title: 'Dispatch next wave',
        blockedBy: ['wave-0-item'],
      },
      1,
      2,
      'feature/971-slot-2',
      'feature/971',
    );

    expect(taskInput).toEqual({
      schema: 'AgentTaskInput',
      agent_id: 'agent-pan-971-2',
      issue_id: 'PAN-971',
      plan_id: 'PAN-971',
      task_id: 'wave-1-item',
      title: 'Dispatch next wave',
      wave_index: 1,
      slot: 2,
      branch: 'feature/971-slot-2',
      pr_target: 'feature/971',
      workspace_plan_path: '.pan/spec.vbrief.json',
      dependencies: [
        { item_id: 'wave-0-item', title: 'Prepare slot input' },
      ],
      acceptance_criteria: [
        'Emit AgentTaskInput JSON block',
        'Target parent feature branch instead of main',
      ],
    });
  });

  it('keeps prose guardrails while embedding structured AgentTaskInput JSON', async () => {
    const { __testInternals } = await import('../swarm.js');

    const prompt = __testInternals.buildSlotPrompt(
      PLAN_DOC,
      'PAN-971',
      {
        id: 'wave-1-item',
        title: 'Dispatch next wave',
        blockedBy: ['wave-0-item'],
      },
      1,
      2,
      'feature/971-slot-2',
      'feature/971',
    );

    const jsonBlock = prompt.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonBlock?.[1]).toBeTruthy();

    const parsed = JSON.parse(jsonBlock![1]!) as {
      schema: string;
      branch: string;
      pr_target: string;
      dependencies: Array<{ item_id: string }>;
    };

    expect(parsed.schema).toBe('AgentTaskInput');
    expect(parsed.branch).toBe('feature/971-slot-2');
    expect(parsed.pr_target).toBe('feature/971');
    expect(parsed.dependencies).toEqual([{ item_id: 'wave-0-item', title: 'Prepare slot input' }]);
    expect(prompt).toContain('The plan is in .pan/spec.vbrief.json');
    expect(prompt).toContain('Do NOT run `pan done`');
    expect(prompt).toContain('Create a PR targeting `feature/971` — do NOT target main');
  });

  it('auto-advances completed swarms to next wave and persists new slot state', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      hostOverride: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          // PAN-977 round-14 blocker: a 'completed' slot is one whose tmux
          // pane exited but whose branch is NOT yet merged into the parent
          // feature branch. Auto-advance MUST wait for 'merged' (the
          // /api/swarm/slot-merged callback) before dispatching downstream
          // slots; otherwise dependents see stale parent-branch files.
          status: 'merged',
          startedAt: '2026-05-07T00:00:00Z',
          completedAt: '2026-05-07T00:05:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    }, null, 2));

    // The previous wave's slot agent has exited — pane is dead — so the slot-1
    // tmux session can be reaped and re-spawned for the next wave's item. PAN-977
    // forbids silently aliasing a *live* session for a different item.
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    // Round 10 blocker #4: durable runtime now lives in the continue vBRIEF;
    // the sidecar file is no longer written. Read state via the canonical
    // authority instead.
    const nextState = (await __testInternals.loadSwarmState('PAN-971'))!;

    // PAN-977 blocker #3: auto-advance is per-DAG-readiness now, not by wave
    // index. We assert the new ready item dispatched, regardless of currentWave.
    // PAN-977 blocker #4: prior slots are persisted cumulatively, so the new
    // dispatch appears alongside the prior completed slot.
    expect(nextState.autoAdvance).toBe(true);
    expect(nextState.hostOverride).toBe(true);
    const newSlot = nextState.slots.find((s) => s.itemId === 'wave-1-item');
    expect(newSlot).toBeTruthy();
    expect(newSlot?.itemTitle).toBe('Dispatch next wave');
    expect(newSlot?.status).toBe('running');
    expect(agents.spawnAgent).toHaveBeenCalledTimes(1);
    expect(agents.spawnAgent).toHaveBeenCalledWith(expect.objectContaining({
      allowHost: true,
    }));
  });

  // PAN-977 round-12 blocker #1: regression — onSlotMergeComplete must not
  // remove the swarm from the active-poll registry when its dispatch step
  // just spawned the next DAG-ready slot. Pre-fix, registry cleanup ran
  // against the stale pre-dispatch slots set (no running entries) and
  // deleted the issue, stranding the freshly-dispatched slot without an
  // auto-advance poller.
  it('keeps the swarm in the active registry when slot-merge dispatches the next DAG item', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    const initial = {
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    };
    writeFileSync(swarmStatePath, JSON.stringify(initial, null, 2));

    const { __testInternals } = await import('../swarm.js');
    // Seed runtime authority so subsequent loadSwarmState() reads the
    // continue vBRIEF rather than re-importing from the legacy sidecar.
    await __testInternals.persistSwarmRuntime(
      join(projectPath, 'workspaces', 'feature-pan-971'),
      initial as any,
    );

    // The slot-1 tmux pane has exited (the merged agent went away), so a
    // fresh dispatch on slot 1 for the next DAG item is allowed.
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue([]);

    // Simulate the steady-state where the initial dispatchSwarmWave already
    // registered this issue with the auto-advance poll loop.
    __testInternals.addActiveSwarmIssueId('PAN-971');

    const result = await __testInternals.onSlotMergeComplete('PAN-971', 'wave-0-item', 1);
    expect(result.ok).toBe(true);

    // The merged slot must be marked merged on the canonical record (not
    // every historical sibling sharing the slot/itemId).
    const after = (await __testInternals.loadSwarmState('PAN-971'))!;
    const mergedSlot = after.slots.find((s) => s.slot === 1 && s.itemId === 'wave-0-item');
    expect(mergedSlot?.status).toBe('merged');

    // Pre-fix this would be false: the cleanup branch ran on the stale
    // pre-dispatch snapshot, saw no running/pending slots, and deleted the
    // issue from the registry — even though dispatchSwarmWave had just been
    // invoked for the next DAG item. Post-fix, registry membership is decided
    // from observed post-dispatch state (or short-circuited entirely when a
    // dispatch succeeded), so the issue stays pollable.
    const registry = __testInternals.getActiveSwarmIssueIds();
    expect(registry.has('PAN-971'), 'issue must remain in active poll registry after slot merge').toBe(true);
  });

  // PAN-977 round-13 blocker #1: when the poller observes a final-wave slot
  // transition, the refreshed status must be persisted before registry cleanup.
  // Completed implementation slots stay active until they reach merged or failed-merge.
  it('persists refreshed final-wave slot status and keeps completed implementation slots active', async () => {
    mockGhPrList([{ number: 1188, mergeable: true, mergeableState: 'CLEAN', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      // currentWave === totalWaves - 1 — the final wave.
      currentWave: 1,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-1-item',
          itemTitle: 'Dispatch next wave',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    }, null, 2));

    // The slot's tmux pane has exited cleanly (exit 0) so refreshSwarmSlotStatuses
    // will flip the slot from 'running' to 'completed'.
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { __testInternals } = await import('../swarm.js');
    __testInternals.addActiveSwarmIssueId('PAN-971');
    await __testInternals.pollSwarmAutoAdvance();

    const persisted = (await __testInternals.loadSwarmState('PAN-971'))!;
    const slot = persisted.slots.find((s) => s.slot === 1);
    expect(slot?.status, 'final-wave terminal status must be persisted to continue-vBRIEF').toBe('completed');

    expect(__testInternals.getActiveSwarmIssueIds().has('PAN-971')).toBe(true);
  });

  // PAN-977 round-14 blocker: a slot whose tmux pane exited cleanly is
  // 'completed' — its commits are NOT yet on the parent feature branch.
  // Auto-advance MUST NOT dispatch downstream slots until the slot
  // transitions to 'merged' via /api/swarm/slot-merged. Otherwise the
  // downstream slot is created against stale parent-branch files and the
  // DAG dependency order is silently broken.
  it('does not auto-advance while a non-synthesis slot is only completed (not yet merged)', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          // Pane exited but branch not merged → must NOT trigger dispatch.
          status: 'completed',
          phase: 'implementation',
          startedAt: '2026-05-07T00:00:00Z',
          completedAt: '2026-05-07T00:05:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    }, null, 2));

    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    // wave-1-item must NOT have been dispatched — the upstream slot is
    // only locally completed, the merge callback has not landed.
    expect(agents.spawnAgent).not.toHaveBeenCalled();
    const nextState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(nextState.slots.some((s) => s.itemId === 'wave-1-item')).toBe(false);
  });

  it('halts auto-advance and emits one activity entry when a slot PR becomes failed-merge', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify(baseSwarmState({ status: 'running' }), null, 2));

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();
    await __testInternals.pollSwarmAutoAdvance();
    await __testInternals.pollSwarmAutoAdvance();

    const failedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(failedState.slots[0]).toMatchObject({
      status: 'failed-merge',
      prUrl: 'https://github.com/owner/repo/pull/1188',
    });
    expect(failedState.lastAutoAdvanceError).toContain('https://github.com/owner/repo/pull/1188');
    expect(failedState.lastAutoAdvanceError).toContain('pan swarm recover PAN-971 1 --action <retry|drop|handoff>');
    expect(failedState.autoAdvanceFailureCount).toBeGreaterThanOrEqual(1);
    expect(activityLogger.emitActivityEntry).toHaveBeenCalledTimes(1);
    expect(activityLogger.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ship',
      level: 'error',
      issueId: 'PAN-971',
      message: 'Swarm slot 1 PR https://github.com/owner/repo/pull/1188 unmergeable: PR #1188 not mergeable: CONFLICTING. Recover with: pan swarm recover PAN-971 1 --action <retry|drop|handoff>',
    }));
  });

  it('keeps a final-wave completed slot active long enough to debounce merge conflicts', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      ...baseSwarmState(),
      totalWaves: 1,
      slots: [{ ...baseSwarmState().slots[0] }],
    }, null, 2));

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    const firstState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(firstState.slots[0]).toMatchObject({ status: 'completed', consecutiveConflictCount: 1 });
    expect(__testInternals.getActiveSwarmIssueIds().has('PAN-971')).toBe(true);

    await __testInternals.pollSwarmAutoAdvance();

    const failedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(failedState.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 not mergeable: CONFLICTING',
      consecutiveConflictCount: 2,
    });
  });

  it('resumes final-wave completed slots that still need mergeability polling on startup', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      ...baseSwarmState({ consecutiveConflictCount: 1 }),
      totalWaves: 1,
    }, null, 2));

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.resumeSwarmAutoAdvanceLoopOnStartup();

    expect(__testInternals.getActiveSwarmIssueIds().has('PAN-971')).toBe(true);
  });

  it('POST /api/swarm/refresh uses the same status and mergeability refresh path as polling', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify(baseSwarmState({ status: 'running' }), null, 2));
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { HttpRouter } = await import('effect/unstable/http');
    const { __testInternals, swarmRouteLayer } = await import('../swarm.js');
    const { handler, dispose } = HttpRouter.toWebHandler(swarmRouteLayer, { disableLogger: true });
    try {
      const first = await handler(new Request('http://localhost/api/swarm/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-panopticon-internal-token': 'test-token' },
        body: JSON.stringify({ issueId: 'PAN-971' }),
      }));
      const second = await handler(new Request('http://localhost/api/swarm/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-panopticon-internal-token': 'test-token' },
        body: JSON.stringify({ issueId: 'PAN-971' }),
      }));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await first.json()).toMatchObject({ success: true, changed: true });
      expect(await second.json()).toMatchObject({ success: true, changed: true });
    } finally {
      await dispose();
    }

    const refreshedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(refreshedState.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 not mergeable: CONFLICTING',
      consecutiveConflictCount: 2,
    });
  });

  it('records a failed-merge error instead of looping forever on completed conflicting slots', async () => {
    mockGhPrList([{ number: 1188, mergeable: false, mergeableState: 'CONFLICTING', state: 'OPEN', url: 'https://github.com/owner/repo/pull/1188' }]);
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      ...baseSwarmState({ consecutiveConflictCount: 1 }),
      slots: [
        {
          ...baseSwarmState({ consecutiveConflictCount: 1 }).slots[0],
        },
        {
          slot: 2,
          itemId: 'already-merged',
          itemTitle: 'Already merged sibling',
          sessionName: 'agent-pan-971-2',
          workspace: '/tmp/feature-pan-971-slot-2',
          status: 'merged' as const,
          phase: 'implementation' as const,
        },
      ],
    }, null, 2));

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();
    await __testInternals.pollSwarmAutoAdvance();

    const failedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(failedState.slots[0]).toMatchObject({
      status: 'failed-merge',
      failureReason: 'PR #1188 not mergeable: CONFLICTING',
    });
    expect(failedState.lastAutoAdvanceError).toBe('Swarm slot 1 PR https://github.com/owner/repo/pull/1188 unmergeable: PR #1188 not mergeable: CONFLICTING. Recover with: pan swarm recover PAN-971 1 --action <retry|drop|handoff>');
    expect(agents.spawnAgent).not.toHaveBeenCalled();
  });

  it('recovers a failed-merge slot via retry and dispatches the item on the next poll', async () => {
    const { __testInternals } = await import('../swarm.js');
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    const runningDoc = {
      ...PLAN_DOC,
      plan: {
        ...PLAN_DOC.plan,
        items: PLAN_DOC.plan.items.map(item => item.id === 'wave-0-item' ? { ...item, status: 'running' as const } : item),
      },
    };
    writeFileSync(join(featureWorkspace, '.pan', 'spec.vbrief.json'), JSON.stringify(runningDoc, null, 2));
    await __testInternals.persistSwarmRuntime(featureWorkspace, {
      ...baseSwarmState({ status: 'failed-merge', failureReason: 'PR #1188 not mergeable: CONFLICTING', prUrl: 'https://github.com/owner/repo/pull/1188' }),
      autoAdvanceFailureCount: 2,
      autoAdvanceRetryAfter: '2026-05-07T00:10:00Z',
      lastAutoAdvanceError: 'slot failed',
    } as any);
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue([]);

    const recovered = await __testInternals.recoverSwarmSlot('PAN-971', 1, 'retry');

    expect(recovered).toMatchObject({ status: 200, body: { ok: true, action: 'retry', slotId: 1, issueId: 'PAN-971' } });
    const recoveredState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(recoveredState.autoAdvanceFailureCount).toBe(0);
    expect(recoveredState.autoAdvanceRetryAfter).toBeUndefined();
    expect(recoveredState.lastAutoAdvanceError).toBeUndefined();
    expect(recoveredState.slots[0]).toMatchObject({ status: 'pending', recoveryAction: 'retry' });
    expect(recoveredState.slots[0]?.failureReason).toBeUndefined();
    expect(recoveredState.slots[0]?.consecutiveConflictCount).toBeUndefined();
    expect(recoveredState.slots[0]?.prUrl).toBeUndefined();

    await __testInternals.pollSwarmAutoAdvance();

    const dispatchedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(dispatchedState.slots.filter(s => s.itemId === 'wave-0-item').at(-1)?.status).toBe('running');
    expect(agents.spawnAgent).toHaveBeenCalledTimes(1);
    expect(activityLogger.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ship',
      level: 'info',
      issueId: 'PAN-971',
      message: 'Operator recovered slot 1 via retry (wave-0-item)',
    }));
  });

  it('recovers a failed-merge slot via drop and dispatches downstream DAG work', async () => {
    const { __testInternals } = await import('../swarm.js');
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    const runningDoc = {
      ...PLAN_DOC,
      plan: {
        ...PLAN_DOC.plan,
        items: PLAN_DOC.plan.items.map(item => item.id === 'wave-0-item' ? { ...item, status: 'running' as const } : item),
      },
    };
    writeFileSync(join(featureWorkspace, '.pan', 'spec.vbrief.json'), JSON.stringify(runningDoc, null, 2));
    await __testInternals.persistSwarmRuntime(featureWorkspace, {
      ...baseSwarmState({ status: 'failed-merge', failureReason: 'PR #1188 not mergeable: CONFLICTING' }),
      lastAutoAdvanceError: 'slot failed',
      autoAdvanceFailureCount: 1,
    } as any);
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue([]);

    const recovered = await __testInternals.recoverSwarmSlot('PAN-971', 1, 'drop');

    expect(recovered.status).toBe(200);
    const plan = JSON.parse(readFileSync(join(featureWorkspace, '.pan', 'spec.vbrief.json'), 'utf-8')) as VBriefDocument;
    expect(plan.plan.items.find(item => item.id === 'wave-0-item')?.status).toBe('completed');
    expect(plan.plan.items.find(item => item.id === 'wave-0-item')?.metadata?.statusReason).toBe('Operator dropped slot via failed-merge recovery');
    const recoveredState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(recoveredState.slots[0]).toMatchObject({ status: 'failed-merge', recoveryAction: 'drop' });
    expect(recoveredState.lastAutoAdvanceError).toBeUndefined();

    await __testInternals.pollSwarmAutoAdvance();

    const dispatchedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(dispatchedState.slots.find(s => s.itemId === 'wave-1-item')?.status).toBe('running');
    expect(agents.spawnAgent).toHaveBeenCalledTimes(1);
  });

  it('recovers a failed-merge slot via handoff and lets the next poll drop the active swarm', async () => {
    const { __testInternals } = await import('../swarm.js');
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    await __testInternals.persistSwarmRuntime(featureWorkspace, {
      ...baseSwarmState({ status: 'failed-merge', failureReason: 'PR #1188 not mergeable: CONFLICTING' }),
      lastAutoAdvanceError: 'slot failed',
      autoAdvanceFailureCount: 1,
    } as any);

    const recovered = await __testInternals.recoverSwarmSlot('PAN-971', 1, 'handoff');

    expect(recovered.status).toBe(200);
    const recoveredState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(recoveredState.autoAdvance).toBe(false);
    expect(recoveredState.slots[0]).toMatchObject({ status: 'failed-merge', recoveryAction: 'handoff' });
    expect(activityLogger.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ship',
      level: 'warn',
      issueId: 'PAN-971',
      message: 'Swarm autoAdvance disabled for PAN-971 after operator handoff of slot 1. Take it from here.',
    }));

    await __testInternals.pollSwarmAutoAdvance();

    expect(__testInternals.getActiveSwarmIssueIds().has('PAN-971')).toBe(false);
  });

  it('returns 409 when replaying recovery for an already recovered slot', async () => {
    const { __testInternals } = await import('../swarm.js');
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    await __testInternals.persistSwarmRuntime(featureWorkspace, baseSwarmState({
      status: 'failed-merge',
      recoveryAction: 'drop',
      recoveredAt: '2026-05-07T00:06:00Z',
    }) as any);

    const replay = await __testInternals.recoverSwarmSlot('PAN-971', 1, 'drop');

    expect(replay.status).toBe(409);
    expect(replay.body.error).toContain('No failed-merge slot 1 exists for PAN-971');
  });

  it('does not persist drop recovery state when the vBRIEF mutation fails', async () => {
    const { __testInternals } = await import('../swarm.js');
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');
    await __testInternals.persistSwarmRuntime(featureWorkspace, baseSwarmState({
      itemId: 'missing-item',
      status: 'failed-merge',
      failureReason: 'PR #1188 not mergeable: CONFLICTING',
    }) as any);

    const failed = await __testInternals.recoverSwarmSlot('PAN-971', 1, 'drop');

    expect(failed.status).toBe(500);
    expect(failed.body.error).toContain('Plan item not found: missing-item');
    const state = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(state.slots[0]?.recoveryAction).toBeUndefined();
    expect(activityLogger.emitActivityEntry).not.toHaveBeenCalledWith(expect.objectContaining({
      message: 'Operator recovered slot 1 via drop (missing-item)',
    }));
  });

  // PAN-977 round-15 blocker: when a synthesis slot for itemX has completed
  // but its tmux session is still alive (pane teardown lagging), a dispatch
  // for itemX as an implementation slot MUST NOT silently alias the
  // completed synthesis session — that would skip the implementation work
  // entirely. The reuse guard now requires same-item AND same-phase AND
  // status='running' before keeping an existing assignment.
  it('does not alias a completed synthesis slot whose tmux session is still alive as the implementation dispatch', async () => {
    // Build a plan where wave-1-item is a DAG convergence point requiring
    // synthesis: two parents block it, so blockingParentCount > 1 and the
    // dispatcher picks the synthesis-first phase by default.
    const synthesisDoc: VBriefDocument = {
      ...PLAN_DOC,
      plan: {
        ...PLAN_DOC.plan,
        items: [
          // Parents already finished — marking them 'completed' in the plan
          // makes wave-1-item DAG-ready via getDispatchableItems().
          { id: 'wave-0-a', title: 'Parent A', status: 'completed' },
          { id: 'wave-0-b', title: 'Parent B', status: 'completed' },
          { id: 'wave-1-item', title: 'Convergence work', status: 'pending' },
        ],
        edges: [
          { from: 'wave-0-a', to: 'wave-1-item', type: 'blocks' },
          { from: 'wave-0-b', to: 'wave-1-item', type: 'blocks' },
        ],
      },
    };
    writeFileSync(
      join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'),
      JSON.stringify(synthesisDoc, null, 2),
    );
    vi.mocked(vbriefIo.readWorkspacePlan).mockReturnValue(synthesisDoc);

    // Both parents are merged so wave-1-item is DAG-ready, AND the synthesis
    // slot for wave-1-item has already completed (output persisted) but its
    // tmux session is still alive — pane teardown lagging.
    const initialState = {
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 1,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-1-item',
          itemTitle: 'Convergence work',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'completed' as const,
          phase: 'synthesis' as const,
          startedAt: '2026-05-07T00:00:00Z',
          completedAt: '2026-05-07T00:05:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    };
    const featureWorkspace = join(projectPath, 'workspaces', 'feature-pan-971');

    const { __testInternals } = await import('../swarm.js');
    // persistSwarmRuntime writes via runtimeFromState which uses the canonical
    // slotId/itemId/sessionName/workspace shape — no manual continue-state
    // surgery needed for the slot list. Then patch synthesisOutputs in-place.
    await __testInternals.persistSwarmRuntime(featureWorkspace, initialState as any);

    // PAN-977 review-round-18: pass the workspace root, NOT `.pan/`.
    // `writeContinueStateAsync` appends `.pan/continues/` internally via
    // `getContinuesDir(projectRoot)`.
    const continueDir = featureWorkspace;
    const cont = await import('../../../../lib/vbrief/continue-state.js');
    const existingCont = (await cont.readContinueStateAsync(continueDir, 'PAN-971'))!;
    await cont.writeContinueStateAsync(continueDir, 'PAN-971', {
      ...existingCont,
      swarmRuntime: {
        ...(existingCont.swarmRuntime!),
        synthesisOutputs: {
          'wave-1-item': {
            targetItemId: 'wave-1-item',
            writtenAt: '2026-05-07T00:05:00Z',
            contextUpdate: 'synthesis context for downstream implementation',
          },
        },
      },
    });

    // The slot-1 tmux session is still alive — pane has not yet torn down.
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(false);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['12345']);

    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      autoAdvance: true,
    });

    // Dispatch must NOT alias the live completed-synthesis session in slot
    // 1. Round-15 + round-16 fix together: the phase-aware reuse guard
    // refuses to alias, and the new free-slot allocator hands out the
    // lowest unoccupied slot id (slot 2 here, since slot 1 is alive) so
    // the implementation work still dispatches on a fresh slot rather than
    // stalling.
    expect(result.status).toBe(200);
    const after = (await __testInternals.loadSwarmState('PAN-971'))!;
    const implSlot = after.slots.find(
      (s) => s.itemId === 'wave-1-item' && s.phase === 'implementation',
    );
    expect(implSlot, 'implementation slot must be dispatched on a fresh slot id').toBeTruthy();
    expect(implSlot?.slot, 'must NOT alias the live synthesis slot 1').not.toBe(1);

    // The original synthesis slot record stays in the cumulative history
    // untouched — its status remains 'completed' (it was the synthesis-phase
    // dispatch, never aliased).
    const synthSlot = after.slots.find(
      (s) => s.itemId === 'wave-1-item' && s.phase === 'synthesis',
    );
    expect(synthSlot?.status).toBe('completed');
  });

  // PAN-977 round-16 blocker #1: slot allocation must hand out the LOWEST
  // FREE slot id, not the positional batch index. Pre-fix, dispatch reused
  // `index + 1` and stalled whenever slot-1 was already occupied even though
  // higher slot ids were free — auto-advance would silently fail to dispatch
  // valid ready work.
  it('allocates the lowest free slot when slot-1 is occupied by a running prior dispatch', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      // Slot 1 is still running from a prior dispatch (an unrelated parallel
      // item working on its own scope). The new ready item MUST be assigned
      // slot 2, not stall on slot 1.
      slots: [
        {
          slot: 1,
          itemId: 'unrelated-running',
          itemTitle: 'Unrelated running work',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          phase: 'implementation',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    }, null, 2));

    // The slot-1 tmux session is alive; slot-2 is free.
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(false);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['12345']);

    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      autoAdvance: true,
    });

    expect(result.status).toBe(200);
    const after = (await __testInternals.loadSwarmState('PAN-971'))!;
    const newDispatch = after.slots.find((s) => s.itemId === 'wave-0-item');
    expect(newDispatch, 'wave-0-item must be dispatched even though slot 1 is occupied').toBeTruthy();
    expect(newDispatch?.slot, 'must allocate slot 2 (lowest free) instead of stalling on slot 1').toBe(2);
    expect(newDispatch?.sessionName).toBe('agent-pan-971-2');
    expect(newDispatch?.status).toBe('running');
  });

  it('passes confirmed host override into swarm slot spawns', async () => {
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue([]);

    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      allowHost: true,
    });

    expect(result.status).toBe(200);
    expect(agents.spawnAgent).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-971',
      allowHost: true,
    }));
    const state = await __testInternals.loadSwarmState('PAN-971');
    expect(state?.hostOverride).toBe(true);
  });

  it('does not advance while current wave still has running slots', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    }, null, 2));

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    const unchangedState = JSON.parse(readFileSync(swarmStatePath, 'utf-8')) as {
      currentWave: number;
      slots: Array<{ itemId: string; status: string }>;
    };

    expect(unchangedState.currentWave).toBe(0);
    expect(unchangedState.slots).toEqual([
      {
        slot: 1,
        itemId: 'wave-0-item',
        itemTitle: 'Prepare slot input',
        sessionName: 'agent-pan-971-1',
        workspace: '/tmp/feature-pan-971-slot-1',
        status: 'running',
        startedAt: '2026-05-07T00:00:00Z',
      },
    ]);
  });

  it('treats dead tmux panes with exit code 0 as completed', async () => {
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { __testInternals } = await import('../swarm.js');
    const refreshed = await __testInternals.refreshSwarmSlotStatuses({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    });

    expect(refreshed.changed).toBe(true);
    expect(refreshed.state.slots[0]?.status).toBe('completed');
  });

  it('marks dead tmux panes with non-zero exit status as failed', async () => {
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['23']);

    const { __testInternals } = await import('../swarm.js');
    const refreshed = await __testInternals.refreshSwarmSlotStatuses({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    });

    expect(refreshed.changed).toBe(true);
    expect(refreshed.state.slots[0]).toMatchObject({
      status: 'failed',
      failureReason: 'tmux pane exited with status 23',
    });
  });

  it('reads tmux sessions once per auto-advance poll before refreshing swarm states', async () => {
    writeFileSync(join(testHome, '.panopticon', 'swarms', 'pan-971.json'), JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [{
        slot: 1,
        itemId: 'wave-0-item',
        itemTitle: 'Prepare slot input',
        sessionName: 'agent-pan-971-1',
        workspace: '/tmp/feature-pan-971-slot-1',
        status: 'running',
      }],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    }, null, 2));
    writeFileSync(join(testHome, '.panopticon', 'swarms', 'pan-972.json'), JSON.stringify({
      issueId: 'PAN-972',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [{
        slot: 1,
        itemId: 'wave-0-item',
        itemTitle: 'Prepare slot input',
        sessionName: 'agent-pan-972-1',
        workspace: '/tmp/feature-pan-972-slot-1',
        status: 'running',
      }],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    }, null, 2));

    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1', 'agent-pan-972-1']);

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    expect(tmux.listSessionNamesAsync).toHaveBeenCalledTimes(1);
  });

  it('backs off auto-advance retries after repeated dispatch failures', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          // PAN-977 round-14: 'merged' (not 'completed') is what triggers
          // downstream auto-advance, since 'completed' means pane exited
          // but branch is not yet on the parent feature branch.
          status: 'merged',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:05:00Z',
    }, null, 2));

    rmSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'), { force: true });
    vi.mocked(vbriefIo.readWorkspacePlan).mockReturnValue(null);

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();
    await __testInternals.pollSwarmAutoAdvance();
    await __testInternals.pollSwarmAutoAdvance();

    const failedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(failedState.autoAdvanceFailureCount).toBe(3);
    expect(failedState.autoAdvanceRetryAfter).toBeTruthy();

    vi.mocked(vbriefIo.readWorkspacePlan).mockClear();
    await __testInternals.pollSwarmAutoAdvance();
    expect(vbriefIo.readWorkspacePlan).not.toHaveBeenCalled();
  });

  it('re-dispatches deferred items before advancing to the next wave', async () => {
    const sameWaveDoc: VBriefDocument = {
      ...PLAN_DOC,
      plan: {
        ...PLAN_DOC.plan,
        items: [
          {
            id: 'wave-0-item-a',
            title: 'First slot item',
            status: 'pending',
          },
          {
            id: 'wave-0-item-b',
            title: 'Deferred slot item',
            status: 'pending',
          },
          {
            id: 'wave-1-item',
            title: 'Later wave item',
            status: 'pending',
          },
        ],
        edges: [
          { from: 'wave-0-item-a', to: 'wave-1-item', type: 'blocks' },
          { from: 'wave-0-item-b', to: 'wave-1-item', type: 'blocks' },
        ],
      },
    };
    vi.mocked(vbriefIo.readWorkspacePlan).mockReturnValue(sameWaveDoc);
    writeFileSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'), JSON.stringify(sameWaveDoc, null, 2));
    // Default mock has slot-1 session present; mark it dead so the dispatcher
    // reaps it and reuses the slot id (PAN-977 no-alias-onto-live-session rule).
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { __testInternals } = await import('../swarm.js');
    const initialDispatch = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      maxSlots: 1,
      autoAdvance: true,
    });

    expect(initialDispatch.status).toBe(200);
    expect(initialDispatch.body.deferred).toEqual([
      { itemId: 'wave-0-item-b', itemTitle: 'Deferred slot item' },
    ]);

    // PAN-977 round-14: only 'merged' slots satisfy DAG dependencies and
    // gate auto-advance — a slot that merely 'completed' (pane exited)
    // has not yet landed on the parent feature branch, so dispatching
    // dependents would race against stale upstream files.
    const initialState = (await __testInternals.loadSwarmState('PAN-971'))!;
    const completedState = {
      ...initialState,
      slots: [{
        slot: 1,
        itemId: 'wave-0-item-a',
        itemTitle: 'First slot item',
        sessionName: 'agent-pan-971-1',
        workspace: '',
        status: 'merged' as const,
      }],
    };
    await __testInternals.persistSwarmRuntime(
      join(projectPath, 'workspaces', 'feature-pan-971'),
      completedState,
    );

    await __testInternals.pollSwarmAutoAdvance();

    const nextState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(nextState.deferred).toBeUndefined();
    // Cumulative slot history (PAN-977 #4) keeps the prior 'completed' record
    // alongside the new dispatch. Locate the new dispatch by item id.
    const dispatched = nextState.slots.find((s) => s.itemId === 'wave-0-item-b');
    expect(dispatched).toBeTruthy();
    expect(dispatched?.itemTitle).toBe('Deferred slot item');
    expect(dispatched?.sessionName).toBe('agent-pan-971-1');
    expect(dispatched?.status).toBe('running');
  });

  it('records failed slots and blocks auto-advance when tmux exits non-zero', async () => {
    const swarmStatePath = join(testHome, '.panopticon', 'swarms', 'pan-971.json');
    writeFileSync(swarmStatePath, JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [
        {
          slot: 1,
          itemId: 'wave-0-item',
          itemTitle: 'Prepare slot input',
          sessionName: 'agent-pan-971-1',
          workspace: '/tmp/feature-pan-971-slot-1',
          status: 'running',
          startedAt: '2026-05-07T00:00:00Z',
        },
      ],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    }, null, 2));

    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue(['agent-pan-971-1']);
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['7']);

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    const failedState = (await __testInternals.loadSwarmState('PAN-971'))!;
    expect(failedState.currentWave).toBe(0);
    expect(failedState.autoAdvanceFailureCount).toBe(1);
    expect(failedState.lastAutoAdvanceError).toBe('One or more swarm slots failed before completion was confirmed.');
    expect(failedState.slots[0]).toMatchObject({
      status: 'failed',
      failureReason: 'tmux pane exited with status 7',
    });
  });

  it('resumes auto-advance polling on startup when an active swarm exists', async () => {
    writeFileSync(join(testHome, '.panopticon', 'swarms', 'pan-971.json'), JSON.stringify({
      issueId: 'PAN-971',
      currentWave: 0,
      totalWaves: 2,
      model: 'kimi-k2.6',
      autoAdvance: true,
      slots: [{
        slot: 1,
        itemId: 'wave-0-item',
        itemTitle: 'Prepare slot input',
        sessionName: 'agent-pan-971-1',
        workspace: '',
        status: 'running',
      }],
      createdAt: '2026-05-07T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    }, null, 2));

    const { resumeSwarmAutoAdvanceLoopOnStartup } = await import('../swarm.js');
    await resumeSwarmAutoAdvanceLoopOnStartup();

    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('returns 400 when maxSlots is not a positive integer', async () => {
    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      maxSlots: 0,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('maxSlots must be a positive integer.');
  });

  it('returns an error instead of persisting an empty swarm wave when every slot fails to spawn', async () => {
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-971-slot-1'), { recursive: true });
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue([]);
    vi.mocked(agents.spawnAgent).mockRejectedValue(new Error('spawn failed') as never);

    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      autoAdvance: true,
    });

    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Failed to dispatch any slots');
  });

  it('rejects an explicit future wave while earlier dependencies remain pending', async () => {
    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 1,
      maxSlots: 1,
    });

    expect(result.status).toBe(422);
    expect(result.body.error).toContain('No dispatchable items');
    expect(agents.spawnAgent).not.toHaveBeenCalled();
  });

  it('claims dispatched items in the workspace vBRIEF plan', async () => {
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-971-slot-1'), { recursive: true });
    vi.mocked(tmux.listSessionNamesAsync).mockResolvedValue([]);
    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      maxSlots: 1,
    });

    expect(result.status).toBe(200);
    const writtenPlan = JSON.parse(readFileSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'), 'utf-8')) as VBriefDocument;
    expect(writtenPlan.plan.items.find(item => item.id === 'wave-0-item')?.status).toBe('running');
  });

  it('defers same-batch candidates whose file scopes overlap selected items', async () => {
    const overlapDoc: VBriefDocument = {
      ...PLAN_DOC,
      plan: {
        ...PLAN_DOC.plan,
        items: [
          { id: 'item-a', title: 'Touch shared file first', status: 'pending', metadata: { files_scope: ['src/shared.ts'] } },
          { id: 'item-b', title: 'Touch shared file second', status: 'pending', metadata: { files_scope: ['src/shared.ts'] } },
        ],
        edges: [],
      },
    };
    writeFileSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'), JSON.stringify(overlapDoc, null, 2));
    // Pre-existing slot session is dead, so the dispatcher reaps it and re-uses
    // the slot id without violating PAN-977's no-alias-onto-live-session rule.
    vi.mocked(tmux.isPaneDeadAsync).mockResolvedValue(true);
    vi.mocked(tmux.listPaneValuesAsync).mockResolvedValue(['0']);

    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
      maxSlots: 2,
    });

    expect(result.status).toBe(200);
    expect(result.body.slots?.map(slot => slot.itemId)).toEqual(['item-a']);
    expect(result.body.deferred).toEqual([{ itemId: 'item-b', itemTitle: 'Touch shared file second' }]);
  });

  it('honors PAN_AGENT_BLOCK_COUNT=0 as an explicit hard stop', async () => {
    process.env.PAN_AGENT_BLOCK_COUNT = '0';

    const { __testInternals } = await import('../swarm.js');
    const result = await __testInternals.dispatchSwarmWave({
      issueId: 'PAN-971',
      wave: 0,
    });

    expect(result.status).toBe(429);
    expect(result.body.error).toContain('No agent capacity available');

    delete process.env.PAN_AGENT_BLOCK_COUNT;
  });
});
