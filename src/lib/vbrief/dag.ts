/**
 * vBRIEF DAG utilities — critical path, graph analysis, wave scheduling, per-item dispatch
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { VBriefDocument, VBriefItem, VBriefItemStatus } from './types.js';

export interface WaveItem {
  id: string;
  title: string;
  difficulty?: string;
  blockedBy: string[];
}

export interface Wave {
  index: number;
  items: WaveItem[];
}

/**
 * Groups actionable vBRIEF items into dependency waves using Kahn's algorithm.
 *
 * Wave 0 = items with no unresolved blockers (ready to start).
 * Wave N = items whose blockers all resolve in waves < N.
 * Completed/cancelled items are excluded from waves but their edges are honored
 * (a completed blocker does not hold back its dependents).
 *
 * Returns waves in ascending order. Items within a wave are independent and
 * can execute in parallel.
 */
export function groupItemsByWave(doc: VBriefDocument): Wave[] {
  const skipStatuses = new Set(['completed', 'cancelled', 'blocked', 'running']);
  const actionable = doc.plan.items.filter(i => !skipStatuses.has(i.status));
  if (actionable.length === 0) return [];

  const actionableIds = new Set(actionable.map(i => i.id));
  const allItemIds = new Set(doc.plan.items.map(i => i.id));
  const completedIds = new Set(
    doc.plan.items.filter(i => skipStatuses.has(i.status)).map(i => i.id),
  );

  const edges = doc.plan.edges ?? [];
  const blockEdges = edges.filter(
    e => e.type === 'blocks' && allItemIds.has(e.from) && allItemIds.has(e.to),
  );

  // Build in-degree for actionable items only.
  // Edges from completed items don't contribute — those blockers are resolved.
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const incomingFrom = new Map<string, string[]>();

  for (const id of actionableIds) {
    inDegree.set(id, 0);
    outgoing.set(id, []);
    incomingFrom.set(id, []);
  }

  for (const edge of blockEdges) {
    if (!actionableIds.has(edge.to)) continue;
    if (completedIds.has(edge.from)) continue;
    if (!actionableIds.has(edge.from)) continue;

    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
    incomingFrom.get(edge.to)?.push(edge.from);
  }

  const itemById = new Map<string, VBriefItem>(doc.plan.items.map(i => [i.id, i]));
  const waves: Wave[] = [];

  let currentLayer = Array.from(actionableIds).filter(id => (inDegree.get(id) ?? 0) === 0);
  let waveIndex = 0;

  while (currentLayer.length > 0) {
    const waveItems: WaveItem[] = currentLayer.map(id => {
      const item = itemById.get(id)!;
      return {
        id,
        title: item.title,
        difficulty: item.metadata?.difficulty,
        blockedBy: incomingFrom.get(id) ?? [],
      };
    });

    waves.push({ index: waveIndex, items: waveItems });

    const nextLayer: string[] = [];
    for (const id of currentLayer) {
      for (const dep of outgoing.get(id) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) {
          nextLayer.push(dep);
        }
      }
    }

    currentLayer = nextLayer;
    waveIndex++;
  }

  return waves;
}

/**
 * Computes the critical path of a vBRIEF plan using the longest-path
 * algorithm on 'blocks' edges.
 *
 * All edges have weight 1 (one step). Returns an ordered list of item IDs
 * representing the longest dependency chain in the DAG.
 *
 * Returns [] for empty plans or plans with no blocking edges.
 */
export function criticalPath(doc: VBriefDocument): string[] {
  const items = doc.plan.items;
  const edges = doc.plan.edges ?? [];
  const blockEdges = edges.filter(e => e.type === 'blocks');

  if (items.length === 0 || blockEdges.length === 0) return [];

  const itemIds = new Set(items.map(i => i.id));

  // Build adjacency: from → list of 'to' IDs
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of itemIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of blockEdges) {
    if (itemIds.has(edge.from) && itemIds.has(edge.to)) {
      outgoing.get(edge.from)!.push(edge.to);
      incoming.get(edge.to)!.push(edge.from);
    }
  }

  // Topological sort (Kahn's algorithm) for longest-path DP.
  // Assumption: the plan DAG is acyclic. Cycles are not detected; if present,
  // nodes in the cycle will retain non-zero in-degree and be excluded from
  // topoOrder, effectively treating the cycle as a disconnected subgraph
  // (the longest path through non-cyclic nodes is still returned correctly).
  const inDegree = new Map<string, number>();
  for (const id of itemIds) {
    inDegree.set(id, incoming.get(id)!.length);
  }

  const queue: string[] = [];
  for (const id of itemIds) {
    if (inDegree.get(id) === 0) queue.push(id);
  }

  // DP: dist[id] = longest path ending at id, prev[id] = predecessor on that path
  const dist = new Map<string, number>(Array.from(itemIds).map(id => [id, 0]));
  const prev = new Map<string, string | null>(Array.from(itemIds).map(id => [id, null]));

  const topoOrder: string[] = [];
  const q = [...queue];
  let qHead = 0;
  while (qHead < q.length) {
    const u = q[qHead++]!;
    topoOrder.push(u);
    for (const v of outgoing.get(u) ?? []) {
      const newDist = dist.get(u)! + 1;
      if (newDist > dist.get(v)!) {
        dist.set(v, newDist);
        prev.set(v, u);
      }
      const newDeg = inDegree.get(v)! - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) q.push(v);
    }
  }

  // Find the node with the maximum distance (end of critical path)
  let maxDist = 0;
  let endNode: string | null = null;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  if (!endNode || maxDist === 0) return [];

  // Reconstruct path by following prev pointers
  const path: string[] = [];
  let current: string | null = endNode;
  while (current !== null) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  return path;
}

/**
 * Returns items that are ready to dispatch given the set of item IDs that have
 * been merged into the feature branch. An item is dispatchable when:
 *   - Its status is not 'completed', 'cancelled', or 'running'
 *   - Every item with a 'blocks → thisItem' edge is either in `mergedItemIds`
 *     OR has status 'completed'/'cancelled' in the plan.
 */
export function getDispatchableItems(
  doc: VBriefDocument,
  mergedItemIds: Set<string>,
): VBriefItem[] {
  const nonDispatchableStatuses = new Set(['completed', 'cancelled', 'running', 'blocked']);
  const actionable = doc.plan.items.filter(i => !nonDispatchableStatuses.has(i.status));
  if (actionable.length === 0) return [];

  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  const actionableIds = new Set(actionable.map(i => i.id));

  // Collect 'blocks' edges whose target is actionable
  const blockEdges = doc.plan.edges.filter(
    e => e.type === 'blocks' && actionableIds.has(e.to) && itemById.has(e.from),
  );

  // Build map: itemId → list of blocker IDs
  const blockers = new Map<string, string[]>();
  for (const id of actionableIds) blockers.set(id, []);
  for (const edge of blockEdges) {
    blockers.get(edge.to)?.push(edge.from);
  }

  return actionable.filter(item => {
    const itemBlockers = blockers.get(item.id) ?? [];
    return itemBlockers.every(blockerId => {
      if (mergedItemIds.has(blockerId)) return true;
      const blocker = itemById.get(blockerId);
      return blocker?.status === 'completed' || blocker?.status === 'cancelled';
    });
  });
}

/**
 * Returns the count of blocking parents for an item (items with 'blocks → itemId' edges
 * that are neither completed nor cancelled in the plan).
 * Count > 1 means the item is a DAG convergence point requiring a synthesis agent.
 */
export function blockingParentCount(doc: VBriefDocument, itemId: string): number {
  const completedStatuses = new Set(['completed', 'cancelled']);
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges.filter(e => {
    if (e.type !== 'blocks' || e.to !== itemId) return false;
    const parent = itemById.get(e.from);
    return parent && !completedStatuses.has(parent.status);
  }).length;
}

export function blockingParentTotal(doc: VBriefDocument, itemId: string): number {
  const itemIds = new Set(doc.plan.items.map(i => i.id));
  return doc.plan.edges.filter(e => e.type === 'blocks' && e.to === itemId && itemIds.has(e.from)).length;
}

export function deriveSynthesisMetadata(doc: VBriefDocument): VBriefDocument {
  const next = cloneDoc(doc);
  const itemIds = new Set(next.plan.items.map(item => item.id));
  const incomingBlockCounts = new Map<string, number>();

  for (const edge of next.plan.edges) {
    if (edge.type !== 'blocks' || !itemIds.has(edge.from) || !itemIds.has(edge.to)) continue;
    incomingBlockCounts.set(edge.to, (incomingBlockCounts.get(edge.to) ?? 0) + 1);
  }

  for (const item of next.plan.items) {
    if ((incomingBlockCounts.get(item.id) ?? 0) > 1) {
      item.metadata = { ...(item.metadata ?? {}), requiresSynthesis: true };
    }
  }
  return next;
}

/**
 * Converts a glob pattern to a RegExp for simple path matching.
 * Supports `**` (any path segment), `*` (any chars within a segment), and `?`.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * and ?
    .replace(/\*\*/g, '\x00')              // temporarily replace ** with NUL
    .replace(/\*/g, '[^/]*')              // * matches within a segment
    .replace(/\x00/g, '.*')               // ** matches across segments
    .replace(/\?/g, '[^/]');              // ? matches any single char
  return new RegExp(`^${escaped}$`);
}

/**
 * Returns true if a path matches at least one glob pattern in the list.
 * Patterns ending in `/**` also match exact directory paths.
 */
interface CompiledGlob {
  pattern: string;
  regex: RegExp;
  exactDirectory?: string;
}

function compileGlob(pattern: string): CompiledGlob {
  const withoutTrail = pattern.replace(/\/\*\*$/, '');
  return {
    pattern,
    regex: globToRegex(pattern),
    exactDirectory: withoutTrail !== pattern ? withoutTrail : undefined,
  };
}

function pathMatchesAnyCompiled(filePath: string, patterns: CompiledGlob[]): boolean {
  return patterns.some(pattern => pattern.regex.test(filePath) || pattern.exactDirectory === filePath);
}

function pathMatchesAny(filePath: string, patterns: string[]): boolean {
  return pathMatchesAnyCompiled(filePath, patterns.map(compileGlob));
}

/**
 * Returns true if the candidate item's `files_scope` overlaps with any running
 * item's `files_scope`. Items without a `files_scope` are considered non-overlapping.
 *
 * Overlap is bidirectional: a file in the candidate matched by a running item's
 * patterns, or a file in a running item matched by the candidate's patterns.
 */
export function hasFileOverlap(runningItems: VBriefItem[], candidate: VBriefItem): boolean {
  const candidateScope = candidate.metadata?.files_scope;
  if (!candidateScope || candidateScope.length === 0) return false;

  const compiledCandidateScope = candidateScope.map(compileGlob);

  for (const running of runningItems) {
    const runningScope = running.metadata?.files_scope;
    if (!runningScope || runningScope.length === 0) continue;
    const compiledRunningScope = runningScope.map(compileGlob);

    // Check candidate patterns against running scope paths
    for (const runningPath of runningScope) {
      if (pathMatchesAnyCompiled(runningPath, compiledCandidateScope)) return true;
    }
    // Check running patterns against candidate scope paths
    for (const candidatePath of candidateScope) {
      if (pathMatchesAnyCompiled(candidatePath, compiledRunningScope)) return true;
    }
  }

  return false;
}


/** Active-slice prompt contract for bounded work-agent context. */
export interface ActiveSlice {
  issueId: string;
  planId: string;
  planTitle: string;
  planSequence: number;
  objective?: string;
  globalConstraints: string[];
  item: VBriefItem;
  currentWorkSet: VBriefItem[];
  /** Direct blocking parent items, regardless of status. */
  blockers: VBriefItem[];
  /** Resolved direct blocking parents that should inform this item. */
  dependencies: VBriefItem[];
  /** Direct child items this work unlocks after completion. */
  unlocks: VBriefItem[];
  /** Nearby items connected by non-blocking context edges or shared phase. */
  nearbyContext: VBriefItem[];
  /** Direct child acceptance criteria/subItems for prompt-size boundedness. */
  acceptanceCriteria: NonNullable<VBriefItem['subItems']>;
  /** Synthesis context for DAG convergence points, when available. */
  synthesisContext?: string;
  /** Minimal markdown prompt payload for work agents. */
  prompt: string;
}

export interface ActiveSliceOptions {
  issueId: string;
  itemId: string;
  currentItemIds?: string[];
  synthesisOutputs?: Record<string, { contextUpdate: string }>;
}

function directBlockingParents(doc: VBriefDocument, itemId: string): VBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges
    .filter(e => e.type === 'blocks' && e.to === itemId)
    .map(e => itemById.get(e.from))
    .filter((item): item is VBriefItem => Boolean(item));
}

function directUnlocks(doc: VBriefDocument, itemId: string): VBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges
    .filter(e => e.type === 'blocks' && e.from === itemId)
    .map(e => itemById.get(e.to))
    .filter((item): item is VBriefItem => Boolean(item));
}

function nearbyItems(doc: VBriefDocument, item: VBriefItem, excludedIds: Set<string>): VBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  const nearby = new Map<string, VBriefItem>();
  for (const edge of doc.plan.edges) {
    if (edge.type === 'blocks') continue;
    if (edge.from === item.id) {
      const candidate = itemById.get(edge.to);
      if (candidate && !excludedIds.has(candidate.id)) nearby.set(candidate.id, candidate);
    }
    if (edge.to === item.id) {
      const candidate = itemById.get(edge.from);
      if (candidate && !excludedIds.has(candidate.id)) nearby.set(candidate.id, candidate);
    }
  }
  const phase = item.metadata?.phase;
  if (phase !== undefined) {
    for (const candidate of doc.plan.items) {
      if (nearby.size >= 5) break;
      if (candidate.id !== item.id && candidate.metadata?.phase === phase && !excludedIds.has(candidate.id)) {
        nearby.set(candidate.id, candidate);
      }
    }
  }
  return Array.from(nearby.values()).slice(0, 5);
}

function renderItemLine(item: VBriefItem): string {
  const phase = item.metadata?.phase !== undefined ? ` phase=${item.metadata.phase}` : '';
  const difficulty = item.metadata?.difficulty ? ` difficulty=${item.metadata.difficulty}` : '';
  return `- ${item.id}: ${item.title} [${item.status}]${phase}${difficulty}`;
}

/**
 * Build the bounded active slice that work-agent prompts should receive by
 * default instead of the full vBRIEF. The slice includes the target/current work
 * set, direct blockers, unlocks, nearby context, global constraints, acceptance
 * criteria, and optional persisted synthesis output for convergence points.
 */
export function createActiveSlice(doc: VBriefDocument, options: ActiveSliceOptions): ActiveSlice {
  const item = doc.plan.items.find(i => i.id === options.itemId);
  if (!item) throw new Error(`Plan item not found: ${options.itemId}`);
  const currentIds = Array.from(new Set([...(options.currentItemIds ?? []), item.id]));
  const currentWorkSet = currentIds
    .map(id => doc.plan.items.find(i => i.id === id))
    .filter((candidate): candidate is VBriefItem => Boolean(candidate));
  const blockers = directBlockingParents(doc, item.id);
  const resolvedStatuses = new Set(['completed', 'cancelled']);
  const dependencies = blockers.filter(parent => resolvedStatuses.has(parent.status));
  const unlocks = directUnlocks(doc, item.id);
  const excludedIds = new Set([item.id, ...currentWorkSet.map(i => i.id), ...blockers.map(i => i.id), ...unlocks.map(i => i.id)]);
  const nearbyContext = nearbyItems(doc, item, excludedIds);
  const acceptanceCriteria = item.subItems ?? [];
  const synthesisContext = options.synthesisOutputs?.[item.id]?.contextUpdate;
  const globalConstraints = [doc.plan.narratives?.Constraint, doc.plan.narratives?.Risk]
    .filter((value): value is string => Boolean(value));
  const objective = doc.plan.narratives?.Problem ?? doc.plan.narratives?.Proposal ?? doc.vBRIEFInfo.description;
  const prompt = renderActiveSlicePrompt({
    issueId: options.issueId,
    planId: doc.plan.id,
    planTitle: doc.plan.title,
    planSequence: doc.plan.sequence ?? 0,
    objective,
    globalConstraints,
    item,
    currentWorkSet,
    blockers,
    dependencies,
    unlocks,
    nearbyContext,
    acceptanceCriteria,
    synthesisContext,
  });
  return {
    issueId: options.issueId,
    planId: doc.plan.id,
    planTitle: doc.plan.title,
    planSequence: doc.plan.sequence ?? 0,
    objective,
    globalConstraints,
    item,
    currentWorkSet,
    blockers,
    dependencies,
    unlocks,
    nearbyContext,
    acceptanceCriteria,
    synthesisContext,
    prompt,
  };
}

export function renderActiveSlicePrompt(slice: Omit<ActiveSlice, 'prompt'>): string {
  const lines = [
    `# Active vBRIEF Slice: ${slice.issueId}`,
    `Plan: ${slice.planTitle} (${slice.planId}) @ sequence ${slice.planSequence}`,
  ];
  if (slice.objective) lines.push(``, `## Issue Objective`, slice.objective);
  if (slice.globalConstraints.length > 0) lines.push(``, `## Global Constraints`, ...slice.globalConstraints.map(c => `- ${c}`));
  lines.push(``, `## Current Work Set`, ...slice.currentWorkSet.map(renderItemLine));
  lines.push(``, `## Target Item`, renderItemLine(slice.item));
  if (slice.item.narrative?.Action) lines.push(`- Action: ${slice.item.narrative.Action}`);
  if (slice.blockers.length > 0) {
    lines.push(``, `## Direct Blockers`);
    for (const dep of slice.blockers) lines.push(renderItemLine(dep));
  }
  if (slice.dependencies.length > 0) {
    lines.push(``, `## Resolved Dependencies`);
    for (const dep of slice.dependencies) lines.push(renderItemLine(dep));
  }
  if (slice.unlocks.length > 0) {
    lines.push(``, `## Direct Unlocks / Dependents`);
    for (const unlock of slice.unlocks) lines.push(renderItemLine(unlock));
  }
  if (slice.nearbyContext.length > 0) {
    lines.push(``, `## Nearby Context`);
    for (const nearby of slice.nearbyContext) lines.push(renderItemLine(nearby));
  }
  if (slice.acceptanceCriteria.length > 0) {
    lines.push(``, `## Acceptance Criteria`);
    for (const ac of slice.acceptanceCriteria) lines.push(`- ${ac.id}: ${ac.title} [${ac.status}]`);
  }
  if (slice.synthesisContext) lines.push(``, `## Synthesis Context`, slice.synthesisContext);
  return lines.join('\n');
}

export type TaskOperationType = 'claim' | 'done' | 'block' | 'unblock' | 'cancel';

export interface TaskOperation {
  type: TaskOperationType;
  itemId: string;
  expectedSequence?: number;
  reason?: string;
  subItemIds?: string[];
  pipeline?: PlanPipelineMirror;
}

export interface TaskOperationResult {
  doc: VBriefDocument;
  item: VBriefItem;
}

const TASK_OPERATION_TYPES = new Set<string>(['claim', 'done', 'block', 'unblock', 'cancel']);
const TASK_COMMANDS = new Set<string>(['next', 'show', ...TASK_OPERATION_TYPES]);

export function isTaskOperationType(value: string): value is TaskOperationType {
  return TASK_OPERATION_TYPES.has(value);
}

export function isTaskCommand(value: string): value is TaskCommand {
  return TASK_COMMANDS.has(value);
}

function statusForOperation(type: TaskOperationType): VBriefItemStatus {
  switch (type) {
    case 'claim': return 'running';
    case 'done': return 'completed';
    case 'block': return 'blocked';
    case 'unblock': return 'pending';
    case 'cancel': return 'cancelled';
    default: {
      const exhaustive: never = type;
      throw new Error(`Unsupported vBRIEF task operation: ${String(exhaustive)}`);
    }
  }
}

function cloneDoc(doc: VBriefDocument): VBriefDocument {
  return JSON.parse(JSON.stringify(doc)) as VBriefDocument;
}

/**
 * Apply a Panopticon-native task operation to the vBRIEF itself. This is the
 * single mutation authority for swarm task status: Beads can mirror state during
 * migration, but the plan document wins and receives the sequence bump.
 */
export function applyTaskOperation(doc: VBriefDocument, operation: TaskOperation): TaskOperationResult {
  if (!isTaskOperationType(String(operation.type))) {
    throw new Error(`Unsupported vBRIEF task operation: ${String(operation.type)}`);
  }
  const currentSequence = doc.plan.sequence ?? 0;
  if (operation.expectedSequence !== undefined && operation.expectedSequence !== currentSequence) {
    throw new Error(`vBRIEF sequence conflict: expected ${operation.expectedSequence}, found ${currentSequence}`);
  }
  const next = cloneDoc(doc);
  const item = next.plan.items.find(i => i.id === operation.itemId);
  if (!item) throw new Error(`Plan item not found: ${operation.itemId}`);

  const now = new Date().toISOString();
  item.status = statusForOperation(operation.type);
  if (operation.type === 'done') item.completed = now;
  if (operation.reason) {
    item.metadata = { ...(item.metadata ?? {}), statusReason: operation.reason, statusUpdatedAt: now };
  }
  if (operation.subItemIds?.length) {
    const ids = new Set(operation.subItemIds);
    for (const sub of item.subItems ?? []) {
      if (ids.has(sub.id)) {
        sub.status = item.status;
        if (operation.type === 'done') sub.completed = now;
      }
    }
  } else if (operation.type === 'done') {
    for (const sub of item.subItems ?? []) {
      sub.status = 'completed';
      sub.completed = now;
    }
  }
  next.plan.sequence = currentSequence + 1;
  next.plan.updated = now;
  next.vBRIEFInfo.updated = now;
  if (operation.pipeline) setPipelineMirror(next, operation.pipeline);
  return { doc: next, item };
}

export interface PlanPipelineMirror {
  issueId: string;
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  updatedAt: string;
  [key: string]: unknown;
}

export function getPipelineMirror(doc: VBriefDocument): PlanPipelineMirror | undefined {
  return doc.plan.metadata?.pipeline as PlanPipelineMirror | undefined;
}

/** Write pipeline state into plan.metadata.pipeline for pan-oversee and dashboard readers. */
export function setPipelineMirror(doc: VBriefDocument, pipeline: PlanPipelineMirror): VBriefDocument {
  doc.plan.metadata = { ...(doc.plan.metadata ?? {}), pipeline };
  return doc;
}

export interface TaskGraphView {
  source: 'vbrief';
  next: VBriefItem[];
  waves: Wave[];
  criticalPath: string[];
}

/** vBRIEF-first task graph view. Beads are intentionally not consulted here. */
export function getTaskGraphView(doc: VBriefDocument, mergedItemIds: Set<string> = new Set()): TaskGraphView {
  return {
    source: 'vbrief',
    next: getDispatchableItems(doc, mergedItemIds),
    waves: groupItemsByWave(doc),
    criticalPath: criticalPath(doc),
  };
}

export function activeSlicePromptSize(slice: ActiveSlice): number {
  return Buffer.byteLength(slice.prompt, 'utf8');
}


export interface PersistedTaskOperation extends TaskOperation {
  /** Stable ID of the single writer that owns this worktree mutation. */
  writerId: string;
}

const activePlanWriters = new Map<string, string>();

function lockPathForPlan(planPath: string): string {
  return `${planPath}.writer.lock`;
}

function lockOwnerPath(planPath: string): string {
  return join(lockPathForPlan(planPath), 'owner.json');
}

function assertSingleWriter(planPath: string, writerId: string): void {
  const owner = activePlanWriters.get(planPath);
  if (owner && owner !== writerId) {
    throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${owner} already owns the worktree`);
  }
  const lockPath = lockPathForPlan(planPath);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    // PAN-977 review-round-17 blocker: same orphan-lock vulnerability as
    // assertSingleWriterAsync. If owner.json write throws non-EEXIST, the
    // mkdir'd lockPath must be cleaned up before re-throwing.
    try {
      writeFileSync(lockOwnerPath(planPath), JSON.stringify({ writerId, pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2), 'utf-8');
    } catch (writeErr) {
      try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
      throw writeErr;
    }
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
    let lockOwner = 'unknown writer';
    try {
      const ownerData = JSON.parse(readFileSync(lockOwnerPath(planPath), 'utf-8')) as { writerId?: string; pid?: number; acquiredAt?: string };
      lockOwner = `${ownerData.writerId ?? 'unknown writer'} pid=${ownerData.pid ?? 'unknown'} acquiredAt=${ownerData.acquiredAt ?? 'unknown'}`;
    } catch { /* ignore malformed owner file */ }
    throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${lockOwner} already owns the worktree`);
  }
  activePlanWriters.set(planPath, writerId);
}

// PAN-977 round-16 blocker #2: bounded retry/wait around the writer lock so
// concurrent same-cycle dispatch claims (parallel slot spawns mutating the
// same .pan/spec.vbrief.json) wait for the previous atomic write rather than
// failing the item outright. Total wait budget ≈ 1s — long enough to absorb
// many sub-millisecond same-process claims, short enough that a genuinely
// stuck lock surfaces quickly.
const WRITER_LOCK_RETRY_DELAYS_MS = [5, 10, 20, 40, 80, 160, 320, 360];

async function assertSingleWriterAsync(planPath: string, writerId: string): Promise<void> {
  const lockPath = lockPathForPlan(planPath);
  let lastOwnerDescription = 'unknown writer';
  for (let attempt = 0; attempt <= WRITER_LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    const owner = activePlanWriters.get(planPath);
    if (!owner || owner === writerId) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        // PAN-977 review-round-17 blocker: once mkdir succeeds we own the
        // lock directory. If the owner.json write throws a non-EEXIST error
        // (ENOSPC, EPERM, ENAMETOOLONG, …), we must remove the directory
        // before re-throwing — otherwise the orphan lock wedges every
        // subsequent assertSingleWriterAsync call (mkdir → EEXIST →
        // owner.json read → ENOENT → "unknown writer" → permanent
        // writer-conflict), and `activePlanWriters.set` never ran so
        // `releasePlanWriterAsync` won't free it either.
        try {
          await writeFile(
            lockOwnerPath(planPath),
            JSON.stringify({ writerId, pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2),
            'utf-8',
          );
        } catch (writeErr) {
          try { await rm(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
          throw writeErr;
        }
        activePlanWriters.set(planPath, writerId);
        return;
      } catch (err: any) {
        if (err?.code !== 'EEXIST') throw err;
        // On-disk lock exists but in-memory map says owner-or-empty — record
        // the on-disk owner for diagnostics, then fall through to retry.
        try {
          const ownerData = JSON.parse(await readFile(lockOwnerPath(planPath), 'utf-8')) as { writerId?: string; pid?: number; acquiredAt?: string };
          lastOwnerDescription = `${ownerData.writerId ?? 'unknown writer'} pid=${ownerData.pid ?? 'unknown'} acquiredAt=${ownerData.acquiredAt ?? 'unknown'}`;
        } catch { /* ignore malformed owner file */ }
      }
    } else {
      lastOwnerDescription = owner;
    }
    const delay = WRITER_LOCK_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
  }
  throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${lastOwnerDescription} already owns the worktree`);
}

export function releasePlanWriter(planPath: string, writerId: string): void {
  if (activePlanWriters.get(planPath) === writerId) activePlanWriters.delete(planPath);
  rmSync(lockPathForPlan(planPath), { recursive: true, force: true });
}

async function releasePlanWriterAsync(planPath: string, writerId: string): Promise<void> {
  if (activePlanWriters.get(planPath) === writerId) activePlanWriters.delete(planPath);
  await rm(lockPathForPlan(planPath), { recursive: true, force: true });
}

export function workspacePlanPath(workspacePath: string): string {
  return join(workspacePath, '.pan', 'spec.vbrief.json');
}

function validatePlanIssue(doc: VBriefDocument, issueId: string): void {
  const target = issueId.toUpperCase();
  const candidates = [doc.plan.id, ...(doc.plan.tags ?? [])].map(v => String(v).toUpperCase());
  if (!candidates.some(v => v.includes(target))) {
    throw new Error(`vBRIEF plan ${doc.plan.id} is not traceable to ${target}`);
  }
}

function readPlanFile(planPath: string): VBriefDocument {
  return JSON.parse(readFileSync(planPath, 'utf-8')) as VBriefDocument;
}

function writePlanFileAtomic(planPath: string, doc: VBriefDocument): void {
  mkdirSync(dirname(planPath), { recursive: true });
  const tmp = `${planPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, planPath);
}

async function writePlanFileAtomicAsync(planPath: string, doc: VBriefDocument): Promise<void> {
  await mkdir(dirname(planPath), { recursive: true });
  const tmp = `${planPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  await rename(tmp, planPath);
}

/** Persist a task operation to workspace .pan/spec.vbrief.json with CAS + single-writer guard. */
export function applyTaskOperationToPlanFile(planPath: string, operation: PersistedTaskOperation): TaskOperationResult {
  if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found: ${planPath}`);
  assertSingleWriter(planPath, operation.writerId);
  try {
    const current = readPlanFile(planPath);
    const result = applyTaskOperation(current, operation);
    writePlanFileAtomic(planPath, result.doc);
    return result;
  } finally {
    releasePlanWriter(planPath, operation.writerId);
  }
}

export async function applyTaskOperationToPlanFileAsync(planPath: string, operation: PersistedTaskOperation): Promise<TaskOperationResult> {
  if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found: ${planPath}`);
  await assertSingleWriterAsync(planPath, operation.writerId);
  try {
    const current = await readPlanFileAsync(planPath);
    const result = applyTaskOperation(current, operation);
    await writePlanFileAtomicAsync(planPath, result.doc);
    return result;
  } finally {
    await releasePlanWriterAsync(planPath, operation.writerId);
  }
}

export type TaskCommand = 'next' | 'show' | TaskOperationType;

export interface TaskCommandOptions {
  issueId: string;
  workspacePath: string;
  itemId?: string;
  writerId?: string;
  expectedSequence?: number;
  reason?: string;
  mergedItemIds?: Set<string>;
}

/** CLI/API-facing vBRIEF task operations for next/show/claim/done/block/unblock/cancel. */
export function runTaskCommand(command: TaskCommand, options: TaskCommandOptions): VBriefItem | VBriefItem[] | TaskOperationResult {
  if (!isTaskCommand(String(command))) {
    throw new Error(`Unsupported vBRIEF task command: ${String(command)}`);
  }
  const planPath = workspacePlanPath(options.workspacePath);
  if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found: ${planPath}`);
  const doc = readPlanFile(planPath);
  validatePlanIssue(doc, options.issueId);
  if (command === 'next') return getDispatchableItems(doc, options.mergedItemIds ?? new Set());
  if (command === 'show') {
    if (!options.itemId) throw new Error('show requires itemId');
    const item = doc.plan.items.find(i => i.id === options.itemId);
    if (!item) throw new Error(`Plan item not found: ${options.itemId}`);
    return item;
  }
  if (!options.itemId) throw new Error(`${command} requires itemId`);
  return applyTaskOperationToPlanFile(planPath, {
    type: command,
    itemId: options.itemId,
    expectedSequence: options.expectedSequence,
    reason: options.reason,
    writerId: options.writerId ?? `pan-task-${process.pid}`,
  });
}

export type PlanPipelinePhase = 'work' | 'review' | 'test' | 'uat' | 'merge' | 'done';

export interface PlanPipelineHistoryEntry {
  status?: string;
  at: string;
  agentId?: string;
  notes?: string;
}

export interface PlanPipelineStageMirror {
  status?: string;
  agentId?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  notes?: string;
  history: PlanPipelineHistoryEntry[];
}

export interface PlanPipelineReviewMirror extends PlanPipelineStageMirror {
  approval?: 'approved' | 'changes_requested' | 'pending';
}

export interface PlanPipelineMergeMirror extends PlanPipelineStageMirror {
  readyForMerge?: boolean;
  prUrl?: string;
  mergeCommit?: string;
  mergedAt?: string;
}

export interface NestedPlanPipelineMirror {
  phase: PlanPipelinePhase;
  issueId: string;
  sqliteAuthoritative: true;
  updatedAt: string;
  work: PlanPipelineStageMirror;
  verification: PlanPipelineStageMirror;
  review: PlanPipelineReviewMirror;
  test: PlanPipelineStageMirror;
  uat: PlanPipelineStageMirror;
  merge: PlanPipelineMergeMirror;
}

function stageFromStatus(status: Record<string, unknown>, key: string, now: string): PlanPipelineStageMirror {
  const stageStatus = status[`${key}Status`] as string | undefined;
  const notes = status[`${key}Notes`] as string | undefined;
  const agentId = (status[`${key}AgentId`] ?? status.agentId) as string | undefined;
  const startedAt = status[`${key}StartedAt`] as string | undefined;
  const completedAt = status[`${key}CompletedAt`] as string | undefined;
  return {
    status: stageStatus,
    agentId,
    startedAt,
    updatedAt: now,
    completedAt,
    notes,
    history: stageStatus ? [{ status: stageStatus, at: now, agentId, notes }] : [],
  };
}

function activePipelineStatus(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value !== 'pending';
}

function inferPipelinePhase(status: Record<string, unknown>): PlanPipelinePhase {
  if (status.mergeCommit || status.mergedAt || status.mergeStatus === 'merged') return 'done';
  if (activePipelineStatus(status.mergeStatus) || status.readyForMerge === true) return 'merge';
  if (activePipelineStatus(status.uatStatus)) return 'uat';
  if (activePipelineStatus(status.testStatus)) return 'test';
  if (activePipelineStatus(status.reviewStatus)) return 'review';
  return 'work';
}

function reviewApproval(reviewStatus: unknown): PlanPipelineReviewMirror['approval'] {
  if (reviewStatus === 'approved' || reviewStatus === 'APPROVED' || reviewStatus === 'passed') return 'approved';
  if (
    reviewStatus === 'changes_requested' ||
    reviewStatus === 'CHANGES_REQUESTED' ||
    reviewStatus === 'failed' ||
    reviewStatus === 'blocked'
  ) return 'changes_requested';
  return reviewStatus ? 'pending' : undefined;
}

export function buildPipelineMirrorFromStatus(issueId: string, status: Record<string, unknown>, now = new Date().toISOString()): NestedPlanPipelineMirror {
  const review = stageFromStatus(status, 'review', now) as PlanPipelineReviewMirror;
  review.approval = reviewApproval(status.reviewStatus);
  return {
    phase: inferPipelinePhase(status),
    issueId: issueId.toUpperCase(),
    sqliteAuthoritative: true,
    updatedAt: now,
    work: stageFromStatus(status, 'work', now),
    verification: stageFromStatus(status, 'verification', now),
    review,
    test: stageFromStatus(status, 'test', now),
    uat: stageFromStatus(status, 'uat', now),
    merge: {
      ...stageFromStatus(status, 'merge', now),
      readyForMerge: status.readyForMerge as boolean | undefined,
      prUrl: status.prUrl as string | undefined,
      mergeCommit: status.mergeCommit as string | undefined,
      mergedAt: status.mergedAt as string | undefined,
    },
  };
}

export function writePipelineMirrorToPlanFile(planPath: string, mirror: NestedPlanPipelineMirror, writerId = `pipeline-${process.pid}`): VBriefDocument | null {
  if (!existsSync(planPath)) return null;
  assertSingleWriter(planPath, writerId);
  try {
    const doc = readPlanFile(planPath);
    setPipelineMirror(doc, mirror as unknown as PlanPipelineMirror);
    const now = new Date().toISOString();
    doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
    doc.plan.updated = now;
    doc.vBRIEFInfo.updated = now;
    writePlanFileAtomic(planPath, doc);
    return doc;
  } finally {
    releasePlanWriter(planPath, writerId);
  }
}


async function readPlanFileAsync(planPath: string): Promise<VBriefDocument> {
  return JSON.parse(await readFile(planPath, 'utf-8')) as VBriefDocument;
}

export async function writePipelineMirrorToPlanFileAsync(planPath: string, mirror: NestedPlanPipelineMirror, writerId = `pipeline-${process.pid}`): Promise<VBriefDocument | null> {
  if (!existsSync(planPath)) return null;
  await assertSingleWriterAsync(planPath, writerId);
  try {
    const doc = await readPlanFileAsync(planPath);
    setPipelineMirror(doc, mirror as unknown as PlanPipelineMirror);
    const now = new Date().toISOString();
    doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
    doc.plan.updated = now;
    doc.vBRIEFInfo.updated = now;
    await writePlanFileAtomicAsync(planPath, doc);
    return doc;
  } finally {
    await releasePlanWriterAsync(planPath, writerId);
  }
}

export interface PromptSizeVerification {
  fullPlanBytes: number;
  activeSliceBytes: number;
  reductionRatio: number;
}

export function verifyActiveSlicePromptReduction(doc: VBriefDocument, slice: ActiveSlice): PromptSizeVerification {
  const fullPlanBytes = Buffer.byteLength(JSON.stringify(doc, null, 2), 'utf8');
  const activeSliceBytes = activeSlicePromptSize(slice);
  return {
    fullPlanBytes,
    activeSliceBytes,
    reductionRatio: fullPlanBytes === 0 ? 0 : activeSliceBytes / fullPlanBytes,
  };
}
