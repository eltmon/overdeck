import { describe, expect, it } from 'vitest';
import {
  autoMergeFastTrackBatch,
  escalateFastTrackItem,
  FAST_TRACK_GATE_COMMANDS,
  groupFastTrack,
  isFastTrackAutoMergeAllowed,
} from '../fast-track.js';
import type { VBriefItem, VBriefItemMetadata } from '../../vbrief/types.js';

let counter = 0;
function item(metadata: VBriefItemMetadata, id?: string): VBriefItem {
  counter += 1;
  return { id: id ?? `item-${counter}`, title: `t${counter}`, status: 'pending', metadata };
}

function trivial(scope: string[], id?: string): VBriefItem {
  return item({ difficulty: 'trivial', files_scope: scope, files_scope_confidence: 'high' }, id);
}

describe('groupFastTrack', () => {
  it('batches consecutive trivial scope-disjoint beads under one fastTrackBatchKey', () => {
    const a = trivial(['docs/a.md'], 'a');
    const b = trivial(['docs/b.md'], 'b');
    const c = trivial(['docs/c.md'], 'c');

    const grouping = groupFastTrack([a, b, c]);

    expect(grouping.batches).toHaveLength(1);
    expect(grouping.batches[0].items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(grouping.batches[0].fastTrackBatchKey).toBe('fast-track:a');
    expect(grouping.rest).toHaveLength(0);
  });

  it('rejects a bead whose files_scope overlaps another in the candidate batch', () => {
    const a = trivial(['docs/a.md'], 'a');
    const b = trivial(['docs/b.md'], 'b');
    const conflicting = trivial(['docs/a.md'], 'conflict');
    const d = trivial(['docs/d.md'], 'd');

    const grouping = groupFastTrack([a, b, conflicting, d]);

    // The overlap closes the first batch; the conflicting bead starts the next.
    expect(grouping.batches).toHaveLength(2);
    expect(grouping.batches[0].items.map(i => i.id)).toEqual(['a', 'b']);
    expect(grouping.batches[1].items.map(i => i.id)).toEqual(['conflict', 'd']);
    for (const batch of grouping.batches) {
      expect(batch.items.some(i => batch.items.some(j => i !== j && i.metadata?.files_scope?.[0] === j.metadata?.files_scope?.[0]))).toBe(false);
    }
  });

  it('rejects any medium-or-harder bead from a fast-track batch', () => {
    const a = trivial(['docs/a.md'], 'a');
    const medium = item({ difficulty: 'medium', files_scope: ['docs/m.md'], files_scope_confidence: 'high' }, 'medium');
    const b = trivial(['docs/b.md'], 'b');
    const c = trivial(['docs/c.md'], 'c');

    const grouping = groupFastTrack([a, medium, b, c]);

    // The medium bead breaks the run: 'a' is a singleton (no batch), the
    // medium bead is never batched, b+c form the only batch.
    expect(grouping.batches).toHaveLength(1);
    expect(grouping.batches[0].items.map(i => i.id)).toEqual(['b', 'c']);
    expect(grouping.rest.map(i => i.id)).toEqual(['a', 'medium']);
  });

  it('keeps ineligible items out of batches: wide scope, low confidence, or no scope', () => {
    const wide = item({ difficulty: 'trivial', files_scope: ['a', 'b', 'c', 'd'], files_scope_confidence: 'high' }, 'wide');
    const lowConf = item({ difficulty: 'trivial', files_scope: ['e'], files_scope_confidence: 'medium' }, 'low-conf');
    const noScope = item({ difficulty: 'trivial' }, 'no-scope');

    const grouping = groupFastTrack([wide, lowConf, noScope]);

    expect(grouping.batches).toHaveLength(0);
    expect(grouping.rest.map(i => i.id)).toEqual(['wide', 'low-conf', 'no-scope']);
  });

  it('does not emit singleton batches', () => {
    const only = trivial(['docs/a.md'], 'only');
    const grouping = groupFastTrack([only]);
    expect(grouping.batches).toHaveLength(0);
    expect(grouping.rest.map(i => i.id)).toEqual(['only']);
  });

  it('honors a custom maxScopeFiles threshold', () => {
    const a = item({ difficulty: 'simple', files_scope: ['a', 'b', 'c', 'd'], files_scope_confidence: 'high' }, 'a');
    const b = item({ difficulty: 'simple', files_scope: ['e', 'f', 'g', 'h'], files_scope_confidence: 'high' }, 'b');
    const grouping = groupFastTrack([a, b], { maxScopeFiles: 4 });
    expect(grouping.batches).toHaveLength(1);
    expect(grouping.batches[0].items.map(i => i.id)).toEqual(['a', 'b']);
  });
});

describe('escalateFastTrackItem', () => {
  function makeBatch() {
    return groupFastTrack([trivial(['docs/a.md'], 'a'), trivial(['docs/b.md'], 'b'), trivial(['docs/c.md'], 'c')]).batches[0];
  }

  it('removes a mid-flight non-trivial item from its batch and routes it to the standard path', () => {
    const batch = makeBatch();
    const { escalation, remaining } = escalateFastTrackItem(batch, 'b', 'verify-failed', 'typecheck exploded');

    expect(remaining.items.map(i => i.id)).toEqual(['a', 'c']);
    expect(remaining.fastTrackBatchKey).toBe(batch.fastTrackBatchKey);
    expect(escalation.itemId).toBe('b');
    expect(escalation.fromBatchKey).toBe(batch.fastTrackBatchKey);
    expect(escalation.reason).toBe('verify-failed');
    expect(escalation.requiresFullReview).toBe(true);
  });

  it('marks escalated items as full-review and the auto-merge path refuses them', () => {
    const batch = makeBatch();
    const { escalation } = escalateFastTrackItem(batch, 'c', 'diff-exceeds-threshold');

    expect(escalation.requiresFullReview).toBe(true);
    expect(escalation.autoMergeEligible).toBe(false);
    expect(isFastTrackAutoMergeAllowed('c', [escalation])).toBe(false);
    expect(isFastTrackAutoMergeAllowed('a', [escalation])).toBe(true);
  });

  it('throws when escalating an item that is not in the batch', () => {
    const batch = makeBatch();
    expect(() => escalateFastTrackItem(batch, 'nope', 'verify-failed')).toThrow(/not in fast-track batch/);
  });
});

describe('autoMergeFastTrackBatch', () => {
  const ISSUE = { issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' };

  function makeBatch() {
    return groupFastTrack([trivial(['docs/a.md'], 'a'), trivial(['docs/b.md'], 'b')]).batches[0];
  }

  function recordingRun() {
    const calls: Array<{ command: string; cwd: string }> = [];
    const run = async (command: string, cwd: string) => {
      calls.push({ command, cwd });
      return { stdout: 'ok', stderr: '' };
    };
    return { calls, run };
  }

  it('refuses every batch when tiered_execution is disabled and runs no commands', async () => {
    const { calls, run } = recordingRun();
    const outcome = await autoMergeFastTrackBatch(ISSUE, 1, makeBatch(), {
      enabled: false,
      mergeOptions: { deps: { run } },
    });
    expect(outcome.refused).toBe(true);
    expect(outcome.refusalReason).toContain('review-then-merge');
    expect(outcome.result).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('auto-merges a trivial batch to the feature branch after typecheck and lint pass', async () => {
    const { calls, run } = recordingRun();
    const outcome = await autoMergeFastTrackBatch(ISSUE, 3, makeBatch(), {
      enabled: true,
      mergeOptions: { deps: { run } },
    });
    expect(outcome.refused).toBe(false);
    expect(outcome.result?.verified).toBe(true);
    expect(outcome.result?.merged).toBe(true);
    expect(calls.map(c => c.command)).toEqual([...FAST_TRACK_GATE_COMMANDS, 'git merge --no-ff "feature/pan-1-slot-3"']);
  });

  it('does not merge when the typecheck gate fails and surfaces the failure', async () => {
    const commands: string[] = [];
    const run = async (command: string) => {
      commands.push(command);
      if (command === 'npm run typecheck') throw Object.assign(new Error('TS2345'), { stdout: '', stderr: 'TS2345' });
      return { stdout: 'ok', stderr: '' };
    };
    const outcome = await autoMergeFastTrackBatch(ISSUE, 1, makeBatch(), {
      enabled: true,
      mergeOptions: { deps: { run } },
    });
    expect(outcome.refused).toBe(false);
    expect(outcome.result?.verified).toBe(false);
    expect(outcome.result?.merged).toBe(false);
    expect(outcome.result?.failure).toContain('Verify command failed');
    expect(commands.some(c => c.startsWith('git merge'))).toBe(false);
  });

  it('rejects any batch containing a medium-or-harder bead', async () => {
    const { calls, run } = recordingRun();
    const batch = makeBatch();
    batch.items.push(item({ difficulty: 'medium', files_scope: ['docs/m.md'], files_scope_confidence: 'high' }, 'medium'));
    const outcome = await autoMergeFastTrackBatch(ISSUE, 1, batch, {
      enabled: true,
      mergeOptions: { deps: { run } },
    });
    expect(outcome.refused).toBe(true);
    expect(outcome.refusalReason).toContain("non-trivial item 'medium'");
    expect(calls).toHaveLength(0);
  });

  it('rejects a batch containing an escalated item', async () => {
    const { calls, run } = recordingRun();
    const batch = makeBatch();
    const { escalation } = escalateFastTrackItem(batch, 'a', 'diff-exceeds-threshold');
    // The foreman failed to drop the escalated item from the batch — the
    // auto-merge path must still refuse it.
    const outcome = await autoMergeFastTrackBatch(ISSUE, 1, batch, {
      enabled: true,
      escalations: [escalation],
      mergeOptions: { deps: { run } },
    });
    expect(outcome.refused).toBe(true);
    expect(outcome.refusalReason).toContain('escalated');
    expect(calls).toHaveLength(0);
  });
});
