import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';
import type { SwarmCommandDeps, SwarmHoldCommandDeps, SwarmResetCommandDeps, SwarmStopCommandDeps } from '../../../../src/cli/commands/swarm.js';
import type { SwarmStatusCommandDeps } from '../../../../src/cli/commands/swarm.js';
import { swarmCommand, swarmFreezeCommand, swarmRecoverCommand, swarmResetCommand, swarmResumeCommand, swarmStatusCommand, swarmStopCommand } from '../../../../src/cli/commands/swarm.js';
import {
  coordinateSwarmSlots,
  getFailedMergeBlock,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import { writeIssueRecordForWorkspaceSync } from '../../../../src/lib/pan-dir/record.js';

function makeDoc(items: VBriefDocument['plan']['items']): VBriefDocument {
  return {
    status: 'active',
    vBRIEFInfo: { version: '0.6' },
    plan: {
      id: 'PAN-2203',
      title: 'Swarm test',
      status: 'active',
      items,
      edges: [],
    },
  } as VBriefDocument;
}

function makeEligibleItem(id: string, filePath: string): VBriefDocument['plan']['items'][number] {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: {
      readiness: 'ready',
      files_scope: [filePath],
      files_scope_confidence: 'high',
      verify_commands: ['npm test'],
      expected_outputs: ['tests pass'],
    },
  };
}

function makeDeps(doc: VBriefDocument): SwarmCommandDeps {
  return {
    resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
    findSpecByIssue: vi.fn(() => Effect.succeed({
      path: '/repo/.pan/specs/pan-2203.json',
      filename: 'pan-2203.json',
      issueId: 'PAN-2203',
      document: doc,
      status: 'active',
    })),
    analyzeSwarmReadiness: vi.fn(() => ({
      items: doc.plan.items.map(item => ({
        id: item.id,
        readiness: item.metadata?.readiness,
        slotEligible: item.metadata?.readiness === 'ready' && (item.metadata?.files_scope?.length ?? 0) > 0,
        scopeConfidence: item.metadata?.files_scope_confidence,
        missingScope: (item.metadata?.files_scope?.length ?? 0) === 0,
        overlaps: [],
      })),
      waves: [],
      conflictGroups: [],
      overlapMatrix: {},
      swarmEligible: doc.plan.items.some(item => item.metadata?.readiness === 'ready' && (item.metadata?.files_scope?.length ?? 0) > 0),
    })),
    ensureWorkspace: vi.fn(async () => '/repo/workspaces/feature-pan-2203'),
    coordinateSwarmSlots: vi.fn(async () => [
      '[swarm] considered PAN-2203: swarm eligible',
      '[swarm] dispatched implementation slot 1 (item wi-1) for PAN-2203',
    ]),
    getFailedMergeBlock: vi.fn(() => ({ issueId: 'PAN-2203', itemId: 'wi-1', slotIndex: 1, note: 'conflict' })),
    recoverFailedMergeSlot: vi.fn(async () => ['[swarm] retrying failed-merge slot 1 (item wi-1) for PAN-2203']),
    console: {
      log: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('pan swarm command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints why a non-swarm-eligible plan cannot dispatch and exits nonzero', async () => {
    const doc = makeDoc([{
      id: 'wi-1',
      title: 'Needs scope',
      status: 'pending',
      metadata: { readiness: 'ready' },
    }]);
    const deps = makeDeps(doc);

    const result = await swarmCommand('pan-2203', deps);

    expect(result.ok).toBe(false);
    expect(deps.ensureWorkspace).not.toHaveBeenCalled();
    expect(deps.coordinateSwarmSlots).not.toHaveBeenCalled();
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('PAN-2203 is not swarm eligible'));
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('missing files_scope'));
  });

  it('ensures the workspace and dispatches through coordinateSwarmSlots with real reconcile (PAN-2214)', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = makeDeps(doc);

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.ensureWorkspace).toHaveBeenCalledWith('PAN-2203', { projectName: 'overdeck', projectPath: '/repo' });
    expect(deps.coordinateSwarmSlots).toHaveBeenCalledWith({ issueId: 'PAN-2203' });
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('dispatched implementation slot 1'));
  });

  it('prints the operator-hold skip and names pan swarm resume when the issue is held', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = {
      ...makeDeps(doc),
      coordinateSwarmSlots: vi.fn(async () => ['[swarm] skipped PAN-2203: deacon-ignored — operator hold']),
    };

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.console.log).toHaveBeenCalledWith('[swarm] skipped PAN-2203: deacon-ignored — operator hold');
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('pan swarm resume PAN-2203'));
    expect(deps.console.log).not.toHaveBeenCalledWith(expect.stringContaining('continue in Deacon'));
  });

  it('re-running pan swarm is idempotent: already-dispatched work is reconciled, not re-spawned', async () => {
    resetSwarmLoopSafetyForTests();
    const projectPath = mkdtempSync(join(tmpdir(), 'pan-2203-swarm-idem-'));
    try {
      const doc = makeDoc([
        makeEligibleItem('wi-1', 'src/a.ts'),
        makeEligibleItem('wi-2', 'src/b.ts'),
      ]);
      mkdirSync(join(projectPath, '.pan', 'specs'), { recursive: true });
      writeFileSync(
        join(projectPath, '.pan', 'specs', '2026-07-01-PAN-2203-test.vbrief.json'),
        JSON.stringify({ ...doc, status: 'active' }, null, 2),
      );
      const workspacePath = join(projectPath, 'workspaces', 'feature-pan-2203');
      mkdirSync(workspacePath, { recursive: true });

      // Inner deps model the state AFTER a first run dispatched both items:
      // live sessions, unmerged branches, durable assignments, in-flight items.
      const spawnRun = vi.fn(async () => undefined);
      const inner = {
        listFeatureWorkspaces: () => [{ issueId: 'PAN-2203', workspacePath, projectPath }],
        reconcileSlotState: async () => ({
          issueId: 'PAN-2203',
          merged: [],
          inFlight: [
            { itemId: 'wi-1', slotIndex: 1, status: 'in_flight', branch: 'feature/pan-2203-slot-1', agentId: 'agent-pan-2203-slot-1' },
            { itemId: 'wi-2', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-2203-slot-2', agentId: 'agent-pan-2203-slot-2' },
          ],
          pending: [],
          branches: [
            { slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false },
            { slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false },
          ],
          agents: [
            { slotIndex: 1, agentId: 'agent-pan-2203-slot-1' },
            { slotIndex: 2, agentId: 'agent-pan-2203-slot-2' },
          ],
        }),
        listSessionNames: async () => ['agent-pan-2203-slot-1', 'agent-pan-2203-slot-2'],
        isPaneDead: async () => false,
        getPaneExitStatus: async () => null,
        getAgentRuntimeState: async () => null,
        getPaneOutputDigest: async () => 'live output',
        getBranchTipCommitTime: async () => 1_750_000_000_000,
        slotWorktreeExists: () => false,
        verifyAndMergeSlot: vi.fn(async () => ({ merged: false } )),
        applyTaskOperationToPlanFile: vi.fn(async () => undefined),
        recordSlotAssignment: vi.fn(),
        clearSlotAssignment: vi.fn(),
        runGitCommand: vi.fn(async () => ({ stdout: '' })),
        registeredSlotCapacityAvailable: () => true,
        tryReserveSwarmSlot: () => true,
        releaseSwarmSlot: vi.fn(),
        spawnRun,
        getIssueHold: () => null,
        shouldDispatch: () => true,
        getMaxSlotIndex: () => 3,
        listSlotAssignments: () => [{ slotIndex: 1 }, { slotIndex: 2 }],
      } as unknown as CoordinateSwarmSlotsDeps;
      const deps = {
        ...makeDeps(doc),
        ensureWorkspace: vi.fn(async () => workspacePath),
        coordinateSwarmSlots: vi.fn((opts) => coordinateSwarmSlots(opts, inner)),
      };

      const result = await swarmCommand('PAN-2203', deps);

      expect(result.ok).toBe(true);
      expect(spawnRun).not.toHaveBeenCalled();
      expect(result.actions).toContain('[swarm] considered PAN-2203: swarm eligible');
      expect(result.actions.some(action => action.includes('dispatched'))).toBe(false);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      resetSwarmLoopSafetyForTests();
    }
  });

  it('recover retry calls the failed-slot recovery path for the requested slot', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = makeDeps(doc);

    const result = await swarmRecoverCommand('PAN-2203', '1', { action: 'retry' }, deps);

    expect(result.ok).toBe(true);
    expect(deps.getFailedMergeBlock).toHaveBeenCalledWith('PAN-2203', '/repo/workspaces/feature-pan-2203');
    expect(deps.recoverFailedMergeSlot).toHaveBeenCalledWith(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      doc,
      'retry',
    );
  });

  it('recover reads a failed slot persisted by Deacon instead of a CLI-local map', async () => {
    resetSwarmLoopSafetyForTests();
    const workspace = mkdtempSync(join(tmpdir(), 'pan-2203-swarm-recover-'));
    try {
      const doc = makeDoc([
        makeEligibleItem('wi-1', 'src/a.ts'),
        makeEligibleItem('wi-2', 'src/b.ts'),
      ]);
      writeIssueRecordForWorkspaceSync(workspace, 'PAN-2203', {
        issueId: 'PAN-2203',
        schemaVersion: 2,
        feedback: [],
        swarm: {
          failedMergeBlock: {
            issueId: 'PAN-2203',
            itemId: 'wi-1',
            slotIndex: 1,
            branch: 'feature/pan-2203-slot-1',
            note: 'persisted by Deacon',
          },
        },
        pipeline: {
          issueId: 'PAN-2203',
          reviewStatus: 'pending',
          testStatus: 'pending',
          mergeStatus: 'pending',
          readyForMerge: false,
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
        closeOut: {
          usage: { byStage: {}, totals: {} },
          merges: [],
          ranOn: 'test',
        },
      });
      const deps = {
        ...makeDeps(doc),
        ensureWorkspace: vi.fn(async () => workspace),
        getFailedMergeBlock,
      };

      const result = await swarmRecoverCommand('PAN-2203', '1', { action: 'retry' }, deps);

      expect(result.ok).toBe(true);
      expect(deps.recoverFailedMergeSlot).toHaveBeenCalledWith('PAN-2203', workspace, doc, 'retry');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      resetSwarmLoopSafetyForTests();
    }
  });
});

describe('pan swarm freeze / resume (PAN-2214)', () => {
  function makeHoldDeps(status: { deaconIgnored?: boolean } | null): SwarmHoldCommandDeps {
    return {
      getReviewStatusSync: vi.fn(() => status as ReturnType<SwarmHoldCommandDeps['getReviewStatusSync']>),
      setDeaconIgnored: vi.fn(),
      appendOperatorInterventionEvent: vi.fn(async () => undefined),
      console: { log: vi.fn(), error: vi.fn() },
    };
  }

  it('freeze persists deaconIgnored with the default reason and explains the hold', async () => {
    const deps = makeHoldDeps(null);

    const result = await swarmFreezeCommand('pan-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).toHaveBeenCalledWith('PAN-2203', true, 'swarm freeze via pan swarm freeze');
    expect(deps.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2203',
      kind: 'pause',
      source: 'pan swarm freeze',
    });
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('skip all swarm coordination for PAN-2203'));
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('pan swarm resume PAN-2203'));
  });

  it('freeze records a custom --reason', async () => {
    const deps = makeHoldDeps(null);

    await swarmFreezeCommand('PAN-2203', { reason: 'investigating slot churn' }, deps);

    expect(deps.setDeaconIgnored).toHaveBeenCalledWith('PAN-2203', true, 'investigating slot churn');
  });

  it('freezing an already-frozen issue is an idempotent no-op with an already notice', async () => {
    const deps = makeHoldDeps({ deaconIgnored: true });

    const result = await swarmFreezeCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).not.toHaveBeenCalled();
    expect(deps.appendOperatorInterventionEvent).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('already frozen'));
  });

  it('resume clears deaconIgnored and points at the next patrol cycle', async () => {
    const deps = makeHoldDeps({ deaconIgnored: true });

    const result = await swarmResumeCommand('pan-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).toHaveBeenCalledWith('PAN-2203', false);
    expect(deps.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2203',
      kind: 'unpause',
      source: 'pan swarm resume',
    });
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('next patrol'));
  });

  it('resuming an unfrozen issue is an idempotent no-op with an already-resumed notice', async () => {
    const deps = makeHoldDeps(null);

    const result = await swarmResumeCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).not.toHaveBeenCalled();
    expect(deps.appendOperatorInterventionEvent).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('already resumed'));
  });
});

describe('pan swarm stop (PAN-2214)', () => {
  function makeStopDeps(options: {
    status?: { deaconIgnored?: boolean } | null;
    sessionNames?: string[];
    slotAgents?: Array<{ slotIndex: number; agentId: string; status: string }>;
  } = {}): SwarmStopCommandDeps & { runGitCommand: ReturnType<typeof vi.fn> } {
    return {
      getReviewStatusSync: vi.fn(() => (options.status ?? null) as ReturnType<SwarmStopCommandDeps['getReviewStatusSync']>),
      setDeaconIgnored: vi.fn(),
      appendOperatorInterventionEvent: vi.fn(async () => undefined),
      listSlotAgents: vi.fn(() => (options.slotAgents ?? []) as ReturnType<SwarmStopCommandDeps['listSlotAgents']>),
      listSessionNamesSync: vi.fn(() => options.sessionNames ?? []),
      stopAgentSync: vi.fn(),
      runGitCommand: vi.fn(),
      console: { log: vi.fn(), error: vi.fn() },
    };
  }

  it('sets the hold BEFORE any stop call and stops every live slot agent', async () => {
    const deps = makeStopDeps({
      sessionNames: ['agent-pan-2203-slot-1', 'agent-pan-2203-slot-2', 'agent-pan-9999-slot-1', 'conv-foo'],
      slotAgents: [{ slotIndex: 3, agentId: 'agent-pan-2203-slot-3', status: 'running' }],
    });

    const result = await swarmStopCommand('pan-2203', { reason: 'runaway dispatch' }, deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).toHaveBeenCalledWith('PAN-2203', true, 'runaway dispatch');
    const stopTargets = vi.mocked(deps.stopAgentSync).mock.calls.map(([agentId]) => agentId);
    expect(stopTargets).toEqual([
      'agent-pan-2203-slot-1',
      'agent-pan-2203-slot-2',
      'agent-pan-2203-slot-3',
    ]);
    const holdOrder = vi.mocked(deps.setDeaconIgnored).mock.invocationCallOrder[0];
    for (const stopOrder of vi.mocked(deps.stopAgentSync).mock.invocationCallOrder) {
      expect(holdOrder).toBeLessThan(stopOrder);
    }
  });

  it('with zero live slots it exits ok, sets the hold, and reports nothing was running', async () => {
    const deps = makeStopDeps({
      slotAgents: [{ slotIndex: 4, agentId: 'agent-pan-2203-slot-4', status: 'stopped' }],
    });

    const result = await swarmStopCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).toHaveBeenCalledWith('PAN-2203', true, 'swarm stop via pan swarm stop');
    expect(deps.stopAgentSync).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('nothing to stop'));
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('pan swarm resume PAN-2203'));
  });

  it('keeps an existing freeze in place instead of re-setting it', async () => {
    const deps = makeStopDeps({
      status: { deaconIgnored: true },
      sessionNames: ['agent-pan-2203-slot-1'],
    });

    const result = await swarmStopCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).not.toHaveBeenCalled();
    expect(deps.stopAgentSync).toHaveBeenCalledWith('agent-pan-2203-slot-1');
  });

  it('preserves slot branches and worktrees: no git deletion commands are issued', async () => {
    const deps = makeStopDeps({
      sessionNames: ['agent-pan-2203-slot-1', 'agent-pan-2203-slot-2'],
    });

    await swarmStopCommand('PAN-2203', {}, deps);

    expect(deps.runGitCommand).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('branches and worktrees are preserved'));
  });

  it('reports per-slot stop failures and exits nonzero', async () => {
    const deps = makeStopDeps({
      sessionNames: ['agent-pan-2203-slot-1', 'agent-pan-2203-slot-2'],
    });
    vi.mocked(deps.stopAgentSync).mockImplementation((agentId: string) => {
      if (agentId.endsWith('slot-2')) throw new Error('tmux kill failed');
    });

    const result = await swarmStopCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(false);
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('agent-pan-2203-slot-2'));
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('1 of 2 slot agent(s) stopped'));
  });
});

describe('pan swarm status (PAN-2214)', () => {
  function makeStatusDeps(options: {
    doc?: VBriefDocument;
    hold?: { deaconIgnored?: boolean; deaconIgnoredReason?: string; stuck?: boolean; stuckReason?: string } | null;
    reconciled?: Record<string, unknown>;
    classified?: Array<Record<string, unknown>>;
    sessionNames?: string[];
    liveSlotCount?: number;
  } = {}): SwarmStatusCommandDeps {
    const doc = options.doc ?? makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    return {
      resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
      findSpecByIssue: vi.fn(() => Effect.succeed({
        path: '/repo/.pan/specs/pan-2203.json',
        filename: 'pan-2203.json',
        issueId: 'PAN-2203',
        document: doc,
        status: 'active',
      })) as unknown as SwarmStatusCommandDeps['findSpecByIssue'],
      reconcileSlotState: vi.fn(async () => ({
        issueId: 'PAN-2203',
        merged: [],
        inFlight: [],
        pending: [],
        branches: [],
        agents: [],
        ...options.reconciled,
      })) as unknown as SwarmStatusCommandDeps['reconcileSlotState'],
      classifyInFlightSlots: vi.fn(async () => (options.classified ?? []) as never),
      getReviewStatusSync: vi.fn(() => options.hold ?? null) as unknown as SwarmStatusCommandDeps['getReviewStatusSync'],
      listSessionNamesSync: vi.fn(() => options.sessionNames ?? []),
      getConcurrencyLimits: vi.fn(() => ({
        maxWorkAgents: 4,
        reservedAdvancingSlots: 2,
        reservedSwarmSlots: 3,
        totalCeiling: 6,
        exemptOperatorStarted: true,
      })),
      countRunningSwarmSlotsForIssue: vi.fn(() => options.liveSlotCount ?? 0),
      console: { log: vi.fn(), error: vi.fn() },
    };
  }

  function loggedText(deps: SwarmStatusCommandDeps): string {
    return vi.mocked(deps.console.log).mock.calls.map(call => call.join(' ')).join('\n');
  }

  it('renders one row per reconciled slot with index, item, lifecycle, branch state, and session liveness', async () => {
    const deps = makeStatusDeps({
      reconciled: {
        merged: [{ itemId: 'wi-0', slotIndex: 1, status: 'merged', branch: 'feature/pan-2203-slot-1', agentId: 'agent-pan-2203-slot-1' }],
        inFlight: [{ itemId: 'wi-1', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-2203-slot-2', agentId: 'agent-pan-2203-slot-2' }],
        branches: [
          { slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: true },
          { slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false },
        ],
      },
      classified: [{ itemId: 'wi-1', slotIndex: 2, lifecycle: 'running' }],
      sessionNames: ['agent-pan-2203-slot-2'],
      liveSlotCount: 1,
    });

    const result = await swarmStatusCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    const output = loggedText(deps);
    expect(output).toContain('slot 1 · item wi-0 · merged · branch feature/pan-2203-slot-1 (merged) · session dead');
    expect(output).toContain('slot 2 · item wi-1 · running · branch feature/pan-2203-slot-2 (unmerged) · session alive');
    expect(output).toContain('Capacity: 1 of 3 swarm slots in use');
  });

  it('prints the hold reason and the resume command when a hold is active', async () => {
    const deps = makeStatusDeps({
      hold: { deaconIgnored: true, deaconIgnoredReason: 'operator freeze' },
    });

    await swarmStatusCommand('PAN-2203', deps);

    const output = loggedText(deps);
    expect(output).toContain('Hold: deacon-ignored');
    expect(output).toContain('pan swarm resume PAN-2203');
    expect(output).toContain('Reason: operator freeze');
  });

  it('prints that coordination is active when no hold is set', async () => {
    const deps = makeStatusDeps({ hold: null });

    await swarmStatusCommand('PAN-2203', deps);

    expect(loggedText(deps)).toContain('Hold: none — the Deacon is actively coordinating this issue on every patrol.');
  });

  it('is read-only: no record writes, git mutations, or spawns are possible through its deps', async () => {
    const deps = makeStatusDeps({
      reconciled: {
        inFlight: [{ itemId: 'wi-1', slotIndex: 1, status: 'in_flight', branch: 'feature/pan-2203-slot-1', agentId: 'agent-pan-2203-slot-1' }],
      },
      classified: [{ itemId: 'wi-1', slotIndex: 1, lifecycle: 'running' }],
    });

    const result = await swarmStatusCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    // The deps surface has no write, git-mutation, or spawn members at all —
    // assert the only calls made were the read-side ones.
    expect(deps.reconcileSlotState).toHaveBeenCalledTimes(1);
    expect(deps.classifyInFlightSlots).toHaveBeenCalledTimes(1);
    expect(Object.keys(deps).sort()).toEqual([
      'classifyInFlightSlots',
      'console',
      'countRunningSwarmSlotsForIssue',
      'findSpecByIssue',
      'getConcurrencyLimits',
      'getReviewStatusSync',
      'listSessionNamesSync',
      'reconcileSlotState',
      'resolveProjectFromIssueSync',
    ]);
  });
});

describe('pan swarm reset (PAN-2214)', () => {
  function makeResetDeps(options: {
    slotBranches?: Record<string, string>; // branch → ahead count stdout
    worktreeSlotPaths?: string[];
    pushFailsFor?: string[];
    slotAgents?: Array<{ slotIndex: number; agentId: string; status: string }>;
    liveSessions?: string[];
    status?: { deaconIgnored?: boolean } | null;
  } = {}): SwarmResetCommandDeps & { gitCalls: string[] } {
    const gitCalls: string[] = [];
    const branches = options.slotBranches ?? {};
    const deps = {
      getReviewStatusSync: vi.fn(() => (options.status ?? null) as never),
      setDeaconIgnored: vi.fn(),
      appendOperatorInterventionEvent: vi.fn(async () => undefined),
      listSlotAgents: vi.fn(() => (options.slotAgents ?? []) as never),
      listSessionNamesSync: vi.fn(() => options.liveSessions ?? []),
      stopAgentSync: vi.fn(),
      removeAgentSync: vi.fn(),
      resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
      clearAllSlotAssignments: vi.fn(),
      clearFailedMergeBlock: vi.fn(),
      runGitCommand: vi.fn(async (command: string) => {
        gitCalls.push(command);
        if (command.startsWith('git for-each-ref')) {
          return { stdout: `${Object.keys(branches).join('\n')}\n` };
        }
        if (command.startsWith('git rev-list --count HEAD..')) {
          for (const [branch, count] of Object.entries(branches)) {
            if (command === `git rev-list --count HEAD..${JSON.stringify(branch)}`) return { stdout: `${count}\n` };
          }
          return { stdout: '0\n' };
        }
        if (command === 'git worktree list --porcelain') {
          const lines = ['worktree /repo/workspaces/feature-pan-2203'];
          for (const path of options.worktreeSlotPaths ?? []) lines.push(`worktree ${path}`);
          return { stdout: `${lines.join('\n')}\n` };
        }
        if (command.startsWith('git push origin ')) {
          for (const failing of options.pushFailsFor ?? []) {
            if (command === `git push origin ${JSON.stringify(failing)}`) throw new Error('remote rejected');
          }
          return { stdout: '' };
        }
        return { stdout: '' };
      }),
      console: { log: vi.fn(), error: vi.fn() },
    };
    return Object.assign(deps as unknown as SwarmResetCommandDeps, { gitCalls });
  }

  function loggedText(deps: SwarmResetCommandDeps): string {
    return [
      ...vi.mocked(deps.console.log).mock.calls,
      ...vi.mocked(deps.console.error).mock.calls,
    ].map(call => call.join(' ')).join('\n');
  }

  it('pushes an unmerged slot branch to origin BEFORE any deletion', async () => {
    const deps = makeResetDeps({
      slotBranches: { 'feature/pan-2203-slot-1': '2' },
      worktreeSlotPaths: ['/repo/workspaces/feature-pan-2203-slot-1'],
    });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    const pushIndex = deps.gitCalls.findIndex(cmd => cmd === 'git push origin "feature/pan-2203-slot-1"');
    const removeIndex = deps.gitCalls.findIndex(cmd => cmd.startsWith('git worktree remove'));
    const deleteIndex = deps.gitCalls.findIndex(cmd => cmd.startsWith('git branch -D'));
    expect(pushIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(pushIndex);
    expect(deleteIndex).toBeGreaterThan(pushIndex);
  });

  it('a push failure without --force aborts with the branch named and deletes nothing', async () => {
    const deps = makeResetDeps({
      slotBranches: { 'feature/pan-2203-slot-1': '2' },
      worktreeSlotPaths: ['/repo/workspaces/feature-pan-2203-slot-1'],
      pushFailsFor: ['feature/pan-2203-slot-1'],
    });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(false);
    expect(loggedText(deps)).toContain('feature/pan-2203-slot-1');
    expect(loggedText(deps)).toContain('Nothing was deleted');
    expect(deps.gitCalls.some(cmd => cmd.startsWith('git worktree remove'))).toBe(false);
    expect(deps.gitCalls.some(cmd => cmd.startsWith('git branch -D'))).toBe(false);
    expect(deps.clearAllSlotAssignments).not.toHaveBeenCalled();
  });

  it('--force continues past a push failure and still deletes', async () => {
    const deps = makeResetDeps({
      slotBranches: { 'feature/pan-2203-slot-1': '2' },
      pushFailsFor: ['feature/pan-2203-slot-1'],
    });

    const result = await swarmResetCommand('PAN-2203', { force: true }, deps);

    expect(result.ok).toBe(true);
    expect(deps.gitCalls.some(cmd => cmd === 'git branch -D "feature/pan-2203-slot-1"')).toBe(true);
  });

  it('clears slot assignments, the failed-merge block, and stops lingering slot agent rows', async () => {
    const deps = makeResetDeps({
      slotBranches: { 'feature/pan-2203-slot-1': '0' },
      slotAgents: [
        { slotIndex: 1, agentId: 'agent-pan-2203-slot-1', status: 'running' },
        { slotIndex: 2, agentId: 'agent-pan-2203-slot-2', status: 'stopped' },
      ],
    });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.clearAllSlotAssignments).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
    expect(deps.clearFailedMergeBlock).toHaveBeenCalledWith('PAN-2203', '/repo/workspaces/feature-pan-2203');
    // The running row is stopped twice at most (once via stop's enumeration, once via the
    // final sweep) — the essential guarantee is it is stopped and the stopped row is not touched.
    expect(deps.stopAgentSync).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.stopAgentSync).not.toHaveBeenCalledWith('agent-pan-2203-slot-2');
  });

  it('retires stopped slot agent records with no live tmux session', async () => {
    const deps = makeResetDeps({
      slotAgents: [
        { slotIndex: 1, agentId: 'agent-pan-2203-slot-1', status: 'stopped' },
        { slotIndex: 2, agentId: 'agent-pan-2203-slot-2', status: 'failed' },
      ],
    });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.removeAgentSync).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.removeAgentSync).toHaveBeenCalledWith('agent-pan-2203-slot-2');
    expect(loggedText(deps)).toContain('retired 2 dead slot agent record(s): agent-pan-2203-slot-1, agent-pan-2203-slot-2');
  });

  it('does not retire slot agents with live tmux sessions and reports them as skipped', async () => {
    const deps = makeResetDeps({
      slotAgents: [
        { slotIndex: 1, agentId: 'agent-pan-2203-slot-1', status: 'stopped' },
        { slotIndex: 2, agentId: 'agent-pan-2203-slot-2', status: 'stopped' },
      ],
      liveSessions: ['agent-pan-2203-slot-2'],
    });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.removeAgentSync).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.removeAgentSync).not.toHaveBeenCalledWith('agent-pan-2203-slot-2');
    expect(loggedText(deps)).toContain('Skipped live slot agent session(s): agent-pan-2203-slot-2');
  });

  it('retires through removeAgentSync only so JSONL transcript paths are untouched', async () => {
    const deps = makeResetDeps({
      slotAgents: [
        { slotIndex: 1, agentId: 'agent-pan-2203-slot-1', status: 'stopped' },
      ],
    });

    await swarmResetCommand('PAN-2203', {}, deps);

    expect(deps.removeAgentSync).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.gitCalls.some(call => call.includes('.jsonl'))).toBe(false);
  });

  it('preserves the hold and names pan swarm resume as the re-enable step', async () => {
    const deps = makeResetDeps({ slotBranches: {} });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.setDeaconIgnored).toHaveBeenCalledWith('PAN-2203', true, expect.any(String));
    expect(deps.setDeaconIgnored).not.toHaveBeenCalledWith('PAN-2203', false);
    expect(loggedText(deps)).toContain('hold REMAINS SET');
    expect(loggedText(deps)).toContain('pan swarm resume PAN-2203');
  });

  it('is idempotent on a clean issue and deletes merged branches without pushing', async () => {
    const clean = makeResetDeps({ slotBranches: {}, worktreeSlotPaths: [] });
    await expect(swarmResetCommand('PAN-2203', {}, clean)).resolves.toEqual({ ok: true });
    expect(clean.gitCalls.some(cmd => cmd.startsWith('git push'))).toBe(false);
    expect(clean.gitCalls.some(cmd => cmd.startsWith('git branch -D'))).toBe(false);
    expect(clean.removeAgentSync).not.toHaveBeenCalled();
    expect(loggedText(clean)).toContain('retired no dead slot agent records');

    const merged = makeResetDeps({ slotBranches: { 'feature/pan-2203-slot-1': '0' } });
    await expect(swarmResetCommand('PAN-2203', {}, merged)).resolves.toEqual({ ok: true });
    expect(merged.gitCalls.some(cmd => cmd.startsWith('git push'))).toBe(false);
    expect(merged.gitCalls.some(cmd => cmd === 'git branch -D "feature/pan-2203-slot-1"')).toBe(true);
  });
});
