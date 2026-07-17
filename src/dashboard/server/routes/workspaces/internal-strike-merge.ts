import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { parseIssueIdSync } from '../../../../lib/issue-id.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { validateInternalEventsHeaders } from '../internal-events.js';
import type { HeaderMap } from '../origin-validation.js';
import { parseStrikeMergeRequest, type StrikeMergeRequest, type TriggerMergeResult } from './merge-strike.js';

type StrikeMergeHandler = (
  issueId: string,
  request: StrikeMergeRequest,
) => Promise<TriggerMergeResult>;

export function internalStrikeMergeRoute(triggerMerge: StrikeMergeHandler) {
  return HttpRouter.add(
    'POST',
    '/api/internal/strikes/:issueId/merge',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = validateInternalEventsHeaders(request.headers as HeaderMap);
      if (!auth.ok) return jsonResponse({ success: false, error: auth.error }, { status: auth.status });

      const params = yield* HttpRouter.params;
      const issueId = params['issueId'] ?? '';
      if (!parseIssueIdSync(issueId) || !/^[A-Z]+-\d+$/i.test(issueId)) {
        return jsonResponse({ success: false, error: 'Invalid issue ID' }, { status: 400 });
      }

      const text = yield* request.text;
      let raw: unknown;
      try {
        raw = text ? JSON.parse(text) : null;
      } catch {
        return jsonResponse({ success: false, error: 'Invalid JSON' }, { status: 400 });
      }

      const strikeRequest = parseStrikeMergeRequest(raw);
      if (!strikeRequest) {
        return jsonResponse({ success: false, error: 'Invalid strike merge request' }, { status: 400 });
      }

      const result = yield* Effect.promise(() => triggerMerge(issueId, strikeRequest));
      const { statusCode, ...body } = result;
      return jsonResponse(body, { status: statusCode });
    })),
  );
}
