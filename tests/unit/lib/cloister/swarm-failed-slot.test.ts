import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveFailedSwarmSlot, nextSwarmSlotIndex } from '../../../../src/lib/cloister/swarm-failed-slot.js';
import { readIssueRecordForWorkspaceSync } from '../../../../src/lib/pan-dir/record.js';

let workspace = '';
afterEach(() => {
  if (!workspace) return;
  rmSync(workspace, { recursive: true, force: true });
  rmSync(`${workspace}-slot-2`, { recursive: true, force: true });
});

describe('PAN-2543 failed swarm slot supersession', () => {
  it('archives occupied branch/worktree metadata and preserves a monotonic next index', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-2543-swarm-'));
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
