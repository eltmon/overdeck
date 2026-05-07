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
}));

vi.mock('../../../../lib/vbrief/io.js', () => ({
  findPlan: vi.fn(),
  readWorkspacePlan: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', () => ({
  spawnAgent: vi.fn(),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionNamesAsync: vi.fn(),
  isPaneDeadAsync: vi.fn(),
  killSessionAsync: vi.fn(),
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
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-971'), { recursive: true });
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

    const { __testInternals } = await import('../swarm.js');
    await __testInternals.pollSwarmAutoAdvance();

    const nextState = JSON.parse(readFileSync(swarmStatePath, 'utf-8')) as {
      currentWave: number;
      autoAdvance: boolean;
      slots: Array<{ itemId: string; itemTitle: string; sessionName: string; status: string }>;
    };

    expect(nextState.currentWave).toBe(1);
    expect(nextState.autoAdvance).toBe(true);
    expect(nextState.slots).toEqual([
      {
        slot: 1,
        itemId: 'wave-1-item',
        itemTitle: 'Dispatch next wave',
        sessionName: 'agent-pan-971-1',
        workspace: '',
        status: 'running',
      },
    ]);
    expect(agents.spawnAgent).not.toHaveBeenCalled();
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
});
