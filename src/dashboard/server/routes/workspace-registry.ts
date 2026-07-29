/**
 * Workspaces/projects domain REST API (PAN-1990 FR-14/FR-15).
 *
 * Named `workspace-registry` (not `workspaces`) — `routes/workspaces.ts`
 * already owns `/api/workspaces/*` for the PAN-428 issue/git-worktree
 * concept (a different "workspace"). This module is the PAN-1990
 * projects/workspaces/project_targets/pinned_docs domain: reads go through
 * `src/lib/workspaces/resolver.ts`, writes through `src/lib/workspaces/writer.ts`
 * — no direct SQL here (scripts/guard-workspace-doors.sh enforces this).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getWorkspaceById, listWorkspaces } from '../../../lib/workspaces/resolver.js';
import {
  archiveWorkspace,
  setWorkspaceFavorite,
  touchWorkspaceAccessed,
  unarchiveWorkspace,
  updateWorkspaceLayout,
} from '../../../lib/workspaces/writer.js';
import type { WorkspaceRow } from '../../../lib/workspaces/types.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { readCurrentStatus, readRecentObservations } from '../../../lib/memory/rollup.js';

export interface WorkspacePipelineBadge {
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  verificationStatus?: string;
  readyForMerge?: boolean;
}

export interface WorkspaceListRow extends WorkspaceRow {
  pipeline: WorkspacePipelineBadge | null;
}

function pipelineBadgeForWorkspace(workspace: WorkspaceRow): WorkspacePipelineBadge | null {
  if (!workspace.issueId) return null;
  const status = getReviewStatusSync(workspace.issueId);
  if (!status) return null;
  return {
    reviewStatus: status.reviewStatus,
    testStatus: status.testStatus,
    mergeStatus: status.mergeStatus,
    verificationStatus: status.verificationStatus,
    readyForMerge: status.readyForMerge,
  };
}

function toListRow(workspace: WorkspaceRow): WorkspaceListRow {
  return { ...workspace, pipeline: pipelineBadgeForWorkspace(workspace) };
}

/**
 * Returns `{}` for a genuinely empty body (the legitimate "no explicit flag,
 * apply the default" case for archive/favorite), and `undefined` for a
 * non-empty body that fails to parse. These two cases were previously
 * conflated — a malformed body silently became `{}`, and archive/favorite's
 * `!== false` default then read as "apply the mutation" instead of rejecting
 * the request.
 */
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  if (!text) return {} as unknown;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
});

// ─── GET /api/workspace-registry ───────────────────────────────────────────

const listWorkspaceRegistryRoute = HttpRouter.add(
  'GET',
  '/api/workspace-registry',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const searchParams = new URL(request.url, 'http://localhost').searchParams;
    const projectId = searchParams.get('project') ?? undefined;
    const kindParam = searchParams.get('kind');
    const kind = kindParam === 'main' || kindParam === 'issue' || kindParam === 'scratch' ? kindParam : undefined;
    const includeArchived = searchParams.get('includeArchived') === 'true';
    const workspaces = listWorkspaces({ projectId, kind, includeArchived });
    return jsonResponse({ workspaces: workspaces.map(toListRow) });
  })),
);

// ─── GET /api/workspace-registry/:id ────────────────────────────────────────

const getWorkspaceRegistryDetailRoute = HttpRouter.add(
  'GET',
  '/api/workspace-registry/:id',
  httpHandler(Effect.gen(function* () {
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const memoryStatus = (yield* Effect.promise(() => readCurrentStatus(workspace.projectId, workspace.id).catch(() => undefined))) ?? null;
    return jsonResponse({ ...toListRow(workspace), memoryStatus });
  })),
);

// ─── GET /api/workspace-registry/:id/memory ─────────────────────────────────

const getWorkspaceRegistryMemoryRoute = HttpRouter.add(
  'GET',
  '/api/workspace-registry/:id/memory',
  httpHandler(Effect.gen(function* () {
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const request = yield* HttpServerRequest.HttpServerRequest;
    const limitParam = new URL(request.url, 'http://localhost').searchParams.get('limit');
    const limit = Math.min(Math.max(Number.parseInt(limitParam ?? '50', 10) || 50, 1), 200);
    const status = (yield* Effect.promise(() => readCurrentStatus(workspace.projectId, workspace.id).catch(() => undefined))) ?? null;
    const observations = yield* Effect.promise(() => readRecentObservations(workspace.projectId, workspace.id, limit));
    return jsonResponse({
      headline: status?.headline ?? null,
      status,
      observations,
    });
  })),
);

// ─── POST /api/workspace-registry/:id/activate|archive|favorite ────────────

const postWorkspaceRegistryActivateRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/activate',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    touchWorkspaceAccessed(id);
    return jsonResponse(toListRow(getWorkspaceById(id) ?? workspace));
  })),
);

const postWorkspaceRegistryArchiveRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/archive',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const body = (yield* readJsonBody) as { archived?: unknown } | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    if (body.archived === false) unarchiveWorkspace(id);
    else yield* Effect.promise(() => archiveWorkspace(id));
    return jsonResponse(toListRow(getWorkspaceById(id) ?? workspace));
  })),
);

const postWorkspaceRegistryFavoriteRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/favorite',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const body = (yield* readJsonBody) as { favorite?: unknown } | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    setWorkspaceFavorite(id, body.favorite !== false);
    return jsonResponse(toListRow(getWorkspaceById(id) ?? workspace));
  })),
);

// ─── PUT /api/workspace-registry/:id/layout ─────────────────────────────────

const putWorkspaceRegistryLayoutRoute = HttpRouter.add(
  'PUT',
  '/api/workspace-registry/:id/layout',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const body = (yield* readJsonBody) as { layout?: unknown } | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    if (body.layout === undefined) return jsonResponse({ error: 'layout is required' }, { status: 400 });
    updateWorkspaceLayout(id, JSON.stringify(body.layout));
    return jsonResponse(toListRow(getWorkspaceById(id) ?? workspace));
  })),
);

export const workspaceRegistryRouteLayer = Layer.mergeAll(
  listWorkspaceRegistryRoute,
  getWorkspaceRegistryDetailRoute,
  getWorkspaceRegistryMemoryRoute,
  postWorkspaceRegistryActivateRoute,
  postWorkspaceRegistryArchiveRoute,
  postWorkspaceRegistryFavoriteRoute,
  putWorkspaceRegistryLayoutRoute,
);
export default workspaceRegistryRouteLayer;
