import { jsonResponse, jsonStringResponse } from "../http-helpers.js";
import { httpHandler } from './http-handler.js';
/**
 * Issues route module — Effect HttpRouter.Layer (PAN-428 B6)
 *
 * Implements all /api/issues/* endpoints from the Express server:
 *   GET  /api/issues
 *   GET  /api/issues/:id/analyze
 *   POST /api/issues/:id/plan
 *   POST /api/issues/:issueId/close
 *   POST /api/issues/:id/start-planning
 *   POST /api/issues/:id/abort-planning
 *   POST /api/issues/:id/complete-planning
 *   POST /api/issues/:id/abort
 *   POST /api/issues/:id/reset
 *   POST /api/issues/:id/reset-to-planned
 *   POST /api/issues/:id/cancel
 *   POST /api/issues/:id/reopen
 *   POST /api/issues/:id/move-status
 *   POST /api/issues/:id/cleanup-workspace
 *   POST /api/issues/:id/deep-wipe
 *   POST /api/issues/:id/close-out
 *   GET  /api/issues/:id/tasks
 *   POST /api/issues/:id/tasks/:taskId/inspect
 *   GET  /api/issues/:id/costs
 */

import { exec, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnPlanningSession, type PlanningIssue } from '../../../lib/planning/spawn-planning-session.js';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { spawnInspectAgent } from '../../../lib/cloister/inspect-agent.js';
import { createInFlightGuard } from '../../../lib/cloister/in-flight-guard.js';

import { Duration, Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeamSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../lib/issue-id.js';
import { isPlanningComplete, readPlanSync } from '../../../lib/vbrief/io.js';
import { appendContinueSessionEntryForIssue } from '../../../lib/vbrief/lifecycle-io.js';
import {
  completePlanningForIssue,
} from '../../../lib/overdeck/planning-promotion.js';
import {
  abortPlanningForIssue,
  getPlanningState,
  restartFromPlan,
  startPlanningForIssue,
} from '../../../lib/overdeck/planning-sessions.js';
import { generateTasksForIssue } from '../../../lib/overdeck/task-generation.js';
import { loadWorkspaceMetadataSync as loadWorkspaceMetadataStatic } from '../../../lib/remote/workspace-metadata.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared, resolveTrackerTypeSync } from '../../../lib/tracker-utils.js';
import { clearReviewStatus, getReviewStatusSync } from '../review-status.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { validateOrigin } from './origin-validation.js';
import { reopenWorkspaceState } from '../../../lib/reopen.js';
import { getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import { getCostForIssueAggregateSync } from '../../../lib/overdeck/cost-sync.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
import { CacheService } from '../services/cache-service.js';
import { EventStoreService } from '../services/domain-services.js';
import { resolveIssueHeadlineCost } from '../services/issue-cost-resolver.js';
import { getCachedRunningAgents } from '../services/running-agents-cache.js';
import { invalidateAgentsCache } from './agents.js';
import { IssueLifecycle, type IssueState } from '../services/issue-lifecycle.js';
import { LinearClient } from '../services/linear-client.js';
import { GitHubClient, type GitHubClientError, type GitHubClientShape, type GitHubIssue } from '../services/github-client.js';
import { RallyClient } from '../services/rally-client.js';
import { TrackerApiError } from '../services/typed-errors.js';
import { killSession, listSessionNames, sessionExists } from '../../../lib/tmux.js';
import { getAgentState, getAgentStateSync, saveAgentStateSync, getProviderAuthMode, normalizeAgentId } from '../../../lib/agents.js';
import { loadRemoteAgentState } from '../../../lib/remote/remote-agents.js';
import { saveAgentStateAndEmitEvent, saveAgentStateAndEmitEventProgram } from '../services/agent-projection.js';
import { countPendingAskUserQuestionsForAgent } from '../../../lib/agent-enrichment.js';
import { canUseHarnessSync } from '../../../lib/harness-policy.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../../lib/activity-logger.js';
import type { LifecycleContext, StepResult, WorkflowResult } from '../../../lib/lifecycle/types.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { operatorInterventionEvent } from '../../../lib/operator-interventions.js';
import {
  getCachedResourceAllocatedIssues,
  getResourceDetailIdentifiers,
  sanitizeResourceAllocatedIssues,
} from '../services/resource-discovery.js';
import {
  fetchIssueCheckRuns,
  fetchIssuePullRequest,
  fetchIssuePullRequestDetails,
  fetchIssuePullRequestDiff,
} from '../../../lib/overdeck/pull-requests.js';
import { fetchIssueDiscussions } from '../../../lib/overdeck/discussions.js';
import {
  cleanupAgentStateDirs,
  cleanupWorkspaceForIssue,
  copySettingsToWorkspace,
  deepWipeIssue,
  removeCompletionMarker,
} from '../../../lib/overdeck/workspace-hygiene.js';
import {
  abortIssueTransition,
  cancelIssueTransition,
  closeIssueTransition,
  moveIssueStatus,
  reopenIssueTransition,
  resetIssueTransition,
} from '../../../lib/overdeck/issue-transitions.js';
import { bulkCloseOut, closeOutIssue } from '../../../lib/overdeck/issue-close-out.js';
import { DOD_ROWS, type DodRowId } from '../../../lib/lifecycle/dod.js';
import {
  analyzeIssue,
  getIssueTasks,
  getIssueResourceDetails,
  getResourceAllocatedIssues,
  inspectIssueTask,
} from '../../../lib/overdeck/issue-reads.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// Started by main.ts on boot. Updates flow through the ReadModel via
// onIssuesChanged callback → event store → WebSocket RPC.

function getIssueDataService(): IssueDataService {
  return getSharedIssueService();
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueShared(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function getGitHubLocalPaths(): Record<string, string> {
  const ghConfig = getGitHubConfig();
  if (!ghConfig) return {};
  const out: Record<string, string> = {};
  for (const r of ghConfig.repos) {
    const localPath = (r as { localPath?: unknown }).localPath;
    if (typeof localPath === 'string') {
      out[`${r.owner}/${r.repo}`] = localPath;
    }
  }
  return out;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// ─── Route: GET /api/issues ───────────────────────────────────────────────────

const getIssuesRoute = HttpRouter.add(
  'GET',
  '/api/issues',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const searchParams = urlOpt.value.searchParams;
    const cycle = searchParams.get('cycle') ?? undefined;
    const includeCompleted = searchParams.get('includeCompleted') === 'true';

    const issueDataService = getIssueDataService();
    return jsonStringResponse(issueDataService.getIssuesJson({ cycle, includeCompleted }));
  })),
);

// ─── Route: GET /api/issues/:id/analyze ──────────────────────────────────────

const getIssueAnalyzeRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/analyze',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    return yield* analyzeIssue(id);
  })),
);

// ─── Route: GET /api/issues/:id/ship-log ─────────────────────────────────────
// PAN-2487: live Ship-phase progress — door steps + quality-gate lines for the
// cockpit's Ship panel (the merge runs server-side; no agent session to open).
const getIssueShipLogRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/ship-log',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      const { getShipLog } = await import('../../../lib/cloister/ship-log.js');
      const { getReviewStatusSync } = await import('../../../lib/review-status.js');
      const log = getShipLog(id);
      const rs = getReviewStatusSync(id);
      return jsonResponse({
        issueId: id.toUpperCase(),
        mergeStatus: rs?.mergeStatus ?? null,
        mergeStep: rs?.mergeStep ?? null,
        log,
      });
    });
  })),
);

// ─── Route: GET /api/issues/:id/verification ─────────────────────────────────
// PAN-2665: the Test/Lint tree node's live view — the per-workspace
// verification artifact (written incrementally while gates run) plus the
// review-status verificationStatus, polled by the panel while running.
const getIssueVerificationRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/verification',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      const { readVerificationArtifact } = await import('../../../lib/cloister/verification-artifact.js');
      const { getReviewStatusSync } = await import('../../../lib/review-status.js');
      const { join } = await import('node:path');
      const resolved = resolveProjectFromIssueSync(id);
      const workspacePath = resolved
        ? join(resolved.projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
        : null;
      const artifact = workspacePath ? readVerificationArtifact(workspacePath) : null;
      const rs = getReviewStatusSync(id.toUpperCase());
      return jsonResponse({
        issueId: id.toUpperCase(),
        verificationStatus: rs?.verificationStatus ?? null,
        artifact,
      });
    });
  })),
);

// ─── Route: POST /api/issues/:issueId/close ──────────────────────────────────

const postIssueCloseRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/close',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    return yield* closeIssueTransition({ issueId, body, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/start-planning ──────────────────────────────

const postIssueStartPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/start-planning',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const github = yield* GitHubClient;
    const rally = yield* RallyClient;
    const lifecycle = yield* IssueLifecycle;

    return yield* startPlanningForIssue({ id, body, eventStore, linear, github, rally, lifecycle });
  })),
);

// ─── Route: POST /api/issues/:id/abort-planning ──────────────────────────────

const postIssueAbortPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort-planning',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;
    const eventStore = yield* EventStoreService;

    return yield* abortPlanningForIssue({ id, body, lifecycle, linear, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/complete-planning ───────────────────────────

const postIssueCompletePlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/complete-planning',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const lifecycle = yield* IssueLifecycle;
    return yield* Effect.promise(() => completePlanningForIssue({
      request,
      id,
      body,
      eventStore,
      linear,
      lifecycle,
    }));
  })),
);

// ─── Route: POST /api/issues/:id/abort ───────────────────────────────────────

const postIssueAbortRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const eventStore = yield* EventStoreService;

    return yield* abortIssueTransition({ id, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/reset ───────────────────────────────────────

const postIssueResetRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reset',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    return yield* resetIssueTransition({ id, body, eventStore });
  })),
);

const postIssueResetToPlannedRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reset-to-planned',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    try {
      const { stdout } = yield* Effect.promise(() => execFileAsync('pan', ['reset-to-planned', id], { encoding: 'utf8' }));
      invalidateAgentsCache();
      return jsonResponse({ success: true, message: stdout.trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, { status: 500 });
    }
  })),
);

// ─── Route: POST /api/issues/:id/cancel ──────────────────────────────────────

const postIssueCancelRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cancel',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    return yield* cancelIssueTransition({ id, body, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/reopen ──────────────────────────────────────

const postIssueReopenRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reopen',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;
    const eventStore = yield* EventStoreService;

    return yield* reopenIssueTransition({ id, body, lifecycle, linear, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/restart-from-plan ────────────────────────────

const postIssueRestartFromPlanRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/restart-from-plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const lifecycle = yield* IssueLifecycle;
    const eventStore = yield* EventStoreService;

    return yield* restartFromPlan({ id, lifecycle, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/move-status ─────────────────────────────────

const postIssueMoveStatusRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/move-status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;

    return yield* moveIssueStatus({ id, body, eventStore, lifecycle });
  })),
);

// ─── Route: POST /api/issues/:id/cleanup-workspace ───────────────────────────

const postIssueCleanupWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cleanup-workspace',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const eventStore = yield* EventStoreService;
    return yield* Effect.promise(() => cleanupWorkspaceForIssue(rawId, eventStore));
  })),
);

// ─── Route: POST /api/issues/:id/deep-wipe ───────────────────────────────────

const postIssueDeepWipeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/deep-wipe',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    return yield* Effect.promise(() => deepWipeIssue(id, body, eventStore));
  })),
);

// ─── Route: POST /api/issues/:id/copy-settings ───────────────────────────────

const postIssueCopySettingsRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/copy-settings',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return yield* Effect.promise(() => copySettingsToWorkspace(id));
  })),
);

// ─── Route: POST /api/issues/:id/close-out ───────────────────────────────────

const postIssueCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/close-out',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const text = yield* request.text;
    let body: { acceptedRows?: unknown } = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const validRows = DOD_ROWS.filter(row => row.overridable).map(row => row.id);
    if (body.acceptedRows !== undefined && (
      !Array.isArray(body.acceptedRows) ||
      body.acceptedRows.some(row => typeof row !== 'string' || !validRows.includes(row as DodRowId))
    )) {
      return jsonResponse({ error: `Invalid acceptedRows; valid ids: ${validRows.join(', ')}`, validRows }, { status: 400 });
    }
    return yield* closeOutIssue(id, {
      acceptedRows: (body.acceptedRows ?? []) as DodRowId[],
      acceptedBy: 'dashboard-operator',
    });
  })),
);

// ─── Route: POST /api/issues/bulk-close-out ──────────────────────────────────

const postIssuesBulkCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/bulk-close-out',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const text = yield* request.text;
    const body: Record<string, unknown> = (() => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } })();
    return yield* bulkCloseOut(body);
  })),
);

// ─── Route: GET /api/issues/:id/tasks ────────────────────────────────────────

const getIssueTasksRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/tasks',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* getIssueTasks(id);
  })),
);

// ─── Route: POST /api/issues/:id/tasks/:taskId/inspect ───────────────────────

const postIssueTaskInspectRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/tasks/:itemId/inspect',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const id = (params['id'] ?? '').toUpperCase();
    const itemId = params['itemId'] ?? '';
    const body = yield* readJsonBody;
    return yield* inspectIssueTask({ id, itemId, body });
  })),
);

// ─── Route: GET /api/issues/:id/planning-state ───────────────────────────────
//
// Lightweight summary of an issue's planning artifacts:
//   { hasPlan, hasTasks, tasksCount }
// Used by kanban cards to color the vBRIEF/Tasks chips and decide whether to
// show "Generate Tasks" instead of "Tasks". Cheap so it can be polled per-card.

const getIssuePlanningStateRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/planning-state',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* getPlanningState(id);
  })),
);

// ─── Route: POST /api/issues/:id/generate-tasks ──────────────────────────────
//
// Runs createTasksFromVBrief() against the workspace. Same logic as
// `pan plan finalize`, exposed so the
// dashboard can offer a one-click "Generate Tasks" action when a vBRIEF plan
// exists but tasks were never created (e.g. plans authored before the
// agent-driven finalize flow shipped).

const postIssueGenerateTasksRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/generate-tasks',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* generateTasksForIssue(id);
  })),
);

const getIssuePrRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssuePullRequest(id));
    return jsonResponse(result);
  })),
);

const getIssuePrDiffRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr/diff',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssuePullRequestDiff(id));
    return jsonResponse(result);
  })),
);

const getIssuePrDetailsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr/details',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssuePullRequestDetails(id));
    return jsonResponse(result);
  })),
);

const getIssueCheckRunsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/check-runs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssueCheckRuns(id));
    return jsonResponse(result);
  })),
);

const getIssueDiscussionsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/discussions',
  httpHandler(Effect.gen(function* () {
    const linear = yield* LinearClient;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const linearGetIssueId = async (ref: string): Promise<string | null> => {
      try {
        const issue = await Effect.runPromise(linear.getIssue(ref));
        return issue.id;
      } catch {
        return null;
      }
    };
    const linearGetComments = async (uuid: string) => {
      try {
        const comments = await Effect.runPromise(linear.getComments(uuid));
        return comments.map((c) => ({
          author: c.author,
          body: c.body,
          createdAt: c.createdAt,
        }));
      } catch {
        return [];
      }
    };

    const result = yield* Effect.promise(() =>
      fetchIssueDiscussions(id, { linearGetIssueId, linearGetComments }),
    );
    return jsonResponse(result);
  })),
);

// ─── Route: GET /api/issues/:id/costs ────────────────────────────────────────

const getIssueCostsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/costs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issueData = getCostForIssueAggregateSync(id);
    const agents = yield* Effect.promise(() => getCachedRunningAgents());
    const resolvedCost = resolveIssueHeadlineCost({
      issueId: id,
      aggregateCost: issueData?.totalCost,
      agents,
    });

    if (!issueData) {
      return jsonResponse({
        issueId: id.toUpperCase(),
        totalCost: 0,
        resolvedTotalCost: resolvedCost.resolvedTotalCost,
        aggregateCost: resolvedCost.aggregateCost,
        liveCost: resolvedCost.liveCost,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        models: {},
        providers: {},
        byModel: {},
        sessions: [],
        byStage: {},
        budget: undefined,
        budgetWarning: false,
      });
    }

    return jsonResponse({
      issueId: id.toUpperCase(),
      totalCost: issueData.totalCost,
      resolvedTotalCost: resolvedCost.resolvedTotalCost,
      aggregateCost: resolvedCost.aggregateCost,
      liveCost: resolvedCost.liveCost,
      totalTokens: issueData.inputTokens + issueData.outputTokens + issueData.cacheReadTokens + issueData.cacheWriteTokens,
      inputTokens: issueData.inputTokens,
      outputTokens: issueData.outputTokens,
      cacheReadTokens: issueData.cacheReadTokens,
      cacheWriteTokens: issueData.cacheWriteTokens,
      models: issueData.models,
      providers: issueData.providers,
      byModel: Object.fromEntries(
        Object.entries(issueData.models).map(([model, stats]: [string, any]) => [
          model,
          { cost: stats.cost, tokens: stats.tokens },
        ])
      ),
      sessions: (issueData as unknown as { sessions?: unknown[] }).sessions ?? [],
      byStage: Object.fromEntries(
        Object.entries(issueData.stages || {}).map(([stage, stats]: [string, any]) => [
          stage,
          { cost: stats.cost, tokens: stats.tokens },
        ])
      ),
      budget: undefined,
      budgetWarning: issueData.budgetWarning,
      lastUpdated: issueData.lastUpdated,
    });
  })),
);

const getResourceAllocatedIssuesRoute = HttpRouter.add(
  'GET',
  '/api/issues/resource-allocated',
  httpHandler(Effect.gen(function* () {
    return yield* getResourceAllocatedIssues();
  })),
);

const getIssueResourceDetailsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/resource-details',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    return yield* getIssueResourceDetails(rawId);
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const issuesRouteLayer = Layer.mergeAll(
  getIssuesRoute,
  getIssueAnalyzeRoute,
  getIssueShipLogRoute,
  getIssueVerificationRoute,
  postIssueCloseRoute,
  postIssueStartPlanningRoute,
  postIssueAbortPlanningRoute,
  postIssueCompletePlanningRoute,
  postIssueAbortRoute,
  postIssueResetRoute,
  postIssueResetToPlannedRoute,
  postIssueCancelRoute,
  postIssueReopenRoute,
  postIssueRestartFromPlanRoute,
  postIssueMoveStatusRoute,
  postIssueCleanupWorkspaceRoute,
  postIssueDeepWipeRoute,
  postIssueCopySettingsRoute,
  postIssueCloseOutRoute,
  postIssuesBulkCloseOutRoute,
  getIssueTasksRoute,
  postIssueTaskInspectRoute,
  getIssuePlanningStateRoute,
  postIssueGenerateTasksRoute,
  getIssueCostsRoute,
  getResourceAllocatedIssuesRoute,
  getIssueResourceDetailsRoute,
  getIssuePrRoute,
  getIssuePrDiffRoute,
  getIssuePrDetailsRoute,
  getIssueCheckRunsRoute,
  getIssueDiscussionsRoute,
);

export default issuesRouteLayer;
