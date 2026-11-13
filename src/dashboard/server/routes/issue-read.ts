/**
 * `GET /api/issues/:id` (PAN-5171): one dashboard-shaped issue for the issue
 * view headers (drawer, cockpit, phone sheet), so a header never waits on, or
 * depends on, the full issue list. Reads the shared issue service with
 * `cycle: 'all'` (the snapshot drops backlog and canceled rows), backfills
 * through the tracker door when the service lacks the issue, and answers 404
 * only when the tracker says the issue does not exist.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { parseIssueId } from '../../../lib/issue-id.js';
import { jsonResponse } from '../http-helpers.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
import { missingIssueFailureKind } from '../services/issue-title-fallback.js';
import { httpHandler } from './http-handler.js';

function findIssueRow(key: string): unknown | null {
  const issues = getSharedIssueService().getIssues({ cycle: 'all', includeCompleted: true }) as Array<{ identifier?: unknown }>;
  return issues.find((issue) => typeof issue?.identifier === 'string' && issue.identifier.toUpperCase() === key) ?? null;
}

export async function readIssueRow(rawId: string): Promise<{ status: 200; issue: unknown } | { status: 404 | 503 }> {
  const key = rawId.toUpperCase();
  const listed = findIssueRow(key);
  if (listed) return { status: 200, issue: listed };
  await getSharedIssueService().backfillIssue(key);
  const backfilled = findIssueRow(key);
  if (backfilled) return { status: 200, issue: backfilled };
  return { status: missingIssueFailureKind(key) === 'not-found' ? 404 : 503 };
}

const getIssueRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueId(id)) return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    const result = yield* Effect.promise(() => readIssueRow(id));
    if (result.status === 200) return jsonResponse(result.issue);
    const issueId = id.toUpperCase();
    return result.status === 404
      ? jsonResponse({ error: 'Issue not found', issueId }, { status: 404 })
      : jsonResponse({ error: 'Issue tracker unavailable', issueId }, { status: 503 });
  })),
);

export const issueReadRouteLayer = Layer.mergeAll(getIssueRoute);
