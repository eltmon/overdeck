/**
 * The guarded review request, from a process that does not serve the dashboard
 * routes (PAN-3911). Deacon-lite runs in the deacon child, where the route
 * module that registers the in-process review starter is never loaded, so it
 * asks the dashboard over HTTP: `POST /api/review/:issueId/request`, the same
 * route `pan review request` uses, with its merged check, approved-head check
 * and re-request breaker.
 */
import { reviewRequestOutcomeFromRoute, type ReviewRequestOutcome, type ReviewRequestRouteBody } from '../agents/issue-pause.js';
import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
import type { RequestReviewSource } from './request-review-pipeline.js';

function internalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

/** Never throws: an unreachable dashboard is a `requested: false` outcome. */
export async function requestReviewThroughRoute(
  issueId: string,
  options: { message: string; source: RequestReviewSource; timeoutMs?: number },
  dashboardOrigin = internalDashboardOrigin(),
): Promise<ReviewRequestOutcome> {
  const internalToken = getInternalToken();
  let response: Response;
  try {
    response = await fetch(new URL(`/api/review/${encodeURIComponent(issueId)}/request`, dashboardOrigin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: dashboardOrigin,
        ...(internalToken ? { [INTERNAL_TOKEN_HEADER]: internalToken } : {}),
      },
      body: JSON.stringify({ message: options.message, source: options.source }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    return { requested: false, reason: `dashboard unreachable (${cause ?? (err instanceof Error ? err.message : String(err))})` };
  }
  const body = await response.json().catch(() => ({})) as ReviewRequestRouteBody;
  return reviewRequestOutcomeFromRoute(response.ok, response.status, body);
}
