/**
 * PAN-4753: the merge-train lane routes (strike lane first).
 *
 * New `/api/merge-train/*` routes of the merge-train restoration epic live here,
 * so `merge-train.ts` stays wiring for its existing surface.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getProjectSync } from '../../../lib/projects.js';
import { jsonResponse } from '../http-helpers.js';
import { getMergeTrainBoard } from '../services/merge-train-board.js';
import { postStrikeMergePayload } from '../services/strike-merge.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

// POST /api/merge-train/strikes/:issueId/merge — PAN-4750: the operator's strike Merge button.
const postStrikeMergeRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/strikes/:issueId/merge',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const issueId = ((yield* HttpRouter.params)['issueId'] ?? '').trim().toUpperCase();
    if (!ISSUE_ID.test(issueId)) return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    const result = yield* Effect.promise(() => postStrikeMergePayload(issueId));
    return jsonResponse(result.body, { status: result.status });
  })),
);

// GET /api/merge-train/board[?project=<key>] — PAN-4753 WI-7: everything the MergeTrain component renders.
const getMergeTrainBoardRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/board',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const projectKey = new URL(request.url, 'http://localhost').searchParams.get('project')?.trim() || undefined;
    if (projectKey && !getProjectSync(projectKey)) {
      return jsonResponse({ error: `Unknown project: ${projectKey}` }, { status: 404 });
    }
    const board = yield* Effect.promise(() => getMergeTrainBoard({ projectKey }));
    return jsonResponse(board);
  })),
);

export const mergeTrainLanesRouteLayer = Layer.mergeAll(postStrikeMergeRoute, getMergeTrainBoardRoute);
