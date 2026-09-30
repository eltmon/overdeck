/**
 * `GET/POST /api/issues/:id/test-removal-waiver` (PAN-4438, `.pan/drafts/PAN-4438.md` WI-3).
 *
 * The dashboard door for the test-skip gate's operator waiver — the other
 * door is `pan review waive-test-removal`. Both call `grantTestSkipWaiver` in
 * `src/lib/cloister/test-skip-waiver.ts`; this route is thin plumbing around
 * it, same shape as `routes/lanes.ts`.
 */
import { existsSync } from 'node:fs';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { formatAnchorShort, snapshotWorkspaceHeads } from '../../../lib/git-utils.js';
import { parseIssueId } from '../../../lib/issue-id.js';
import { getIssueWorkspacePath } from '../../../lib/overdeck/issue-projects.js';
import {
  grantTestSkipWaiver,
  readTestSkipWaiver,
  waiverCoversHead,
} from '../../../lib/cloister/test-skip-waiver.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

const GRANT_ERROR_STATUS: Record<'empty-reason' | 'no-workspace' | 'remote-workspace' | 'no-head' | 'head-moved', number> = {
  'empty-reason': 400,
  'no-workspace': 404,
  'remote-workspace': 409,
  'no-head': 409,
  'head-moved': 409,
};

const getTestRemovalWaiverRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/test-removal-waiver',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueId(id)) {
      return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    }
    const issueId = id.toUpperCase();
    return yield* Effect.promise(async () => {
      const workspacePath = getIssueWorkspacePath(issueId);
      const head = workspacePath && existsSync(workspacePath)
        ? await snapshotWorkspaceHeads(issueId, workspacePath)
        : undefined;
      const waiver = workspacePath ? readTestSkipWaiver(workspacePath) : null;
      return jsonResponse({
        issueId,
        head: head ?? null,
        headShort: head ? formatAnchorShort(head) : null,
        waiver,
        active: waiverCoversHead(waiver ?? undefined, head),
      });
    });
  }),
);

const postTestRemovalWaiverRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/test-removal-waiver',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueId(id)) {
      return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    }
    const issueId = id.toUpperCase();

    const text = yield* request.text;
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return jsonResponse({ error: 'body must be a JSON object' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }

    if (typeof body['head'] !== 'string' || body['head'].trim() === '') {
      return jsonResponse({ error: 'head is required' }, { status: 400 });
    }
    const reason = typeof body['reason'] === 'string' ? body['reason'] : '';

    return yield* Effect.promise(async () => {
      const result = await grantTestSkipWaiver({
        issueId,
        reason,
        by: 'dashboard',
        expectedHead: body['head'] as string,
      });
      if (!result.ok) {
        return jsonResponse({ error: result.message, code: result.code }, { status: GRANT_ERROR_STATUS[result.code] });
      }
      return jsonResponse({ waiver: result.waiver, headShort: formatAnchorShort(result.waiver.sha) }, { status: 201 });
    });
  }),
);

export const testRemovalWaiverRouteLayer = Layer.mergeAll(getTestRemovalWaiverRoute, postTestRemovalWaiverRoute);
