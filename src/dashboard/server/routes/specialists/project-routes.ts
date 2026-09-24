import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { getClaudePermissionFlagsString } from '../../../../lib/claude-permissions.js';
import { normalizeModelName } from '../../../../lib/cost-parsers/jsonl-parser.js';
import { calculateCost, getPricing, type TokenUsage } from '../../../../lib/cost.js';
import { loadConfigSync, resolveModel } from '../../../../lib/config-yaml.js';
import { encodeClaudeProjectDir } from '../../../../lib/runtimes/storage/claude-code.js';
import { resolvePrimaryWorkspaceRepoDir, resolveWorkspaceRepoRoots } from '../../../../lib/project-repos.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { getAgentCommand } from '../../../../lib/settings.js';
import { killSession } from '../../../../lib/tmux.js';
import { getAgentState, saveAgentRuntimeState } from '../../../../lib/agents.js';
import type { AgentState } from '../../../../lib/agents/agent-state.js';
import { PAN_DIRNAME } from '../../../../lib/pan-dir/types.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from '../../../../lib/cloister/review-monitor.js';
import { jsonResponse } from '../../http-helpers.js';
import { getDerivedIssueState } from '../../services/derived-issue-state.js';
import { httpHandler } from '../http-handler.js';
import { execAsync, readJsonBody, validateSpecialistAgentName } from './shared.js';

// ─── Route: GET /api/specialists/:project/:issueId/:type/status ───────────────
//
// PAN-1048 review feedback 003 (REQ-16): the legacy specialist-status route
// returned metadata sourced from ~/.overdeck/specialists/registry.json, which
// the role-primitive refactor explicitly retires. The startup cleanup in
// service.ts deletes that directory on every boot; preserving the read path
// would silently recreate it via getRunMetadata() → loadRegistry()/saveRegistry().
//
// The route is now a 410 Gone with a pointer to the role-aware status surface.
// The frontend's only caller (AgentOutputPanel) only fires when
// parseSpecialistSession(agentId) matches the legacy `specialist-…` session
// naming, which the new role spawns no longer use, so the dead-letter response
// is invisible to current dashboards.

const getProjectSpecialistStatusRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:issueId/:type/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    return jsonResponse(
      {
        error: 'specialist-status route retired',
        hint: 'Specialist identity is replaced by the role primitive. Use GET /api/agents and read the role/status fields off the AgentSnapshot for the role-scoped session (e.g. agent-pan-509-review).',
        retiredFor: {
          project: params['project'],
          issueId: params['issueId'],
          type: params['type'],
        },
      },
      { status: 410 },
    );
  })),
);

// ─── Route: POST /api/specialists/:project/:issueId/:type/kill ───────────────

const postProjectSpecialistKillRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/:type/kill',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const issueId = params['issueId'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { getTmuxSessionName, makeSpecialistRegistryKey, getRunMetadata } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));

    const registryKey = makeSpecialistRegistryKey(type, issueId);
    const tmuxSession = getRunMetadata(project, registryKey).tmuxSession
      ?? getTmuxSessionName(type, project, issueId);

    yield* Effect.promise(() => Effect.runPromise(killSession(tmuxSession)).catch(() => {}));
    // Leave Claude JSONL/session artifacts intact; only reset Overdeck runtime state.
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    return jsonResponse({
      success: true,
      message: `Killed ${type} (${project}/${issueId})`,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/spawn ───────────────────────
//
// PAN-1048 R1: removed. The legacy /spawn endpoint dispatched arbitrary
// "specialist types" (review-agent, test-agent, merge-agent) by issuing a
// generic spawnEphemeralSpecialist call. Under the role primitive, review/test
// dispatch through lifecycle-aware role paths. Shipping is now server-side;
// `ship` remains only as the merge-specialist identity for model routing and
// historical activity attribution. The endpoint had no remaining in-tree caller
// and is replaced by reactive Cloister scheduling on issue state transitions
// plus the role spawn primitive.
//
// Old shape (removed):
//   POST /api/specialists/:project/:type/spawn { issueId, branch, ... }
//
// Replacement: drive role spawns via lifecycle.transitionTo() and the
// reactive scheduler in src/lib/cloister/service.ts.

// ─── Route: POST /api/specialists/:project/:type/runs/:runId/terminate ────────

const postProjectSpecialistRunTerminateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/runs/:runId/terminate',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { terminateSpecialist } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    yield* Effect.promise(() => terminateSpecialist(project, type));
    return jsonResponse({ success: true, message: 'Specialist terminated' });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/complete ─────────────────────

const postProjectSpecialistCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/complete',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const body = yield* readJsonBody;
    const { status, notes, issueId } = body as { status?: string; notes?: string; issueId?: string };

    if (!status || !['passed', 'failed', 'blocked'].includes(status)) {
      return jsonResponse(
        { error: 'Valid status (passed/failed/blocked) is required' },
        { status: 400 },
      );
    }

    if (!validateSpecialistAgentName(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { signalSpecialistCompletion } =
      yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    signalSpecialistCompletion(project, type, { status: status as 'passed' | 'failed' | 'blocked', notes }, issueId);
    return jsonResponse({
      success: true,
      message: 'Specialist completion signaled, grace period started',
    });
  })),
);

// ─── Route: POST /api/specialists/projects/:project/:name/reset-session ───────
// Bumps the session generation so the next dispatch starts a fresh Claude session.
// Old JSONL files are preserved.

const postProjectSpecialistResetSessionRoute = HttpRouter.add(
  'POST',
  '/api/specialists/projects/:project/:name/reset-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const projectKey = params['project'] ?? '';
    const name = params['name'] ?? '';
    return jsonResponse(
      { error: `Legacy specialist session rotation is no longer supported for ${projectKey}/${name}.` },
      { status: 410 },
    );
  })),
);

// ─── Route: POST /api/specialists/:project/:issueId/review/restart ───────────
// Stops the review parent and convoy sessions, then resumes the parent through
// the role primitive. Saved sessions and completed reports stay intact; same-run
// recovery re-dispatches only reviewer lanes that have not produced a report.
// A model or harness change still takes the existing fresh-spawn path.

const postProjectReviewRestartRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/review/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const issueId = params['issueId'] as string;
    const body = yield* readJsonBody;
    const { model, harness } = body as { model?: string; harness?: 'claude-code' | 'pi' | 'codex' };

    const { killAllReviewerSessions } = yield* Effect.promise(
      () => import('../../../../lib/cloister/review-agent.js'),
    );
    const killResult = yield* Effect.promise(() => killAllReviewerSessions(project, issueId));

    // PAN-1862: do NOT wipe here. The review session (state.json + saved session id) is preserved
    // so spawnReviewRoleForIssue can RESUME it — keeping the prior review's context so a restart
    // with the same model checks the fix instead of re-researching the whole diff. It wipes +
    // fresh-spawns internally ONLY when the harness/model actually changed.

    // Resolve workspace info for re-dispatch
    const projectConfig = resolveProjectFromIssueSync(issueId);
    if (!projectConfig) {
      return jsonResponse({ error: `Cannot resolve project for ${issueId}` }, { status: 404 });
    }
    const workspacePath = join(projectConfig.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: `Workspace not found: ${workspacePath}` }, { status: 404 });
    }

    // Detect branch from the primary code repo; fall back to configured source branch.
    const primaryRepo = resolveWorkspaceRepoRoots(issueId, workspacePath)[0];
    let branch = primaryRepo.sourceBranch;
    try {
      const { stdout } = yield* Effect.promise(() => execAsync(
        'git branch --show-current',
        { cwd: resolvePrimaryWorkspaceRepoDir(issueId, workspacePath), encoding: 'utf-8', timeout: 5000 },
      ));
      branch = stdout.trim() || primaryRepo.sourceBranch;
    } catch { /* non-fatal */ }

    // PAN-1048 R3: review now spawns through the role primitive.
    const { spawnReviewRoleForIssue } = yield* Effect.promise(
      () => import('../../../../lib/cloister/review-agent.js'),
    );
    // PAN-3917: the PR is the forge's, read through the derived issue state.
    const prUrl = (yield* Effect.promise(() => getDerivedIssueState(issueId))).pr?.url;
    const result = yield* spawnReviewRoleForIssue({
      issueId,
      workspace: workspacePath,
      branch,
      prUrl,
      model,
      harness,
    });

    if (result.gated) {
      return jsonResponse({
        success: false,
        gated: true,
        message: result.message,
        killed: killResult.killed,
        wiped: [],
        model: model ?? undefined,
        harness: harness ?? undefined,
      }, { status: 409 });
    }

    return jsonResponse({
      success: result.success,
      message: result.message,
      killed: killResult.killed,
      wiped: [],
      model: model ?? undefined,
      harness: harness ?? undefined,
    });
  })),
);

/**
 * The review parent's active run, recovered from its workspace artifacts.
 *
 * PAN-3917 (FR-7): review rounds are files under `<workspace>/.pan/review/<runId>/`,
 * so the run id is recoverable from disk when the runtime registry lost it.
 * Fail-closed: recovery only fires when exactly one run directory postdates the
 * parent's start, and it never writes anything back.
 */
async function resolveReviewParentRunState(
  parent: AgentState,
): Promise<(AgentState & { reviewRunId?: string }) | null> {
  if (!parent.workspace) return null;
  if (parent.reviewRunId) return parent;

  const startedAt = Date.parse(parent.startedAt);
  if (!Number.isFinite(startedAt)) return null;

  const reviewRoot = join(parent.workspace, PAN_DIRNAME, 'review');
  let entries;
  try {
    entries = await readdir(reviewRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${parent.id}-`)) continue;
    try {
      const runStat = await stat(join(reviewRoot, entry.name));
      if (runStat.mtimeMs >= startedAt) candidates.push(entry.name);
    } catch { /* raced away */ }
  }
  if (candidates.length !== 1) return null;

  const runId = candidates[0]!;
  const contextManifestPath = join(reviewRoot, runId, 'context.json');
  return {
    ...parent,
    reviewRunId: runId,
    ...(existsSync(contextManifestPath) ? { reviewContextManifestPath: contextManifestPath } : {}),
  };
}

// ─── Route: POST /api/specialists/:project/:issueId/reviewer/:role/restart ───
//
// PAN-3368: convoy reviewers are independent role sessions again. Restarting one
// lane preserves completed sibling reports and gives operators the surgical recovery
// that the CLI's long-advertised --role flag promises.

const postProjectReviewerRoleRestartRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/reviewer/:role/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] as string).toUpperCase();
    const role = params['role'] as string;
    if (!(REVIEW_SUB_ROLES as readonly string[]).includes(role)) {
      return jsonResponse(
        { error: `Invalid reviewer role: ${role}`, allowed: REVIEW_SUB_ROLES },
        { status: 400 },
      );
    }

    const parentId = `agent-${issueId.toLowerCase()}-review`;
    const reviewerId = `${parentId}-${role}`;
    const parentState = getAgentState(parentId);
    const parent = parentState
      ? yield* Effect.promise(() => resolveReviewParentRunState(parentState))
      : null;
    if (!parent?.reviewRunId || !parent.workspace) {
      return jsonResponse(
        { error: `Active review run not found for ${issueId}` },
        { status: 409 },
      );
    }

    const body = yield* readJsonBody;
    const { model } = body as { model?: string };
    const reviewer = getAgentState(reviewerId);
    yield* Effect.promise(() => Effect.runPromise(killSession(reviewerId)).catch(() => undefined));

    const { spawnReviewSubRoleForIssue } = yield* Effect.promise(
      () => import('../../../../lib/cloister/review-agent.js'),
    );
    const spawnOptions = {
      issueId,
      workspace: parent.workspace,
      subRole: role as ReviewSubRole,
      runId: parent.reviewRunId,
      ...(reviewer?.reviewRunId === parent.reviewRunId && reviewer.reviewOutputPath
        ? { outputPath: reviewer.reviewOutputPath }
        : {}),
      contextManifestPath: parent.reviewContextManifestPath,
      synthesisAgentId: parentId,
      ...(model ? { model } : {}),
      allowHost: parent.hostOverride ?? false,
    };
    const result = yield* Effect.promise(() => spawnReviewSubRoleForIssue(spawnOptions));

    return jsonResponse(
      {
        success: result.success,
        message: result.message,
        error: result.error,
        restarted: role,
      },
      result.success ? undefined : { status: 500 },
    );
  })),
);

// ─── Route: GET /api/models/resolve ──────────────────────────────────────────
// Returns the resolved default model for each session/work type.

const getModelsResolveRoute = HttpRouter.add(
  'GET',
  '/api/models/resolve',
  httpHandler(Effect.gen(function* () {
    const config = loadConfigSync().config;

    const routes = [
      { key: 'role:plan', role: 'plan' },
      { key: 'role:work', role: 'work' },
      { key: 'role:strike', role: 'strike' },
      { key: 'role:review', role: 'review' },
      { key: 'role:review.correctness', role: 'review', subRole: 'correctness' },
      { key: 'role:review.security', role: 'review', subRole: 'security' },
      { key: 'role:review.performance', role: 'review', subRole: 'performance' },
      { key: 'role:review.requirements', role: 'review', subRole: 'requirements' },
      { key: 'role:test', role: 'test' },
      { key: 'role:ship', role: 'ship' },
    ] as const;

    const resolved: Record<string, string | null> = {};
    for (const route of routes) {
      try {
        resolved[route.key] = resolveModel(route.role, (route as { subRole?: string }).subRole, config);
      } catch {
        resolved[route.key] = null;
      }
    }

    return jsonResponse(resolved);
  })),
);

export const specialistsProjectRouteLayer = Layer.mergeAll(
  // PAN-1048 R1: postProjectSpecialistSpawnRoute removed (see above).
  getProjectSpecialistStatusRoute,
  postProjectSpecialistKillRoute,
  postProjectSpecialistRunTerminateRoute,   // /runs/:runId/terminate
  postProjectSpecialistCompleteRoute,       // /complete
  postProjectSpecialistResetSessionRoute,  // /reset-session
  postProjectReviewRestartRoute,           // /:project/:issueId/review/restart
  postProjectReviewerRoleRestartRoute,     // /:project/:issueId/reviewer/:role/restart
  getModelsResolveRoute,                   // /models/resolve
);
