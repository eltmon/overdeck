import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';
import type { SwarmCommandDeps, SwarmHoldCommandDeps } from '../../../../src/cli/commands/swarm.js';
import { swarmCommand, swarmFreezeCommand, swarmRecoverCommand, swarmResumeCommand } from '../../../../src/cli/commands/swarm.js';
import { getFailedMergeBlock, resetSwarmLoopSafetyForTests } from '../../../../src/lib/cloister/deacon-swarm.js';
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
    dispatchNextWave: vi.fn(async () => ['[swarm] dispatched implementation slot 1 (item wi-1) for PAN-2203']),
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
    expect(deps.dispatchNextWave).not.toHaveBeenCalled();
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('PAN-2203 is not swarm eligible'));
    expect(deps.console.error).toHaveBeenCalledWith(expect.stringContaining('missing files_scope'));
  });

  it('ensures the workspace and dispatches wave 0 through the shared selector', async () => {
    const doc = makeDoc([
      makeEligibleItem('wi-1', 'src/a.ts'),
      makeEligibleItem('wi-2', 'src/b.ts'),
    ]);
    const deps = makeDeps(doc);

    const result = await swarmCommand('PAN-2203', deps);

    expect(result.ok).toBe(true);
    expect(deps.ensureWorkspace).toHaveBeenCalledWith('PAN-2203', { projectName: 'overdeck', projectPath: '/repo' });
    expect(deps.dispatchNextWave).toHaveBeenCalledWith(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      doc,
      expect.objectContaining({ merged: [], inFlight: [] }),
      expect.objectContaining({ swarmEligible: true }),
    );
    expect(deps.console.log).toHaveBeenCalledWith(expect.stringContaining('dispatched implementation slot 1'));
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
