import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../lib/internal-token.js';

export interface DoneDashboardPostResult {
  success?: boolean;
  error?: string;
  message?: string;
  queued?: boolean;
  alreadyReviewed?: boolean;
  alreadyMerged?: boolean;
}

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
