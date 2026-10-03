/**
 * The default reasoning effort a new conversation would get, with its source
 * (PAN-4486). The new-conversation options dialog shows it beside the picker.
 *
 *   GET /api/effort/default?model=<id>&harness=<runtime>&issue=<ID>
 *
 * Returns `resolveEffort({ model, harness, issueId })`:
 * `{ effort, source, requested, clamped, warning? }`. An unknown harness or a
 * malformed issue id is ignored, not rejected.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { resolveEffort } from '../../../../lib/agents/resolve-effort.js';
import { normalizeHarness } from '../../../../lib/overdeck/conversations.js';
import { jsonResponse } from '../../http-helpers.js';

const ISSUE_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

const getEffortDefaultRoute = HttpRouter.add(
  'GET',
  '/api/effort/default',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const model = url.searchParams.get('model') || undefined;
    const harness = normalizeHarness(url.searchParams.get('harness')) ?? undefined;
    const issue = url.searchParams.get('issue');
    const issueId = issue && ISSUE_ID_PATTERN.test(issue) ? issue : undefined;
    try {
      return jsonResponse(resolveEffort({ model, harness, issueId }));
    } catch (error) {
      console.error('[effort-default] request failed:', error);
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }),
);

export const effortDefaultRouteLayer = Layer.mergeAll(getEffortDefaultRoute);
