import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  findProjectByPathSync: () => null,
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

import {
  clearFailedMergeBlock,
  getFailedMergeBlock,
  getFailedMergeBlocks,
  mergeReadySlots,
  recordFailedMergeBlock,
  recoverFailedMergeSlot,
  resetSwarmLoopSafetyForTests,
  type ClassifiedSwarmSlot,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import { readIssueRecordForWorkspaceSync, writeIssueRecordForWorkspaceSync } from '../../../../src/lib/pan-dir/record.js';
import { requeueFailedSwarmSlots } from '../../../../src/lib/cloister/swarm-failed-slot.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

beforeEach(() => {
  mocks.resolveProjectFromIssueSync.mockReturnValue(null);
});

function item(id = 'wi-a', status: VBriefItem['status'] = 'running'): VBriefItem {
  return {
    id,
    title: id,
    status,
    metadata: {
      readiness: 'ready',
      files_scope: [`src/${id}.ts`],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function doc(planItem = item()): VBriefDocument {
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
      items: [planItem],
      edges: [],
    },
  };
}

function readySlot(): ClassifiedSwarmSlot {
  return {
    itemId: 'wi-a',
    slotIndex: 1,
    status: 'in_flight',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    lifecycle: 'ready-to-merge',
    exitStatus: 0,
  };
}

function readySlotAt(index: number, itemId: string): ClassifiedSwarmSlot {
  return {
    itemId,
    slotIndex: index,
    status: 'in_flight',
    branch: `feature/pan-2203-slot-${index}`,
    agentId: `agent-pan-2203-slot-${index}`,
    lifecycle: 'ready-to-merge',
    exitStatus: 0,
  };
}

function failedSlotAt(index: number, itemId: string): ClassifiedSwarmSlot {
  return {
    itemId,
    slotIndex: index,
    status: 'in_flight',
    branch: `feature/pan-2203-slot-${index}`,
    agentId: `agent-pan-2203-slot-${index}`,
    lifecycle: 'failed',
    reason: 'pane-exit-nonzero',
    exitStatus: 1,
  };
}

function mergeDeps(): Pick<CoordinateSwarmSlotsDeps, 'verifyAndMergeSlot' | 'applyTaskOperationToPlanFile'> {
  return {
    verifyAndMergeSlot: vi.fn(async () => ({
      verified: true,
      merged: false,
      conflicts: true,
      evidence: {
        verifyCommands: ['npm run typecheck'],
        expectedOutputs: ['typecheck completes without errors'],
        commandOutputs: [],
      },
    })),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
  };
}

function recoveryDeps(): Pick<
  CoordinateSwarmSlotsDeps,
  'applyTaskOperationToPlanFile'
  | 'recordSlotAssignment'
  | 'clearSlotAssignment'
  | 'registeredSlotCapacityAvailable'
  | 'tryReserveSwarmSlot'
  | 'releaseSwarmSlot'
  | 'spawnRun'
  | 'shouldDispatch'
  | 'runGitCommand'
> {
  return {
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
    shouldDispatch: vi.fn(() => true),
    runGitCommand: vi.fn(async () => undefined),
  };
}

let workspacePath: string;

async function recordConflict(): Promise<void> {
  await mergeReadySlots('PAN-2203', workspacePath, doc(), [readySlot()], mergeDeps());
}

describe('deacon-swarm failed-merge recovery', () => {
  beforeEach(() => {
    resetSwarmLoopSafetyForTests();
    if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-2203-swarm-recovery-'));
  });

  afterEach(() => {
    if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
  });

  it('records failed-merge and blocks auto-advance until recovery runs', async () => {
    await expect(mergeReadySlots('PAN-2203', workspacePath, doc(), [readySlot()], mergeDeps()))
      .resolves.toEqual(['[swarm] failed-merge slot 1 (item wi-a) for PAN-2203']);

    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)).toEqual(expect.objectContaining({
      issueId: 'PAN-2203',
      itemId: 'wi-a',
      slotIndex: 1,
      branch: 'feature/pan-2203-slot-1',
    }));
  });

  it('retries a failed-merge slot by unblocking and re-dispatching through dispatchNextWave', async () => {
    await recordConflict();
    const fakeDeps = recoveryDeps();

    await expect(recoverFailedMergeSlot('PAN-2203', workspacePath, 1,doc(item('wi-a', 'blocked')), 'retry', fakeDeps))
      .resolves.toEqual([
        '[swarm] retrying failed-merge slot 1 (item wi-a) for PAN-2203',
        '[swarm] dispatched implementation slot 1 (item wi-a) for PAN-2203',
      ]);

    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      join(workspacePath, '.pan', 'spec.vbrief.json'),
      {
        type: 'unblock',
        itemId: 'wi-a',
        writerId: 'deacon-swarm',
        reason: 'Retrying failed swarm slot after merge conflict',
      },
      workspacePath,
    );
    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({
      slotIndex: 1,
      slotItemId: 'wi-a',
    }));
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      expect.stringContaining('git branch -m'),
      workspacePath,
    );
    const record = readIssueRecordForWorkspaceSync(workspacePath, 'PAN-2203');
    expect(record?.swarm?.supersededAttempts).toEqual(
      expect.arrayContaining([expect.objectContaining({ slotIndex: 1, itemId: 'wi-a' })]),
    );
    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)).toBeUndefined();
  });

  it('drops a failed-merge slot by marking the item done and clearing the block', async () => {
    await recordConflict();
    const fakeDeps = recoveryDeps();

    await expect(recoverFailedMergeSlot('PAN-2203', workspacePath, 1,doc(), 'drop', fakeDeps))
      .resolves.toEqual(['[swarm] dropped failed-merge slot 1 (item wi-a) for PAN-2203']);

    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      join(workspacePath, '.pan', 'spec.vbrief.json'),
      {
        type: 'done',
        itemId: 'wi-a',
        writerId: 'deacon-swarm',
        reason: 'Dropped failed swarm slot after operator recovery',
      },
      workspacePath,
    );
    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)).toBeUndefined();
  });

  it('handoff keeps auto-advance paused with an operator note', async () => {
    await recordConflict();
    const fakeDeps = recoveryDeps();

    await expect(recoverFailedMergeSlot('PAN-2203', workspacePath, 1,doc(), 'handoff', fakeDeps))
      .resolves.toEqual(['[swarm] handoff paused PAN-2203 slot 1 (item wi-a)']);

    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)?.note).toContain('Operator handoff required');
  });

  it('stores and returns multiple per-slot blocks independently', () => {
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-a', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-c', slotIndex: 3, note: 'slot 3 conflict' }, workspacePath);

    const blocks = getFailedMergeBlocks('PAN-2203', workspacePath);
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.slotIndex)).toEqual([1, 3]);
    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)?.itemId).toBe('wi-a');
    expect(getFailedMergeBlock('PAN-2203', 3, workspacePath)?.itemId).toBe('wi-c');
  });

  it('folds a legacy singular block into the per-slot map on first write and clears the singular field', () => {
    writeIssueRecordForWorkspaceSync(workspacePath, 'PAN-2203', {
      issueId: 'PAN-2203',
      schemaVersion: 2,
      feedback: [],
      swarm: {
        failedMergeBlock: {
          issueId: 'PAN-2203',
          itemId: 'wi-legacy',
          slotIndex: 2,
          note: 'legacy singular block',
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
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'test' },
    });

    expect(getFailedMergeBlocks('PAN-2203', workspacePath)).toEqual([
      expect.objectContaining({ slotIndex: 2, itemId: 'wi-legacy' }),
    ]);

    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-a', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);

    const record = JSON.parse(readFileSync(join(workspacePath, '.pan', 'records', 'pan-2203.json'), 'utf-8'));
    expect(record.swarm.failedMergeBlock).toBeUndefined();
    expect(record.swarm.failedMergeBlocks).toEqual(expect.objectContaining({
      '1': expect.objectContaining({ itemId: 'wi-a' }),
      '2': expect.objectContaining({ itemId: 'wi-legacy' }),
    }));
  });

  it('clearFailedMergeBlock removes only the targeted slot', () => {
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-a', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-c', slotIndex: 3, note: 'slot 3 conflict' }, workspacePath);

    clearFailedMergeBlock('PAN-2203', 1, workspacePath);

    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)).toBeUndefined();
    expect(getFailedMergeBlock('PAN-2203', 3, workspacePath)).toEqual(expect.objectContaining({
      itemId: 'wi-c',
      slotIndex: 3,
    }));
    expect(getFailedMergeBlocks('PAN-2203', workspacePath)).toEqual([
      expect.objectContaining({ slotIndex: 3, itemId: 'wi-c' }),
    ]);
  });

  it('durable blocks survive resetSwarmLoopSafetyForTests clearing the in-memory map', () => {
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-a', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);

    resetSwarmLoopSafetyForTests();

    expect(getFailedMergeBlocks('PAN-2203', workspacePath)).toEqual([
      expect.objectContaining({ slotIndex: 1, itemId: 'wi-a' }),
    ]);
    expect(getFailedMergeBlock('PAN-2203', 1, workspacePath)).toEqual(expect.objectContaining({
      itemId: 'wi-a',
      slotIndex: 1,
    }));
  });

  it('PAN-2364: mergeReadySlots skips a blocked ready-to-merge slot every pass', async () => {
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-b', slotIndex: 2, note: 'slot 2 conflict' }, workspacePath);
    const fakeDeps = mergeDeps();

    await expect(mergeReadySlots(
      'PAN-2203',
      workspacePath,
      doc(item('wi-b')),
      [readySlotAt(2, 'wi-b')],
      fakeDeps,
      new Set([2]),
    )).resolves.toEqual([
      '[swarm] skipped merge slot 2 (item wi-b) for PAN-2203: failed-merge block — awaiting `pan swarm recover`',
    ]);

    expect(fakeDeps.verifyAndMergeSlot).not.toHaveBeenCalled();
  });

  it('PAN-2364: requeueFailedSwarmSlots skips a blocked failed slot without archiving', async () => {
    recordFailedMergeBlock({ issueId: 'PAN-2203', itemId: 'wi-b', slotIndex: 2, note: 'slot 2 conflict' }, workspacePath);
    const fakeDeps = {
      ...recoveryDeps(),
      runGitCommand: vi.fn(async () => undefined),
    };

    const { doc: nextDoc, actions } = await requeueFailedSwarmSlots(
      'PAN-2203',
      workspacePath,
      [failedSlotAt(2, 'wi-b')],
      doc(item('wi-b')),
      {
        issueId: 'PAN-2203',
        merged: [],
        inFlight: [failedSlotAt(2, 'wi-b')],
        pending: [],
        branches: [],
        agents: [],
      },
      fakeDeps,
      new Set([2]),
    );

    expect(actions).toEqual([
      '[swarm] skipped requeue slot 2 (item wi-b) for PAN-2203: failed-merge block — awaiting operator recovery',
    ]);
    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
    expect(nextDoc.plan.items.find(i => i.id === 'wi-b')?.status).toBe('running');
  });
});
