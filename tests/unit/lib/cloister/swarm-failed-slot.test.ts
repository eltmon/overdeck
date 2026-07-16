import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveFailedSwarmSlot, nextSwarmSlotIndex, SWARM_SUPERSEDED_RETENTION } from '../../../../src/lib/cloister/swarm-failed-slot.js';
import { readIssueRecordForWorkspaceSync } from '../../../../src/lib/pan-dir/record.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../../../helpers/git-record-fixture.js';

let workspace = '';
let remote: string | null = null;
afterEach(async () => {
  removeGitRecordRemote(remote);
  remote = null;
  if (!workspace) return;
  await cleanupGitRecordRoot(workspace);
  rmSync(`${workspace}-slot-2`, { recursive: true, force: true });
});

describe('PAN-2543 failed swarm slot supersession', () => {
  it('retains superseded attempts until issue close-out, never time-based GC', () => {
    expect(SWARM_SUPERSEDED_RETENTION).toBe('issue-close-out');
  });
  it('archives occupied branch/worktree metadata and preserves a monotonic next index', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-2543-swarm-'));
    remote = initGitRecordRoot(workspace);
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

    const record = readIssueRecordForWorkspaceSync(workspace, 'PAN-2543');
    expect(record?.swarm?.supersededAttempts).toEqual([expect.objectContaining({
      slotIndex: 2, itemId: 'wi-8', reason: 'auth-death',
      archivedBranch: 'feature/pan-2543-slot-2-failed-20260710010203000',
    })]);
    expect(nextSwarmSlotIndex(record, reconciled)).toBe(3);
    expect(runGitCommand).toHaveBeenNthCalledWith(1, expect.stringContaining('git worktree move'), workspace);
    expect(runGitCommand).toHaveBeenNthCalledWith(2, expect.stringContaining('git branch -m'), workspace);
    expect(clearSlotAssignment).toHaveBeenCalledWith(workspace, 'PAN-2543', 2, 'wi-8');
  });
});

describe('PAN-2372 WI-4 supersession clears the durable slot-completion marker (FR-6, AC4)', () => {
  it('removes swarm.slotCompletions[slotIndex] when a slot is archived/superseded, preserving siblings', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-2372-swarm-requeue-'));
    remote = initGitRecordRoot(workspace);
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

    const record = readIssueRecordForWorkspaceSync(workspace, 'PAN-2372');
    expect(record?.swarm?.slotCompletions?.['2']).toBeUndefined();   // requeued slot cleared
    expect(record?.swarm?.slotCompletions?.['3']).toBeDefined();     // sibling preserved
  });
});
