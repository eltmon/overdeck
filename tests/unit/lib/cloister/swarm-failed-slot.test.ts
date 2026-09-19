/**
 * Failed swarm slot supersession (PAN-2543, PAN-2372 WI-4; re-pointed PAN-3917).
 *
 * The archived attempt and the slot-completion marker used to live on the issue
 * record; both now live in the slot ledger beside the issue's continue file.
 * Fixtures use a real `<project>/workspaces/feature-<issue>` layout because the
 * ledger resolves its plan home from the workspace path.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveFailedSwarmSlot, nextSwarmSlotIndex, SWARM_SUPERSEDED_RETENTION } from '../../../../src/lib/cloister/swarm-failed-slot.js';
import { readSwarmSlotState } from '../../../../src/lib/cloister/swarm-slot-store.js';

let projectRoot = '';
let workspace = '';

function makeWorkspace(prefix: string, issueLower: string): void {
  projectRoot = mkdtempSync(join(tmpdir(), prefix));
  workspace = join(projectRoot, 'workspaces', `feature-${issueLower}`);
  mkdirSync(workspace, { recursive: true });
}

afterEach(() => {
  if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = '';
  workspace = '';
});

describe('PAN-2543 failed swarm slot supersession', () => {
  it('retains superseded attempts until issue close-out, never time-based GC', () => {
    expect(SWARM_SUPERSEDED_RETENTION).toBe('issue-close-out');
  });

  it('archives occupied branch/worktree metadata and preserves a monotonic next index', async () => {
    makeWorkspace('pan-2543-swarm-', 'pan-2543');
    mkdirSync(`${workspace}-slot-2`);
    const runGitCommand = vi.fn(async () => undefined);
    const clearSlotAssignment = vi.fn();
    const reconciled = {
      issueId: 'PAN-2543', merged: [], pending: [], agents: [],
      inFlight: [{ itemId: 'wi-8', slotIndex: 2, status: 'in_flight' as const }],
      branches: [{ slotIndex: 2, branch: 'feature/pan-2543-slot-2', merged: false }],
    };

    await archiveFailedSwarmSlot('PAN-2543', workspace, {
      ...reconciled.inFlight[0], branch: 'feature/pan-2543-slot-2', agentId: 'agent-pan-2543-slot-2', reason: 'auth-death',
    }, { runGitCommand, clearSlotAssignment }, new Date('2026-07-10T01:02:03.000Z'));

    const state = readSwarmSlotState(workspace, 'PAN-2543');
    expect(state?.supersededAttempts).toEqual([expect.objectContaining({
      slotIndex: 2, itemId: 'wi-8', reason: 'auth-death',
      archivedBranch: 'feature/pan-2543-slot-2-failed-20260710010203000',
    })]);
    expect(nextSwarmSlotIndex(state, reconciled)).toBe(3);
    expect(runGitCommand).toHaveBeenNthCalledWith(1, expect.stringContaining('git worktree move'), workspace);
    expect(runGitCommand).toHaveBeenNthCalledWith(2, expect.stringContaining('git branch -m'), workspace);
    expect(clearSlotAssignment).toHaveBeenCalledWith(workspace, 'PAN-2543', 2, 'wi-8');
  });
});

describe('PAN-2372 WI-4 supersession clears the durable slot-completion marker (FR-6, AC4)', () => {
  it('removes slotCompletions[slotIndex] when a slot is archived/superseded, preserving siblings', async () => {
    makeWorkspace('pan-2372-swarm-requeue-', 'pan-2372');
    const { writeSwarmSlotCompletion } = await import('../../../../src/lib/cloister/deacon-swarm-record.js');
    // Seed a durable marker for the slot about to be superseded, plus a sibling
    // marker that must survive (only the requeued slot's marker is cleared).
    await writeSwarmSlotCompletion(workspace, 'PAN-2372', {
      slotIndex: 2, itemId: 'wi-8', agentId: 'agent-pan-2372-slot-2', completedAt: '2026-07-10T01:02:03.000Z',
    });
    await writeSwarmSlotCompletion(workspace, 'PAN-2372', {
      slotIndex: 3, itemId: 'wi-9', agentId: 'agent-pan-2372-slot-3', completedAt: '2026-07-10T01:02:03.000Z',
    });

    await archiveFailedSwarmSlot('PAN-2372', workspace, {
      itemId: 'wi-8', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-2372-slot-2', agentId: 'agent-pan-2372-slot-2', reason: 'auth-death',
    }, { runGitCommand: vi.fn(async () => undefined), clearSlotAssignment: vi.fn() }, new Date('2026-07-10T01:02:03.000Z'));

    const state = readSwarmSlotState(workspace, 'PAN-2372');
    expect(state?.slotCompletions?.['2']).toBeUndefined();   // requeued slot cleared
    expect(state?.slotCompletions?.['3']).toBeDefined();     // sibling preserved
  });
});
