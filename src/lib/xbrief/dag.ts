/**
 * xBRIEF DAG utilities — critical path, graph analysis, wave scheduling, per-item dispatch
 */
import { existsSync } from 'fs';
import { subItemsOf, type XBriefDocument, type XBriefItem, type XBriefItemStatus, type XBriefSubItem } from './types.js';

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
 * Groups actionable xBRIEF items into dependency waves using Kahn's algorithm.
 *
 * Wave 0 = items with no unresolved blockers (ready to start).
 * Wave N = items whose blockers all resolve in waves < N.
 * Completed/cancelled items are excluded from waves but their edges are honored
 * (a completed blocker does not hold back its dependents).
 *
 * Returns waves in ascending order. Items within a wave are independent and
 * can execute in parallel.
 */
export function groupItemsByWave(doc: XBriefDocument): Wave[] {
  const skipStatuses = new Set<XBriefItemStatus>(['completed', 'cancelled', 'blocked', 'running']);
  const actionable = doc.plan.items.filter(i => !skipStatuses.has(i.status));
  if (actionable.length === 0) return [];

  const actionableIds = new Set(actionable.map(i => i.id));
  const allItemIds = new Set(doc.plan.items.map(i => i.id));
  const resolvedIds = new Set(
    doc.plan.items.filter(i => i.status === 'completed' || i.status === 'cancelled').map(i => i.id),
  );

  const edges = doc.plan.edges ?? [];
  const blockEdges = edges.filter(
    e => e.type === 'blocks' && allItemIds.has(e.from) && allItemIds.has(e.to),
  );

  // Build in-degree for actionable items only.
  // Edges from resolved items don't contribute — those blockers are resolved.
  // Edges from running/blocked items DO contribute — those blockers are unresolved.
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
    if (resolvedIds.has(edge.from)) continue;

    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    incomingFrom.get(edge.to)?.push(edge.from);

    // Only track outgoing edges from actionable items (they're the ones that advance through waves)
    if (actionableIds.has(edge.from)) {
      outgoing.get(edge.from)?.push(edge.to);
    }
  }

  const itemById = new Map<string, XBriefItem>(doc.plan.items.map(i => [i.id, i]));
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
 * Computes the critical path of an xBRIEF plan using the longest-path
 * algorithm on 'blocks' edges.
 *
 * All edges have weight 1 (one step). Returns an ordered list of item IDs
 * representing the longest dependency chain in the DAG.
 *
 * Returns [] for empty plans or plans with no blocking edges.
 */
export function criticalPath(doc: XBriefDocument): string[] {
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
  doc: XBriefDocument,
  mergedItemIds: Set<string>,
): XBriefItem[] {
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
      const blocker = itemById.get(blockerId);
      // Branch ancestry cannot resolve a running task. Polyrepo wrapper
      // branches may appear merged while member-repository work is still live.
      if (mergedItemIds.has(blockerId) && blocker?.status === 'completed') return true;
      return blocker?.status === 'completed' || blocker?.status === 'cancelled';
    });
  });
}

/**
 * Returns the count of blocking parents for an item (items with 'blocks → itemId' edges
 * that are neither completed nor cancelled in the plan).
 * Count > 1 means the item is a DAG convergence point requiring a synthesis agent.
 */
export function blockingParentCount(doc: XBriefDocument, itemId: string): number {
  const completedStatuses = new Set(['completed', 'cancelled']);
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges.filter(e => {
    if (e.type !== 'blocks' || e.to !== itemId) return false;
    const parent = itemById.get(e.from);
    return parent && !completedStatuses.has(parent.status);
  }).length;
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
export interface CompiledGlob {
  pattern: string;
  regex: RegExp;
  exactDirectory?: string;
}

export function compileGlob(pattern: string): CompiledGlob {
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


/**
 * Returns true if the candidate item's `files_scope` overlaps with any running
 * item's `files_scope`. Items without a `files_scope` are considered non-overlapping.
 *
 * Overlap is bidirectional: a file in the candidate matched by a running item's
 * patterns, or a file in a running item matched by the candidate's patterns.
 */
export function hasFileOverlap(
  runningItems: XBriefItem[],
  candidate: XBriefItem,
  precompiled?: Map<string, CompiledGlob[]>,
): boolean {
  const candidateScope = candidate.metadata?.files_scope;
  if (!candidateScope || candidateScope.length === 0) return false;

  const compiledCandidateScope = precompiled?.get(candidate.id) ?? candidateScope.map(compileGlob);

  for (const running of runningItems) {
    const runningScope = running.metadata?.files_scope;
    if (!runningScope || runningScope.length === 0) continue;
    const compiledRunningScope = precompiled?.get(running.id) ?? runningScope.map(compileGlob);

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
  item: XBriefItem;
  currentWorkSet: XBriefItem[];
  /** Direct blocking parent items, regardless of status. */
  blockers: XBriefItem[];
  /** Resolved direct blocking parents that should inform this item. */
  dependencies: XBriefItem[];
  /** Direct child items this work unlocks after completion. */
  unlocks: XBriefItem[];
  /** Nearby items connected by non-blocking context edges or shared phase. */
  nearbyContext: XBriefItem[];
  /** Direct child acceptance criteria/items for prompt-size boundedness. */
  acceptanceCriteria: XBriefSubItem[];
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

function directBlockingParents(doc: XBriefDocument, itemId: string): XBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges
    .filter(e => e.type === 'blocks' && e.to === itemId)
    .map(e => itemById.get(e.from))
    .filter((item): item is XBriefItem => Boolean(item));
}

function directUnlocks(doc: XBriefDocument, itemId: string): XBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges
    .filter(e => e.type === 'blocks' && e.from === itemId)
    .map(e => itemById.get(e.to))
    .filter((item): item is XBriefItem => Boolean(item));
}

function nearbyItems(doc: XBriefDocument, item: XBriefItem, excludedIds: Set<string>): XBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  const nearby = new Map<string, XBriefItem>();
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

function renderItemLine(item: XBriefItem): string {
  const phase = item.metadata?.phase !== undefined ? ` phase=${item.metadata.phase}` : '';
  const difficulty = item.metadata?.difficulty ? ` difficulty=${item.metadata.difficulty}` : '';
  return `- ${item.id}: ${item.title} [${item.status}]${phase}${difficulty}`;
}

/**
 * Build the bounded active slice that work-agent prompts should receive by
 * default instead of the full xBRIEF. The slice includes the target/current work
 * set, direct blockers, unlocks, nearby context, global constraints, acceptance
 * criteria, and optional persisted synthesis output for convergence points.
 */
export function createActiveSlice(doc: XBriefDocument, options: ActiveSliceOptions): ActiveSlice {
  const item = doc.plan.items.find(i => i.id === options.itemId);
  if (!item) throw new Error(`Plan item not found: ${options.itemId}`);
  const currentIds = Array.from(new Set([...(options.currentItemIds ?? []), item.id]));
  const currentWorkSet = currentIds
    .map(id => doc.plan.items.find(i => i.id === id))
    .filter((candidate): candidate is XBriefItem => Boolean(candidate));
  const blockers = directBlockingParents(doc, item.id);
  const resolvedStatuses = new Set(['completed', 'cancelled']);
  const dependencies = blockers.filter(parent => resolvedStatuses.has(parent.status));
  const unlocks = directUnlocks(doc, item.id);
  const excludedIds = new Set([item.id, ...currentWorkSet.map(i => i.id), ...blockers.map(i => i.id), ...unlocks.map(i => i.id)]);
  const nearbyContext = nearbyItems(doc, item, excludedIds);
  const acceptanceCriteria = subItemsOf(item);
  const synthesisContext = options.synthesisOutputs?.[item.id]?.contextUpdate;
  const globalConstraints = [doc.plan.narratives?.Constraint, doc.plan.narratives?.Risk]
    .filter((value): value is string => Boolean(value));
  const objective = doc.plan.narratives?.Problem ?? doc.plan.narratives?.Proposal ?? doc.xBRIEFInfo.description;
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
    `# Active xBRIEF Slice: ${slice.issueId}`,
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

export type TaskOperationType = 'claim' | 'done' | 'block' | 'unblock' | 'cancel' | 'reopen';

export interface TaskOperation {
  type: TaskOperationType;
  itemId: string;
  expectedSequence?: number;
  reason?: string;
  subItemIds?: string[];
}

export interface TaskOperationResult {
  doc: XBriefDocument;
  item: XBriefItem;
}

export interface TaskGraphView {
  source: 'vbrief';
  next: XBriefItem[];
  waves: Wave[];
  criticalPath: string[];
}

const NON_ACTIONABLE_STATUSES = new Set(['completed', 'cancelled', 'running', 'blocked']);

/** Build a document containing only actionable (non-terminal) items and their block edges. */
export function actionableDoc(doc: XBriefDocument): XBriefDocument {
  const actionableItems = doc.plan.items.filter(i => !NON_ACTIONABLE_STATUSES.has(i.status));
  const actionableIds = new Set(actionableItems.map(i => i.id));
  const actionableEdges = (doc.plan.edges ?? []).filter(
    e => e.type === 'blocks' && actionableIds.has(e.from) && actionableIds.has(e.to),
  );
  return {
    ...doc,
    plan: {
      ...doc.plan,
      items: actionableItems,
      edges: actionableEdges,
    },
  };
}

/** Canonical xBRIEF task graph view; no secondary task store is consulted here. */
export function getTaskGraphView(doc: XBriefDocument, mergedItemIds: Set<string> = new Set()): TaskGraphView {
  const filtered = actionableDoc(doc);
  return {
    source: 'vbrief',
    next: getDispatchableItems(doc, mergedItemIds),
    waves: groupItemsByWave(doc),
    criticalPath: criticalPath(filtered),
  };
}


export interface PersistedTaskOperation extends TaskOperation {
  /** Stable ID of the single writer that owns this worktree mutation. */
  writerId: string;
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

export interface PromptSizeVerification {
  fullPlanBytes: number;
  activeSliceBytes: number;
  reductionRatio: number;
}
