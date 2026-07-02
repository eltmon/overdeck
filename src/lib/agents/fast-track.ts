import type { VBriefDifficulty, VBriefItem } from '../vbrief/types.js';
import { hasFileOverlap } from '../vbrief/dag.js';
import { verifyAndMergeSlot, type SlotMergeIssue, type SlotMergeOptions, type SlotMergeResult } from './slot-merge.js';

/**
 * Trivial fast-track batching (PAN-1791, folding in PAN-1311). The "skip
 * slot dispatch" half already exists (chooseDispatchTier -> 'in-context');
 * this groups consecutive same-wave mechanical beads into one shared batch
 * so N trivial items become one dispatch instead of N.
 *
 * Eligibility per item: difficulty in {trivial, simple}, a declared
 * files_scope with high confidence, and a scope no wider than
 * maxScopeFiles. A bead has no line count before it is implemented, so the
 * declared scope size is the observable stand-in for the LOC threshold —
 * callers with a better signal can tighten or widen it via options.
 *
 * Batches are internally conflict-free: an eligible item whose files_scope
 * overlaps an item already in the candidate batch closes that batch and
 * starts the next one. Only batches of two or more items are emitted — a
 * singleton has no batching benefit and stays on the normal in-context path.
 */

const FAST_TRACK_DIFFICULTIES = new Set<VBriefDifficulty>(['trivial', 'simple']);

export const DEFAULT_FAST_TRACK_MAX_SCOPE_FILES = 3;

export interface FastTrackOptions {
  /** Widest files_scope (entry count) an item may declare and still batch. */
  maxScopeFiles?: number;
}

export interface FastTrackBatch {
  /** Shared key identifying the single dispatch this batch becomes. */
  fastTrackBatchKey: string;
  items: VBriefItem[];
}

export interface FastTrackGrouping {
  batches: FastTrackBatch[];
  /** Items not batched (ineligible or singleton runs), in input order. */
  rest: VBriefItem[];
}

function isFastTrackEligible(item: VBriefItem, maxScopeFiles: number): boolean {
  const metadata = item.metadata;
  const difficulty = metadata?.difficulty;
  if (!difficulty || !FAST_TRACK_DIFFICULTIES.has(difficulty)) return false;
  const scope = metadata?.files_scope;
  if (!scope || scope.length === 0 || scope.length > maxScopeFiles) return false;
  return metadata?.files_scope_confidence === 'high';
}

function batchKey(items: VBriefItem[]): string {
  return `fast-track:${items[0].id}`;
}

/**
 * Group an ordered same-wave item list into fast-track batches. The caller
 * passes one wave's items (waves come from groupItemsByWave); consecutive
 * runs of eligible, scope-disjoint items share one fastTrackBatchKey.
 */
/**
 * Fail-open escalation (PAN-1311). A fast-track item detected mid-flight to
 * be non-trivial — its verify command failed in a way indicating real
 * complexity, or its diff exceeded the LOC threshold — must leave the batch
 * and take the standard path: re-dispatched through the normal tier
 * resolution for its difficulty, full review, and never auto-merged. This
 * module only emits the signal; the foreman acts on it (no spawning here).
 */
export type FastTrackEscalationReason = 'verify-failed' | 'diff-exceeds-threshold';

export interface FastTrackEscalation {
  itemId: string;
  /** Batch the item left. */
  fromBatchKey: string;
  reason: FastTrackEscalationReason;
  detail?: string;
  /** Escalated items always route through full review. */
  requiresFullReview: true;
  /** The fast-track auto-merge path must refuse escalated items. */
  autoMergeEligible: false;
}

/**
 * Remove an item from its fast-track batch and emit the escalation signal.
 * The remaining batch keeps its key; a remainder of one item is the caller's
 * to fold back into the normal in-context path. Throws if the item is not in
 * the batch — escalating an item that was never fast-tracked is a foreman
 * bookkeeping bug, not a recoverable state.
 */
export function escalateFastTrackItem(
  batch: FastTrackBatch,
  itemId: string,
  reason: FastTrackEscalationReason,
  detail?: string,
): { escalation: FastTrackEscalation; remaining: FastTrackBatch } {
  const item = batch.items.find(i => i.id === itemId);
  if (!item) {
    throw new Error(`Cannot escalate '${itemId}': not in fast-track batch '${batch.fastTrackBatchKey}'`);
  }
  return {
    escalation: {
      itemId,
      fromBatchKey: batch.fastTrackBatchKey,
      reason,
      detail,
      requiresFullReview: true,
      autoMergeEligible: false,
    },
    remaining: {
      fastTrackBatchKey: batch.fastTrackBatchKey,
      items: batch.items.filter(i => i.id !== itemId),
    },
  };
}

/** Refusal surface for the fast-track auto-merge path: escalated items never auto-merge. */
export function isFastTrackAutoMergeAllowed(itemId: string, escalations: FastTrackEscalation[]): boolean {
  return !escalations.some(e => e.itemId === itemId);
}

export function groupFastTrack(items: VBriefItem[], options: FastTrackOptions = {}): FastTrackGrouping {
  const maxScopeFiles = options.maxScopeFiles ?? DEFAULT_FAST_TRACK_MAX_SCOPE_FILES;
  const batches: FastTrackBatch[] = [];
  const rest: VBriefItem[] = [];
  let current: VBriefItem[] = [];

  const flush = () => {
    if (current.length >= 2) {
      batches.push({ fastTrackBatchKey: batchKey(current), items: current });
    } else {
      rest.push(...current);
    }
    current = [];
  };

  for (const item of items) {
    if (!isFastTrackEligible(item, maxScopeFiles)) {
      flush();
      rest.push(item);
      continue;
    }
    if (current.length > 0 && hasFileOverlap(current, item)) {
      flush();
    }
    current.push(item);
  }
  flush();

  return { batches, rest };
}

/**
 * Trivial-tier typecheck-gated auto-merge (PAN-1311, hazard H1). ONLY when
 * tiered execution is enabled AND the batch is entirely trivial/simple AND
 * nothing in it was escalated does the batch skip the review convoy: the
 * typecheck+lint gate runs in the slot workspace and, on success, the slot
 * branch merges to the feature branch via the verifyAndMergeSlot machinery.
 *
 * TRUST BOUNDARY — every refusal below is enforced here, not assumed of the
 * caller: with tiering disabled this path refuses everything (items route
 * through the normal review-then-merge flow); a medium-or-harder bead
 * anywhere in the batch refuses the whole batch; an escalated item refuses
 * the batch (isFastTrackAutoMergeAllowed); and a failed gate does NOT merge
 * — the SlotMergeResult surfaces back to the foreman with the evidence.
 */
export const FAST_TRACK_GATE_COMMANDS = ['npm run typecheck', 'npm run lint'];

export interface FastTrackAutoMergeResult {
  /** True when the trust boundary refused the batch before any gate ran. */
  refused: boolean;
  refusalReason?: string;
  /** Gate + merge outcome; present only when not refused. */
  result?: SlotMergeResult;
}

export async function autoMergeFastTrackBatch(
  issue: string | SlotMergeIssue,
  slotIndex: number,
  batch: FastTrackBatch,
  opts: {
    /** Resolved tiered-execution flag (global + per-issue override). Off by default. */
    enabled: boolean;
    escalations?: FastTrackEscalation[];
    mergeOptions?: SlotMergeOptions;
  },
): Promise<FastTrackAutoMergeResult> {
  if (!opts.enabled) {
    return { refused: true, refusalReason: 'tiered_execution is disabled; batch routes through the normal review-then-merge flow' };
  }

  const nonTrivial = batch.items.find(i => !i.metadata?.difficulty || !FAST_TRACK_DIFFICULTIES.has(i.metadata.difficulty));
  if (nonTrivial) {
    return {
      refused: true,
      refusalReason: `batch '${batch.fastTrackBatchKey}' contains non-trivial item '${nonTrivial.id}' (difficulty: ${nonTrivial.metadata?.difficulty ?? 'unset'}); auto-merge only applies to trivial/simple batches`,
    };
  }

  const escalated = batch.items.find(i => !isFastTrackAutoMergeAllowed(i.id, opts.escalations ?? []));
  if (escalated) {
    return {
      refused: true,
      refusalReason: `batch '${batch.fastTrackBatchKey}' contains escalated item '${escalated.id}'; escalated work requires full review`,
    };
  }

  // One batch = one dispatch = one slot: reuse verifyAndMergeSlot with a
  // synthetic batch-level item carrying the typecheck+lint gate.
  const gateItem: VBriefItem = {
    id: batch.fastTrackBatchKey,
    title: `fast-track batch ${batch.fastTrackBatchKey} (${batch.items.map(i => i.id).join(', ')})`,
    status: 'running',
    metadata: {
      verify_commands: FAST_TRACK_GATE_COMMANDS,
      expected_outputs: ['typecheck and lint complete without errors'],
    },
  };

  const result = await verifyAndMergeSlot(issue, slotIndex, gateItem, opts.mergeOptions ?? {});
  return { refused: false, result };
}
