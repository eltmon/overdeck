/**
 * PAN-4264: publish the GitHub quota snapshot.
 *
 * Every 30 seconds the publisher rebuilds the snapshot from the quota ledger
 * and pause file and, only when it changed, emits `github_quota.changed` with
 * `emitOnly`. The quota is derived runtime state (NFR-7): it fans out to live
 * subscribers and the read model but never enters the durable event log or
 * overdeck.db. `GET /api/github-quota` returns the same published snapshot.
 */

import type { GitHubQuotaSnapshot } from '@overdeck/contracts';
import { getGitHubLogin } from '../../../lib/github-quota/identity.js';
import { buildGitHubQuotaSnapshot } from '../../../lib/github-quota/snapshot.js';
import { getEventStore } from '../event-store.js';

export const GITHUB_QUOTA_PUBLISH_INTERVAL_MS = 30_000;

let published: GitHubQuotaSnapshot | null = null;
let publishedKey: string | null = null;

/** Everything but `generatedAt`, so an unchanged tick is recognized as unchanged. */
function changeKey(snapshot: GitHubQuotaSnapshot): string {
  const { generatedAt: _generatedAt, ...rest } = snapshot;
  return JSON.stringify(rest);
}

/**
 * Rebuild the snapshot and emit it when it changed. Returns the published
 * snapshot, which is the read model's view as well.
 */
export async function refreshGitHubQuotaSnapshot(nowMs: number = Date.now()): Promise<GitHubQuotaSnapshot> {
  const login = await getGitHubLogin();
  const next = buildGitHubQuotaSnapshot(nowMs, login);
  const key = changeKey(next);
  if (published && key === publishedKey) return published;
  published = next;
  publishedKey = key;
  try {
    getEventStore().emitOnly({
      type: 'github_quota.changed',
      timestamp: new Date(nowMs).toISOString(),
      payload: next,
    });
  } catch {
    // Event store not ready yet: the next change republishes.
  }
  return next;
}

/** Start the 30-second publisher (first run immediately). Returns the stop function. */
export function startGitHubQuotaPublisher(intervalMs: number = GITHUB_QUOTA_PUBLISH_INTERVAL_MS): () => void {
  const tick = () => {
    refreshGitHubQuotaSnapshot().catch((err: unknown) => {
      console.warn('[github-quota] snapshot publish failed:', err instanceof Error ? err.message : String(err));
    });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Forget the published snapshot (tests only). */
export function resetGitHubQuotaPublisherForTests(): void {
  published = null;
  publishedKey = null;
}
