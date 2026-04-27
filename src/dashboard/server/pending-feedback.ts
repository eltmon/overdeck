/**
 * Pending feedback recovery for dashboard restarts (PAN-585).
 *
 * Feedback files and review-status rows are persistent, but tmux delivery is not.
 * When the dashboard dies after writing feedback and before messageAgent() completes,
 * startup replays the queued delivery so the work agent is notified.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageAgent, getAgentStateAsync } from '../../lib/agents.js';
import { getReviewStatus, loadReviewStatuses, type ReviewStatus } from '../../lib/review-status.js';
import { getPanopticonHome } from '../../lib/paths.js';
import { emitActivityEntry } from '../../lib/activity-logger.js';

const PENDING_FEEDBACK_FILE = join(getPanopticonHome(), 'pending-feedback-deliveries.json');
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

type FeedbackKind = 'review-blocked' | 'review-failed' | 'test-failed';

export interface PendingFeedbackDelivery {
  issueId: string;
  agentId: string;
  kind: FeedbackKind;
  filePath: string;
  message: string;
  createdAt: string;
}

interface PendingFeedbackStore {
  deliveries: PendingFeedbackDelivery[];
}

async function readStore(filePath: string): Promise<PendingFeedbackStore> {
  if (!existsSync(filePath)) {
    return { deliveries: [] };
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    if (!raw.trim()) return { deliveries: [] };
    const parsed = JSON.parse(raw) as PendingFeedbackStore;
    return { deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [] };
  } catch {
    return { deliveries: [] };
  }
}

async function writeStore(filePath: string, store: PendingFeedbackStore): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function isDeliveryStillRelevant(delivery: PendingFeedbackDelivery, status: ReviewStatus | null | undefined): boolean {
  switch (delivery.kind) {
    case 'review-blocked':
      return status?.reviewStatus === 'blocked';
    case 'review-failed':
      return status?.reviewStatus === 'failed';
    case 'test-failed':
      return status?.testStatus === 'failed';
    default:
      return false;
  }
}

export async function enqueuePendingFeedbackDelivery(
  delivery: PendingFeedbackDelivery,
  options?: { filePath?: string }
): Promise<void> {
  const filePath = options?.filePath ?? PENDING_FEEDBACK_FILE;
  const store = await readStore(filePath);
  store.deliveries = store.deliveries.filter(
    (existing) => !(existing.issueId === delivery.issueId && existing.kind === delivery.kind)
  );
  store.deliveries.push(delivery);
  await writeStore(filePath, store);
}

export async function markPendingFeedbackDelivered(
  issueId: string,
  kind: FeedbackKind,
  options?: { filePath?: string }
): Promise<void> {
  const filePath = options?.filePath ?? PENDING_FEEDBACK_FILE;
  const store = await readStore(filePath);
  const next = store.deliveries.filter(
    (delivery) => !(delivery.issueId === issueId && delivery.kind === kind)
  );

  if (next.length === store.deliveries.length) return;

  if (next.length === 0) {
    if (existsSync(filePath)) {
      await unlink(filePath).catch(() => {});
    }
    return;
  }

  await writeStore(filePath, { deliveries: next });
}

export async function processPendingFeedbackDeliveries(options?: {
  filePath?: string;
  staleThresholdMs?: number;
  now?: number;
  _deliver?: (agentId: string, message: string) => Promise<void>;
  _getAgentState?: typeof getAgentStateAsync;
  _loadStatuses?: typeof loadReviewStatuses;
  _getStatus?: typeof getReviewStatus;
}): Promise<void> {
  const filePath = options?.filePath ?? PENDING_FEEDBACK_FILE;
  const staleThresholdMs = options?.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const now = options?.now ?? Date.now();
  const deliver = options?._deliver ?? messageAgent;
  const getAgentState = options?._getAgentState ?? getAgentStateAsync;
  const loadStatuses = options?._loadStatuses ?? loadReviewStatuses;
  const getStatus = options?._getStatus ?? getReviewStatus;

  if (!existsSync(filePath)) return;

  const store = await readStore(filePath);
  if (store.deliveries.length === 0) {
    await unlink(filePath).catch(() => {});
    return;
  }

  const statuses = loadStatuses();
  const remaining: PendingFeedbackDelivery[] = [];

  for (const delivery of store.deliveries) {
    const createdAt = Date.parse(delivery.createdAt);
    if (Number.isFinite(createdAt) && now - createdAt > staleThresholdMs) {
      continue;
    }

    const status = statuses[delivery.issueId] ?? getStatus(delivery.issueId);
    if (!isDeliveryStillRelevant(delivery, status)) {
      continue;
    }

    const agentState = await getAgentState(delivery.agentId);
    if (!agentState) {
      remaining.push(delivery);
      continue;
    }

    try {
      await deliver(delivery.agentId, delivery.message);
      emitActivityEntry({
        source: 'dashboard',
        level: 'warn',
        message: `${delivery.issueId} — replayed missed ${delivery.kind} feedback after restart`,
        issueId: delivery.issueId,
        details: delivery.filePath,
      });
    } catch {
      remaining.push(delivery);
    }
  }

  if (remaining.length === 0) {
    await unlink(filePath).catch(() => {});
    return;
  }

  await writeStore(filePath, { deliveries: remaining });
}
