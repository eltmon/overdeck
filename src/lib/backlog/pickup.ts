/**
 * PAN-2006 — shared pickup-eligibility + forecast model (single source of truth).
 *
 * This module is the ONE place that classifies a backlog issue's pipeline state and
 * decides what is auto-pickable / unblock-eligible, plus the wave / lane / cohort
 * computations the Forecast UI (PAN-2005) and the Run lifecycle consume. The Flywheel
 * (`pickFromSequence`) and the dashboard must import from here rather than reimplement
 * the rules, so the operator-facing forecast can never disagree with what actually runs.
 *
 * Pure: no I/O. All environment facts (labels, planned-ness, in-pipeline) are injected
 * via {@link ClassifyLookups}.
 *
 * Vocabulary (operator-confirmed 2026-06-21):
 *  - Ready      — operator marked it workable (Definition of Ready): `ready` label / Linear Todo. Entry gate.
 *  - Planned    — has a vBRIEF spec + beads. Derived. Distinct from Ready.
 *  - released   — operator reviewed the plan and released it for pickup (`released` label, PAN-2059). Required for auto-pickup.
 *  - objection  — AI raised a written "held for review" objection in place of planning (`objection` label, PAN-2059). Halts pickup until override/park.
 *  - parked     — deferred pending human design/discussion (`parked` label; legacy `needs-design`/`needs-discussion`).
 *  - vetoed     — absolute NO; overrides even a pipeline-unblock (`vetoed` label OR pickup-gate `vetoed`).
 *  - blocks-main — must land to green main (`blocks-main` label).
 *  - pickup gate — operator override stored in sequence.md: `auto` | `promote` | `vetoed`.
 */
import type { SequenceNode } from './types.js';

export const READY_LABEL = 'ready';
export const PARKED_LABEL = 'parked';
/** An epic is a container of child issues — never directly workable/pickable. */
export const EPIC_LABEL = 'epic';
export const VETOED_LABEL = 'vetoed';
export const BLOCKS_MAIN_LABEL = 'blocks-main';
/** PAN-2059: operator's explicit "go" after reviewing the plan. Required for auto-pickup. */
export const RELEASED_LABEL = 'released';
/** PAN-2059: the planning AI's written "no, and here's why" — raised in place of a plan. */
export const OBJECTION_LABEL = 'objection';
/** Pre-PAN-2006 labels that still mean "parked" until migrated (FR-2). */
export const LEGACY_PARKED_LABELS = ['needs-design', 'needs-discussion'] as const;

export type PickupGate = 'auto' | 'promote' | 'vetoed';

export interface PipelineState {
  /** Definition of Ready met — operator signalled it may enter the pipeline. */
  ready: boolean;
  /** Has a vBRIEF spec + beads (worked-out enough to start). */
  planned: boolean;
  /** Deferred pending human design/discussion. */
  parked: boolean;
  /** Hard veto — never pick up, plan, or strike; overrides the unblock path. */
  vetoed: boolean;
  /** Must land to get main green. */
  blocksMain: boolean;
  /** Active work/review/test in flight. */
  inPipeline: boolean;
  /** PAN-2059: operator reviewed the plan and released it for pickup. Required for auto-pickup. */
  released: boolean;
  /** PAN-2059: AI raised a written objection (held for review) in place of planning. */
  objection: boolean;
  /** Epic container (not directly workable) — its children carry the work. */
  epic: boolean;
  /** Operator pickup override. */
  gate: PickupGate;
}

export interface ClassifyLookups {
  /** GitHub/Linear labels for an issue (case-insensitive match). */
  labels: (issueId: string) => readonly string[];
  /** True when the issue has a vBRIEF spec AND beads. */
  isPlanned: (issueId: string) => boolean;
  /** True when the issue has active work/review/test. */
  isInPipeline: (issueId: string) => boolean;
}

/** Map legacy/new gate spellings onto the locked `auto|promote|vetoed` set. */
export function normalizeGate(gate: string | undefined): PickupGate {
  if (gate === 'vetoed' || gate === 'blocked') return 'vetoed';
  if (gate === 'promote' || gate === 'ready') return 'promote';
  return 'auto';
}

/** Derive the full pipeline state for one node. */
export function classifyIssue(node: SequenceNode, lk: ClassifyLookups): PipelineState {
  const labels = lk.labels(node.issue).map((l) => l.toLowerCase());
  const has = (l: string) => labels.includes(l);
  const gate = normalizeGate(node.gate);
  return {
    ready: has(READY_LABEL),
    planned: lk.isPlanned(node.issue),
    parked: has(PARKED_LABEL) || LEGACY_PARKED_LABELS.some((l) => has(l)),
    vetoed: has(VETOED_LABEL) || gate === 'vetoed',
    blocksMain: has(BLOCKS_MAIN_LABEL),
    inPipeline: lk.isInPipeline(node.issue),
    released: has(RELEASED_LABEL),
    objection: has(OBJECTION_LABEL),
    epic: node.isEpic === true || has(EPIC_LABEL),
    gate,
  };
}

/**
 * Routine auto-pickup for WORK: Ready AND Planned AND Released AND not
 * parked/vetoed/objected/in-flight. The DoR `ready` is the entry gate; `released`
 * (PAN-2059) is the operator's explicit "go" after reviewing the plan — a Planned
 * item is NOT pickable until released. An open `objection` halts pickup until the
 * operator overrides or parks. An `epic` is a container, never directly workable —
 * its children carry the work, so it is excluded regardless of the other gates.
 */
export function isAutoPickable(s: PipelineState): boolean {
  return s.ready && s.planned && s.released && !s.parked && !s.vetoed && !s.objection && !s.inPipeline && !s.epic;
}

/**
 * Pipeline-unblock override (FR-6): a blocks-main issue may be picked / struck even
 * when not Ready/Released and even with auto-pickup off — EXCEPT `vetoed` (the one
 * hard stop), an open `objection` (PAN-2059), and `epic` containers, which halt even
 * blocks-main pickup until the operator overrides or parks. An epic is never directly
 * worked, so it is not a valid unblock target either — strike a child instead.
 */
export function isUnblockEligible(s: PipelineState): boolean {
  return s.blocksMain && !s.vetoed && !s.objection && !s.inPipeline && !s.epic;
}

/** Effort → relative duration units for the lane forecast. */
export const EFFORT_UNITS: Record<string, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
export function effortOf(size: string): number {
  return EFFORT_UNITS[size] ?? EFFORT_UNITS['M']!;
}

/** Sort key: promoted issues jump ahead of their rank (FR-7), then by rank. */
function pickOrder(a: { gate: PickupGate; rank: number }, b: { gate: PickupGate; rank: number }): number {
  const ap = a.gate === 'promote' ? 0 : 1;
  const bp = b.gate === 'promote' ? 0 : 1;
  if (ap !== bp) return ap - bp;
  return a.rank - b.rank;
}

export interface ForecastNode {
  issue: string;
  rank: number;
  size: string;
  state: PipelineState;
}

/** The auto-pickable queue, in pickup order (promoted first, then rank). */
export function pickableQueue(nodes: readonly SequenceNode[], lk: ClassifyLookups): ForecastNode[] {
  return nodes
    .map((n) => ({ issue: n.issue, rank: n.rank, size: n.size, state: classifyIssue(n, lk) }))
    .filter((n) => isAutoPickable(n.state))
    .sort((a, b) => pickOrder({ gate: a.state.gate, rank: a.rank }, { gate: b.state.gate, rank: b.rank }));
}

/** Batch the pickup queue into waves of up to `n`. */
export function computeWaves(nodes: readonly SequenceNode[], lk: ClassifyLookups, n: number): ForecastNode[][] {
  const q = pickableQueue(nodes, lk);
  const size = Math.max(1, n);
  const waves: ForecastNode[][] = [];
  for (let i = 0; i < q.length; i += size) waves.push(q.slice(i, i + size));
  return waves;
}

export interface LaneBlock extends ForecastNode {
  lane: number;
  start: number;
  end: number;
}

/** Greedy list-schedule of the pickup queue across `n` lanes (block width = effort). */
export function computeLanes(
  nodes: readonly SequenceNode[],
  lk: ClassifyLookups,
  n: number,
): { blocks: LaneBlock[]; makespan: number } {
  const lanes = Math.max(1, n);
  const free = new Array<number>(lanes).fill(0);
  const blocks: LaneBlock[] = [];
  for (const item of pickableQueue(nodes, lk)) {
    let li = 0;
    for (let i = 1; i < lanes; i++) if (free[i]! < free[li]!) li = i;
    const start = free[li]!;
    const end = start + effortOf(item.size);
    free[li] = end;
    blocks.push({ ...item, lane: li, start, end });
  }
  return { blocks, makespan: Math.max(0, ...free) };
}

/**
 * Run cohort (FR-9): the work a Run commits to draining = everything in-flight now
 * ∪ the auto-pickable issues in the current + next wave (top `2 × n` by pickup order).
 * Returns the issue ids; the Run completes when all of them reach a terminal state.
 */
export function computeCohort(nodes: readonly SequenceNode[], lk: ClassifyLookups, n: number): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (classifyIssue(node, lk).inPipeline) ids.add(node.issue);
  }
  for (const item of pickableQueue(nodes, lk).slice(0, Math.max(1, n) * 2)) {
    ids.add(item.issue);
  }
  return [...ids];
}

/**
 * Pipeline-unblock targets (FR-6): the blocks-main issues the Flywheel may strike
 * even when auto-pickup is off — in rank order, capped, never `vetoed`, never
 * already in-flight. `vetoed` is the absolute stop that overrides the unblock path.
 */
export function selectUnblockTargets(
  nodes: readonly SequenceNode[],
  lk: ClassifyLookups,
  opts: { cap?: number } = {},
): ForecastNode[] {
  const cap = Math.max(1, opts.cap ?? 2);
  return nodes
    .map((n) => ({ issue: n.issue, rank: n.rank, size: n.size, state: classifyIssue(n, lk) }))
    .filter((n) => isUnblockEligible(n.state))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, cap);
}

/**
 * Planning floor targets: ready issues that still need a plan, capped in rank
 * order. Planning stops at the Release gate; this selector surfaces the backlog
 * the flywheel should keep planning even while a current work cohort drains.
 */
export function selectNeedsPlanning(
  nodes: readonly SequenceNode[],
  lk: ClassifyLookups,
  opts: { cap?: number } = {},
): ForecastNode[] {
  const cap = Math.max(1, opts.cap ?? 2);
  return nodes
    .map((n) => ({ issue: n.issue, rank: n.rank, size: n.size, state: classifyIssue(n, lk) }))
    .filter((n) => n.state.ready && !n.state.planned && !n.state.parked && !n.state.vetoed && !n.state.objection && !n.state.inPipeline)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, cap);
}

export interface ForecastStats {
  total: number;
  inFlight: number;
  ready: number;
  planned: number;
  released: number;
  objection: number;
  pickable: number;
  needsPlanning: number;
  needsRelease: number;
  parked: number;
  vetoed: number;
  blocksMain: number;
}

/** Aggregate counts for the forecast header / filter bar. */
export function computeStats(nodes: readonly SequenceNode[], lk: ClassifyLookups): ForecastStats {
  const stats: ForecastStats = {
    total: nodes.length, inFlight: 0, ready: 0, planned: 0, released: 0, objection: 0,
    pickable: 0, needsPlanning: 0, needsRelease: 0, parked: 0, vetoed: 0, blocksMain: 0,
  };
  for (const node of nodes) {
    const s = classifyIssue(node, lk);
    if (s.inPipeline) stats.inFlight++;
    if (s.ready) stats.ready++;
    if (s.planned) stats.planned++;
    if (s.released) stats.released++;
    if (s.objection) stats.objection++;
    if (s.parked) stats.parked++;
    if (s.vetoed) stats.vetoed++;
    if (s.blocksMain) stats.blocksMain++;
    if (isAutoPickable(s)) stats.pickable++;
    // "needs planning" = wants to run (ready, not parked/vetoed/objected/in-flight) but no spec yet
    if (s.ready && !s.planned && !s.parked && !s.vetoed && !s.objection && !s.inPipeline) stats.needsPlanning++;
    // "needs release" = planned + ready but the operator hasn't released it yet (PAN-2059)
    if (s.ready && s.planned && !s.released && !s.parked && !s.vetoed && !s.objection && !s.inPipeline) stats.needsRelease++;
  }
  return stats;
}

export interface EpicGroups {
  epics: Array<{ issue: string; rank: number }>;
  contains: Array<{ epic: string; child: string }>;
}

export function computeEpicGroups(
  nodes: readonly SequenceNode[],
  edges: readonly { from: string; to: string; type: string }[],
  lk: ClassifyLookups,
): EpicGroups {
  const epics = nodes
    .filter((node) => classifyIssue(node, lk).epic)
    .map((node) => ({ issue: node.issue, rank: node.rank }))
    .sort((a, b) => a.rank - b.rank);
  const contains = edges
    .filter((edge) => edge.type === 'contains')
    .map((edge) => ({ epic: edge.from, child: edge.to }));
  return { epics, contains };
}
