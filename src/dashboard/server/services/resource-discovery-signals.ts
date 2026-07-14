export const RECENCY_DAYS = 14;
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

export interface TaskTotals {
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
