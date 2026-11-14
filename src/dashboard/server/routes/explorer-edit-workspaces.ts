/**
 * Explorer edit-workspace routes (PAN-5191) — Effect HttpRouter.Layer
 *
 *   GET /api/explorer/edit-workspaces/:workspaceId
 *     The edit workspace, its PR with the merge verdict, and PR and pipeline
 *     support (EditWorkspaceStatus).
 *
 * Every route accepts only an explorer edit workspace (edit branch, D-A4
 * root); any other workspace id answers 409 NOT_AN_EDIT_WORKSPACE (FR-14).
 * Errors are `{ error, code }`: an EditWorkspaceError carries its own status,
 * anything else goes through explorerErrorResponse. Handlers are exported so
 * tests drive them directly.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { EditWorkspaceError } from '../services/explorer/edit-workspace-errors.js';
import { getEditWorkspaceStatus, type EditWorkspacePrDeps } from '../services/explorer/edit-workspace-pr.js';
import { explorerErrorResponse } from '../services/explorer/http-errors.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

export function editWorkspaceErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  if (error instanceof EditWorkspaceError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: error.status });
  }
  return explorerErrorResponse(error);
}

export async function handleEditWorkspaceStatus(
  request: HttpServerRequest.HttpServerRequest,
  workspaceId: string,
  deps: EditWorkspacePrDeps = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const authError = rejectUnauthorizedDashboardRequest(request);
  if (authError) return authError;
  try {
    return jsonResponse(await getEditWorkspaceStatus(workspaceId, deps));
  } catch (error) {
    return editWorkspaceErrorResponse(error);
  }
}

// ─── GET /api/explorer/edit-workspaces/:workspaceId ───────────────────────────

const statusRoute = HttpRouter.add(
  'GET',
  '/api/explorer/edit-workspaces/:workspaceId',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const workspaceId = params['workspaceId'] ?? '';
    return yield* Effect.promise(() => handleEditWorkspaceStatus(request, workspaceId));
  })),
);

// ─── Layer composition ────────────────────────────────────────────────────────

export const explorerEditWorkspacesRouteLayer = Layer.mergeAll(statusRoute);
