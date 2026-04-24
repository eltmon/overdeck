import { describe, it, expect } from 'vitest';
import { desiredLabels, computeLabelDeltas, WORKFLOW_LABELS } from '../desired-labels.js';
import type { CanonicalState } from '../types.js';

describe('desiredLabels (PAN-805)', () => {
  it('returns empty set for todo', () => {
    expect(desiredLabels('todo')).toEqual(new Set());
  });

  it('returns in-progress for in_progress', () => {
    expect(desiredLabels('in_progress')).toEqual(new Set(['in-progress']));
  });

  it('returns in-review for in_review', () => {
    expect(desiredLabels('in_review')).toEqual(new Set(['in-review']));
  });

  it('returns merged for merged', () => {
    expect(desiredLabels('merged')).toEqual(new Set(['merged']));
  });

  it('returns wontfix for closed_wontfix', () => {
    expect(desiredLabels('closed_wontfix')).toEqual(new Set(['wontfix']));
  });

  it('falls back to empty set for unknown state', () => {
    expect(desiredLabels('unknown' as CanonicalState)).toEqual(new Set());
  });
});

describe('computeLabelDeltas (PAN-805)', () => {
  it('adds missing workflow labels and removes extra ones', () => {
    const desired = new Set(['in-progress']);
    const actual = ['in-review', 'merged', 'bug'];
    const result = computeLabelDeltas(desired, actual);
    expect(result.add).toEqual(['in-progress']);
    expect(result.remove.sort()).toEqual(['in-review', 'merged']);
  });

  it('ignores non-workflow labels', () => {
    const desired = new Set(['merged']);
    const actual = ['bug', 'feature', 'help wanted'];
    const result = computeLabelDeltas(desired, actual);
    expect(result.add).toEqual(['merged']);
    expect(result.remove).toEqual([]);
  });

  it('returns empty deltas when actual matches desired', () => {
    const desired = new Set(['in-review']);
    const actual = ['in-review', 'bug'];
    const result = computeLabelDeltas(desired, actual);
    expect(result.add).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('removes all workflow labels when desired is empty', () => {
    const desired = new Set<string>();
    const actual = ['in-progress', 'in-review', 'merged', 'wontfix', 'needs-close-out', 'bug'];
    const result = computeLabelDeltas(desired, actual);
    expect(result.add).toEqual([]);
    expect(result.remove.sort()).toEqual(WORKFLOW_LABELS.slice().sort());
  });
});
