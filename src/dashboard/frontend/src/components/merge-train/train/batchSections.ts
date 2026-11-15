/**
 * How the merge-train card groups a project's batch chain (PAN-5364). Pure: no
 * React, so every rule is unit-tested without rendering.
 *
 * Precedence (FR-10): (1) the live hero, else the merged outcome; (2) take it out
 * of the older list; (3) fold the rebuilds that outcome's merge voided; (4) hide
 * voided batches whose features all merged later; (5) collapse identical voided
 * runs; (6) the card then caps the older list at three rows. Superseded and
 * failed batches are never folded, hidden or collapsed.
 */
import type { UatGenerationPayload } from './boardTypes';

export type OlderRow =
  | { kind: 'single'; gen: UatGenerationPayload }
  /** `gens` in chain order (newest first). */
  | { kind: 'run'; gens: UatGenerationPayload[] };

export interface BatchSections {
  /** The live hero (`pickHeroBatch`). */
  hero: UatGenerationPayload | null;
  /** The merged outcome shown in the hero slot (FR-4); null whenever `hero` is set. */
  outcome: UatGenerationPayload | null;
  /** Voided batches whose `voidedBy` is the outcome, chain order. */
  folded: UatGenerationPayload[];
  /** Visible older rows, run-collapsed, before the three-row cap. */
  rows: OlderRow[];
  /** Voided batches whose features all merged later, run-collapsed. */
  covered: OlderRow[];
}

export const OLDER_ROWS_VISIBLE = 3;

/** The hero batch: newest assembling/ready, else newest superseded. Batches arrive newest first. */
export function pickHeroBatch(batches: readonly UatGenerationPayload[]): UatGenerationPayload | null {
  return batches.find((b) => b.status === 'assembling' || b.status === 'ready')
    ?? batches.find((b) => b.status === 'superseded')
    ?? null;
}

function memberIds(gen: UatGenerationPayload): string[] {
  return gen.members.map((m) => m.issueId.toUpperCase());
}

/** Sorted upper-cased issue ids joined with `,`; empty when there are no members. */
function memberKey(gen: UatGenerationPayload): string {
  return memberIds(gen).sort().join(',');
}

/** True when `gen` has members and every one of them is a member of `of`. */
function membersWithin(gen: UatGenerationPayload, of: UatGenerationPayload): boolean {
  if (gen.members.length === 0) return false;
  const ids = new Set(memberIds(of));
  return memberIds(gen).every((id) => ids.has(id));
}

/** Merge time of a promoted batch: latest repo promote stamp, else updatedAt. Null when not promoted. */
export function batchMergedAt(gen: UatGenerationPayload): string | null {
  if (gen.status !== 'promoted') return null;
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const repo of gen.repos ?? []) {
    if (!repo.promotedAt) continue;
    const ms = Date.parse(repo.promotedAt);
    if (Number.isNaN(ms) || ms <= latestMs) continue;
    latest = repo.promotedAt;
    latestMs = ms;
  }
  return latest ?? gen.updatedAt;
}

function mergedAtMs(gen: UatGenerationPayload): number {
  const at = batchMergedAt(gen);
  const ms = at === null ? Number.NaN : Date.parse(at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** A voided batch every feature of which merged in a promoted batch at or after its creation. */
export function isCoveredByMerge(gen: UatGenerationPayload, batches: readonly UatGenerationPayload[]): boolean {
  if (gen.status !== 'invalidated' || gen.members.length === 0) return false;
  const created = Date.parse(gen.createdAt);
  return batches.some((p) => p !== gen
    && p.status === 'promoted'
    && membersWithin(gen, p)
    && mergedAtMs(p) >= created);
}

/**
 * The merged batch to show in the hero slot (FR-4): only when there is no live
 * hero, and nothing was created after its merge except voided rebuilds of its
 * own members. Uses `createdAt`, never `updatedAt`, because stack start/stop
 * and stale-record heals move `updatedAt` on unrelated batches.
 */
export function pickOutcomeBatch(batches: readonly UatGenerationPayload[]): UatGenerationPayload | null {
  if (pickHeroBatch(batches) !== null) return null;
  let outcome: UatGenerationPayload | null = null;
  for (const b of batches) {
    if (b.status !== 'promoted') continue;
    if (outcome === null || mergedAtMs(b) > mergedAtMs(outcome)) outcome = b;
  }
  if (outcome === null) return null;
  const mergedAt = mergedAtMs(outcome);
  const p = outcome;
  const newer = batches.some((b) => b !== p
    && Date.parse(b.createdAt) > mergedAt
    && !(b.status === 'invalidated' && membersWithin(b, p)));
  return newer ? null : outcome;
}

/** 2+ consecutive voided batches with the same non-empty member set become one run. */
export function collapseIdenticalRuns(gens: readonly UatGenerationPayload[]): OlderRow[] {
  const rows: OlderRow[] = [];
  let i = 0;
  while (i < gens.length) {
    const g = gens[i]!;
    const key = g.status === 'invalidated' ? memberKey(g) : '';
    let j = i + 1;
    if (key !== '') {
      while (j < gens.length && gens[j]!.status === 'invalidated' && memberKey(gens[j]!) === key) j += 1;
    }
    if (j - i >= 2) rows.push({ kind: 'run', gens: gens.slice(i, j) });
    else rows.push({ kind: 'single', gen: g });
    i = j;
  }
  return rows;
}

export function buildBatchSections(batches: readonly UatGenerationPayload[]): BatchSections {
  const hero = pickHeroBatch(batches);
  const outcome = hero ? null : pickOutcomeBatch(batches);
  const rest = batches.filter((b) => b !== hero && b !== outcome);
  const folded = outcome
    ? rest.filter((b) => b.status === 'invalidated' && b.voidedBy === outcome.name)
    : [];
  const unfolded = rest.filter((b) => !folded.includes(b));
  const coveredGens = unfolded.filter((b) => isCoveredByMerge(b, batches));
  return {
    hero,
    outcome,
    folded,
    rows: collapseIdenticalRuns(unfolded.filter((b) => !coveredGens.includes(b))),
    covered: collapseIdenticalRuns(coveredGens),
  };
}

/** The first three rows plus every later failed single; all rows when expanded. */
export function capOlderRows(rows: readonly OlderRow[], expanded: boolean): { shown: OlderRow[]; hiddenCount: number } {
  if (expanded) return { shown: [...rows], hiddenCount: 0 };
  const shown = rows.filter((row, index) => index < OLDER_ROWS_VISIBLE
    || (row.kind === 'single' && row.gen.status === 'failed'));
  return { shown, hiddenCount: rows.length - shown.length };
}
