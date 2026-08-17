import type { DomainEvent } from '@overdeck/contracts';
import { getReviewStatusSync, loadReviewStatuses, type ReviewStatus } from '../../../lib/review-status.js';
import { getEventStore, type StoredEvent } from '../event-store.js';
import { getDashboardIdentity } from '../identity.js';
import {
  emitReviewStatusChanged,
  sameCanonicalReviewStatus,
} from '../review-status-emit.js';

const POLL_INTERVAL_MS = 60_000;

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
const reconcileTracking = new Map<string, { healedUpdatedAt: string; warnedUpdatedAt?: string }>();

interface ReviewStatusEventPayload {
  issueId: string;
  status: { updatedAt?: string };
}

function reviewStatusPayload(event: StoredEvent): ReviewStatusEventPayload | null {
  if (!event.payload || typeof event.payload !== 'object') return null;
  const payload = event.payload as Partial<ReviewStatusEventPayload>;
  if (typeof payload.issueId !== 'string' || !payload.status || typeof payload.status !== 'object') {
    return null;
  }
  return payload as ReviewStatusEventPayload;
}

async function reconcileOnce(): Promise<void> {
  const cached = loadReviewStatuses();
  const canonicalByIssue = new Map<string, ReviewStatus>();

  // Reading canonical status can itself reconcile a newer journal row and emit
  // status_changed. Query the event store after these reads so this sweep does
  // not duplicate an event that the read door just healed.
  for (const issueId of Object.keys(cached)) {
    const canonical = getReviewStatusSync(issueId);
    if (!canonical || canonical.retiredAt) continue;
    canonicalByIssue.set(issueId.toUpperCase(), canonical);
  }
  for (const issueId of reconcileTracking.keys()) {
    if (!canonicalByIssue.has(issueId)) reconcileTracking.delete(issueId);
  }

  const store = getEventStore();
  const latestByIssue = new Map<string, StoredEvent>();
  for (const event of store.queryLatestPerIssue('review.status_changed')) {
    const payload = reviewStatusPayload(event);
    if (payload) latestByIssue.set(payload.issueId.toUpperCase(), event);
  }

  for (const [issueId, canonical] of canonicalByIssue) {
    const latest = latestByIssue.get(issueId);
    const latestPayload = latest ? reviewStatusPayload(latest) : null;
    const lastUpdatedAt = latestPayload?.status.updatedAt ?? '';
    if (lastUpdatedAt > canonical.updatedAt) {
      reconcileTracking.delete(issueId);
      continue;
    }
    if (
      lastUpdatedAt === canonical.updatedAt &&
      latestPayload &&
      sameCanonicalReviewStatus(latestPayload.status, canonical)
    ) {
      reconcileTracking.delete(issueId);
      continue;
    }

    const tracking = reconcileTracking.get(issueId);
    if (tracking?.healedUpdatedAt === canonical.updatedAt) {
      if (tracking.warnedUpdatedAt !== canonical.updatedAt) {
        console.warn(`[review-status-reconcile] NOT CONVERGING for ${issueId}: canonical=${canonical.updatedAt} event=${lastUpdatedAt}`);
        tracking.warnedUpdatedAt = canonical.updatedAt;
      }
      continue;
    }

    console.log(
      `[review-status-reconcile] re-emitting status for ${issueId} ` +
      '(canonical differs from last event — healing lost status_changed)',
    );
    emitReviewStatusChanged(
      (event) => store.append(event as Omit<DomainEvent, 'sequence'>),
      issueId,
      canonical,
    );
    reconcileTracking.set(issueId, { healedUpdatedAt: canonical.updatedAt });
  }
}

export function startReviewStatusReconcileService(): boolean {
  if (getDashboardIdentity().mode !== 'primary') return false;
  if (reconcileTimer !== null) return true;
  reconcileTimer = setInterval(() => {
    void reconcileOnce().catch(() => {
      // Swallow — reconciliation must never crash the dashboard server.
    });
  }, POLL_INTERVAL_MS);
  reconcileTimer.unref?.();
  return true;
}

export function stopReviewStatusReconcileService(): void {
  if (reconcileTimer !== null) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  reconcileTracking.clear();
}

export async function __reconcileReviewStatusesOnceForTests(): Promise<void> {
  await reconcileOnce();
}
