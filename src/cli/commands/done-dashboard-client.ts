import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../lib/internal-token.js';

export interface DoneDashboardPostResult {
  success?: boolean;
  error?: string;
  message?: string;
  queued?: boolean;
  alreadyReviewed?: boolean;
  alreadyMerged?: boolean;
}

export interface DoneReviewHandoffStatus {
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | null;
  reviewSpawnedAt?: string | number | null;
}

export type DoneReviewHandoffObservation =
  | { kind: 'verification'; status: DoneReviewHandoffStatus }
  | { kind: 'review'; status: DoneReviewHandoffStatus };

export async function postDoneDashboardJson(
  dashboardUrl: string,
  path: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<DoneDashboardPostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await (options.fetchImpl ?? fetch)(`${dashboardUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: ensureInternalTokenSync(),
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    try {
      return await res.json() as DoneDashboardPostResult;
    } catch {
      return { success: false, error: 'Invalid response' };
    }
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function getDoneReviewHandoffStatus(
  dashboardUrl: string,
  issueId: string,
  fetchImpl: typeof fetch,
): Promise<DoneReviewHandoffStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchImpl(`${dashboardUrl}/api/review/${issueId}/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as DoneReviewHandoffStatus;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function observeDoneReviewHandoff(
  status: DoneReviewHandoffStatus,
  reviewRequestedAt: string,
): DoneReviewHandoffObservation | null {
  if (status.verificationStatus === 'running') {
    return { kind: 'verification', status };
  }

  const requestedAtMs = Date.parse(reviewRequestedAt);
  const spawnedAtMs = typeof status.reviewSpawnedAt === 'number'
    ? status.reviewSpawnedAt
    : Date.parse(status.reviewSpawnedAt ?? '');
  const currentReviewSpawn = Number.isFinite(requestedAtMs)
    && Number.isFinite(spawnedAtMs)
    && spawnedAtMs >= requestedAtMs;

  return currentReviewSpawn ? { kind: 'review', status } : null;
}

export async function waitForDoneReviewHandoff(
  dashboardUrl: string,
  issueId: string,
  reviewRequestedAt: string,
  options: {
    fetchImpl?: typeof fetch;
    attempts?: number;
    intervalMs?: number;
  } = {},
): Promise<DoneReviewHandoffObservation | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = options.attempts ?? 60;
  const intervalMs = options.intervalMs ?? 1000;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const status = await getDoneReviewHandoffStatus(dashboardUrl, issueId, fetchImpl);
    const observation = status ? observeDoneReviewHandoff(status, reviewRequestedAt) : null;
    if (observation) return observation;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return null;
}
