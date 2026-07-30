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
import { getProjectByKey, getWorkspaceById, listProjectTargets, listWorkspaces } from '../../../lib/workspaces/resolver.js';
import {
  archiveWorkspace,
  relocateWorkspace,
  setWorkspaceFavorite,
  touchWorkspaceAccessed,
  unarchiveWorkspace,
  updateWorkspaceLayout,
} from '../../../lib/workspaces/writer.js';
import {
  performWorkspaceCreate,
  resolveWorkspaceCreateIntent,
  type WorkspaceCreateInput,
} from '../../../lib/workspaces/create.js';
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

/**
 * Read the creation-intent fields out of a request body. Everything is
 * optional at this layer — the shared core is the single validator, so an
 * absent or wrong-typed field becomes a finding rather than a 400 here.
 */
function toCreateInput(body: Record<string, unknown>): WorkspaceCreateInput {
  const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
  return {
    name: str(body.name),
    kind: body.bootstrapMain === true ? 'main' : 'scratch',
    projectKey: str(body.project),
    targetPath: str(body.targetPath),
    isolated: body.isolated === true,
    parentBranch: str(body.parentBranch),
  };
}

// ─── GET /api/workspace-registry/project-targets ────────────────────────────
// Registered BEFORE the `/:id` detail route: `project-targets` is a literal
// that would otherwise be captured as an id.

const getWorkspaceRegistryProjectTargetsRoute = HttpRouter.add(
  'GET',
  '/api/workspace-registry/project-targets',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const projectKey = new URL(request.url, 'http://localhost').searchParams.get('project') ?? '';
    if (!projectKey) return jsonResponse({ error: 'project is required' }, { status: 400 });
    const project = getProjectByKey(projectKey);
    if (!project) return jsonResponse({ error: `No project registered with key '${projectKey}'` }, { status: 400 });
    return jsonResponse({ primaryPath: project.primaryPath, targets: listProjectTargets(projectKey) });
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

// ─── POST /api/workspace-registry/resolve ───────────────────────────────────

/**
 * Dry-run the creation intent. A POST because it carries a JSON body, but it
 * MUST stay write-free — the dialog calls it on every settled keystroke, and
 * its whole value is that the preview is produced by the same code the real
 * create runs (PAN-3330 D-2/NFR-6).
 */
const postWorkspaceRegistryResolveRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/resolve',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = (yield* readJsonBody) as Record<string, unknown> | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    const intent = yield* Effect.promise(() => resolveWorkspaceCreateIntent(toCreateInput(body)));
    return jsonResponse(intent);
  })),
);

// ─── POST /api/workspace-registry ───────────────────────────────────────────

const postWorkspaceRegistryCreateRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = (yield* readJsonBody) as Record<string, unknown> | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    // Resolved server-side from the raw intent — never from a client-supplied
    // resolved intent, which could otherwise name any path on the box.
    const intent = yield* Effect.promise(() => resolveWorkspaceCreateIntent(toCreateInput(body)));
    if (intent.findings.length > 0) return jsonResponse({ findings: intent.findings }, { status: 422 });
    const created = yield* Effect.promise(() => performWorkspaceCreate(intent));
    return jsonResponse({ id: created.id }, { status: 201 });
  })),
);

// ─── POST /api/workspace-registry/:id/relocate ──────────────────────────────

const postWorkspaceRegistryRelocateRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/relocate',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const body = (yield* readJsonBody) as { path?: unknown; force?: unknown } | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    if (typeof body.path !== 'string' || !body.path) return jsonResponse({ error: 'path is required' }, { status: 400 });
    // The writer owns the refusal rules (archived, issue-kind, main without
    // force); surface its message as a 409 rather than restating them here.
    const failure = yield* Effect.promise(() =>
      relocateWorkspace(id, body.path as string, { force: body.force === true })
        .then(() => null)
        .catch((err: unknown) => (err instanceof Error ? err.message : String(err))),
    );
    if (failure) return jsonResponse({ error: failure }, { status: 409 });
    return jsonResponse({ ok: true });
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
  // Literal-path routes precede `/:id`, which would otherwise capture them.
  getWorkspaceRegistryProjectTargetsRoute,
  postWorkspaceRegistryResolveRoute,
  postWorkspaceRegistryCreateRoute,
  postWorkspaceRegistryRelocateRoute,
  getWorkspaceRegistryDetailRoute,
  getWorkspaceRegistryMemoryRoute,
  postWorkspaceRegistryActivateRoute,
  postWorkspaceRegistryArchiveRoute,
  postWorkspaceRegistryFavoriteRoute,
  putWorkspaceRegistryLayoutRoute,
);
export default workspaceRegistryRouteLayer;
