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
import { createHash } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getWorkspaceById, listWorkspaces } from '../../../lib/workspaces/resolver.js';
import {
  archiveWorkspace,
  setWorkspaceFavorite,
  setWorkspaceRunCommand,
  touchWorkspaceAccessed,
  unarchiveWorkspace,
  updateWorkspaceLayout,
} from '../../../lib/workspaces/writer.js';
import { createSession, sessionExists } from '../../../lib/tmux.js';
import { getProjectSync } from '../../../lib/projects.js';
import { openInEditor, openPath } from '../../../lib/browser.js';
import { getOpenInEditorCommand } from '../../../lib/config-yaml/load.js';
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodePath from '@effect/platform-node/NodePath';
import type { WorkspaceGitState, WorkspaceRow } from '../../../lib/workspaces/types.js';
import { getWorkspaceGitState, pullWorkspaceFastForward } from '../../../lib/workspaces/git-state.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { readCurrentStatus, readRecentObservations } from '../../../lib/memory/rollup.js';

export interface WorkspacePipelineBadge {
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  verificationStatus?: string;
  readyForMerge?: boolean;
}

/**
 * The public list DTO deliberately OMITS `runCommand` (PAN-3331 review): a run
 * command is executable text an operator may have embedded a token in, and the
 * list read is unauthenticated. Command text is served only by the
 * authenticated detail route and the already-guarded run-command write.
 */
export interface WorkspaceListRow extends Omit<WorkspaceRow, 'runCommand'> {
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
  // Destructured out rather than deleted afterwards, so a future field added to
  // WorkspaceRow cannot silently leak through a forgotten delete.
  const { runCommand: _runCommand, ...publicFields } = workspace;
  return { ...publicFields, pipeline: pipelineBadgeForWorkspace(workspace), memoryPhase };
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
    // Authenticated because this is the one read that returns executable command
    // text — the stored run command plus every configured start_command.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const memoryStatus = (yield* Effect.promise(() => readCurrentStatus(workspace.projectId, workspace.id).catch(() => undefined))) ?? null;
    // Same rule as the list route: issue rows carry no memoryPhase, even though
    // the detail route reads their full status for the memory panel.
    const memoryPhase = workspace.kind === 'issue' ? null : memoryStatus?.phase ?? null;
    // The band's run card needs both what it would run today and what else the
    // project offers, so it can show a placeholder and a service picker.
    const runCommandOptions = runCommandOptionsFor(workspace);
    const editorCommand = yield* getOpenInEditorCommand();
    return jsonResponse({
      ...toListRow(workspace, memoryPhase),
      memoryStatus,
      runCommand: workspace.runCommand,
      runCommandDefault: runCommandOptions[0]?.command ?? null,
      runCommandOptions,
      // The band hides "Open in editor" entirely when no template is configured.
      openInEditorConfigured: editorCommand !== null,
    });
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

// ─── GET /api/workspace-registry/:id/git ────────────────────────────────────

/**
 * Fetch throttling, per workspace path. A card that judges freshness from refs
 * nobody refreshed is lying, so the GET route fetches — but at most once per
 * FETCH_MIN_INTERVAL_MS, so a 30s poll (or several open views) cannot turn into
 * a fetch storm.
 *
 * Two clocks, deliberately: `lastFetchAttemptByPath` is claimed BEFORE the fetch
 * is awaited so overlapping requests cannot each start one, while
 * `lastFetchSuccessByPath` is what `fetchedAt` reports — a failed fetch must
 * hold the throttle window (don't hammer a broken remote) without claiming the
 * data is fresh.
 */
const lastFetchAttemptByPath = new Map<string, number>();
const lastFetchSuccessByPath = new Map<string, number>();
/** In-flight fetches, so concurrent callers share one `git fetch` per path. */
const inFlightFetchByPath = new Map<string, Promise<WorkspaceGitState>>();
const FETCH_MIN_INTERVAL_MS = 30_000;

function fetchIsDue(path: string, now: number): boolean {
  const last = lastFetchAttemptByPath.get(path);
  return last === undefined || now - last >= FETCH_MIN_INTERVAL_MS;
}

function withFreshness(state: WorkspaceGitState, path: string): WorkspaceGitState {
  return { ...state, fetchedAt: state.fetchedAt ?? lastFetchSuccessByPath.get(path) ?? null };
}

/**
 * Reads state, fetching first when the caller asked and the throttle allows.
 * `fetchedAt` reports the last successful fetch for this path — not only the one
 * this call performed — so a throttled read still shows honest freshness.
 */
async function readGitState(path: string, wantFetch: boolean): Promise<WorkspaceGitState> {
  if (wantFetch) {
    // A fetch already running for this checkout is the fetch this caller wanted.
    const inFlight = inFlightFetchByPath.get(path);
    if (inFlight) return withFreshness(await inFlight, path);

    if (fetchIsDue(path, Date.now())) {
      // Claim the window before awaiting anything: two requests that arrive in
      // the same tick would otherwise both see a stale timestamp and each spawn
      // a `git fetch` against the same refs.
      lastFetchAttemptByPath.set(path, Date.now());
      const run = getWorkspaceGitState(path, { fetch: true })
        .then((state) => {
          if (state.fetchedAt !== null) lastFetchSuccessByPath.set(path, state.fetchedAt);
          return state;
        })
        .finally(() => { inFlightFetchByPath.delete(path); });
      inFlightFetchByPath.set(path, run);
      return withFreshness(await run, path);
    }
  }
  return withFreshness(await getWorkspaceGitState(path, { fetch: false }), path);
}

const getWorkspaceRegistryGitRoute = HttpRouter.add(
  'GET',
  '/api/workspace-registry/:id/git',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // Authenticated: `fetch=1` reaches out to the remote and rewrites
    // remote-tracking refs, so this read has a side effect worth protecting.
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    if (!workspace.isGitRepository) return jsonResponse({ git: null });
    const wantFetch = new URL(request.url, 'http://localhost').searchParams.get('fetch') === '1';
    const git = yield* Effect.promise(() => readGitState(workspace.path, wantFetch));
    return jsonResponse({ git });
  })),
);

// ─── POST /api/workspace-registry/:id/pull ──────────────────────────────────

const postWorkspaceRegistryPullRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/pull',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    if (!workspace.isGitRepository) {
      return jsonResponse({ error: `Workspace is not a git repository: ${id}` }, { status: 400 });
    }
    // Issue workspaces keep their existing semantics: sync-main merges main into
    // the feature branch with its own dirty-tree and quiescence handling. This
    // route never touches them — the band routes their button there instead.
    if (workspace.kind === 'issue') {
      return jsonResponse({
        error: 'Issue workspaces sync through sync-main, not fast-forward pull.',
        syncMainUrl: workspace.issueId ? `/api/issues/${workspace.issueId}/sync-main` : null,
      }, { status: 409 });
    }
    const result = yield* Effect.promise(() => pullWorkspaceFastForward(workspace.path));
    if (!result.ok) {
      return jsonResponse(
        { error: result.detail, reason: result.reason },
        { status: result.reason === 'error' ? 500 : 409 },
      );
    }
    // The pull itself contacted the remote, so it counts as a fetch.
    const pulledAt = Date.now();
    lastFetchAttemptByPath.set(workspace.path, pulledAt);
    lastFetchSuccessByPath.set(workspace.path, pulledAt);
    return jsonResponse({ git: { ...result.state, fetchedAt: pulledAt } });
  })),
);

// ─── Run command: PUT /:id/run-command, POST /:id/run ───────────────────────

/**
 * The run command lands in a tmux session's argv, not in a shell string we
 * build — but the async `createSession` (unlike the deprecated sync one) does
 * no validation of its own, so commands that would break the session are
 * refused at the door instead.
 */
const MAX_RUN_COMMAND_LENGTH = 500;

function invalidRunCommandReason(command: string): string | null {
  if (command.length === 0) return 'Run command is empty.';
  if (command.length > MAX_RUN_COMMAND_LENGTH) {
    return `Run command exceeds ${MAX_RUN_COMMAND_LENGTH} characters.`;
  }
  if (/[\n\r`]/.test(command)) return 'Run command cannot contain newlines or backticks.';
  return null;
}

/** Every `services[].start_command` the workspace's project configures, in config order. */
function runCommandOptionsFor(workspace: WorkspaceRow): Array<{ name: string; command: string }> {
  const services = getProjectSync(workspace.projectId)?.workspace?.services ?? [];
  return services
    .filter((service) => typeof service.start_command === 'string' && service.start_command.length > 0)
    .map((service) => ({ name: service.name, command: service.start_command }));
}

/** The command the Run button would use: the operator's override, else the first configured service. */
function resolveRunCommand(workspace: WorkspaceRow): string | null {
  if (workspace.runCommand) return workspace.runCommand;
  return runCommandOptionsFor(workspace)[0]?.command ?? null;
}

/**
 * Deterministic per workspace, so a reload finds the live session instead of
 * spawning a second one — and UNIQUE per workspace, so one workspace can never
 * re-focus, stop, or kill another's process.
 *
 * A sanitized prefix of the id is not safe for this: stripping characters is
 * not injective (`ws-a-b` and `wsab` collapse together) and truncating makes
 * collisions likely, so two ids sharing their first eight alphanumerics used to
 * share one session. A sha256 prefix is injective enough at 64 bits, fixed
 * length, and stable across restarts.
 */
function runSessionName(workspaceId: string): string {
  return `ws-run-${createHash('sha256').update(workspaceId).digest('hex').slice(0, 16)}`;
}

const putWorkspaceRegistryRunCommandRoute = HttpRouter.add(
  'PUT',
  '/api/workspace-registry/:id/run-command',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const body = (yield* readJsonBody) as { command?: unknown } | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    if (body.command !== null && typeof body.command !== 'string') {
      return jsonResponse({ error: 'command must be a string or null' }, { status: 400 });
    }
    // An empty string is the operator clearing the override back to the default.
    const trimmed = typeof body.command === 'string' ? body.command.trim() : null;
    const command = trimmed === null || trimmed === '' ? null : trimmed;
    if (command !== null) {
      const reason = invalidRunCommandReason(command);
      if (reason) return jsonResponse({ error: reason }, { status: 400 });
    }
    setWorkspaceRunCommand(id, command);
    const updated = getWorkspaceById(id) ?? { ...workspace, runCommand: command };
    return jsonResponse({
      ...toListRow(updated),
      // Echoed back explicitly: toListRow omits command text from the public
      // DTO, and this route is already session+CSRF guarded.
      runCommand: updated.runCommand,
      runCommandDefault: runCommandOptionsFor(updated)[0]?.command ?? null,
      runCommandOptions: runCommandOptionsFor(updated),
    });
  })),
);

const postWorkspaceRegistryRunRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/run',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const command = resolveRunCommand(workspace);
    if (!command) {
      return jsonResponse({
        error: 'No run command configured for this workspace.',
        runCommandOptions: runCommandOptionsFor(workspace),
      }, { status: 400 });
    }
    const reason = invalidRunCommandReason(command);
    if (reason) return jsonResponse({ error: reason }, { status: 400 });

    // One live run session per workspace: a second Run re-focuses the first
    // rather than stacking duplicate servers on the same port.
    const sessionName = runSessionName(id);
    if (yield* sessionExists(sessionName)) {
      return jsonResponse({ sessionName, command, alreadyRunning: true }, { status: 409 });
    }
    yield* createSession(sessionName, workspace.path, command, {
      env: { PATH: process.env.PATH || '' },
    });
    return jsonResponse({ sessionName, command });
  })),
);

// ─── POST /api/workspace-registry/:id/open ──────────────────────────────────

const spawnerLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const postWorkspaceRegistryOpenRoute = HttpRouter.add(
  'POST',
  '/api/workspace-registry/:id/open',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // Guarded because it spawns a process on the operator's machine.
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const workspace = getWorkspaceById(id);
    if (!workspace) return jsonResponse({ error: `Workspace not found: ${id}` }, { status: 404 });
    const body = (yield* readJsonBody) as { target?: unknown } | undefined;
    if (body === undefined) return jsonResponse({ error: 'Malformed JSON body' }, { status: 400 });
    const target = body.target;
    if (target !== 'file-manager' && target !== 'editor') {
      return jsonResponse({ error: "target must be 'file-manager' or 'editor'" }, { status: 400 });
    }
    // These await the opener's exit rather than returning at spawn. That is
    // deliberate: it is what surfaces "cursor: not found" to the operator
    // instead of a silent 200. The openers used here (open/xdg-open/explorer,
    // and every GUI editor launcher) return immediately. If a future template
    // names a foreground process, the fix is a spawn-and-detach primitive in
    // browser.ts — NOT Effect.timeout here, which interrupts the effect and
    // would kill the child the operator just asked for.
    if (target === 'file-manager') {
      yield* openPath(workspace.path).pipe(Effect.provide(spawnerLayer));
      return jsonResponse({ ok: true, target, path: workspace.path });
    }
    const template = yield* getOpenInEditorCommand();
    if (!template) {
      return jsonResponse({
        error: 'No editor configured. Set ui.open_in_editor_command in ~/.overdeck/config.yaml (e.g. "cursor {path}").',
      }, { status: 409 });
    }
    yield* openInEditor(template, workspace.path).pipe(Effect.provide(spawnerLayer));
    return jsonResponse({ ok: true, target, path: workspace.path });
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
  getWorkspaceRegistryGitRoute,
  postWorkspaceRegistryPullRoute,
  putWorkspaceRegistryRunCommandRoute,
  postWorkspaceRegistryRunRoute,
  postWorkspaceRegistryOpenRoute,
  postWorkspaceRegistryActivateRoute,
  postWorkspaceRegistryArchiveRoute,
  postWorkspaceRegistryFavoriteRoute,
  putWorkspaceRegistryLayoutRoute,
);
export default workspaceRegistryRouteLayer;
