import { describe, it, expect } from 'vitest';
import {
  classifyIssue,
  computeEpicGroups,
  isAutoPickable,
  isUnblockEligible,
  pickableQueue,
  type ClassifyLookups,
} from '../../../../src/lib/backlog/pickup.js';
import type { SequenceNode } from '../../../../src/lib/backlog/types.js';

/**
 * PAN-2081 Phase 1: an epic is a container of child issues, never directly
 * workable. It must be excluded from the auto-pickable queue and from the
 * blocks-main unblock path regardless of its other gates — otherwise a work
 * agent could be dispatched on a container (e.g. #2075) that has no code to write.
 */
function node(issue: string, over: Partial<SequenceNode> = {}): SequenceNode {
  return {
    issue,
    rank: 1,
    size: 'M',
    importance: 'high',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: '',
    gate: 'auto',
    planning: 'auto',
    ...over,
  };
}

function lookups(
  labels: Record<string, string[]>,
  planned: Set<string>,
  inPipeline: Set<string> = new Set(),
): ClassifyLookups {
  return {
    labels: (id) => labels[id] ?? [],
    isPlanned: (id) => planned.has(id),
    isInPipeline: (id) => inPipeline.has(id),
  };
}

describe('pickup epic exclusion (PAN-2081)', () => {
  const workable = ['ready', 'released'];

  it('a non-epic that is ready+planned+released IS auto-pickable (control)', () => {
    const lk = lookups({ 'PAN-1': workable }, new Set(['PAN-1']));
    expect(isAutoPickable(classifyIssue(node('PAN-1'), lk))).toBe(true);
  });

  it('an epic (node isEpic flag) is never auto-pickable, even fully gated', () => {
    const lk = lookups({ 'PAN-2075': workable }, new Set(['PAN-2075']));
    const s = classifyIssue(node('PAN-2075', { isEpic: true }), lk);
    expect(s.epic).toBe(true);
    expect(isAutoPickable(s)).toBe(false);
  });

  it('an epic detected via the `epic` label is never auto-pickable', () => {
    const lk = lookups({ 'PAN-2075': [...workable, 'epic'] }, new Set(['PAN-2075']));
    expect(isAutoPickable(classifyIssue(node('PAN-2075'), lk))).toBe(false);
  });

  it('an epic with blocks-main is NOT unblock-eligible (strike a child instead)', () => {
    const lkEpic = lookups({ 'PAN-2075': ['blocks-main'] }, new Set());
    expect(isUnblockEligible(classifyIssue(node('PAN-2075', { isEpic: true }), lkEpic))).toBe(false);
    // control: a non-epic blocks-main issue IS unblock-eligible
    const lkLeaf = lookups({ 'PAN-9': ['blocks-main'] }, new Set());
    expect(isUnblockEligible(classifyIssue(node('PAN-9'), lkLeaf))).toBe(true);
  });

  it('pickableQueue drops the epic but keeps its workable children', () => {
    const nodes = [
      node('PAN-2075', { rank: 1, isEpic: true }),
      node('PAN-2076', { rank: 2 }),
      node('PAN-2077', { rank: 3 }),
    ];
    const lk = lookups(
      { 'PAN-2075': workable, 'PAN-2076': workable, 'PAN-2077': workable },
      new Set(['PAN-2075', 'PAN-2076', 'PAN-2077']),
    );
    expect(pickableQueue(nodes, lk).map((n) => n.issue)).toEqual(['PAN-2076', 'PAN-2077']);
  });

  it('computeEpicGroups returns #2075 and the five #2075 contains pairs', () => {
    const nodes = [
      node('PAN-2075', { rank: 1, isEpic: true }),
      node('PAN-2076', { rank: 2 }),
      node('PAN-2077', { rank: 3 }),
      node('PAN-2078', { rank: 4 }),
      node('PAN-2079', { rank: 5 }),
      node('PAN-2080', { rank: 6 }),
    ];
    const edges = ['PAN-2076', 'PAN-2077', 'PAN-2078', 'PAN-2079', 'PAN-2080'].map((child) => ({
      from: 'PAN-2075',
      to: child,
      type: 'contains',
    }));
    const groups = computeEpicGroups(nodes, edges, lookups({}, new Set()));

    expect(groups.epics).toEqual([{ issue: 'PAN-2075', rank: 1 }]);
    expect(groups.epics.map((e) => e.issue)).not.toContain('PAN-2076');
    expect(groups.contains).toEqual([
      { epic: 'PAN-2075', child: 'PAN-2076' },
      { epic: 'PAN-2075', child: 'PAN-2077' },
      { epic: 'PAN-2075', child: 'PAN-2078' },
      { epic: 'PAN-2075', child: 'PAN-2079' },
      { epic: 'PAN-2075', child: 'PAN-2080' },
    ]);
  });
});
