import type { VBriefDifficulty, VBriefItem } from '../vbrief/types.js';
import { hasFileOverlap } from '../vbrief/dag.js';

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
