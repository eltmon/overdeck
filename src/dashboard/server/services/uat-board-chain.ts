/**
 * Which generations the merge-train board shows (PAN-5364). Pure: the chain
 * arrives newest first; rows are never deleted, only left out of the payload.
 *
 * Voided (`invalidated`) and merged (`promoted`) batches leave the board 24
 * hours after they ended. A `failed` batch leaves after 24 hours too, unless it
 * is the newest row, so an old failure never becomes `batches[0]` again and
 * re-offers Retry. Live batches (`assembling`, `ready`, `superseded`) always
 * stay. The newest surviving promoted batch is always included, even when ten
 * newer batches exist.
 */

import type { UatGeneration } from '../../../lib/overdeck/merge-types.js';

export const BOARD_SCAN_LIMIT = 50;
export const BOARD_CHAIN_LIMIT = 10;
export const BOARD_TERMINAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Latest repo promote stamp of a promoted generation, else its updatedAt. */
export function generationMergedAt(gen: UatGeneration): string {
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

/** An unparseable timestamp counts as fresh, so a bad row is shown, not lost. */
function isFresh(iso: string, cutoff: number): boolean {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) || ms >= cutoff;
}

function mergedAtMs(gen: UatGeneration): number {
  const ms = Date.parse(generationMergedAt(gen));
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function selectBoardChain(chain: readonly UatGeneration[], now: number): UatGeneration[] {
  const cutoff = now - BOARD_TERMINAL_MAX_AGE_MS;
  const fresh = chain.filter((g, index) => {
    if (g.status === 'invalidated') return isFresh(g.updatedAt, cutoff);
    if (g.status === 'promoted') return isFresh(generationMergedAt(g), cutoff);
    if (g.status === 'failed') return index === 0 || isFresh(g.updatedAt, cutoff);
    return true;
  });
  const selected = fresh.slice(0, BOARD_CHAIN_LIMIT);
  let newestPromoted: UatGeneration | undefined;
  for (const g of fresh) {
    if (g.status !== 'promoted') continue;
    if (!newestPromoted || mergedAtMs(g) > mergedAtMs(newestPromoted)) newestPromoted = g;
  }
  if (newestPromoted && !selected.includes(newestPromoted)) selected.push(newestPromoted);
  return selected;
}
