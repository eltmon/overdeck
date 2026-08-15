import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordFailedMergeBlock,
  recoverFailedMergeSlot,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import {
  createMinimalIssueRecord,
} from '../../../../src/lib/cloister/deacon-swarm-record.js';
import {
  readIssueRecordForWorkspaceSync,
  writeIssueRecordForWorkspaceSync,
} from '../../../../src/lib/pan-dir/record.js';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../../../helpers/git-record-fixture.js';

describe('swarm failed-slot reclaim', () => {
  afterEach(() => resetSwarmLoopSafetyForTests());

  it('archives and unblocks the slot, then records a serial foreman takeover without redispatch', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-3680-reclaim-'));
    const recordRemote = initGitRecordRoot(workspace);
    try {
      writeIssueRecordForWorkspaceSync(workspace, 'PAN-3680', {
        ...createMinimalIssueRecord('PAN-3680'),
        swarm: { slotAssignments: [{ slotIndex: 2, itemId: 'wi-1', agentId: 'agent-pan-3680-slot-2' }] },
      });
      await recordFailedMergeBlock({
        issueId: 'PAN-3680', itemId: 'wi-1', slotIndex: 2,
        branch: 'feature/pan-3680-slot-2', note: 'merge conflict',
      }, workspace);
      const applyTaskOperationToPlanFile = vi.fn(async () => undefined);
      const clearSlotAssignment = vi.fn(async () => undefined);
      const spawnRun = vi.fn();
      const deps = {
        applyTaskOperationToPlanFile,
        clearSlotAssignment,
        recordSlotAssignment: vi.fn(),
        registeredSlotCapacityAvailable: vi.fn(() => true),
        tryReserveSwarmSlot: vi.fn(() => true),
        releaseSwarmSlot: vi.fn(),
        spawnRun,
        shouldDispatch: vi.fn(() => true),
        getMaxSlotIndex: vi.fn(() => 3),
        listSlotAssignments: vi.fn(() => []),
        runGitCommand: vi.fn(async () => ({ stdout: '' })),
      } as unknown as CoordinateSwarmSlotsDeps;
      const doc = {
        status: 'active', xBRIEFInfo: { version: '0.8' },
        plan: { id: 'PAN-3680', title: 'test', status: 'active', edges: [], items: [{ id: 'wi-1', title: 'item', status: 'blocked' }] },
      } as XBriefDocument;

      const actions = await recoverFailedMergeSlot('PAN-3680', workspace, 2, doc, 'reclaim', deps);

      expect(actions).toEqual(['[swarm] reclaimed slot 2 (item wi-1) for foreman implementation in PAN-3680']);
      expect(applyTaskOperationToPlanFile).toHaveBeenCalledWith('PAN-3680', expect.objectContaining({
        type: 'unblock', itemId: 'wi-1',
      }), workspace);
      expect(clearSlotAssignment).toHaveBeenCalledWith(workspace, 'PAN-3680', 2, 'wi-1');
      expect(spawnRun).not.toHaveBeenCalled();
      expect(readIssueRecordForWorkspaceSync(workspace, 'PAN-3680')?.swarm?.reclaimedItems?.['wi-1'])
        .toMatchObject({ slotIndex: 2 });
    } finally {
      removeGitRecordRemote(recordRemote);
      await cleanupGitRecordRoot(workspace);
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
