import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyInFlightSlots,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem } from '../../../../src/lib/agents/slot-reconcile.js';
import type { AgentRuntimeSnapshot } from '@overdeck/contracts';

function slot(slotIndex: number, agentId = `agent-pan-2203-slot-${slotIndex}`): ReconciledSlotItem {
  return {
    itemId: `wi-${slotIndex}`,
    slotIndex,
    status: 'in_flight',
    agentId,
    branch: `feature/pan-2203-slot-${slotIndex}`,
  };
}

function deps(options: {
  sessions?: string[];
  dead?: Record<string, boolean>;
  exitStatus?: Record<string, number | null>;
  runtime?: Record<string, Pick<AgentRuntimeSnapshot, 'resolution'>>;
  outputDigest?: string;
  commitTime?: number | null;
  aheadCount?: number;
  clean?: boolean;
  sendCompletionNudge?: CoordinateSwarmSlotsDeps['sendCompletionNudge'];
}): Pick<
  CoordinateSwarmSlotsDeps,
  'listSessionNames'
  | 'isPaneDead'
  | 'getPaneExitStatus'
  | 'getAgentRuntimeState'
  | 'getPaneOutputDigest'
  | 'getBranchTipCommitTime'
  | 'getSlotBranchAheadCount'
  | 'isSlotWorktreeClean'
  | 'sendCompletionNudge'
> {
  return {
    listSessionNames: vi.fn(async () => options.sessions ?? []),
    isPaneDead: vi.fn(async (sessionName: string) => options.dead?.[sessionName] ?? false),
    getPaneExitStatus: vi.fn(async (sessionName: string) => options.exitStatus?.[sessionName] ?? null),
    getAgentRuntimeState: vi.fn(async (agentId: string) => options.runtime?.[agentId] ?? null),
    getPaneOutputDigest: vi.fn(async () => options.outputDigest ?? 'same pane output'),
    getBranchTipCommitTime: vi.fn(async () => options.commitTime ?? new Date('2026-07-01T00:00:00.000Z').getTime()),
    getSlotBranchAheadCount: vi.fn(async () => options.aheadCount ?? 0),
    isSlotWorktreeClean: vi.fn(async () => options.clean ?? false),
    sendCompletionNudge: options.sendCompletionNudge ?? vi.fn(async () => undefined),
  };
}

describe('deacon-swarm completion classification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    resetSwarmLoopSafetyForTests();
    vi.useRealTimers();
  });

  it('classifies a slot whose pane exited 0 as ready-to-merge', async () => {
    const agentId = 'agent-pan-2203-slot-1';

    await expect(classifyInFlightSlots([slot(1, agentId)], deps({
      sessions: [agentId],
      dead: { [agentId]: true },
      exitStatus: { [agentId]: 0 },
    }))).resolves.toEqual([
      expect.objectContaining({ slotIndex: 1, lifecycle: 'ready-to-merge', exitStatus: 0 }),
    ]);
  });

  it('classifies a slot with persisted pan done completion as ready-to-merge even while the pane is live', async () => {
    const agentId = 'agent-pan-2203-slot-1';

    await expect(classifyInFlightSlots([slot(1, agentId)], deps({
      sessions: [agentId],
      dead: { [agentId]: false },
      runtime: {
        [agentId]: {
          resolution: 'completed',
        },
      },
    }))).resolves.toEqual([
      expect.objectContaining({ slotIndex: 1, lifecycle: 'ready-to-merge', exitStatus: 0 }),
    ]);
  });

  it('classifies a slot whose pane exited non-zero as failed', async () => {
    const agentId = 'agent-pan-2203-slot-2';

    await expect(classifyInFlightSlots([slot(2, agentId)], deps({
      sessions: [agentId],
      dead: { [agentId]: true },
      exitStatus: { [agentId]: 1 },
    }))).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 2,
        lifecycle: 'failed',
        exitStatus: 1,
        reason: 'pane-exit-nonzero',
      }),
    ]);
  });

  it('classifies a vanished slot as failed and a live pane as running', async () => {
    const runningAgentId = 'agent-pan-2203-slot-4';

    await expect(classifyInFlightSlots([
      slot(3, 'agent-pan-2203-slot-3'),
      slot(4, runningAgentId),
    ], deps({
      sessions: [runningAgentId],
      dead: { [runningAgentId]: false },
    }))).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 3,
        lifecycle: 'failed',
        reason: 'vanished-session',
      }),
      expect.objectContaining({
        slotIndex: 4,
        lifecycle: 'running',
      }),
    ]);
  });

  it('nudges a clean committed idle slot exactly once in nudge mode', async () => {
    const agentId = 'agent-pan-2203-slot-1';
    const sendCompletionNudge = vi.fn(async () => undefined);
    const fakeDeps = deps({
      sessions: [agentId],
      aheadCount: 1,
      clean: true,
      sendCompletionNudge,
    });

    await classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'nudge',
      stallThresholdMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'nudge',
      stallThresholdMs: 10_000,
    })).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'stalled',
        actions: ['[swarm] nudged slot 1 (item wi-1) for PAN-2203: run pan done PAN-2203'],
      }),
    ]);

    await expect(classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'nudge',
      stallThresholdMs: 10_000,
    })).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'stalled',
        actions: [],
      }),
    ]);
    expect(sendCompletionNudge).toHaveBeenCalledTimes(1);
    expect(sendCompletionNudge).toHaveBeenCalledWith(agentId, 'PAN-2203');
  });

  it('infers ready-to-merge on the second unchanged idle observation in auto mode', async () => {
    const agentId = 'agent-pan-2203-slot-2';
    const fakeDeps = deps({
      sessions: [agentId],
      aheadCount: 1,
      clean: true,
    });

    await classifyInFlightSlots([slot(2, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'auto',
      stallThresholdMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(classifyInFlightSlots([slot(2, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'auto',
      stallThresholdMs: 10_000,
    })).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'stalled',
        actions: ['[swarm] nudged slot 2 (item wi-2) for PAN-2203: run pan done PAN-2203'],
      }),
    ]);

    await expect(classifyInFlightSlots([slot(2, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'auto',
      stallThresholdMs: 10_000,
    })).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'ready-to-merge',
        signal: 'inferred',
        actions: [],
      }),
    ]);
  });

  it('does not nudge or infer when inference is off, branch has no commits ahead, or the slot worktree is dirty', async () => {
    const cases = [
      { inferCompletion: 'off' as const, aheadCount: 1, clean: true },
      { inferCompletion: 'nudge' as const, aheadCount: 0, clean: true },
      { inferCompletion: 'nudge' as const, aheadCount: 1, clean: false },
    ];

    for (const [index, testCase] of cases.entries()) {
      resetSwarmLoopSafetyForTests();
      const agentId = `agent-pan-2203-slot-${index + 5}`;
      const sendCompletionNudge = vi.fn(async () => undefined);
      const fakeDeps = deps({
        sessions: [agentId],
        aheadCount: testCase.aheadCount,
        clean: testCase.clean,
        sendCompletionNudge,
      });
      await classifyInFlightSlots([slot(index + 5, agentId)], fakeDeps, {
        workspacePath: '/workspace',
        issueId: 'PAN-2203',
        inferCompletion: testCase.inferCompletion,
        stallThresholdMs: 10_000,
      });
      await vi.advanceTimersByTimeAsync(10_001);

      await expect(classifyInFlightSlots([slot(index + 5, agentId)], fakeDeps, {
        workspacePath: '/workspace',
        issueId: 'PAN-2203',
        inferCompletion: testCase.inferCompletion,
        stallThresholdMs: 10_000,
      })).resolves.toEqual([
        expect.objectContaining({
          lifecycle: 'stalled',
          reason: 'no-progress-timeout',
        }),
      ]);
      expect(sendCompletionNudge).not.toHaveBeenCalled();
    }
  });
});
