/**
 * Explorer edit-workspace routes (PAN-5191) — Effect HttpRouter.Layer
 *
 *   GET /api/explorer/edit-workspaces/:workspaceId
 *     The edit workspace, its PR with the merge verdict, and PR and pipeline
 *     support (EditWorkspaceStatus).
 *
 *   POST /api/explorer/edit-workspaces/:workspaceId/pr
 *     Body EditWorkspaceCreatePrInput. `direct` commits, pushes the edit
 *     branch and opens (or pushes to) its PR; 201 EditWorkspaceCreatePrResult.
 *
 *   POST /api/explorer/edit-workspaces/:workspaceId/merge
 *     Body {}. Squash-merges the PR pinned to its head, then removes the edit
 *     workspace; 200 { merged: true }.
 *
 *   POST /api/explorer/edit-workspaces/:workspaceId/discard
 *     Body { closePr: boolean }. Removes the edit workspace (force), closing
 *     its open PR when asked; 200 { removed: true, prClosed }.
 *
 * Every route accepts only an explorer edit workspace (edit branch, D-A4
 * root); any other workspace id answers 409 NOT_AN_EDIT_WORKSPACE (FR-14).
 * Errors are `{ error, code }`: an EditWorkspaceError carries its own status,
 * anything else goes through explorerErrorResponse. Handlers are exported so
 * tests drive them directly.
 */
import type { EditWorkspaceCreatePrInput } from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { EditWorkspaceError } from '../services/explorer/edit-workspace-errors.js';
import {
  createDirectPr,
  discardEditWorkspace,
  getEditWorkspaceStatus,
  mergeEditWorkspace,
  type EditWorkspacePrDeps,
} from '../services/explorer/edit-workspace-pr.js';
import { explorerErrorResponse } from '../services/explorer/http-errors.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

export function editWorkspaceErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  if (error instanceof EditWorkspaceError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: error.status });
  }
  return explorerErrorResponse(error);
}

function invalidInput(message: string): HttpServerResponse.HttpServerResponse {
  return jsonResponse({ error: message, code: 'INVALID_INPUT' }, { status: 400 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The validated create-PR body, or the reason it is invalid. */
export function parseCreatePrInput(body: unknown): EditWorkspaceCreatePrInput | string {
  if (!isRecord(body)) return 'The request body must be a JSON object.';
  const { mode, title, body: prBody, draft } = body;
  if (mode !== 'direct' && mode !== 'pipeline') return 'mode must be "direct" or "pipeline".';
  if (typeof title !== 'string' || title.trim() === '') return 'A title is required.';
  if (prBody !== undefined && typeof prBody !== 'string') return 'body must be a string.';
  if (draft !== undefined && typeof draft !== 'boolean') return 'draft must be a boolean.';
  return { mode, title: title.trim(), body: prBody ?? '', draft: draft ?? false };
}

/** Reads the request body as JSON; undefined when it is not valid JSON. */
function bodyReader(request: HttpServerRequest.HttpServerRequest): () => Promise<unknown> {
  return () =>
    Effect.runPromise(
      Effect.map(Effect.orElseSucceed(request.text, () => ''), (text) => {
        if (text.trim() === '') return {};
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return undefined;
        }
      }),
    );
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

export async function handleEditWorkspaceCreatePr(
  request: HttpServerRequest.HttpServerRequest,
  workspaceId: string,
  readBody: () => Promise<unknown>,
  deps: EditWorkspacePrDeps = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const guardError = rejectUnsafeDashboardMutationRequest(request);
  if (guardError) return guardError;
  const input = parseCreatePrInput(await readBody());
  if (typeof input === 'string') return invalidInput(input);
  try {
    if (input.mode === 'pipeline') {
      return jsonResponse({ error: 'Send through pipeline is not available yet.', code: 'NOT_IMPLEMENTED' }, { status: 501 });
    }
    return jsonResponse(await createDirectPr(workspaceId, input, deps), { status: 201 });
  } catch (error) {
    return editWorkspaceErrorResponse(error);
  }
}

export async function handleEditWorkspaceMerge(
  request: HttpServerRequest.HttpServerRequest,
  workspaceId: string,
  deps: EditWorkspacePrDeps = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const guardError = rejectUnsafeDashboardMutationRequest(request);
  if (guardError) return guardError;
  try {
    return jsonResponse(await mergeEditWorkspace(workspaceId, deps));
  } catch (error) {
    return editWorkspaceErrorResponse(error);
  }
}

export async function handleEditWorkspaceDiscard(
  request: HttpServerRequest.HttpServerRequest,
  workspaceId: string,
  readBody: () => Promise<unknown>,
  deps: EditWorkspacePrDeps = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const guardError = rejectUnsafeDashboardMutationRequest(request);
  if (guardError) return guardError;
  const body = await readBody();
  if (!isRecord(body) || typeof body.closePr !== 'boolean') return invalidInput('closePr must be a boolean.');
  try {
    return jsonResponse(await discardEditWorkspace(workspaceId, { closePr: body.closePr }, deps));
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

// ─── POST /api/explorer/edit-workspaces/:workspaceId/pr ───────────────────────

const createPrRoute = HttpRouter.add(
  'POST',
  '/api/explorer/edit-workspaces/:workspaceId/pr',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const workspaceId = params['workspaceId'] ?? '';
    return yield* Effect.promise(() => handleEditWorkspaceCreatePr(request, workspaceId, bodyReader(request)));
  })),
);

// ─── POST /api/explorer/edit-workspaces/:workspaceId/merge ────────────────────

const mergeRoute = HttpRouter.add(
  'POST',
  '/api/explorer/edit-workspaces/:workspaceId/merge',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const workspaceId = params['workspaceId'] ?? '';
    return yield* Effect.promise(() => handleEditWorkspaceMerge(request, workspaceId));
  })),
);

// ─── POST /api/explorer/edit-workspaces/:workspaceId/discard ──────────────────

const discardRoute = HttpRouter.add(
  'POST',
  '/api/explorer/edit-workspaces/:workspaceId/discard',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const workspaceId = params['workspaceId'] ?? '';
    return yield* Effect.promise(() => handleEditWorkspaceDiscard(request, workspaceId, bodyReader(request)));
  })),
);

// ─── Layer composition ────────────────────────────────────────────────────────

export const explorerEditWorkspacesRouteLayer = Layer.mergeAll(statusRoute, createPrRoute, mergeRoute, discardRoute);
