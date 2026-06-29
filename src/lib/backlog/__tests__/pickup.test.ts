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
  selectNeedsPlanning,
  selectUnblockTargets,
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

  it('reads released + objection labels (PAN-2059)', () => {
    const lk = lookups({ 'PAN-9': { labels: ['ready', 'released', 'objection'], planned: true } });
    const s = classifyIssue(node({ issue: 'PAN-9', rank: 1 }), lk);
    expect(s.released).toBe(true);
    expect(s.objection).toBe(true);
    const lk2 = lookups({ 'PAN-10': { labels: ['ready'], planned: true } });
    const s2 = classifyIssue(node({ issue: 'PAN-10', rank: 1 }), lk2);
    expect(s2.released).toBe(false);
    expect(s2.objection).toBe(false);
  });
});

describe('isAutoPickable', () => {
  const base = { ready: true, planned: true, released: true, objection: false, parked: false, vetoed: false, blocksMain: false, inPipeline: false, gate: 'auto' as const };
  it('requires ready AND planned AND released, excludes parked/vetoed/objected/in-flight', () => {
    expect(isAutoPickable(base)).toBe(true);
    expect(isAutoPickable({ ...base, ready: false })).toBe(false);    // DoR gate
    expect(isAutoPickable({ ...base, planned: false })).toBe(false);  // needs spec
    expect(isAutoPickable({ ...base, released: false })).toBe(false); // PAN-2059: planned but not released
    expect(isAutoPickable({ ...base, objection: true })).toBe(false); // PAN-2059: open objection halts pickup
    expect(isAutoPickable({ ...base, parked: true })).toBe(false);
    expect(isAutoPickable({ ...base, vetoed: true })).toBe(false);
    expect(isAutoPickable({ ...base, inPipeline: true })).toBe(false);
  });
});

describe('isUnblockEligible (override)', () => {
  const u = { ready: false, planned: false, released: false, objection: false, parked: false, vetoed: false, blocksMain: true, inPipeline: false, gate: 'auto' as const };
  it('blocks-main bypasses ready/planned/released, but vetoed and objection are stops', () => {
    expect(isUnblockEligible(u)).toBe(true);
    expect(isUnblockEligible({ ...u, vetoed: true, gate: 'vetoed' })).toBe(false);
    expect(isUnblockEligible({ ...u, objection: true })).toBe(false); // PAN-2059: open objection halts even blocks-main
    expect(isUnblockEligible({ ...u, blocksMain: false, ready: true, planned: true, released: true })).toBe(false);
  });
});

describe('pickableQueue ordering', () => {
  it('promoted jumps ahead of rank, otherwise rank order', () => {
    const nodes = [
      node({ issue: 'A', rank: 1 }),
      node({ issue: 'B', rank: 2, gate: 'ready' }), // promote
      node({ issue: 'C', rank: 3 }),
    ];
    const lk = lookups({ A: { labels: ['ready', 'released'], planned: true }, B: { labels: ['ready', 'released'], planned: true }, C: { labels: ['ready', 'released'], planned: true } });
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
      A: { labels: ['ready', 'released'], planned: true }, B: { labels: ['ready', 'released'], planned: true },
      C: { labels: ['ready', 'released'], planned: true }, D: { labels: ['ready', 'released'], planned: false }, // not planned
      E: { labels: ['ready', 'released'], planned: true, inPipeline: true }, // in flight
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
    const lk = lookups(Object.fromEntries(['A', 'B', 'C', 'D'].map((i) => [i, { labels: ['ready', 'released'], planned: true }])));
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
      P1: { labels: ['ready', 'released'], planned: true }, P2: { labels: ['ready', 'released'], planned: true },
      P3: { labels: ['ready', 'released'], planned: true }, P4: { labels: ['ready', 'released'], planned: true },
    });
    const cohort = computeCohort(nodes, lk, 1); // 2n = 2 pickable + in-flight
    expect(cohort).toContain('IF1');
    expect(cohort).toContain('P1');
    expect(cohort).toContain('P2');
    expect(cohort).not.toContain('P3');
  });
});

describe('selectUnblockTargets', () => {
  it('returns blocks-main issues in rank order, capped, never vetoed or in-flight', () => {
    const nodes = [
      node({ issue: 'BM-LOW', rank: 9 }),
      node({ issue: 'BM-HIGH', rank: 3 }),
      node({ issue: 'BM-VETO', rank: 1 }),
      node({ issue: 'BM-FLIGHT', rank: 2 }),
      node({ issue: 'PLAIN', rank: 4 }),
    ];
    const lk = lookups({
      'BM-LOW': { labels: ['blocks-main'] },
      'BM-HIGH': { labels: ['blocks-main'] },
      'BM-VETO': { labels: ['blocks-main', 'vetoed'] }, // vetoed wins — excluded
      'BM-FLIGHT': { labels: ['blocks-main'], inPipeline: true }, // already running — excluded
      'PLAIN': {},
    });
    const targets = selectUnblockTargets(nodes, lk, { cap: 2 });
    expect(targets.map((t) => t.issue)).toEqual(['BM-HIGH', 'BM-LOW']);
  });

  it('respects the cap', () => {
    const nodes = [node({ issue: 'A', rank: 1 }), node({ issue: 'B', rank: 2 }), node({ issue: 'C', rank: 3 })];
    const lk = lookups({ A: { labels: ['blocks-main'] }, B: { labels: ['blocks-main'] }, C: { labels: ['blocks-main'] } });
    expect(selectUnblockTargets(nodes, lk, { cap: 1 }).map((t) => t.issue)).toEqual(['A']);
  });
});

describe('selectNeedsPlanning', () => {
  it('returns ready-but-unplanned issues in rank order', () => {
    const nodes = [
      node({ issue: 'LOW', rank: 5 }),
      node({ issue: 'HIGH', rank: 2 }),
      node({ issue: 'PLANNED', rank: 1 }),
    ];
    const lk = lookups({
      LOW: { labels: ['ready'], planned: false },
      HIGH: { labels: ['ready'], planned: false },
      PLANNED: { labels: ['ready'], planned: true },
    });

    expect(selectNeedsPlanning(nodes, lk).map((t) => t.issue)).toEqual(['HIGH', 'LOW']);
  });

  it('excludes planned, parked, vetoed, objected, and in-pipeline issues', () => {
    const nodes = [
      node({ issue: 'PLANNED', rank: 1 }),
      node({ issue: 'PARKED', rank: 2 }),
      node({ issue: 'VETOED', rank: 3 }),
      node({ issue: 'OBJECTED', rank: 4 }),
      node({ issue: 'FLIGHT', rank: 5 }),
    ];
    const lk = lookups({
      PLANNED: { labels: ['ready'], planned: true },
      PARKED: { labels: ['ready', 'parked'] },
      VETOED: { labels: ['ready', 'vetoed'] },
      OBJECTED: { labels: ['ready', 'objection'] },
      FLIGHT: { labels: ['ready'], inPipeline: true },
    });

    expect(selectNeedsPlanning(nodes, lk)).toEqual([]);
  });

  it('respects the cap and defaults to two items', () => {
    const nodes = [node({ issue: 'A', rank: 1 }), node({ issue: 'B', rank: 2 }), node({ issue: 'C', rank: 3 })];
    const lk = lookups({ A: { labels: ['ready'] }, B: { labels: ['ready'] }, C: { labels: ['ready'] } });

    expect(selectNeedsPlanning(nodes, lk).map((t) => t.issue)).toEqual(['A', 'B']);
    expect(selectNeedsPlanning(nodes, lk, { cap: 1 }).map((t) => t.issue)).toEqual(['A']);
  });

  it('returns an empty array when no issue needs planning', () => {
    const nodes = [node({ issue: 'A', rank: 1 }), node({ issue: 'B', rank: 2 })];
    const lk = lookups({ A: { labels: ['ready'], planned: true }, B: { labels: [] } });

    expect(selectNeedsPlanning(nodes, lk)).toEqual([]);
  });
});

describe('computeStats', () => {
  it('counts each state, incl. released / objection / needsRelease (PAN-2059)', () => {
    const nodes = [
      node({ issue: 'IF', rank: 1 }),
      node({ issue: 'RP', rank: 2 }),  // ready+planned+released (pickable)
      node({ issue: 'RN', rank: 3 }),  // ready, not planned (needs planning)
      node({ issue: 'NR', rank: 4 }),  // ready+planned, NOT released (needs release)
      node({ issue: 'OBJ', rank: 5 }), // ready+planned+released but objected (not pickable)
      node({ issue: 'V', rank: 6 }),   // vetoed
      node({ issue: 'BM', rank: 7 }),  // blocks-main (pickable)
    ];
    const lk = lookups({
      IF: { inPipeline: true },
      RP: { labels: ['ready', 'released'], planned: true },
      RN: { labels: ['ready'], planned: false },
      NR: { labels: ['ready'], planned: true },
      OBJ: { labels: ['ready', 'released', 'objection'], planned: true },
      V: { labels: ['vetoed'] },
      BM: { labels: ['blocks-main', 'ready', 'released'], planned: true },
    });
    const s = computeStats(nodes, lk);
    expect(s.total).toBe(7);
    expect(s.inFlight).toBe(1);
    expect(s.pickable).toBe(2); // RP + BM (OBJ excluded by objection, NR excluded by no-release)
    expect(s.needsPlanning).toBe(1); // RN
    expect(s.needsRelease).toBe(1); // NR
    expect(s.released).toBe(3); // RP, OBJ, BM
    expect(s.objection).toBe(1); // OBJ
    expect(s.vetoed).toBe(1);
    expect(s.blocksMain).toBe(1);
  });
});
