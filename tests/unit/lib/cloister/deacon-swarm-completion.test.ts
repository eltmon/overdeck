import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyInFlightSlots,
  getFailedMergeBlock,
  mergeReadySlots,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem } from '../../../../src/lib/agents/slot-reconcile.js';
import type { PanIssueSwarmSlotCompletion } from '../../../../src/lib/pan-dir/record.js';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';
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
  slotCompletions?: Record<number, PanIssueSwarmSlotCompletion>;
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
  | 'readCompletionObservation'
  | 'writeCompletionObservation'
  | 'clearCompletionObservation'
  | 'readSlotCompletion'
  | 'clearSlotCompletion'
> {
  const observations = new Map<string, { signature: string; nudged: boolean; consecutiveDoneCount: number }>();
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
    readCompletionObservation: vi.fn((_workspace, _issue, key) => observations.get(key)),
    writeCompletionObservation: vi.fn(async (_workspace, _issue, key, observation) => {
      observations.set(key, observation);
    }),
    clearCompletionObservation: vi.fn(async (_workspace, _issue, key) => {
      observations.delete(key);
    }),
    readSlotCompletion: vi.fn((_workspacePath: string, _issueId: string, slotIndex: number) => options.slotCompletions?.[slotIndex]),
    clearSlotCompletion: vi.fn(async () => undefined),
  };
}

function doc(): XBriefDocument {
  return {
    xBRIEFInfo: {
      version: '0.6',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      author: 'test',
      description: 'test plan',
    },
    plan: {
      id: 'pan-2203',
      title: 'test plan',
      status: 'active',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      items: [{ id: 'wi-1', title: 'work item 1', status: 'running' }],
      edges: [],
    },
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

  it('classifies a slot with a durable slot completion marker as ready-to-merge even while the pane is live', async () => {
    const agentId = 'agent-pan-2203-slot-1';

    await expect(classifyInFlightSlots([slot(1, agentId)], deps({
      sessions: [agentId],
      dead: { [agentId]: false },
      slotCompletions: {
        1: {
          slotIndex: 1,
          itemId: 'wi-1',
          agentId,
          completedAt: '2026-07-01T00:00:00.000Z',
        },
      },
    }), {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    })).resolves.toEqual([
      expect.objectContaining({ slotIndex: 1, lifecycle: 'ready-to-merge', exitStatus: 0, signal: 'durable-completion' }),
    ]);
  });

  it('PAN-3720: a live session reusing a slot id ignores the prior assignment terminal runtime resolution and stays out of the merge queue', async () => {
    // MIN-888 regression: the Deacon reassigned static id agent-min-888-slot-1
    // from completed WI-56 to fresh WI-57; the live WI-57 session inherited the
    // terminal runtime snapshot and classified ready-to-merge while orienting.
    const agentId = 'agent-pan-2203-slot-1';
    const fakeDeps = deps({
      sessions: [agentId],
      dead: { [agentId]: false },
      runtime: {
        [agentId]: {
          resolution: 'completed',
        },
      },
      // No durable slotCompletion marker for the current assignment.
    });

    const classified = await classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    });

    expect(classified).toEqual([
      expect.objectContaining({ slotIndex: 1, lifecycle: 'running' }),
    ]);
    // Runtime resolution is never merge authority — it must not even be read.
    expect(fakeDeps.getAgentRuntimeState).not.toHaveBeenCalled();

    // A running slot must never reach the merge door.
    const verifyAndMergeSlot = vi.fn();
    const mergeActions = await mergeReadySlots('PAN-2203', '/workspace', doc(), classified, {
      verifyAndMergeSlot,
      applyTaskOperationToPlanFile: vi.fn(async () => undefined),
      fireTieredCommitHooks: vi.fn(async () => []),
    });
    expect(verifyAndMergeSlot).not.toHaveBeenCalled();
    expect(mergeActions).toEqual([]);
  });

  it('PAN-3720: a vanished session reusing a slot id never merges on the prior assignment terminal runtime resolution, even with partial commits ahead', async () => {
    // Static slot ids cross assignment generations: the stale 'completed'
    // runtime snapshot belongs to the PREVIOUS work item. Without a current
    // durable slotCompletion marker the vanished slot is failed — partial
    // commits on the slot branch do not change that (the worktree is dirty,
    // so the clean committed recovery path does not apply).
    const agentId = 'agent-pan-2203-slot-1';
    const fakeDeps = deps({
      sessions: [],
      runtime: {
        [agentId]: {
          resolution: 'completed',
        },
      },
      aheadCount: 1,
      clean: false,
      // No durable slotCompletion marker for the current assignment.
    });

    const classified = await classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    });

    expect(classified).toEqual([
      expect.objectContaining({ slotIndex: 1, lifecycle: 'failed', reason: 'vanished-session' }),
    ]);
    expect(fakeDeps.getAgentRuntimeState).not.toHaveBeenCalled();

    // A failed slot must never reach the merge door.
    const verifyAndMergeSlot = vi.fn();
    const mergeActions = await mergeReadySlots('PAN-2203', '/workspace', doc(), classified, {
      verifyAndMergeSlot,
      applyTaskOperationToPlanFile: vi.fn(async () => undefined),
      fireTieredCommitHooks: vi.fn(async () => []),
    });
    expect(verifyAndMergeSlot).not.toHaveBeenCalled();
    expect(mergeActions).toEqual([]);
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

  it('recovers a vanished clean committed slot as ready-to-merge from durable git state', async () => {
    const agentId = 'agent-pan-2203-slot-1';

    await expect(classifyInFlightSlots([slot(1, agentId)], deps({
      sessions: [],
      aheadCount: 2,
      clean: true,
    }), {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    })).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 1,
        lifecycle: 'ready-to-merge',
        exitStatus: 0,
        signal: 'inferred',
      }),
    ]);
  });

  it('recovers a missing-agent clean committed slot as ready-to-merge from durable git state', async () => {
    await expect(classifyInFlightSlots([{ ...slot(2), agentId: undefined }], deps({
      sessions: [],
      aheadCount: 1,
      clean: true,
    }), {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    })).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 2,
        lifecycle: 'ready-to-merge',
        exitStatus: 0,
        signal: 'inferred',
      }),
    ]);
  });

  it('does not recover a vanished slot when the slot branch is not clean committed work', async () => {
    const agentId = 'agent-pan-2203-slot-1';

    await expect(classifyInFlightSlots([slot(1, agentId)], deps({
      sessions: [],
      aheadCount: 1,
      clean: false,
    }), {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    })).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 1,
        lifecycle: 'failed',
        reason: 'vanished-session',
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
        lifecycle: 'awaiting-completion-signal',
        signal: 'completion-nudge',
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
        lifecycle: 'awaiting-completion-signal',
        signal: 'completion-nudge',
        actions: [],
      }),
    ]);
    expect(sendCompletionNudge).toHaveBeenCalledTimes(1);
    expect(sendCompletionNudge).toHaveBeenCalledWith(agentId, 'PAN-2203');
  });

  it('does not record failed-merge recovery while waiting for a nudged slot to run pan done', async () => {
    const agentId = 'agent-pan-2203-slot-1';
    const fakeDeps = deps({
      sessions: [agentId],
      aheadCount: 1,
      clean: true,
    });

    await classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'nudge',
      stallThresholdMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_001);

    const classified = await classifyInFlightSlots([slot(1, agentId)], fakeDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
      inferCompletion: 'nudge',
      stallThresholdMs: 10_000,
    });

    expect(getFailedMergeBlock('PAN-2203', 1)).toBeUndefined();
  });

  it('keeps a live slot waiting for its durable completion signal in auto mode', async () => {
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
        lifecycle: 'awaiting-completion-signal',
        signal: 'completion-nudge',
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
        lifecycle: 'awaiting-completion-signal',
        signal: 'completion-nudge',
        actions: [],
      }),
    ]);
  });

  it('resumes the completion nudge observation after a simulated process restart without inferring live completion', async () => {
    const agentId = 'agent-pan-2203-slot-8';
    const observations = new Map<string, { signature: string; nudged: boolean; consecutiveDoneCount: number }>();
    const firstDeps = deps({ sessions: [agentId], aheadCount: 1, clean: true });
    firstDeps.readCompletionObservation = vi.fn((_workspace, _issue, key) => observations.get(key));
    firstDeps.writeCompletionObservation = vi.fn(async (_workspace, _issue, key, value) => { observations.set(key, value); });
    const options = {
      workspacePath: '/workspace', issueId: 'PAN-2203', inferCompletion: 'auto' as const, stallThresholdMs: 10_000,
    };

    await classifyInFlightSlots([slot(8, agentId)], firstDeps, options);
    await vi.advanceTimersByTimeAsync(10_001);
    await classifyInFlightSlots([slot(8, agentId)], firstDeps, options);

    const restartedDeps = deps({ sessions: [agentId], aheadCount: 1, clean: true });
    restartedDeps.readCompletionObservation = vi.fn((_workspace, _issue, key) => observations.get(key));
    restartedDeps.writeCompletionObservation = vi.fn(async (_workspace, _issue, key, value) => { observations.set(key, value); });
    await expect(classifyInFlightSlots([slot(8, agentId)], restartedDeps, options)).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'awaiting-completion-signal', signal: 'completion-nudge' }),
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
