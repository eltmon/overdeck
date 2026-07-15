import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyInFlightSlots,
  dispatchNextWave,
  getFailedMergeBlock,
  getFailedMergeBlocks,
  recordFailedMergeBlock,
  recordStalledSlotRecovery,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import {
  classifyDoneWithoutSignal,
  resetSwarmCompletionInferenceForTests,
  swarmInferCompletionMode,
  type DoneWithoutSignalObservation,
} from '../../../../src/lib/cloister/deacon-swarm-completion.js';
import type { ReconciledSlotItem, SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

const STALL_THRESHOLD_MS = 10_000;

function slot(overrides: Partial<ReconciledSlotItem> = {}): ReconciledSlotItem {
  return {
    itemId: 'wi-a',
    slotIndex: 1,
    status: 'in_flight',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    ...overrides,
  };
}

function item(id = 'wi-a'): VBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: {
      readiness: 'ready',
      files_scope: [`src/${id}.ts`],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function doc(items: VBriefItem[] = [item()]): VBriefDocument {
  return {
    vBRIEFInfo: {
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
      items,
      edges: [],
    },
  };
}

function classifyDeps(output = 'same pane output'): Pick<
  CoordinateSwarmSlotsDeps,
  'listSessionNames'
  | 'isPaneDead'
  | 'getPaneExitStatus'
  | 'getPaneOutputDigest'
  | 'getBranchTipCommitTime'
> {
  return {
    listSessionNames: vi.fn(async () => ['agent-pan-2203-slot-1']),
    isPaneDead: vi.fn(async () => false),
    getPaneExitStatus: vi.fn(async () => null),
    getPaneOutputDigest: vi.fn(async () => output),
    getBranchTipCommitTime: vi.fn(async () => new Date('2026-07-01T00:00:00.000Z').getTime()),
  };
}

type StallDispatchDeps = Pick<
  CoordinateSwarmSlotsDeps,
  'registeredSlotCapacityAvailable'
  | 'tryReserveSwarmSlot'
  | 'releaseSwarmSlot'
  | 'applyTaskOperationToPlanFile'
  | 'recordSlotAssignment'
  | 'clearSlotAssignment'
  | 'spawnRun'
  | 'shouldDispatch'
  | 'getMaxSlotIndex'
  | 'listSlotAssignments'
  | 'listSessionNames'
  | 'slotWorktreeExists'
>;

function dispatchDeps(overrides: Partial<StallDispatchDeps> = {}): StallDispatchDeps {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
    shouldDispatch: vi.fn(() => true),
    getMaxSlotIndex: vi.fn(() => 4),
    listSlotAssignments: vi.fn(() => []),
    listSessionNames: vi.fn(async () => []),
    slotWorktreeExists: vi.fn(() => false),
    ...overrides,
  };
}

function reconciled(overrides: Partial<SlotReconcileResult> = {}): SlotReconcileResult {
  return {
    issueId: 'PAN-2203',
    merged: [],
    inFlight: [],
    pending: [],
    branches: [],
    agents: [],
    ...overrides,
  };
}

describe('deacon-swarm stalled-slot detection and duplicate-spawn guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    resetSwarmLoopSafetyForTests();
    vi.useRealTimers();
  });

  it('marks a running slot stalled after no branch commit or pane output progress, then escalates recovery', async () => {
    const deps = classifyDeps();

    await expect(classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    })).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'running' }),
    ]);

    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1);

    const classified = await classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    });

    expect(classified).toEqual([
      expect.objectContaining({
        lifecycle: 'stalled',
        reason: 'no-progress-timeout',
        stalledForMs: STALL_THRESHOLD_MS + 1,
      }),
    ]);
    expect(await recordStalledSlotRecovery('PAN-2203', classified)).toEqual([
      '[swarm] stalled slot 1 (item wi-a) for PAN-2203: recovery required',
    ]);
    expect(getFailedMergeBlock('PAN-2203', 1)).toEqual(expect.objectContaining({
      itemId: 'wi-a',
      slotIndex: 1,
      note: expect.stringContaining('stalled'),
    }));
  });

  it('PAN-2364: records a block for every stalled slot in one pass', async () => {
    const classified = [
      { ...slot(), lifecycle: 'stalled' as const, reason: 'no-progress-timeout' as const, stalledForMs: STALL_THRESHOLD_MS + 1 },
      { ...slot({ itemId: 'wi-b', slotIndex: 2, branch: 'feature/pan-2203-slot-2', agentId: 'agent-pan-2203-slot-2' }), lifecycle: 'stalled' as const, reason: 'no-progress-timeout' as const, stalledForMs: STALL_THRESHOLD_MS + 1 },
    ];

    expect(await recordStalledSlotRecovery('PAN-2203', classified)).toEqual([
      '[swarm] stalled slot 1 (item wi-a) for PAN-2203: recovery required',
      '[swarm] stalled slot 2 (item wi-b) for PAN-2203: recovery required',
    ]);
    expect(getFailedMergeBlock('PAN-2203', 1)).toEqual(expect.objectContaining({ itemId: 'wi-a', slotIndex: 1 }));
    expect(getFailedMergeBlock('PAN-2203', 2)).toEqual(expect.objectContaining({ itemId: 'wi-b', slotIndex: 2 }));
  });

  it('PAN-2364: only records blocks for newly stalled slots when others already hold blocks', async () => {
    await recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-a', slotIndex: 1, note: 'Slot 1 stalled with no branch commit or pane output progress' });
    const classified = [
      { ...slot(), lifecycle: 'stalled' as const, reason: 'no-progress-timeout' as const, stalledForMs: STALL_THRESHOLD_MS + 1 },
      { ...slot({ itemId: 'wi-b', slotIndex: 2, branch: 'feature/pan-2203-slot-2', agentId: 'agent-pan-2203-slot-2' }), lifecycle: 'stalled' as const, reason: 'no-progress-timeout' as const, stalledForMs: STALL_THRESHOLD_MS + 1 },
    ];

    expect(await recordStalledSlotRecovery('PAN-2203', classified)).toEqual([
      '[swarm] stalled slot 2 (item wi-b) for PAN-2203: recovery required',
    ]);
    expect(getFailedMergeBlock('PAN-2203', 1)).toEqual(expect.objectContaining({ itemId: 'wi-a', slotIndex: 1 }));
    expect(getFailedMergeBlock('PAN-2203', 2)).toEqual(expect.objectContaining({ itemId: 'wi-b', slotIndex: 2 }));
  });

  it('PAN-2364: repeated passes over the same stalled slot are idempotent and do not rewrite the block', async () => {
    const classified = [{ ...slot(), lifecycle: 'stalled' as const, reason: 'no-progress-timeout' as const, stalledForMs: STALL_THRESHOLD_MS + 1 }];

    expect(await recordStalledSlotRecovery('PAN-2203', classified)).toEqual([
      '[swarm] stalled slot 1 (item wi-a) for PAN-2203: recovery required',
    ]);
    expect(await recordStalledSlotRecovery('PAN-2203', classified)).toEqual([]);
    expect(getFailedMergeBlocks('PAN-2203')).toHaveLength(1);
  });

  it('keeps a fresh slot running within the threshold', async () => {
    const deps = classifyDeps();

    await classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    });
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS - 1);

    await expect(classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    })).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'running' }),
    ]);
  });

  it('advances past a live slot session the registry missed and spawns on the next index (PAN-2213)', async () => {
    const plan = doc([item('wi-a')]);
    const fakeDeps = dispatchDeps({
      listSessionNames: vi.fn(async () => ['agent-pan-2203-slot-1']),
    });

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled(), analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual([
        '[swarm] slot 1 occupied for PAN-2203: live agent-pan-2203-slot-1 session already exists — advancing',
        '[swarm] dispatched implementation slot 2 (item wi-a) for PAN-2203',
      ]);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({ slotIndex: 2 }));
  });

  it('reserves unknown branch and worktree slots, spawning on the next free index (PAN-2213)', async () => {
    const plan = doc([item('wi-a')]);
    const fakeDeps = dispatchDeps({
      slotWorktreeExists: vi.fn((path: string) => path === '/workspace-slot-2'),
    });

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled({
      branches: [{ slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false }],
    }), analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual(['[swarm] dispatched implementation slot 3 (item wi-a) for PAN-2203']);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({ slotIndex: 3 }));
  });
});

describe('PAN-2372 WI-4 durable slot-completion marker (FR-6)', () => {
  // classifyInFlightSlots now takes an optional readSlotCompletion dep. The marker
  // — swarm.slotCompletions[String(slotIndex)], written durably by slot `pan done`
  // (WI-3) — is the STRONGEST completion signal: it is the durable record that the
  // slot finished, so it is checked before session/agent/runtime classification and
  // beats a vanished session or a missing agent (the runtime plane is rebuildable).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    resetSwarmLoopSafetyForTests();
    vi.useRealTimers();
  });

  function marker(slotIndex: number, itemId?: string) {
    return {
      slotIndex,
      ...(itemId !== undefined ? { itemId } : {}),
      agentId: `agent-pan-2203-slot-${slotIndex}`,
      completedAt: '2026-07-01T00:00:00.000Z',
    };
  }

  it('AC1: a matching marker classifies ready-to-merge durable-completion with the session alive and idle', async () => {
    const deps = {
      ...classifyDeps(),
      readSlotCompletion: vi.fn(async () => marker(1, 'wi-a')),
    };

    const result = await classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    });

    // The marker wins even though the session is alive and idle (classifyDeps
    // lists the agent session as present) — it does not wait for the session to exit.
    expect(result).toEqual([
      expect.objectContaining({ lifecycle: 'ready-to-merge', signal: 'durable-completion', exitStatus: 0 }),
    ]);
    expect(deps.readSlotCompletion).toHaveBeenCalledWith('/workspace', 'PAN-2203', 1);
  });

  it('AC2: a marker whose itemId differs from the slot is ignored and the slot falls through to normal classification', async () => {
    const deps = {
      ...classifyDeps(),
      // Stale marker left for a different item (e.g. a re-plan rotated slot→item).
      readSlotCompletion: vi.fn(async () => marker(1, 'wi-other')),
    };

    const result = await classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    });

    // Session alive + not dead ⇒ running. The mismatched marker did NOT short-circuit.
    expect(result).toEqual([expect.objectContaining({ lifecycle: 'running' })]);
    expect(result[0]?.signal).not.toBe('durable-completion');
  });

  it('AC3: a marker beats a vanished session — the slot is still ready-to-merge durable-completion', async () => {
    // Same slot, but the agent session is GONE (not in listSessionNames). Without
    // the marker this classifies as failed 'vanished-session'; with the durable
    // marker it is ready-to-merge — proving the marker beats vanished classification.
    const vanishedDeps = {
      ...classifyDeps(),
      listSessionNames: vi.fn(async () => []),
    };

    const withoutMarker = await classifyInFlightSlots([slot()], vanishedDeps, {
      workspacePath: '/workspace',
      issueId: 'PAN-2203',
    });
    expect(withoutMarker).toEqual([expect.objectContaining({ lifecycle: 'failed', reason: 'vanished-session' })]);

    const withMarker = await classifyInFlightSlots([slot()], {
      ...vanishedDeps,
      readSlotCompletion: vi.fn(async () => marker(1, 'wi-a')),
    }, { workspacePath: '/workspace', issueId: 'PAN-2203' });
    expect(withMarker).toEqual([
      expect.objectContaining({ lifecycle: 'ready-to-merge', signal: 'durable-completion', exitStatus: 0 }),
    ]);
  });
});

describe('PAN-2372 WI-5 infer_completion default + classifyDoneWithoutSignal modes (FR-8)', () => {
  // The default flipped nudge → auto: a stalled, alive-idle, clean+ahead slot now gets ONE
  // completion nudge and then converges to ready-to-merge signal 'inferred' after two stable
  // observations. Explicit 'nudge' (never converges) and 'off' (no nudge, returns null) keep
  // their prior semantics. classifyDoneWithoutSignal is exercised directly — the task names it
  // — with an injected now/options and mocked ahead/clean deps, so no wall-clock waits.
  const originalEnv = process.env.PAN_SWARM_INFER_COMPLETION;

  beforeEach(() => {
    resetSwarmCompletionInferenceForTests();
    delete process.env.PAN_SWARM_INFER_COMPLETION;
  });

  afterEach(() => {
    resetSwarmCompletionInferenceForTests();
    if (originalEnv === undefined) delete process.env.PAN_SWARM_INFER_COMPLETION;
    else process.env.PAN_SWARM_INFER_COMPLETION = originalEnv;
  });

  function doneDeps() {
    return {
      getSlotBranchAheadCount: vi.fn(async () => 1),
      isSlotWorktreeClean: vi.fn(async () => true),
      sendCompletionNudge: vi.fn(async () => undefined),
    };
  }

  function observation(overrides: Partial<DoneWithoutSignalObservation> = {}): DoneWithoutSignalObservation {
    return { commitTime: 1000, outputDigest: 'stable-digest', progressKey: 'wi-a-slot-1', stalledForMs: 9999, ...overrides };
  }

  const opts = (inferCompletion: 'auto' | 'nudge' | 'off') => ({
    workspacePath: '/workspace',
    issueId: 'PAN-2203',
    inferCompletion,
  });

  it('AC1: swarmInferCompletionMode falls back to auto and honors explicit env values', () => {
    // An unparseable env value reaches the fallback branch — proving it is now 'auto'
    // (the same branch an absent config/env takes).
    process.env.PAN_SWARM_INFER_COMPLETION = 'garbage';
    expect(swarmInferCompletionMode()).toBe('auto');
    // Explicit valid values are honored (config.yaml / env opt-out semantics preserved).
    for (const value of ['auto', 'nudge', 'off'] as const) {
      process.env.PAN_SWARM_INFER_COMPLETION = value;
      expect(swarmInferCompletionMode()).toBe(value);
    }
  });

  it('AC2: auto mode nudges exactly once and converges to ready-to-merge inferred after two stable observations', async () => {
    const deps = doneDeps();
    const options = opts('auto');

    const first = await classifyDoneWithoutSignal(slot(), deps, options, observation());
    expect(first).toEqual(expect.objectContaining({ lifecycle: 'awaiting-completion-signal', signal: 'completion-nudge' }));
    expect(deps.sendCompletionNudge).toHaveBeenCalledTimes(1);

    // Same signature (stable commit + output) ⇒ second consecutive stable observation.
    const second = await classifyDoneWithoutSignal(slot(), deps, options, observation());
    expect(second).toEqual(expect.objectContaining({ lifecycle: 'ready-to-merge', signal: 'inferred', exitStatus: 0 }));
    // No second nudge on the converging pass — exactly one nudge across the two observations.
    expect(deps.sendCompletionNudge).toHaveBeenCalledTimes(1);
  });

  it('AC3: nudge mode never converges; off mode returns null and nudges nothing', async () => {
    // nudge: nudges once on the first pass, then stays awaiting-completion-signal however many
    // stable observations accrue (mode !== 'auto' never reaches the converge branch).
    const nudgeDeps = doneDeps();
    const nudgeOpts = opts('nudge');
    for (let pass = 1; pass <= 3; pass++) {
      const result = await classifyDoneWithoutSignal(slot(), nudgeDeps, nudgeOpts, observation());
      expect(result).toEqual(expect.objectContaining({ lifecycle: 'awaiting-completion-signal' }));
      expect(result?.signal).not.toBe('inferred');
    }
    expect(nudgeDeps.sendCompletionNudge).toHaveBeenCalledTimes(1);

    // off: distinct progressKey so it is independent of the nudge observations above.
    const offDeps = doneDeps();
    const off = await classifyDoneWithoutSignal(slot(), offDeps, opts('off'), observation({ progressKey: 'off-slot' }));
    expect(off).toBeNull();
    expect(offDeps.sendCompletionNudge).not.toHaveBeenCalled();
  });
});
