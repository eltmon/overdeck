import { describe, it, expect } from 'vitest';
import type { SequenceNode } from '../types.js';
import {
  classifyIssue,
  isAutoPickable,
  isUnblockEligible,
  normalizeGate,
  computeWaves,
  computeLanes,
  computeCohort,
  computeStats,
  pickableQueue,
  effortOf,
  type ClassifyLookups,
} from '../pickup.js';

function node(partial: Partial<SequenceNode> & { issue: string; rank: number }): SequenceNode {
  return {
    size: 'M', importance: 'medium', score: 50, condition: 'ok', dependsOn: [],
    why: '', gate: 'auto', planning: 'auto', ...partial,
  } as SequenceNode;
}

/** Build lookups from explicit per-issue facts. */
function lookups(facts: Record<string, { labels?: string[]; planned?: boolean; inPipeline?: boolean }>): ClassifyLookups {
  return {
    labels: (id) => facts[id]?.labels ?? [],
    isPlanned: (id) => facts[id]?.planned ?? false,
    isInPipeline: (id) => facts[id]?.inPipeline ?? false,
  };
}

describe('normalizeGate', () => {
  it('maps legacy + new spellings', () => {
    expect(normalizeGate('blocked')).toBe('vetoed');
    expect(normalizeGate('vetoed')).toBe('vetoed');
    expect(normalizeGate('ready')).toBe('promote');
    expect(normalizeGate('promote')).toBe('promote');
    expect(normalizeGate('auto')).toBe('auto');
    expect(normalizeGate(undefined)).toBe('auto');
  });
});

describe('classifyIssue', () => {
  it('reads labels, gate, planned, in-pipeline', () => {
    const lk = lookups({ 'PAN-1': { labels: ['ready', 'blocks-main'], planned: true } });
    const s = classifyIssue(node({ issue: 'PAN-1', rank: 1 }), lk);
    expect(s).toMatchObject({ ready: true, planned: true, blocksMain: true, parked: false, vetoed: false, inPipeline: false, gate: 'auto' });
  });

  it('treats legacy needs-design / needs-discussion as parked', () => {
    const lk = lookups({ 'PAN-2': { labels: ['needs-design'] }, 'PAN-3': { labels: ['needs-discussion'] } });
    expect(classifyIssue(node({ issue: 'PAN-2', rank: 1 }), lk).parked).toBe(true);
    expect(classifyIssue(node({ issue: 'PAN-3', rank: 2 }), lk).parked).toBe(true);
  });

  it('vetoed via label OR gate', () => {
    const lkLabel = lookups({ 'PAN-4': { labels: ['vetoed'] } });
    expect(classifyIssue(node({ issue: 'PAN-4', rank: 1 }), lkLabel).vetoed).toBe(true);
    expect(classifyIssue(node({ issue: 'PAN-5', rank: 2, gate: 'blocked' }), lookups({})).vetoed).toBe(true);
    expect(classifyIssue(node({ issue: 'PAN-6', rank: 3, gate: 'vetoed' as SequenceNode['gate'] }), lookups({})).vetoed).toBe(true);
  });

  it('is case-insensitive on labels', () => {
    const lk = lookups({ 'PAN-7': { labels: ['Ready', 'Blocks-Main'] } });
    const s = classifyIssue(node({ issue: 'PAN-7', rank: 1 }), lk);
    expect(s.ready).toBe(true);
    expect(s.blocksMain).toBe(true);
  });
});

describe('isAutoPickable', () => {
  const base = { ready: true, planned: true, parked: false, vetoed: false, blocksMain: false, inPipeline: false, gate: 'auto' as const };
  it('requires ready AND planned, excludes parked/vetoed/in-flight', () => {
    expect(isAutoPickable(base)).toBe(true);
    expect(isAutoPickable({ ...base, ready: false })).toBe(false);   // DoR gate
    expect(isAutoPickable({ ...base, planned: false })).toBe(false); // needs spec
    expect(isAutoPickable({ ...base, parked: true })).toBe(false);
    expect(isAutoPickable({ ...base, vetoed: true })).toBe(false);
    expect(isAutoPickable({ ...base, inPipeline: true })).toBe(false);
  });
});

describe('isUnblockEligible (override)', () => {
  it('blocks-main bypasses ready/planned, but vetoed is an absolute stop', () => {
    expect(isUnblockEligible({ ready: false, planned: false, parked: false, vetoed: false, blocksMain: true, inPipeline: false, gate: 'auto' })).toBe(true);
    expect(isUnblockEligible({ ready: false, planned: false, parked: false, vetoed: true, blocksMain: true, inPipeline: false, gate: 'vetoed' })).toBe(false);
    expect(isUnblockEligible({ ready: true, planned: true, parked: false, vetoed: false, blocksMain: false, inPipeline: false, gate: 'auto' })).toBe(false);
  });
});

describe('pickableQueue ordering', () => {
  it('promoted jumps ahead of rank, otherwise rank order', () => {
    const nodes = [
      node({ issue: 'A', rank: 1 }),
      node({ issue: 'B', rank: 2, gate: 'ready' }), // promote
      node({ issue: 'C', rank: 3 }),
    ];
    const lk = lookups({ A: { labels: ['ready'], planned: true }, B: { labels: ['ready'], planned: true }, C: { labels: ['ready'], planned: true } });
    expect(pickableQueue(nodes, lk).map((n) => n.issue)).toEqual(['B', 'A', 'C']);
  });
});

describe('computeWaves', () => {
  it('batches the pickable queue by n, excludes non-pickable', () => {
    const nodes = [
      node({ issue: 'A', rank: 1 }), node({ issue: 'B', rank: 2 }), node({ issue: 'C', rank: 3 }),
      node({ issue: 'D', rank: 4 }), node({ issue: 'E', rank: 5 }),
    ];
    const lk = lookups({
      A: { labels: ['ready'], planned: true }, B: { labels: ['ready'], planned: true },
      C: { labels: ['ready'], planned: true }, D: { labels: ['ready'], planned: false }, // not planned
      E: { labels: ['ready'], planned: true, inPipeline: true }, // in flight
    });
    const waves = computeWaves(nodes, lk, 2);
    expect(waves.map((w) => w.map((n) => n.issue))).toEqual([['A', 'B'], ['C']]);
  });
});

describe('computeLanes', () => {
  it('greedy-schedules by effort and reports makespan', () => {
    const nodes = [
      node({ issue: 'A', rank: 1, size: 'M' }), // 3
      node({ issue: 'B', rank: 2, size: 'L' }), // 5
      node({ issue: 'C', rank: 3, size: 'M' }), // 3
      node({ issue: 'D', rank: 4, size: 'M' }), // 3
    ];
    const lk = lookups(Object.fromEntries(['A', 'B', 'C', 'D'].map((i) => [i, { labels: ['ready'], planned: true }])));
    const { blocks, makespan } = computeLanes(nodes, lk, 3);
    // lanes: A→L0[0-3], B→L1[0-5], C→L2[0-3], D→earliest free (L0 or L2 @3)→[3-6]
    expect(blocks.length).toBe(4);
    expect(makespan).toBe(6);
    expect(effortOf('XL')).toBe(8);
  });
});

describe('computeCohort', () => {
  it('= in-flight ∪ top 2n pickable', () => {
    const nodes = [
      node({ issue: 'IF1', rank: 1 }), // in-flight
      node({ issue: 'P1', rank: 2 }), node({ issue: 'P2', rank: 3 }),
      node({ issue: 'P3', rank: 4 }), node({ issue: 'P4', rank: 5 }),
    ];
    const lk = lookups({
      IF1: { inPipeline: true },
      P1: { labels: ['ready'], planned: true }, P2: { labels: ['ready'], planned: true },
      P3: { labels: ['ready'], planned: true }, P4: { labels: ['ready'], planned: true },
    });
    const cohort = computeCohort(nodes, lk, 1); // 2n = 2 pickable + in-flight
    expect(cohort).toContain('IF1');
    expect(cohort).toContain('P1');
    expect(cohort).toContain('P2');
    expect(cohort).not.toContain('P3');
  });
});

describe('computeStats', () => {
  it('counts each state', () => {
    const nodes = [
      node({ issue: 'IF', rank: 1 }),
      node({ issue: 'RP', rank: 2 }),  // ready+planned (pickable)
      node({ issue: 'RN', rank: 3 }),  // ready, not planned (needs planning)
      node({ issue: 'V', rank: 4 }),   // vetoed
      node({ issue: 'BM', rank: 5 }),  // blocks-main
    ];
    const lk = lookups({
      IF: { inPipeline: true },
      RP: { labels: ['ready'], planned: true },
      RN: { labels: ['ready'], planned: false },
      V: { labels: ['vetoed'] },
      BM: { labels: ['blocks-main', 'ready'], planned: true },
    });
    const s = computeStats(nodes, lk);
    expect(s.total).toBe(5);
    expect(s.inFlight).toBe(1);
    expect(s.pickable).toBe(2); // RP + BM
    expect(s.needsPlanning).toBe(1); // RN
    expect(s.vetoed).toBe(1);
    expect(s.blocksMain).toBe(1);
  });
});
