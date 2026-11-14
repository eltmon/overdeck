/**
 * PAN-4753: the auto-promote tick's drop record round-trips the real
 * overdeck.db store, and `droppedFromBatch` reads it back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import { insertUatGeneration, getUatGeneration, type UatGeneration } from '../../../../src/lib/overdeck/merge-sync.js';
import { buildUatGenerationStore } from '../../../../src/lib/cloister/uat-generation-deps.js';
import { droppedFromBatch } from '../../../../src/lib/cloister/merge-route.js';

let odb: OverdeckTestDb;
beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

function seedIssue(id: string): void {
  odb.raw().prepare("INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)").run(id, Date.now());
}

describe('batch drop record (PAN-4753)', () => {
  it('moves the dropped member to heldOut on an invalidated generation, and droppedFromBatch finds it', () => {
    for (const id of ['PAN-1', 'PAN-2', 'PAN-3']) seedIssue(id);
    const members: UatGeneration['members'] = [1, 2, 3].map((n) => ({
      issueId: `PAN-${n}`, title: `t${n}`, branch: `feature/pan-${n}`, headSha: `h${n}`, mergeOrder: n,
    }));
    insertUatGeneration({
      name: 'uat/pan-otter-1114', worktreePath: '/tmp/project/workspaces/uat-pan-otter-1114', projectRoot: '/tmp/project',
      baseSha: 'base', status: 'ready', members, heldOut: [], resolutions: [], stackStartedAt: null,
    });

    const reason = 'combined CI failed on uat/pan-otter-1114 (test); PAN-3 merges on its own';
    buildUatGenerationStore().update('uat/pan-otter-1114', {
      status: 'invalidated',
      members: members.slice(0, 2),
      heldOut: [{ issueId: 'PAN-3', branch: 'feature/pan-3', headSha: 'h3', reason }],
    });

    const stored = getUatGeneration('uat/pan-otter-1114');
    expect(stored?.status).toBe('invalidated');
    expect(stored?.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-2']);
    expect(stored?.heldOut).toEqual([{ issueId: 'PAN-3', branch: 'feature/pan-3', headSha: 'h3', reason }]);
    expect(droppedFromBatch('PAN-3', '/tmp/project')).toBe(true);
    expect(droppedFromBatch('PAN-1', '/tmp/project')).toBe(false);
  });
});
