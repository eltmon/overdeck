import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';
import type { SwarmCommandDeps, SwarmHoldCommandDeps, SwarmResetCommandDeps, SwarmStopCommandDeps } from '../../../../src/cli/commands/swarm.js';
import type { SwarmStatusCommandDeps } from '../../../../src/cli/commands/swarm.js';
import { swarmCommand, swarmFreezeCommand, swarmRecoverCommand, swarmResetCommand, swarmResumeCommand, swarmStatusCommand, swarmStopCommand, isSlotWorkspaceDirectoryName, listSlotWorkspaceDirectoriesSync } from '../../../../src/cli/commands/swarm.js';
import {
  coordinateSwarmSlots,
  getFailedMergeBlock,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import { writeIssueRecordForWorkspaceSync } from '../../../../src/lib/pan-dir/record.js';

function makeDoc(items: XBriefDocument['plan']['items']): XBriefDocument {
  return {
    status: 'active',
    xBRIEFInfo: { version: '0.6' },
    plan: {
      id: 'PAN-2203',
      title: 'Swarm test',
      status: 'active',
      items,
      edges: [],
    },
  } as XBriefDocument;
}

function makeEligibleItem(id: string, filePath: string): XBriefDocument['plan']['items'][number] {
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

function makeDeps(doc: XBriefDocument): SwarmCommandDeps {
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
    ensureSwarmForeman: vi.fn(async issueId => [`[swarm] spawned foreman agent-${issueId.toLowerCase()} for ${issueId}`]),
    getFailedMergeBlock: vi.fn(() => ({ issueId: 'PAN-2203', itemId: 'wi-1', slotIndex: 1, note: 'conflict' })),
    getFailedMergeBlocks: vi.fn(() => []),
    recoverFailedMergeSlot: vi.fn(async () => ['[swarm] retrying failed-merge slot 1 (item wi-1) for PAN-2203']),
    resolveSwarmPolicy: vi.fn(() => ({
      mode: 'auto' as const,
      maxSlots: 3,
      autoAdvance: true,
      source: { mode: 'global', maxSlots: 'default', autoAdvance: 'default' },
    })),
    writeSwarmPolicyMode: vi.fn(async () => undefined),
    readSwarmHold: vi.fn(() => undefined),
    readSwarmInterventionCount: vi.fn(() => 0),
    writeSwarmIntervention: vi.fn(async () => 1),
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
    expect(deps.ensureSwarmForeman).not.toHaveBeenCalled();
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('PAN-2203 is not swarm eligible'));
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('missing files_scope'));
  });

  it('dispatches a mixed plan: sequential items are diagnostics, not gates (PAN-3447)', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
      {
        id: 'wi-seq',
        title: 'Intentionally serialized work',
        status: 'pending',
        metadata: { readiness: 'sequential', files_scope: ['src/c.ts'], files_scope_confidence: 'high' },
      },
    ]);
    const deps = makeDeps(doc);

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.ensureSwarmForeman).toHaveBeenCalledWith('PAN-2203', '/repo/workspaces/feature-pan-2203', { startedBy: 'cli:swarm' });
    expect(deps.console.error).not.toHaveBeenCalledWith(expect.stringContaining('not swarm eligible'));
  });

  it('persists issue-level swarm.policy.mode=always when the effective mode is off (PAN-3459)', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = makeDeps(doc);
    deps.resolveSwarmPolicy = vi.fn(() => ({
      mode: 'off' as const,
      maxSlots: 3,
      autoAdvance: true,
      source: { mode: 'global', maxSlots: 'default', autoAdvance: 'default' },
    }));

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.writeSwarmPolicyMode).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203', 'always');
    // The opt-in must be durable BEFORE dispatch so a crash mid-coordination
    // cannot leave an orphaned swarm that patrols skip.
    const writeOrder = vi.mocked(deps.writeSwarmPolicyMode).mock.invocationCallOrder[0];
    const foremanOrder = vi.mocked(deps.ensureSwarmForeman).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(foremanOrder);
    const output = vi.mocked(deps.console.log).mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('swarm.policy.mode=always');
    expect(output).toContain('prevent automatic foreman lifecycle management');
    expect(output).not.toContain('stop the Deacon from coordinating this swarm');
  });

  it('does not touch the issue-level swarm policy when the effective mode already coordinates (PAN-3459)', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = makeDeps(doc);

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.writeSwarmPolicyMode).not.toHaveBeenCalled();
  });

  it('ensures the workspace and starts the foreman without dispatching slots', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = makeDeps(doc);

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.ensureWorkspace).toHaveBeenCalledWith('PAN-2203', { projectName: 'overdeck', projectPath: '/repo' });
    expect(deps.ensureSwarmForeman).toHaveBeenCalledWith('PAN-2203', '/repo/workspaces/feature-pan-2203', { startedBy: 'cli:swarm' });
    expect(deps.coordinateSwarmSlots).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('spawned foreman'));
  });

  it('prints the operator-hold skip and names pan swarm resume when the issue is held', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = {
      ...makeDeps(doc),
      readSwarmHold: vi.fn(() => ({ reason: 'operator hold', setBy: 'test', at: '2026-08-13T00:00:00Z' })),
    };

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(false);
    expect(deps.ensureSwarmForeman).not.toHaveBeenCalled();
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('pan swarm resume PAN-2203'));
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
        join(projectPath, '.pan', 'specs', '2026-07-01-PAN-2203-test.xbrief.json'),
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
        ensureSwarmForeman: vi.fn(async () => []),
      };

      const result = await swarmCommand('PAN-2203', deps);

      expect(result.ok).toBe(true);
      expect(spawnRun).not.toHaveBeenCalled();
      expect(deps.ensureSwarmForeman).toHaveBeenCalledTimes(1);
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
    expect(deps.getFailedMergeBlock).toHaveBeenCalledWith('PAN-2203', 1, '/repo/workspaces/feature-pan-2203');
    expect(deps.recoverFailedMergeSlot).toHaveBeenCalledWith(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      1,
      doc,
      'retry',
    );
  });

  it('recover retry routes a non-merge slot failure through coordinator archival', async () => {
    const deps = makeDeps(makeDoc([makeEligibleItem('wi-1', 'src/a.ts')]));
    deps.getFailedMergeBlock = vi.fn(() => undefined);
    deps.coordinateSwarmSlots = vi.fn(async () => [
      '[swarm] archived failed slot 3 (item wi-1) for PAN-2203',
      '[swarm] dispatched implementation slot 4 (item wi-1) for PAN-2203',
    ]);

    const result = await swarmRecoverCommand('PAN-2203', '3', { action: 'retry' }, deps);

    expect(result.ok).toBe(true);
    expect(deps.coordinateSwarmSlots).toHaveBeenCalledWith({ issueId: 'PAN-2203', manual: true });
    expect(deps.recoverFailedMergeSlot).not.toHaveBeenCalled();
  });

  it('recover against a slot with no block lists the currently blocked slots and exits nonzero', async () => {
    const deps = makeDeps(makeDoc([makeEligibleItem('wi-1', 'src/a.ts')]));
    deps.getFailedMergeBlock = vi.fn(() => undefined);
    deps.getFailedMergeBlocks = vi.fn(() => [
      { issueId: 'PAN-2203', itemId: 'wi-1', slotIndex: 1, note: 'slot 1 conflict' },
      { issueId: 'PAN-2203', itemId: 'wi-3', slotIndex: 3, note: 'slot 3 conflict' },
    ]);
    deps.coordinateSwarmSlots = vi.fn(async () => []);

    const result = await swarmRecoverCommand('PAN-2203', '2', { action: 'retry' }, deps);

    expect(result.ok).toBe(false);
    expect(deps.recoverFailedMergeSlot).not.toHaveBeenCalled();
    expect(deps.console.error).toHaveBeenCalledWith(
      expect.stringContaining('No failed-merge block for PAN-2203 slot 2'),
    );
    const errorCall = vi.mocked(deps.console.error).mock.calls.find(call =>
      String(call[0]).includes('No failed-merge block for PAN-2203 slot 2'),
    )?.[0];
    expect(String(errorCall)).toContain('slot 1 (item wi-1): slot 1 conflict');
    expect(String(errorCall)).toContain('slot 3 (item wi-3): slot 3 conflict');
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
      expect(deps.recoverFailedMergeSlot).toHaveBeenCalledWith('PAN-2203', workspace, 1, doc, 'retry');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      resetSwarmLoopSafetyForTests();
    }
  });
});

describe('pan swarm freeze / resume (PAN-2214)', () => {
  function makeHoldDeps(hold: { reason: string; setBy: string; at: string } | undefined): SwarmHoldCommandDeps {
    return {
      getIssueWorkspacePath: vi.fn(() => '/repo/workspaces/feature-pan-2203'),
      readSwarmHold: vi.fn(() => hold),
      writeSwarmHold: vi.fn(async () => undefined),
      clearSwarmHold: vi.fn(async () => undefined),
      appendOperatorInterventionEvent: vi.fn(async () => undefined),
      now: vi.fn(() => '2026-08-13T12:00:00.000Z'),
      console: { log: vi.fn(), error: vi.fn() },
    };
  }

  it('freeze persists the hold and explains foreman and Deacon responsibilities', async () => {
    const deps = makeHoldDeps(undefined);

    const result = await swarmFreezeCommand('pan-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.writeSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203', {
      reason: 'swarm freeze via pan swarm freeze', setBy: 'pan swarm freeze', at: '2026-08-13T12:00:00.000Z',
    });
    expect(deps.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2203',
      kind: 'pause',
      source: 'pan swarm freeze',
    });
    const output = vi.mocked(deps.console.log).mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('prevents the PAN-2203 foreman from running gated dispatch, merge, or recovery actions');
    expect(output).toContain('Deacon patrols preserve the hold while continuing janitor, liveness, and event-delivery backstops');
    expect(output).toContain('pan swarm resume PAN-2203');
    expect(output).not.toContain('Deacon will now skip all swarm coordination');
  });

  it('freeze records a custom --reason', async () => {
    const deps = makeHoldDeps(undefined);

    await swarmFreezeCommand('PAN-2203', { reason: 'investigating slot churn' }, deps);

    expect(deps.writeSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203', {
      reason: 'investigating slot churn', setBy: 'pan swarm freeze', at: '2026-08-13T12:00:00.000Z',
    });
  });

  it('freezing an already-frozen issue is an idempotent no-op with an already notice', async () => {
    const deps = makeHoldDeps({ reason: 'existing', setBy: 'test', at: 'now' });

    const result = await swarmFreezeCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.writeSwarmHold).not.toHaveBeenCalled();
    expect(deps.appendOperatorInterventionEvent).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('already frozen'));
  });

  it('resume clears the hold and explains foreman and Deacon responsibilities', async () => {
    const deps = makeHoldDeps({ reason: 'existing', setBy: 'test', at: 'now' });

    const result = await swarmResumeCommand('pan-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.clearSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
    expect(deps.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2203',
      kind: 'unpause',
      source: 'pan swarm resume',
    });
    const output = vi.mocked(deps.console.log).mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('Its foreman may resume gated dispatch, merge, and recovery actions');
    expect(output).toContain('Deacon patrols continue to provide janitor, liveness, and event-delivery backstops');
    expect(output).not.toContain('Deacon will pick this issue back up');
  });

  it('resuming an unfrozen issue is an idempotent no-op with an already-resumed notice', async () => {
    const deps = makeHoldDeps(undefined);

    const result = await swarmResumeCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.clearSwarmHold).not.toHaveBeenCalled();
    expect(deps.appendOperatorInterventionEvent).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('already resumed'));
  });
});

describe('pan swarm stop (PAN-2214)', () => {
  function makeStopDeps(options: {
    hold?: { reason: string; setBy: string; at: string };
    sessionNames?: string[];
    slotAgents?: Array<{ slotIndex: number; agentId: string; status: string }>;
  } = {}): SwarmStopCommandDeps & { runGitCommand: ReturnType<typeof vi.fn> } {
    return {
      getIssueWorkspacePath: vi.fn(() => '/repo/workspaces/feature-pan-2203'),
      readSwarmHold: vi.fn(() => options.hold),
      writeSwarmHold: vi.fn(async () => undefined),
      clearSwarmHold: vi.fn(async () => undefined),
      appendOperatorInterventionEvent: vi.fn(async () => undefined),
      now: vi.fn(() => '2026-08-13T12:00:00.000Z'),
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
    expect(deps.writeSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203', {
      reason: 'runaway dispatch', setBy: 'pan swarm stop', at: '2026-08-13T12:00:00.000Z',
    });
    const stopTargets = vi.mocked(deps.stopAgentSync).mock.calls.map(([agentId]) => agentId);
    expect(stopTargets).toEqual([
      'agent-pan-2203-slot-1',
      'agent-pan-2203-slot-2',
      'agent-pan-2203-slot-3',
    ]);
    const holdOrder = vi.mocked(deps.writeSwarmHold).mock.invocationCallOrder[0];
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
    expect(deps.writeSwarmHold).toHaveBeenCalled();
    expect(deps.stopAgentSync).not.toHaveBeenCalled();
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('nothing to stop'));
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('pan swarm resume PAN-2203'));
  });

  it('keeps an existing freeze in place instead of re-setting it', async () => {
    const deps = makeStopDeps({
      hold: { reason: 'existing', setBy: 'test', at: 'now' },
      sessionNames: ['agent-pan-2203-slot-1'],
    });

    const result = await swarmStopCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.writeSwarmHold).not.toHaveBeenCalled();
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
    doc?: XBriefDocument;
    hold?: { deaconIgnored?: boolean; deaconIgnoredReason?: string; stuck?: boolean; stuckReason?: string } | null;
    reconciled?: Record<string, unknown>;
    classified?: Array<Record<string, unknown>>;
    getFailedMergeBlocks?: () => Array<Record<string, unknown>>;
    sessionNames?: string[];
    liveSlotCount?: number;
    statusOverrides?: Record<string, string>;
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
      getFailedMergeBlocks: vi.fn(() => (options.getFailedMergeBlocks ? options.getFailedMergeBlocks() : [])),
      getReviewStatusSync: vi.fn(() => options.hold ?? null) as unknown as SwarmStatusCommandDeps['getReviewStatusSync'],
      readSwarmHold: vi.fn(() => undefined),
      readSwarmInterventions: vi.fn(() => ({})),
      readStatusOverrides: vi.fn(() => options.statusOverrides),
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

  it('prints foreman ownership and Deacon backstop duties when no hold is set', async () => {
    const deps = makeStatusDeps({ hold: null });

    await swarmStatusCommand('PAN-2203', deps);

    const output = loggedText(deps);
    expect(output).toContain('the foreman may run gated dispatch, merge, and recovery actions');
    expect(output).toContain('Deacon patrols provide janitor, liveness, and event-delivery backstops');
    expect(output).not.toContain('Deacon is actively coordinating');
  });

  it('applies durable status overrides before reconciling slots', async () => {
    const deps = makeStatusDeps({ statusOverrides: { 'wi-1': 'completed' } });

    await swarmStatusCommand('PAN-2203', deps);

    const effectiveDoc = vi.mocked(deps.reconcileSlotState).mock.calls[0]?.[2];
    expect(effectiveDoc?.plan.items.find(item => item.id === 'wi-1')?.status).toBe('completed');
  });

  it('PAN-2364: lists blocked slots separately and overrides ready-to-merge mislabel', async () => {
    const deps = makeStatusDeps({
      reconciled: {
        inFlight: [
          { itemId: 'wi-1', slotIndex: 1, status: 'in_flight', branch: 'feature/pan-2203-slot-1', agentId: 'agent-pan-2203-slot-1' },
          { itemId: 'wi-2', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-2203-slot-2', agentId: 'agent-pan-2203-slot-2' },
        ],
        branches: [
          { slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false },
          { slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false },
        ],
      },
      classified: [
        { itemId: 'wi-1', slotIndex: 1, lifecycle: 'ready-to-merge' },
        { itemId: 'wi-2', slotIndex: 2, lifecycle: 'running' },
      ],
      getFailedMergeBlocks: () => [
        { issueId: 'PAN-2203', itemId: 'wi-1', slotIndex: 1, note: 'merge conflict' },
        { issueId: 'PAN-2203', itemId: 'wi-3', slotIndex: 3, note: 'another conflict' },
      ],
    });

    const result = await swarmStatusCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    const output = loggedText(deps);
    expect(output).toContain('slot 1 · item wi-1 · failed-merge (blocked)');
    expect(output).not.toContain('slot 1 · item wi-1 · ready-to-merge');
    expect(output).toContain('slot 2 · item wi-2 · running');
    expect(output).toContain('Blocked slots:');
    expect(output).toContain('slot 1 (item wi-1): merge conflict. Recover with `pan swarm recover PAN-2203 1 --action retry|drop|handoff`.');
    expect(output).toContain('slot 3 (item wi-3): another conflict. Recover with `pan swarm recover PAN-2203 3 --action retry|drop|handoff`.');
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
      'getFailedMergeBlocks',
      'getReviewStatusSync',
      'listSessionNamesSync',
      'readStatusOverrides',
      'readSwarmHold',
      'readSwarmInterventions',
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
    hold?: { reason: string; setBy: string; at: string };
    // PAN-3713: nested worktree registration per parent repo cwd, and whether
    // nested slot branches still exist locally / on origin.
    registeredNestedWorktrees?: Record<string, string[]>;
    nestedBranchesPresent?: boolean;
    nestedBranchesOnOrigin?: boolean;
    // Ahead count returned for nested `feature..slot` rev-list probes.
    nestedAheadCount?: string;
  } = {}): SwarmResetCommandDeps & { gitCalls: string[] } {
    const gitCalls: string[] = [];
    const branches = options.slotBranches ?? {};
    const outerWorkspace = '/repo/workspaces/feature-pan-2203';
    const deps = {
      getIssueWorkspacePath: vi.fn(() => '/repo/workspaces/feature-pan-2203'),
      readSwarmHold: vi.fn(() => options.hold),
      writeSwarmHold: vi.fn(async () => undefined),
      clearSwarmHold: vi.fn(async () => undefined),
      appendOperatorInterventionEvent: vi.fn(async () => undefined),
      now: vi.fn(() => '2026-08-13T12:00:00.000Z'),
      listSlotAgents: vi.fn(() => (options.slotAgents ?? []) as never),
      listSessionNamesSync: vi.fn(() => options.liveSessions ?? []),
      stopAgentSync: vi.fn(),
      removeAgent: vi.fn(async () => {}),
      listSlotWorkspaceDirectories: vi.fn(() => []),
      resolveSlotWorkspaceWorktrees: vi.fn(() => ({ isPolyrepo: false, nested: [] })),
      removeDirectory: vi.fn(async () => undefined),
      resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
      clearAllSlotAssignments: vi.fn(),
      clearSupersededSwarmAttempts: vi.fn(),
      clearFailedMergeBlock: vi.fn(),
      getFailedMergeBlocks: vi.fn(() => [{ issueId: 'PAN-2203', itemId: 'wi-1', slotIndex: 1, note: 'conflict' }]),
      runGitCommand: vi.fn(async (command: string, cwd?: string) => {
        gitCalls.push(command);
        if (command.startsWith('git for-each-ref')) {
          return { stdout: `${Object.keys(branches).join('\n')}\n` };
        }
        if (command.startsWith('git branch --list ')) {
          const branch = JSON.parse(command.slice('git branch --list '.length)) as string;
          return { stdout: options.nestedBranchesPresent === false ? '' : `${branch}\n` };
        }
        if (command.startsWith('git ls-remote ')) {
          return { stdout: options.nestedBranchesOnOrigin ? 'abc123\trefs/heads/x\n' : '' };
        }
        if (command.startsWith('git rev-list --count HEAD..')) {
          for (const [branch, count] of Object.entries(branches)) {
            if (command === `git rev-list --count HEAD..${JSON.stringify(branch)}`) return { stdout: `${count}\n` };
          }
          return { stdout: '0\n' };
        }
        if (command.startsWith('git rev-list --count ')) {
          return { stdout: `${options.nestedAheadCount ?? '0'}\n` };
        }
        if (command === 'git worktree list --porcelain') {
          if (cwd && cwd !== outerWorkspace) {
            // A parent repo's porcelain list names its own main worktree plus
            // whatever nested slot worktrees remain registered (PAN-3713).
            const lines = [`worktree ${cwd}`];
            for (const path of options.registeredNestedWorktrees?.[cwd] ?? []) lines.push(`worktree ${path}`);
            return { stdout: `${lines.join('\n')}\n` };
          }
          const lines = [`worktree ${outerWorkspace}`];
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

  it('removes stale polyrepo slot directories and nested worktrees left by reset', async () => {
    const slotWorkspace = '/repo/workspaces/feature-pan-2203-slot-4';
    const deps = makeResetDeps({
      registeredNestedWorktrees: { '/repo/api': [`${slotWorkspace}/api`] },
    });
    deps.listSlotWorkspaceDirectories = vi.fn(() => [slotWorkspace]);
    deps.resolveSlotWorkspaceWorktrees = vi.fn(() => ({
      isPolyrepo: true,
      nested: [{
        repoKey: 'api',
        dir: `${slotWorkspace}/api`,
        parentRepo: '/repo/api',
        featureBranch: 'feature/pan-2203',
      }],
    }));

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.runGitCommand).toHaveBeenCalledWith(
      'git worktree remove --force "/repo/workspaces/feature-pan-2203-slot-4/api"',
      '/repo/api',
    );
    expect(deps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
  });

  it('treats an already-unregistered nested worktree as success and continues cleanup (PAN-3713)', async () => {
    const slotWorkspace = '/repo/workspaces/feature-pan-2203-slot-2';
    // fe is still registered; api's worktree registration is already gone —
    // the exact mix that crashed reset with "fatal: '<path>' is not a working tree".
    const deps = makeResetDeps({
      registeredNestedWorktrees: { '/repo/fe': [`${slotWorkspace}/fe`] },
    });
    deps.listSlotWorkspaceDirectories = vi.fn(() => [slotWorkspace]);
    deps.resolveSlotWorkspaceWorktrees = vi.fn(() => ({
      isPolyrepo: true,
      nested: [
        { repoKey: 'fe', dir: `${slotWorkspace}/fe`, parentRepo: '/repo/fe', featureBranch: 'feature/pan-2203' },
        { repoKey: 'api', dir: `${slotWorkspace}/api`, parentRepo: '/repo/api', featureBranch: 'feature/pan-2203' },
      ],
    }));

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    // The registered nested worktree is removed through git…
    expect(deps.runGitCommand).toHaveBeenCalledWith(
      'git worktree remove --force "/repo/workspaces/feature-pan-2203-slot-2/fe"',
      '/repo/fe',
    );
    // …the unregistered one is pruned, never force-removed (that call is the PAN-3713 crash)…
    expect(deps.runGitCommand).not.toHaveBeenCalledWith(
      'git worktree remove --force "/repo/workspaces/feature-pan-2203-slot-2/api"',
      '/repo/api',
    );
    expect(deps.runGitCommand).toHaveBeenCalledWith('git worktree prune', '/repo/api');
    // …both merged slot branches are deleted without a push, the slot
    // directory is removed, and slot state is cleared through the writer.
    expect(deps.runGitCommand).toHaveBeenCalledWith('git branch -D "feature/pan-2203-slot-2"', '/repo/fe');
    expect(deps.runGitCommand).toHaveBeenCalledWith('git branch -D "feature/pan-2203-slot-2"', '/repo/api');
    expect(deps.gitCalls.some(cmd => cmd.startsWith('git push'))).toBe(false);
    expect(deps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
    expect(deps.clearAllSlotAssignments).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
  });

  it('still pushes an unmerged nested branch before removing its unregistered worktree (PAN-3713)', async () => {
    const slotWorkspace = '/repo/workspaces/feature-pan-2203-slot-2';
    // The nested slot branch exists locally with 2 commits the feature branch
    // lacks; its worktree registration is already gone.
    const deps = makeResetDeps({ nestedAheadCount: '2' });
    deps.listSlotWorkspaceDirectories = vi.fn(() => [slotWorkspace]);
    deps.resolveSlotWorkspaceWorktrees = vi.fn(() => ({
      isPolyrepo: true,
      nested: [
        { repoKey: 'api', dir: `${slotWorkspace}/api`, parentRepo: '/repo/api', featureBranch: 'feature/pan-2203' },
      ],
    }));

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.runGitCommand).toHaveBeenCalledWith('git push origin "feature/pan-2203-slot-2"', '/repo/api');
    expect(deps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
  });

  it('re-running reset after partial cleanup succeeds when nested branches are already gone (PAN-3713)', async () => {
    const slotWorkspace = '/repo/workspaces/feature-pan-2203-slot-2';
    const deps = makeResetDeps({ nestedBranchesPresent: false });
    deps.listSlotWorkspaceDirectories = vi.fn(() => [slotWorkspace]);
    deps.resolveSlotWorkspaceWorktrees = vi.fn(() => ({
      isPolyrepo: true,
      nested: [
        { repoKey: 'api', dir: `${slotWorkspace}/api`, parentRepo: '/repo/api', featureBranch: 'feature/pan-2203' },
      ],
    }));

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.gitCalls.some(cmd => cmd.startsWith('git push'))).toBe(false);
    expect(deps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
    expect(deps.clearAllSlotAssignments).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
    expect(loggedText(deps)).toContain('absent from /repo/api and origin');
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
    // PAN-3694: an aborted reset must preserve the superseded-attempt history —
    // clearing it is only valid once every slot workspace/branch removal succeeded.
    expect(deps.clearSupersededSwarmAttempts).not.toHaveBeenCalled();
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
    // PAN-3694: a successful reset also clears the superseded-attempt high-water
    // so a fresh swarm may reuse indexes 1..N.
    expect(deps.clearSupersededSwarmAttempts).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
    expect(deps.clearFailedMergeBlock).toHaveBeenCalledWith('PAN-2203', 1, '/repo/workspaces/feature-pan-2203');
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
    expect(deps.removeAgent).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.removeAgent).toHaveBeenCalledWith('agent-pan-2203-slot-2');
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
    expect(deps.removeAgent).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.removeAgent).not.toHaveBeenCalledWith('agent-pan-2203-slot-2');
    expect(loggedText(deps)).toContain('Skipped live slot agent session(s): agent-pan-2203-slot-2');
  });

  it('retires through removeAgent only so JSONL transcript paths are untouched', async () => {
    const deps = makeResetDeps({
      slotAgents: [
        { slotIndex: 1, agentId: 'agent-pan-2203-slot-1', status: 'stopped' },
      ],
    });

    await swarmResetCommand('PAN-2203', {}, deps);

    expect(deps.removeAgent).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(deps.gitCalls.some(call => call.includes('.jsonl'))).toBe(false);
  });

  it('preserves the hold and names pan swarm resume as the re-enable step', async () => {
    const deps = makeResetDeps({ slotBranches: {} });

    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(true);
    expect(deps.writeSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203', expect.any(Object));
    expect(deps.clearSwarmHold).not.toHaveBeenCalled();
    expect(loggedText(deps)).toContain('hold REMAINS SET');
    expect(loggedText(deps)).toContain('pan swarm resume PAN-2203');
    expect(loggedText(deps)).toContain('foreman cannot run gated dispatch, merge, or recovery actions');
    expect(loggedText(deps)).toContain('Deacon patrols preserve the hold');
    expect(loggedText(deps)).not.toContain('Deacon still skips all swarm coordination');
  });

  it('is idempotent on a clean issue and deletes merged branches without pushing', async () => {
    const clean = makeResetDeps({ slotBranches: {}, worktreeSlotPaths: [] });
    await expect(swarmResetCommand('PAN-2203', {}, clean)).resolves.toEqual({ ok: true });
    expect(clean.gitCalls.some(cmd => cmd.startsWith('git push'))).toBe(false);
    expect(clean.gitCalls.some(cmd => cmd.startsWith('git branch -D'))).toBe(false);
    expect(clean.removeAgent).not.toHaveBeenCalled();
    expect(loggedText(clean)).toContain('retired no dead slot agent records');

    const merged = makeResetDeps({ slotBranches: { 'feature/pan-2203-slot-1': '0' } });
    await expect(swarmResetCommand('PAN-2203', {}, merged)).resolves.toEqual({ ok: true });
    expect(merged.gitCalls.some(cmd => cmd.startsWith('git push'))).toBe(false);
    expect(merged.gitCalls.some(cmd => cmd === 'git branch -D "feature/pan-2203-slot-1"')).toBe(true);
  });

  it('a stale slot directory removal failure is a controlled reset failure and clears no state (PAN-3717)', async () => {
    const slotWorkspace = '/repo/workspaces/feature-pan-2203-slot-2';
    const deps = makeResetDeps({});
    deps.listSlotWorkspaceDirectories = vi.fn(() => [slotWorkspace]);
    deps.resolveSlotWorkspaceWorktrees = vi.fn(() => ({ isPolyrepo: true, nested: [] }));
    // The PAN-3717 crash: root-owned container artifacts (fe/.pnpm-store)
    // make the recursive host-side removal fail with EACCES.
    deps.removeDirectory = vi.fn(async () => {
      throw Object.assign(
        new Error(`EACCES: permission denied, rmdir '${slotWorkspace}/fe/.pnpm-store/v10'`),
        { code: 'EACCES' },
      );
    });

    // Must resolve with a controlled failure — never an uncaught exception.
    const result = await swarmResetCommand('PAN-2203', {}, deps);

    expect(result.ok).toBe(false);
    expect(loggedText(deps)).toContain(slotWorkspace);
    expect(loggedText(deps)).toContain('EACCES');
    expect(loggedText(deps)).toContain('NOT cleared');
    expect(loggedText(deps)).toContain('pan swarm reset PAN-2203');
    // Recorded slot state survives so a re-run picks up exactly here.
    expect(deps.clearAllSlotAssignments).not.toHaveBeenCalled();
    expect(deps.clearSupersededSwarmAttempts).not.toHaveBeenCalled();
    expect(deps.clearFailedMergeBlock).not.toHaveBeenCalled();
    expect(deps.removeAgent).not.toHaveBeenCalled();
  });

  it('re-running reset after a failed directory removal succeeds and clears state (PAN-3717)', async () => {
    const slotWorkspace = '/repo/workspaces/feature-pan-2203-slot-2';
    const deps = makeResetDeps({});
    deps.listSlotWorkspaceDirectories = vi.fn(() => [slotWorkspace]);
    deps.resolveSlotWorkspaceWorktrees = vi.fn(() => ({ isPolyrepo: true, nested: [] }));
    deps.removeDirectory = vi.fn(async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    await expect(swarmResetCommand('PAN-2203', {}, deps)).resolves.toEqual({ ok: false });
    expect(deps.clearAllSlotAssignments).not.toHaveBeenCalled();

    // Removal now succeeds (e.g. the Docker fallback cleaned the root-owned
    // artifacts): the same reset run reaches completion and clears state.
    deps.removeDirectory = vi.fn(async () => undefined);
    const rerun = await swarmResetCommand('PAN-2203', {}, deps);

    expect(rerun.ok).toBe(true);
    expect(deps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
    expect(deps.clearAllSlotAssignments).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
    expect(deps.clearSupersededSwarmAttempts).toHaveBeenCalledWith('/repo/workspaces/feature-pan-2203', 'PAN-2203');
  });
});

describe('listSlotWorkspaceDirectoriesSync (PAN-3717 containment)', () => {
  it('returns only real exact-name slot directories — never symlinks or preserved archives', () => {
    const root = mkdtempSync(join(tmpdir(), 'swarm-slots-'));
    try {
      const workspaces = join(root, 'workspaces');
      mkdirSync(workspaces);
      const realSlot = join(workspaces, 'feature-min-888-slot-1');
      mkdirSync(realSlot);
      // A symlink planted at a slot-shaped name must never reach the
      // privileged Docker bind mount in removeWorkspaceDirectory.
      const elsewhere = join(root, 'elsewhere');
      mkdirSync(elsewhere);
      symlinkSync(elsewhere, join(workspaces, 'feature-min-888-slot-2'));
      // Operator-preserved archives share the -slot- prefix but are not slots.
      mkdirSync(join(workspaces, 'feature-min-888-slot-3-reset-backup-20260814'));

      const found = listSlotWorkspaceDirectoriesSync(join(workspaces, 'feature-min-888'));

      expect(found).toEqual([realSlot]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('isSlotWorkspaceDirectoryName (PAN-3694)', () => {
  const base = 'feature-min-888';

  it('accepts exact slot workspace directory names', () => {
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-1')).toBe(true);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-12')).toBe(true);
  });

  it('rejects preserved archive directories that share the -slot- prefix', () => {
    // The MIN-888 recovery archives that crashed slotBranchFromPath.
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-1-reset-backup-20260814')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-2-failed-20260814120000')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-3-quarantine')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-1-backup')).toBe(false);
  });

  it('rejects non-numeric slot suffixes and other issues\' workspaces', () => {
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-1a')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888-slot-x')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-889-slot-1')).toBe(false);
    expect(isSlotWorkspaceDirectoryName(base, 'feature-min-888')).toBe(false);
  });
});
