import type { ModelRef, WeightedModelRef } from './schema.js';

/** 32-bit FNV-1a hash — deterministic, no Math.random / Date.now. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * MurmurHash3 32-bit finalizer — an avalanche/bit-mixing step applied to the FNV
 * output before bucketing, so near-identical spawn keys land in different buckets.
 * Belt-and-suspenders for the modulo bucketing in `derivePercentPick` (PAN-2055).
 * Deterministic; pure bit ops.
 */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One entry of a percent pick, with the half-open bucket band [lo, hi) it owns. */
export interface PercentBand {
  /** The entry's model ref (NOT dereffed — may be a `workhorse:*` ref). */
  model: ModelRef;
  /** This entry's weight. A percentage when the weights total 100. */
  weight: number;
  /** Bucket-band start (integer, inclusive). */
  lo: number;
  /** Bucket-band end (integer, exclusive). A key whose bucket is in [lo, hi) picks this. */
  hi: number;
  /** True for the single entry the spawn key selected. */
  chosen: boolean;
}

/** The full, inspectable result of a percent pick — what selected the model and why. */
export interface PercentPick {
  /** The selected model ref (same value `pickPercentModelRef` returns). */
  chosen: ModelRef;
  /** Deterministic bucket for this key: `fmix32(fnv1a32(key)) % total`, in [0, total). */
  bucket: number;
  /** Sum of positive weights = number of buckets (100 when weights are percentages). */
  total: number;
  /** Every entry, in declaration order, with its bucket band and the chosen flag. */
  bands: PercentBand[];
}

/**
 * Deterministically pick a model from a percentage distribution, returning the full
 * derivation (bucket, per-entry bands, winner) so it can be shown read-only in the UI.
 *
 * Mental model: hash the spawn key to a stable bucket `0 .. total-1`, then walk the
 * cumulative weights and take the entry whose band contains the bucket. The same key
 * and weights always give the same model; change a weight and future picks change.
 * `pickPercentModelRef` delegates here so selection and explanation can't drift.
 * Throws if no entry has weight > 0.
 */
export function derivePercentPick(entries: WeightedModelRef[], spawnKey: string): PercentPick {
  let total = 0;
  for (const e of entries) {
    if (e.weight > 0) total += e.weight;
  }
  if (total <= 0) {
    throw new Error('derivePercentPick: all entries have weight <= 0');
  }
  // Deterministic bucket 0..total-1. fmix32 avalanches FNV's output so common-prefix
  // issue keys (work:PAN-1901, work:PAN-1919, …) don't all land in one band (PAN-2055).
  const bucket = fmix32(fnv1a32(spawnKey)) % total;
  const bands: PercentBand[] = [];
  let cursor = 0;
  let chosenIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.weight <= 0) {
      // Zero-weight entries occupy an empty band; they can never be selected.
      bands.push({ model: e.model, weight: e.weight, lo: cursor, hi: cursor, chosen: false });
      continue;
    }
    const lo = cursor;
    cursor += e.weight;
    const hi = cursor;
    const isChosen = chosenIdx === -1 && bucket < hi;
    if (isChosen) chosenIdx = i;
    bands.push({ model: e.model, weight: e.weight, lo, hi, chosen: isChosen });
  }
  if (chosenIdx === -1) {
    // bucket < total always holds, so a positive-weight entry is always chosen — this
    // is a defensive fallback only.
    chosenIdx = entries.length - 1;
    bands[chosenIdx].chosen = true;
  }
  return { chosen: entries[chosenIdx].model, bucket, total, bands };
}

/**
 * Pick a model from a percentage distribution using a deterministic spawn key.
 * Same key + same weights → same model. Throws if no entry has weight > 0.
 *
 * Thin wrapper over `derivePercentPick` so selection and its explanation can't drift.
 */
export function pickPercentModelRef(entries: WeightedModelRef[], spawnKey: string): ModelRef {
  return derivePercentPick(entries, spawnKey).chosen;
}

/** Return the model with the highest weight; first entry wins on a tie. */
export function representativeModelRef(entries: WeightedModelRef[]): ModelRef {
  let best = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].weight > best.weight) best = entries[i];
  }
  return best.model;
}
