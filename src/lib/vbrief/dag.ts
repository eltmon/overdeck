/**
 * vBRIEF DAG utilities — critical path, graph analysis, wave scheduling, per-item dispatch
 */

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
  const skipStatuses = new Set(['completed', 'cancelled']);
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
  while (q.length > 0) {
    const u = q.shift()!;
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
  const completedStatuses = new Set(['completed', 'cancelled', 'running']);
  const actionable = doc.plan.items.filter(i => !completedStatuses.has(i.status));
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


/** Active-slice prompt contract for a single work item. */
export interface ActiveSlice {
  issueId: string;
  planId: string;
  planSequence: number;
  item: VBriefItem;
  /** Blocking parent items that have already completed/merged and should inform this item. */
  dependencies: VBriefItem[];
  /** Direct child acceptance criteria/subItems for the item, copied for prompt-size boundedness. */
  acceptanceCriteria: NonNullable<VBriefItem['subItems']>;
  /** Synthesis context for DAG convergence points, when available. */
  synthesisContext?: string;
  /** Minimal markdown prompt payload for work agents. */
  prompt: string;
}

export interface ActiveSliceOptions {
  issueId: string;
  itemId: string;
  synthesisOutputs?: Record<string, { contextUpdate: string }>;
}

function directBlockingParents(doc: VBriefDocument, itemId: string): VBriefItem[] {
  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));
  return doc.plan.edges
    .filter(e => e.type === 'blocks' && e.to === itemId)
    .map(e => itemById.get(e.from))
    .filter((item): item is VBriefItem => Boolean(item));
}

/**
 * Build the bounded "active slice" that work-agent prompts should receive by
 * default instead of the full vBRIEF. The slice contains only the target item,
 * its direct resolved dependencies, its acceptance criteria, and optional
 * synthesis output for convergence points.
 */
export function createActiveSlice(doc: VBriefDocument, options: ActiveSliceOptions): ActiveSlice {
  const item = doc.plan.items.find(i => i.id === options.itemId);
  if (!item) throw new Error(`Plan item not found: ${options.itemId}`);
  const dependencies = directBlockingParents(doc, item.id);
  const acceptanceCriteria = item.subItems ?? [];
  const synthesisContext = options.synthesisOutputs?.[item.id]?.contextUpdate;
  const prompt = renderActiveSlicePrompt({
    issueId: options.issueId,
    planId: doc.plan.id,
    planSequence: doc.plan.sequence ?? 0,
    item,
    dependencies,
    acceptanceCriteria,
    synthesisContext,
  });
  return {
    issueId: options.issueId,
    planId: doc.plan.id,
    planSequence: doc.plan.sequence ?? 0,
    item,
    dependencies,
    acceptanceCriteria,
    synthesisContext,
    prompt,
  };
}

export function renderActiveSlicePrompt(slice: Omit<ActiveSlice, 'prompt'>): string {
  const lines = [
    `# Active vBRIEF Slice: ${slice.issueId}`,
    `Plan: ${slice.planId} @ sequence ${slice.planSequence}`,
    ``,
    `## Target Item`,
    `- ${slice.item.id}: ${slice.item.title} [${slice.item.status}]`,
  ];
  if (slice.item.narrative?.Action) lines.push(`- Action: ${slice.item.narrative.Action}`);
  if (slice.dependencies.length > 0) {
    lines.push(``, `## Resolved Dependencies`);
    for (const dep of slice.dependencies) lines.push(`- ${dep.id}: ${dep.title} [${dep.status}]`);
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

function statusForOperation(type: TaskOperationType): VBriefItemStatus {
  switch (type) {
    case 'claim': return 'running';
    case 'done': return 'completed';
    case 'block': return 'blocked';
    case 'unblock': return 'pending';
    case 'cancel': return 'cancelled';
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
