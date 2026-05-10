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

// PAN-977: createSlotWorktree shells out to `git fetch`/`git worktree add`. The
// test temp directories are not git repos, so stub child_process.execFile to
// resolve successfully — the alternative (running real git) was never the
// behavior under test.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: ((...args: any[]) => {
      const cb = args[args.length - 1] as (err: null, out: { stdout: string; stderr: string }) => void;
      if (typeof cb === 'function') {
        cb(null, { stdout: '', stderr: '' });
      }
      return undefined;
    }) as any,
  };
});

vi.mock('../../../../lib/vbrief/io.js', () => ({
  findPlan: vi.fn(),
  readWorkspacePlan: vi.fn(),
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
    vi.useFakeTimers();

    testHome = mkdtempSync(join(tmpdir(), 'pan-971-swarm-test-'));
    projectPath = join(testHome, 'repo');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan'), { recursive: true });
    writeFileSync(join(projectPath, 'workspaces', 'feature-pan-971', '.pan', 'spec.vbrief.json'), JSON.stringify(PLAN_DOC, null, 2));
    mkdirSync(join(testHome, '.panopticon', 'swarms'), { recursive: true });

    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;

    vi.mocked(projects.resolveProjectFromIssue).mockReturnValue({
      projectPath,
      repo: 'owner/repo',
      key: 'panopticon',
      tracker: 'github',
    } as any);
    vi.mocked(vbriefIo.readWorkspacePlan).mockReturnValue(PLAN_DOC);
    vi.mocked(vbriefIo.findPlan).mockReturnValue(null);
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
    rmSync(testHome, { recursive: true, force: true });
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
      'feature/pan-971/slot-2',
      'feature/pan-971',
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
      branch: 'feature/pan-971/slot-2',
      pr_target: 'feature/pan-971',
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
      'feature/pan-971/slot-2',
      'feature/pan-971',
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
    expect(parsed.branch).toBe('feature/pan-971/slot-2');
    expect(parsed.pr_target).toBe('feature/pan-971');
    expect(parsed.dependencies).toEqual([{ item_id: 'wave-0-item', title: 'Prepare slot input' }]);
    expect(prompt).toContain('The plan is in .pan/spec.vbrief.json');
    expect(prompt).toContain('Do NOT run `pan done`');
    expect(prompt).toContain('Create a PR targeting `feature/pan-971` — do NOT target main');
  });

  it('auto-advances completed swarms to next wave and persists new slot state', async () => {
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
          status: 'completed',
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
    const newSlot = nextState.slots.find((s) => s.itemId === 'wave-1-item');
    expect(newSlot).toBeTruthy();
    expect(newSlot?.itemTitle).toBe('Dispatch next wave');
    expect(newSlot?.status).toBe('running');
    expect(agents.spawnAgent).toHaveBeenCalledTimes(1);
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
          status: 'completed',
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

    // Mark the dispatched slot as completed in the canonical runtime so the
    // next poll re-dispatches the deferred item.
    const initialState = (await __testInternals.loadSwarmState('PAN-971'))!;
    const completedState = {
      ...initialState,
      slots: [{
        slot: 1,
        itemId: 'wave-0-item-a',
        itemTitle: 'First slot item',
        sessionName: 'agent-pan-971-1',
        workspace: '',
        status: 'completed' as const,
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
