import type { BeadRollup } from './beads-rollup-service.js';

export const RECENCY_DAYS = 14;
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

export interface BeadTotals {
  total: number;
  closed: number;
  inProgress: number;
  lastUpdated: string | null;
}

export function isWithinRecencyMs(timestamp: number): boolean {
  return Number.isFinite(timestamp) && (Date.now() - timestamp) < RECENCY_MS;
}

export function isWithinRecencyDate(dateString: string | null): boolean {
  if (!dateString) return false;
  const parsed = Date.parse(dateString);
  return Number.isFinite(parsed) && (Date.now() - parsed) < RECENCY_MS;
}

export function getBeadTotalsForIssue(issueId: string, rollups: Map<string, BeadRollup>): BeadTotals | null {
  const rollup = rollups.get(issueId.toLowerCase());
  if (!rollup) return null;
  return {
    total: rollup.total,
    closed: rollup.closed,
    inProgress: rollup.inProgress,
    lastUpdated: rollup.lastUpdated,
  };
}
