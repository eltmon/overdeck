type CacheKind = 'pr' | 'discussions';

type CacheEntry<T> = {
  generation: number;
  value: T;
  at: number;
};

/**
 * #4036: an entry also expires after a minute. The generation is bumped by the
 * PR webhooks, but a verdict comment posted where no webhook reaches this
 * process (a CLI process, an install without webhooks) must still reach the
 * merge gate, which reads PR comments through this cache.
 */
export const PR_TAB_CACHE_TTL_MS = 60_000;

const generations = new Map<string, number>();
const caches = new Map<string, CacheEntry<unknown>>();

function normalizeIssueId(issueId: string): string {
  return issueId.toUpperCase();
}

function cacheKey(kind: CacheKind, issueId: string): string {
  return `${kind}:${normalizeIssueId(issueId)}`;
}

export function getIssuePrTabCacheGeneration(issueId: string): number {
  return generations.get(normalizeIssueId(issueId)) ?? 0;
}

export function bumpIssuePrTabCacheGeneration(issueId: string): void {
  const normalized = normalizeIssueId(issueId);
  generations.set(normalized, getIssuePrTabCacheGeneration(normalized) + 1);
}

export function getCachedIssuePrTabResponse<T>(
  kind: CacheKind,
  issueId: string,
  generation: number,
): T | null {
  const entry = caches.get(cacheKey(kind, issueId));
  if (!entry || entry.generation !== generation) return null;
  if (Date.now() - entry.at >= PR_TAB_CACHE_TTL_MS) return null;
  return entry.value as T;
}

export function setCachedIssuePrTabResponse<T>(
  kind: CacheKind,
  issueId: string,
  generation: number,
  value: T,
): void {
  caches.set(cacheKey(kind, issueId), { generation, value, at: Date.now() });
}

export function clearIssuePrTabCacheForTests(): void {
  generations.clear();
  caches.clear();
}
