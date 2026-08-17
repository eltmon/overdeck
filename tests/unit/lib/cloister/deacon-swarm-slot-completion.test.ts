/**
 * PAN-2372 WI-3 / FR-4: durable slot-completion marker door functions.
 *
 * writeSwarmSlotCompletion / clearSwarmSlotCompletion (deacon-swarm-record.ts)
 * write to the real workspace record door (the atomic writer landed in WI-1, the
 * project-aware path in WI-2). These are pure door tests: a real tmp workspace,
 * the real record module, a hermetic projects.js mock so an unregistered issue
 * deterministically resolves through the workspace .pan/records/ fallback.
 *
 * ACs covered:
 *  - AC1: marker persisted as swarm.slotCompletions[String(slotIndex)] with
 *    slotIndex / itemId / agentId / ISO-8601 completedAt.
 *  - AC4: an existing record's statusOverrides are preserved byte-for-byte.
 *  - Multi-slot: two distinct slot keys coexist.
 *  - clearSwarmSlotCompletion removes the key (used by the WI-4 coordinator) and
 *    is a no-op when the key is absent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic project resolution: an unregistered issue falls back to the workspace
// .pan/records/ door (the path landed in WI-2). listProjectsSync must return an
// array so resolveStateReadHomeSync never throws.
vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: () => [],
  resolveProjectFromIssueSync: () => null,
  getProjectSync: () => null,
  findProjectByPathSync: () => null,
  getProjectSwarmHotspots: () => [],
}));

import {
  writeSwarmSlotCompletion,
  clearSwarmSlotCompletion,
  clearSupersededSwarmAttempts,
  persistAndVerifySwarmSlotCompletion,
} from '../../../../src/lib/cloister/deacon-swarm-record.js';
import { clearAllSlotAssignments, recordSlotAssignment } from '../../../../src/lib/cloister/deacon-swarm.js';
import { applySupersededSlotHighWater } from '../../../../src/lib/cloister/swarm-failed-slot.js';
import { getIssueRecordPathForWorkspace } from '../../../../src/lib/pan-dir/record.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../../../helpers/git-record-fixture.js';

function readRecord(workspacePath: string, issueId: string): PanIssueRecord {
  const path = getIssueRecordPathForWorkspace(workspacePath, issueId);
  return JSON.parse(readFileSync(path, 'utf-8')) as PanIssueRecord;
}

let remote: string;

describe('PAN-2372 WI-3 writeSwarmSlotCompletion (FR-4)', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-slot-completion-'));
    remote = initGitRecordRoot(workspacePath);
  });

  afterEach(async () => {
    removeGitRecordRemote(remote);
    await cleanupGitRecordRoot(workspacePath);
  });

  it('persists the marker keyed by String(slotIndex) with the required shape (AC1)', async () => {
    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });

    const record = readRecord(workspacePath, 'PAN-2372');
    expect(record.swarm?.slotCompletions).toEqual({
      '1': {
        slotIndex: 1,
        itemId: 'wi-1',
        agentId: 'agent-pan-2372-slot-1',
        completedAt: '2026-07-10T12:00:00.000Z',
      },
    });
  });

  it('preserves an existing record byte-for-byte except the new marker (AC4)', async () => {
    const recordsDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    const pre: PanIssueRecord = {
      issueId: 'PAN-2372',
      schemaVersion: 2,
      statusOverrides: { 'wi-1': 'completed', 'wi-2': 'completed' },
      feedback: [{ from: 'review', at: '2026-07-09T00:00:00.000Z', text: 'looks good' }],
      pipeline: {
        issueId: 'PAN-2372',
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      swarm: {
        slotAssignments: [
          { slotIndex: 1, itemId: 'wi-1', agentId: 'agent-pan-2372-slot-1', assignedAt: '2026-07-09T00:00:00.000Z' },
        ],
      },
    } as PanIssueRecord;
    writeFileSync(join(recordsDir, 'pan-2372.json'), JSON.stringify(pre, null, 2));

    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });

    const after = readRecord(workspacePath, 'PAN-2372');
    // The marker landed.
    expect(after.swarm?.slotCompletions?.['1']).toEqual({
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });
    // statusOverrides and everything else survived untouched.
    expect(after.statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });
    expect(after.feedback).toEqual(pre.feedback);
    expect(after.swarm?.slotAssignments).toEqual(pre.swarm?.slotAssignments);
    expect(after.pipeline).toEqual(pre.pipeline);
  });

  it('coexists with markers for other slots (read-modify-write does not clobber siblings)', async () => {
    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });
    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 2,
      itemId: 'wi-2',
      agentId: 'agent-pan-2372-slot-2',
      completedAt: '2026-07-10T12:01:00.000Z',
    });

    const record = readRecord(workspacePath, 'PAN-2372');
    expect(Object.keys(record.swarm?.slotCompletions ?? {}).sort()).toEqual(['1', '2']);
    expect(record.swarm?.slotCompletions?.['1'].agentId).toBe('agent-pan-2372-slot-1');
    expect(record.swarm?.slotCompletions?.['2'].agentId).toBe('agent-pan-2372-slot-2');
  });
});

describe('PAN-2372 WI-3 clearSwarmSlotCompletion (FR-6)', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-slot-completion-clear-'));
    remote = initGitRecordRoot(workspacePath);
  });

  afterEach(async () => {
    removeGitRecordRemote(remote);
    await cleanupGitRecordRoot(workspacePath);
  });

  it('removes only the targeted slot key and leaves siblings intact', async () => {
    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });
    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 2,
      agentId: 'agent-pan-2372-slot-2',
      completedAt: '2026-07-10T12:01:00.000Z',
    });

    await clearSwarmSlotCompletion(workspacePath, 'PAN-2372', 1);

    const record = readRecord(workspacePath, 'PAN-2372');
    expect(record.swarm?.slotCompletions?.['1']).toBeUndefined();
    expect(record.swarm?.slotCompletions?.['2']).toBeDefined();
  });

  it('is a no-op when no marker exists for the slot', async () => {
    await expect(clearSwarmSlotCompletion(workspacePath, 'PAN-2372', 7)).resolves.toBeUndefined();
    // No record file should have been created for an issue that never had one.
    expect(existsSync(getIssueRecordPathForWorkspace(workspacePath, 'PAN-2372'))).toBe(false);
  });
});

describe('PAN-3685 merged-slot ownership consumption', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-slot-ownership-clear-'));
    remote = initGitRecordRoot(workspacePath);
  });

  afterEach(async () => {
    removeGitRecordRemote(remote);
    await cleanupGitRecordRoot(workspacePath);
  });

  it('atomically removes the assignment and completion while preserving a running sibling', async () => {
    const { clearSwarmSlotOwnership } = await import('../../../../src/lib/cloister/deacon-swarm-record.js');
    const { updateIssueRecordForWorkspace } = await import('../../../../src/lib/pan-dir/record-update.js');
    await updateIssueRecordForWorkspace(workspacePath, 'PAN-3685', record => ({
      ...record,
      swarm: {
        slotAssignments: [
          { slotIndex: 1, itemId: 'integrated' },
          { slotIndex: 2, itemId: 'running' },
        ],
        slotCompletions: {
          '1': { slotIndex: 1, itemId: 'integrated', agentId: 'agent-pan-3685-slot-1', completedAt: '2026-08-13T00:00:00.000Z' },
          '2': { slotIndex: 2, itemId: 'running', agentId: 'agent-pan-3685-slot-2', completedAt: '2026-08-13T00:00:00.000Z' },
        },
      },
    }));

    await clearSwarmSlotOwnership(workspacePath, 'PAN-3685', 1, 'integrated');

    const swarm = readRecord(workspacePath, 'PAN-3685').swarm;
    expect(swarm?.slotAssignments).toEqual([{ slotIndex: 2, itemId: 'running' }]);
    expect(swarm?.slotCompletions?.['1']).toBeUndefined();
    expect(swarm?.slotCompletions?.['2']).toBeDefined();
  });
});

describe('PAN-3690 slot ownership replacement', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-slot-ownership-replace-'));
    remote = initGitRecordRoot(workspacePath);
  });

  afterEach(async () => {
    removeGitRecordRemote(remote);
    await cleanupGitRecordRoot(workspacePath);
  });

  it('atomically clears the prior completion when assigning a new item to the same slot', async () => {
    const { updateIssueRecordForWorkspace } = await import('../../../../src/lib/pan-dir/record-update.js');
    await updateIssueRecordForWorkspace(workspacePath, 'PAN-3690', record => ({
      ...record,
      swarm: {
        slotAssignments: [{ slotIndex: 2, itemId: 'item-a' }],
        slotCompletions: {
          '2': { slotIndex: 2, itemId: 'item-a', agentId: 'agent-pan-3690-slot-2', completedAt: '2026-08-13T00:00:00.000Z' },
        },
      },
    }));

    await recordSlotAssignment(workspacePath, 'PAN-3690', {
      slotIndex: 2,
      itemId: 'item-b',
      agentId: 'agent-pan-3690-slot-2',
    });

    const swarm = readRecord(workspacePath, 'PAN-3690').swarm;
    expect(swarm?.slotAssignments).toEqual([
      expect.objectContaining({ slotIndex: 2, itemId: 'item-b' }),
    ]);
    expect(swarm?.slotCompletions).toEqual({});
  });

  it('atomically clears every assignment and completion during reset', async () => {
    const { updateIssueRecordForWorkspace } = await import('../../../../src/lib/pan-dir/record-update.js');
    await updateIssueRecordForWorkspace(workspacePath, 'PAN-3690', record => ({
      ...record,
      swarm: {
        slotAssignments: [{ slotIndex: 2, itemId: 'item-a' }],
        slotCompletions: {
          '2': { slotIndex: 2, itemId: 'item-a', agentId: 'agent-pan-3690-slot-2', completedAt: '2026-08-13T00:00:00.000Z' },
          '3': { slotIndex: 3, itemId: 'item-c', agentId: 'agent-pan-3690-slot-3', completedAt: '2026-08-13T00:01:00.000Z' },
        },
      },
    }));

    await clearAllSlotAssignments(workspacePath, 'PAN-3690');

    expect(readRecord(workspacePath, 'PAN-3690').swarm).toEqual(expect.objectContaining({
      slotAssignments: [],
      slotCompletions: {},
    }));
  });

  it('PAN-3694: clears the superseded-attempt high-water so a fresh swarm reuses indexes 1..N', async () => {
    const { updateIssueRecordForWorkspace } = await import('../../../../src/lib/pan-dir/record-update.js');
    // The MIN-888 post-reset state: superseded slot 3 retained in the record.
    await updateIssueRecordForWorkspace(workspacePath, 'PAN-3690', record => ({
      ...record,
      swarm: {
        slotAssignments: [],
        supersededAttempts: [{
          slotIndex: 3,
          itemId: 'item-c',
          agentId: 'agent-pan-3690-slot-3',
          branch: 'feature/pan-3690-slot-3',
          archivedBranch: 'feature/pan-3690-slot-3-failed-20260814000000',
          reason: 'failed swarm slot',
          supersededAt: '2026-08-14T00:00:00.000Z',
        }],
      },
    }));

    // Pre-fix behavior: the retained attempt reserves indexes 1..3, so only
    // slot 4 is dispatchable.
    const before = new Set<number>();
    expect(applySupersededSlotHighWater(before, { superseded: readRecord(workspacePath, 'PAN-3690').swarm?.supersededAttempts } as never, 1)).toBe(4);
    expect([...before].sort()).toEqual([1, 2, 3]);

    await clearSupersededSwarmAttempts(workspacePath, 'PAN-3690');

    expect(readRecord(workspacePath, 'PAN-3690').swarm?.supersededAttempts).toEqual([]);
    // Post-reset reuse: no index is reserved and the configured max stands.
    const after = new Set<number>();
    expect(applySupersededSlotHighWater(after, { superseded: readRecord(workspacePath, 'PAN-3690').swarm?.supersededAttempts } as never, 1)).toBe(1);
    expect(after.size).toBe(0);
  });
});

describe('PAN-2372 WI-3 persistAndVerifySwarmSlotCompletion (FR-4, FR-5)', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-slot-completion-verify-'));
    remote = initGitRecordRoot(workspacePath);
  });

  afterEach(async () => {
    removeGitRecordRemote(remote);
    await cleanupGitRecordRoot(workspacePath);
  });

  it('returns true and the marker is observable on the real record door', async () => {
    const ok = await persistAndVerifySwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });
    expect(ok).toBe(true);
    expect(readRecord(workspacePath, 'PAN-2372').swarm?.slotCompletions?.['1']).toBeDefined();
  });

  // The false branch (marker not observable after write) cannot occur against the
  // real door — the write and read resolve to the same path, so read-back always
  // reflects the write. It is driven via the mock in done-slot-completion.test.ts,
  // which asserts completeSlotWork exits non-zero and writes no runtime state.
});
