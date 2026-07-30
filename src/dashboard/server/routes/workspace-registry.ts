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
  /**
   * Memory-synthesized phase (exploring/planning/building/verifying/cleaning/
   * shipping) for main and scratch rows, or null when there is no status yet.
   * Always null for `kind='issue'` rows, which badge the *pipeline* phase
   * instead (PAN-3286 FR-12, D-12).
   */
  memoryPhase: string | null;
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

function toListRow(workspace: WorkspaceRow, memoryPhase: string | null = null): WorkspaceListRow {
  return { ...workspace, pipeline: pipelineBadgeForWorkspace(workspace), memoryPhase };
}

/**
 * The memory phase for one row. Issue rows return null WITHOUT touching the
 * status file — they are badged from the pipeline, so the read would be wasted
 * (PAN-3286 D-12). A read failure degrades to null rather than failing the list.
 */
async function readMemoryPhase(workspace: WorkspaceRow): Promise<string | null> {
  if (workspace.kind === 'issue') return null;
  const status = await readCurrentStatus(workspace.projectId, workspace.id).catch(() => undefined);
  return status?.phase ?? null;
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
    // Server-side so the rail needs no per-row fetch; each read is one small
    // local JSON file, and issue rows are skipped entirely.
    const memoryPhases = yield* Effect.promise(() => Promise.all(workspaces.map(readMemoryPhase)));
    return jsonResponse({ workspaces: workspaces.map((workspace, index) => toListRow(workspace, memoryPhases[index] ?? null)) });
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
    // Same rule as the list route: issue rows carry no memoryPhase, even though
    // the detail route reads their full status for the memory panel.
    const memoryPhase = workspace.kind === 'issue' ? null : memoryStatus?.phase ?? null;
    return jsonResponse({ ...toListRow(workspace, memoryPhase), memoryStatus });
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
