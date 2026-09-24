/**
 * PAN-2372 WI-3 / FR-4, re-pointed by PAN-3917: the durable slot-completion
 * door.
 *
 * These were record-door tests: they wrote to the per-issue record on the state
 * plane and asserted that item overrides and the pipeline block survived a
 * read-modify-write. The record is gone. The same facts now live in
 * the slot ledger — `<planHome>/.pan/continues/<ISSUE>.slots.json` — which is
 * ordinary repo content, so the tests read it back through the store instead of
 * parsing a record file.
 *
 * ACs covered:
 *  - AC1: marker persisted as slotCompletions[String(slotIndex)] with
 *    slotIndex / itemId / agentId / ISO-8601 completedAt.
 *  - AC4: an existing ledger's other fields survive the write untouched.
 *  - Multi-slot: two distinct slot keys coexist.
 *  - clearSwarmSlotCompletion removes the key and is a no-op when absent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../../src/lib/projects.js', () => ({
  // resolvePlanHome() asks projects.ts which repo owns `.pan/`; unregistered
  // fixtures resolve to the checkout root they were handed.
  resolveInfraRepo: (_project: unknown, checkoutRoot: string) => ({ repoPath: checkoutRoot }),
  listProjectsSync: () => [],
  resolveProjectFromIssueSync: () => null,
  getProjectSync: () => null,
  findProjectByPath: () => null,
  getProjectSwarmHotspots: () => [],
}));

import {
  writeSwarmSlotCompletion,
  clearSwarmSlotCompletion,
  clearSupersededSwarmAttempts,
  clearSwarmSlotOwnership,
  readSwarmSlotState,
} from '../../../../src/lib/cloister/deacon-swarm-record.js';
import { clearAllSlotAssignments, recordSlotAssignment } from '../../../../src/lib/cloister/deacon-swarm.js';
import { applySupersededSlotHighWater } from '../../../../src/lib/cloister/swarm-failed-slot.js';
import { swarmSlotStatePath, updateSwarmSlotState } from '../../../../src/lib/cloister/swarm-slot-store.js';

let projectRoot: string;
let workspacePath: string;

/** A realistic `<project>/workspaces/feature-<issue>` layout. */
function makeWorkspace(prefix: string, issueLower: string): void {
  projectRoot = mkdtempSync(join(tmpdir(), prefix));
  workspacePath = join(projectRoot, 'workspaces', `feature-${issueLower}`);
  mkdirSync(workspacePath, { recursive: true });
}

function slots(issueId: string) {
  return readSwarmSlotState(workspacePath, issueId);
}

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('writeSwarmSlotCompletion (FR-4)', () => {
  beforeEach(() => makeWorkspace('pan-slot-completion-', 'pan-2372'));

  it('persists the marker keyed by String(slotIndex) with the required shape (AC1)', async () => {
    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });

    expect(slots('PAN-2372')?.slotCompletions).toEqual({
      '1': {
        slotIndex: 1,
        itemId: 'wi-1',
        agentId: 'agent-pan-2372-slot-1',
        completedAt: '2026-07-10T12:00:00.000Z',
      },
    });
  });

  it('preserves the rest of an existing ledger (AC4)', async () => {
    updateSwarmSlotState(workspacePath, 'PAN-2372', state => ({
      ...state,
      finalizedAt: '2026-07-09T00:00:00.000Z',
      slotAssignments: [
        { slotIndex: 1, itemId: 'wi-1', agentId: 'agent-pan-2372-slot-1', assignedAt: '2026-07-09T00:00:00.000Z' },
      ],
    }));

    await writeSwarmSlotCompletion(workspacePath, 'PAN-2372', {
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });

    const after = slots('PAN-2372');
    expect(after?.slotCompletions?.['1']).toEqual({
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: '2026-07-10T12:00:00.000Z',
    });
    expect(after?.finalizedAt).toBe('2026-07-09T00:00:00.000Z');
    expect(after?.slotAssignments).toEqual([
      { slotIndex: 1, itemId: 'wi-1', agentId: 'agent-pan-2372-slot-1', assignedAt: '2026-07-09T00:00:00.000Z' },
    ]);
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

    const completions = slots('PAN-2372')?.slotCompletions ?? {};
    expect(Object.keys(completions).sort()).toEqual(['1', '2']);
    expect(completions['1']!.agentId).toBe('agent-pan-2372-slot-1');
    expect(completions['2']!.agentId).toBe('agent-pan-2372-slot-2');
  });
});

describe('clearSwarmSlotCompletion (FR-6)', () => {
  beforeEach(() => makeWorkspace('pan-slot-completion-clear-', 'pan-2372'));

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

    expect(slots('PAN-2372')?.slotCompletions?.['1']).toBeUndefined();
    expect(slots('PAN-2372')?.slotCompletions?.['2']).toBeDefined();
  });

  it('is a no-op when no marker exists for the slot', async () => {
    await expect(clearSwarmSlotCompletion(workspacePath, 'PAN-2372', 7)).resolves.toBeUndefined();
    // No ledger is created for an issue that never had one.
    expect(existsSync(swarmSlotStatePath(workspacePath, 'PAN-2372'))).toBe(false);
  });
});

describe('PAN-3685 merged-slot ownership consumption', () => {
  beforeEach(() => makeWorkspace('pan-slot-ownership-clear-', 'pan-3685'));

  it('atomically removes the assignment and completion while preserving a running sibling', async () => {
    updateSwarmSlotState(workspacePath, 'PAN-3685', state => ({
      ...state,
      slotAssignments: [
        { slotIndex: 1, itemId: 'integrated' },
        { slotIndex: 2, itemId: 'running' },
      ],
      slotCompletions: {
        '1': { slotIndex: 1, itemId: 'integrated', agentId: 'agent-pan-3685-slot-1', completedAt: '2026-08-13T00:00:00.000Z' },
        '2': { slotIndex: 2, itemId: 'running', agentId: 'agent-pan-3685-slot-2', completedAt: '2026-08-13T00:00:00.000Z' },
      },
    }));

    await clearSwarmSlotOwnership(workspacePath, 'PAN-3685', 1, 'integrated');

    const state = slots('PAN-3685');
    expect(state?.slotAssignments).toEqual([{ slotIndex: 2, itemId: 'running' }]);
    expect(state?.slotCompletions?.['1']).toBeUndefined();
    expect(state?.slotCompletions?.['2']).toBeDefined();
  });
});

describe('PAN-3690 slot ownership replacement', () => {
  beforeEach(() => makeWorkspace('pan-slot-ownership-replace-', 'pan-3690'));

  it('atomically clears the prior completion when assigning a new item to the same slot', async () => {
    updateSwarmSlotState(workspacePath, 'PAN-3690', state => ({
      ...state,
      slotAssignments: [{ slotIndex: 2, itemId: 'item-a' }],
      slotCompletions: {
        '2': { slotIndex: 2, itemId: 'item-a', agentId: 'agent-pan-3690-slot-2', completedAt: '2026-08-13T00:00:00.000Z' },
      },
    }));

    await recordSlotAssignment(workspacePath, 'PAN-3690', {
      slotIndex: 2,
      itemId: 'item-b',
      agentId: 'agent-pan-3690-slot-2',
    });

    const state = slots('PAN-3690');
    expect(state?.slotAssignments).toEqual([
      expect.objectContaining({ slotIndex: 2, itemId: 'item-b' }),
    ]);
    expect(state?.slotCompletions).toEqual({});
  });

  it('atomically clears every assignment and completion during reset', async () => {
    updateSwarmSlotState(workspacePath, 'PAN-3690', state => ({
      ...state,
      slotAssignments: [{ slotIndex: 2, itemId: 'item-a' }],
      slotCompletions: {
        '2': { slotIndex: 2, itemId: 'item-a', agentId: 'agent-pan-3690-slot-2', completedAt: '2026-08-13T00:00:00.000Z' },
        '3': { slotIndex: 3, itemId: 'item-c', agentId: 'agent-pan-3690-slot-3', completedAt: '2026-08-13T00:01:00.000Z' },
      },
    }));

    await clearAllSlotAssignments(workspacePath, 'PAN-3690');

    expect(slots('PAN-3690')).toEqual(expect.objectContaining({
      slotAssignments: [],
      slotCompletions: {},
    }));
  });

  it('PAN-3694: clears the superseded-attempt high-water so a fresh swarm reuses indexes 1..N', async () => {
    // The MIN-888 post-reset state: superseded slot 3 retained in the ledger.
    updateSwarmSlotState(workspacePath, 'PAN-3690', state => ({
      ...state,
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
    }));

    // Pre-fix behavior: the retained attempt reserves indexes 1..3, so only
    // slot 4 is dispatchable.
    const before = new Set<number>();
    expect(applySupersededSlotHighWater(before, { superseded: slots('PAN-3690')?.supersededAttempts } as never, 1)).toBe(4);
    expect([...before].sort()).toEqual([1, 2, 3]);

    await clearSupersededSwarmAttempts(workspacePath, 'PAN-3690');

    expect(slots('PAN-3690')?.supersededAttempts).toEqual([]);
    // Post-reset reuse: no index is reserved and the configured max stands.
    const after = new Set<number>();
    expect(applySupersededSlotHighWater(after, { superseded: slots('PAN-3690')?.supersededAttempts } as never, 1)).toBe(1);
    expect(after.size).toBe(0);
  });
});

