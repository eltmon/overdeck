import { describe, expect, it } from 'vitest';
import { groupFastTrack } from '../fast-track.js';
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
