/**
 * The batch window (PAN-4753 D4).
 *
 * With the merge train on, normal-priority ready features wait for a batch.
 * A batch assembles when it holds `merge_train.batch_size` features, or when
 * its oldest feature has been ready for `merge_train.batch_wait_minutes`. A
 * lone feature at the timeout makes a one-member batch, so nothing waits
 * forever.
 *
 * A live batch freezes its members: while a generation whose members are all
 * still batch-owned exists, the window answers with exactly those members, so
 * the reconciler re-assembles them only when its base moves and never rebuilds
 * a batch under CI because a new feature became ready. New arrivals wait for
 * the next batch.
 *
 * Pure: the caller supplies the clock and the ready-since times.
 */
import type { ReadyFeature } from './uat-generation-engine.js';
import type { UatGeneration } from '../overdeck/merge-sync.js';
import type { GhPrRow } from '../overdeck/pr-listing.js';

export const DEFAULT_BATCH_SIZE = 3;
export const DEFAULT_BATCH_WAIT_MINUTES = 30;

export type BatchChoice = { features: ReadyFeature[] } | { wait: string };

export interface ChooseBatchInput {
  /** Batch-owned ready features, in merge order. */
  features: readonly ReadyFeature[];
  /** Upper-cased issue id → the time (ms) the feature became ready. */
  readySince: ReadonlyMap<string, number>;
  /** Live generations (`ready` | `superseded`), newest first. */
  live: readonly UatGeneration[];
  size: number;
  waitMs: number;
  now: number;
}

export function chooseBatch(input: ChooseBatchInput): BatchChoice {
  const byId = new Map(input.features.map((f) => [f.issueId.toUpperCase(), f]));

  for (const gen of input.live) {
    const memberIds = gen.members.map((m) => m.issueId.toUpperCase());
    if (memberIds.length > 0 && memberIds.every((id) => byId.has(id))) {
      const frozen = new Set(memberIds);
      return { features: input.features.filter((f) => frozen.has(f.issueId.toUpperCase())) };
    }
  }

  const size = Math.max(1, Math.floor(input.size));
  if (input.features.length >= size) return { features: input.features.slice(0, size) };

  const times = input.features
    .map((f) => input.readySince.get(f.issueId.toUpperCase()))
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const oldest = times.length > 0 ? Math.min(...times) : input.now;
  const waited = Math.max(0, input.now - oldest);
  if (input.features.length > 0 && waited >= input.waitMs) return { features: [...input.features] };

  return {
    wait: `${input.features.length} of ${size} ready; oldest waited ${Math.floor(waited / 60_000)} of ${Math.round(input.waitMs / 60_000)} min`,
  };
}

/**
 * When a PR became ready, derived from the forge: the newest `completedAt`
 * among its head's `statusCheckRollup` rows. A new push resets it (the new
 * head's checks complete later). Null when no row reports a completion time.
 */
export function readySinceFromRollup(row: Pick<GhPrRow, 'statusCheckRollup'>): number | null {
  let newest: number | null = null;
  for (const check of row.statusCheckRollup ?? []) {
    const at = Date.parse(check.completedAt ?? '');
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}
