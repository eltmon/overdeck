import { jsonResponse } from "../http-helpers.js";
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
 *   POST /api/issues/:id/cancel
 *   POST /api/issues/:id/reopen
 *   POST /api/issues/:id/move-status
 *   POST /api/issues/:id/cleanup-workspace
 *   POST /api/issues/:id/deep-wipe
 *   POST /api/issues/:id/close-out
 *   GET  /api/issues/:id/beads
 *   POST /api/issues/:id/beads/:beadId/inspect
 *   GET  /api/issues/:id/costs
 */

import { exec, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnPlanningSession, resolveAutoSpawnOnFinalize, type PlanningIssue } from '../../../lib/planning/spawn-planning-session.js';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { withBdMutex } from '../../../lib/bd-mutex.js';
import { spawnInspectAgent } from '../../../lib/cloister/inspect-agent.js';
import { createInFlightGuard } from '../../../lib/cloister/in-flight-guard.js';

import { Duration, Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeamSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../lib/issue-id.js';
import { findPlan, findWorkspaceDraftPlan, isPlanningComplete, readPlanSync, readPlan } from '../../../lib/vbrief/io.js';
import { assertPlanQuality, PlanQualityLintError } from '../../../lib/vbrief/quality-lint.js';
import { appendContinueSessionEntryForIssue } from '../../../lib/vbrief/lifecycle-io.js';
import { checkPrdGateSync, asPanSpecDocument, findSpecByIssue, writeSpec, writeSpecForIssue } from '../../../lib/pan-dir/index.js';
import type { CreateBeadsResult } from '../../../lib/vbrief/beads.js';
import { loadWorkspaceMetadataSync as loadWorkspaceMetadataStatic } from '../../../lib/remote/workspace-metadata.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared, resolveTrackerTypeSync } from '../../../lib/tracker-utils.js';
import { clearReviewStatus, getReviewStatusSync } from '../review-status.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { validateOrigin } from './origin-validation.js';
import { reopenWorkspaceState } from '../../../lib/reopen.js';
import { getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import { syncCacheSync, getCostsForIssueSync } from '../../../lib/costs/index.js';
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

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// Started by main.ts on boot. Updates flow through the ReadModel via
// onIssuesChanged callback → event store → WebSocket RPC.

function getIssueDataService(): IssueDataService {
  return getSharedIssueService();
}

// ─── Exported async cleanup helpers (used by routes + tests) ─────────────────

export async function cleanupAgentStateDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
}

export async function removeCompletionMarker(markerPath: string): Promise<void> {
  if (existsSync(markerPath)) await rm(markerPath);
}

export interface CompletePlanningAutoSpawnResult {
  workAgentSpawned: boolean;
  workAgentSession?: string;
  workAgentError?: string;
  workAgentSkipReason?: 'stack-unhealthy' | 'guardrails' | 'paused' | 'troubled' | 'spawn-failed';
}

type CompletePlanningPhase = 'prdGate' | 'beadsMaterialize' | 'specWrite' | 'autoSpawn' | 'terminal';
type CompletePlanningPhaseStatus = 'start' | 'success' | 'failure' | 'skipped';

const completePlanningGuard = createInFlightGuard();

export function beginCompletePlanningLease(issueId: string): { started: boolean; release: () => void } {
  const key = issueId.toLowerCase();
  let release!: () => void;
  const lease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = completePlanningGuard.run(key, () => lease);
  return { started, release: started ? release : () => undefined };
}

function emitCompletePlanningPhase(
  issueId: string,
  phase: CompletePlanningPhase,
  status: CompletePlanningPhaseStatus,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  const timestamp = new Date().toISOString();
  emitActivityEntrySync({
    source: 'complete-planning',
    level: status === 'failure' ? 'error' : status === 'skipped' ? 'warn' : 'info',
    message: `complete-planning.phase=${phase}`,
    issueId: issueId.toUpperCase(),
    details: JSON.stringify({ issueId: issueId.toUpperCase(), timestamp, phase, status, reason, ...details }),
  });
}

export async function completePlanningArtifacts(options: {
  projectPath: string;
  workspacePath: string;
  issueId: string;
  createBeads?: (workspacePath: string) => Promise<CreateBeadsResult> | Effect.Effect<CreateBeadsResult, unknown>;
}): Promise<{ proposed: { path: string; filename: string }; beadCount: number; beadsWarning: string | null }> {
  const { projectPath, workspacePath, issueId } = options;
  const issueLower = issueId.toLowerCase();
  const upperIssueId = issueId.toUpperCase();
  const workspacePlanPath = await Effect.runPromise(Effect.gen(function* () {
    return (yield* findWorkspaceDraftPlan(workspacePath)) ?? (yield* findPlan(workspacePath));
  }));
  if (!workspacePlanPath) {
    throw new Error(`No workspace vBRIEF found for ${upperIssueId} at ${workspacePath}/.pan/spec.vbrief.json`);
  }

  const workspaceDoc = await Effect.runPromise(readPlan(workspacePlanPath));
  const workspaceIssueId = workspaceDoc.plan?.id;
  if (workspaceIssueId && workspaceIssueId.toLowerCase() !== issueLower) {
    throw new Error(`Workspace vBRIEF is for ${workspaceIssueId.toUpperCase()}, not ${upperIssueId}`);
  }
  assertPlanQuality(workspaceDoc);

  const createBeads = options.createBeads ?? (async (path: string) => {
    const mod = await import('../../../lib/vbrief/beads.js');
    return (await Effect.runPromise(mod.createBeadsFromVBrief(path)));
  });

  emitCompletePlanningPhase(upperIssueId, 'specWrite', 'start', 'writing proposed vBRIEF spec', { projectPath });
  const existingSpec = await Effect.runPromise(findSpecByIssue(projectPath, upperIssueId));
  const previousSpecContents = existingSpec ? await readFile(existingSpec.path, 'utf-8').catch(() => null) : null;
  let proposed: { path: string; filename: string };
  try {
    proposed = existingSpec
      ? await (async () => {
          const nextDoc = asPanSpecDocument(workspaceDoc, 'proposed');
          await Effect.runPromise(writeSpec(existingSpec.path, nextDoc));
          return { path: existingSpec.path, filename: existingSpec.filename };
        })()
      : await Effect.runPromise(writeSpecForIssue(projectPath, workspaceDoc, 'proposed')).then((e) => ({ path: e.path, filename: e.filename }));
    emitCompletePlanningPhase(upperIssueId, 'specWrite', 'success', 'proposed vBRIEF spec written', {
      path: proposed.path,
      filename: proposed.filename,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emitCompletePlanningPhase(upperIssueId, 'specWrite', 'failure', reason, { projectPath });
    throw error;
  }

  emitCompletePlanningPhase(upperIssueId, 'beadsMaterialize', 'start', 'materializing beads from proposed vBRIEF', { workspacePath });
  const rawBeadsResult = createBeads(workspacePath);
  const beadsResult = Effect.isEffect(rawBeadsResult)
    ? await Effect.runPromise(rawBeadsResult)
    : await rawBeadsResult;
  const created = beadsResult.created ?? [];
  const errors = beadsResult.errors ?? [];
  const planItemCount = workspaceDoc.plan.items?.length ?? 0;
  if (planItemCount === 0 || !beadsResult.success || created.length !== planItemCount) {
    if (existingSpec && previousSpecContents !== null) {
      await writeFile(existingSpec.path, previousSpecContents, 'utf-8');
    } else if (!existingSpec) {
      await rm(proposed.path, { force: true });
      await rm(dirname(proposed.path), { force: true }).catch(() => undefined);
    }
    const detail = errors.length > 0
      ? errors.join('; ')
      : `created ${created.length} beads for ${planItemCount} plan items`;
    emitCompletePlanningPhase(upperIssueId, 'beadsMaterialize', 'failure', detail, {
      workspacePath,
      beadCount: created.length,
      planItemCount,
    });
    throw new Error(`Failed to materialize beads for ${upperIssueId}: ${detail}`);
  }
  emitCompletePlanningPhase(upperIssueId, 'beadsMaterialize', 'success', 'beads materialized', {
    workspacePath,
    beadCount: created.length,
    planItemCount,
  });

  return { proposed, beadCount: created.length, beadsWarning: null };
}

export function completePlanningFilesToStage(projectPath: string, proposedFilename: string): string[] {
  const filesToStage = [`.pan/specs/${proposedFilename}`];
  if (existsSync(join(projectPath, '.pan', 'context', 'codebase'))) {
    filesToStage.push('.pan/context/codebase/');
  }
  return filesToStage;
}

export function completePlanningWorkspaceGitAddCommands(gitRoot: string): string[][] {
  const commands: string[][] = [];
  if (existsSync(join(gitRoot, '.pan'))) {
    commands.push(['add', '.pan/']);
  }
  if (existsSync(join(gitRoot, '.beads'))) {
    commands.push(['add', '.beads/']);
  }
  return commands;
}

function getInternalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

function classifyAutoSpawnSkip(status: number, body: Record<string, unknown>): NonNullable<CompletePlanningAutoSpawnResult['workAgentSkipReason']> {
  const error = typeof body['error'] === 'string' ? body['error'] : '';
  if (body['stackHealth'] || /workspace docker stack/i.test(error)) return 'stack-unhealthy';
  if (body['paused'] === true) return 'paused';
  if (body['troubled'] === true) return 'troubled';
  if (body['guardrails'] || body['requiresAcknowledgement'] === true || status === 409) return 'guardrails';
  return 'spawn-failed';
}

export async function completePlanningAutoSpawn(options: {
  issueId: string;
  autoSpawn?: boolean;
  fetchImpl?: typeof fetch;
  dashboardOrigin?: string;
}): Promise<CompletePlanningAutoSpawnResult | null> {
  if (options.autoSpawn !== true) {
    emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'skipped', 'autoSpawn not requested');
    return null;
  }

  const dashboardOrigin = options.dashboardOrigin ?? getInternalDashboardOrigin();
  emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'start', 'posting work-agent spawn request', { dashboardOrigin });
  try {
    const response = await (options.fetchImpl ?? fetch)(new URL('/api/agents', dashboardOrigin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: dashboardOrigin,
      },
      body: JSON.stringify({ issueId: options.issueId, role: 'work' }),
    });

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const agentId = typeof body['agentId'] === 'string'
      ? body['agentId']
      : `agent-${options.issueId.toLowerCase()}`;

    if (response.ok && body['success'] !== false) {
      emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'success', 'work agent spawn requested', { agentId });
      return { workAgentSpawned: true, workAgentSession: agentId };
    }

    const error = typeof body['error'] === 'string'
      ? body['error']
      : typeof body['message'] === 'string'
        ? body['message']
        : `Work agent spawn returned HTTP ${response.status}`;
    const skipReason = classifyAutoSpawnSkip(response.status, body);
    emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'skipped', skipReason, {
      httpStatus: response.status,
      error,
    });

    return {
      workAgentSpawned: false,
      workAgentError: error,
      workAgentSkipReason: skipReason,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'failure', reason, { dashboardOrigin });
    throw error;
  }
}

export async function completePlanningAutoSpawnAndKill(options: {
  issueId: string;
  autoSpawn: boolean;
  skipKill: boolean;
  sessionName: string;
  fetchImpl?: typeof fetch;
  dashboardOrigin?: string;
  killSessionImpl?: (sessionName: string) => Promise<void>;
  scheduleKill?: (callback: () => void, delayMs: number) => unknown;
  logError?: (message?: unknown, ...optionalParams: unknown[]) => void;
}): Promise<CompletePlanningAutoSpawnResult | null> {
  const autoSpawnResult = await completePlanningAutoSpawn({
    issueId: options.issueId,
    autoSpawn: options.autoSpawn,
    fetchImpl: options.fetchImpl,
    dashboardOrigin: options.dashboardOrigin,
  }).catch((error: unknown): CompletePlanningAutoSpawnResult => ({
    workAgentSpawned: false,
    workAgentError: error instanceof Error ? error.message : String(error),
    workAgentSkipReason: 'spawn-failed',
  }));

  if (options.skipKill) return autoSpawnResult;

  const killSessionImpl = options.killSessionImpl ?? ((target: string) => Effect.runPromise(killSession(target)));
  const logError = options.logError ?? console.error;
  const runKill = async (): Promise<void> => {
    try {
      await killSessionImpl(options.sessionName);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/can't find session|session not found|no session found/i.test(msg)) {
        logError(`[complete-planning] deferred kill-session failed for ${options.sessionName}:`, msg);
      }
    }
  };

  if (options.autoSpawn) {
    await runKill();
  } else {
    (options.scheduleKill ?? setTimeout)(() => { void runKill(); }, 1500);
  }

  return autoSpawnResult;
}

// ─── Local helpers ────────────────────────────────────────────────────────────

const START_PLANNING_GITHUB_FETCH_ATTEMPTS = 5;
const START_PLANNING_GITHUB_FETCH_BACKOFF_MS = [250, 500, 750, 1000];

function getGitHubIssueForStartPlanning(
  github: GitHubClientShape,
  owner: string,
  repo: string,
  number: number,
  issueId: string,
  attempt = 1,
): Effect.Effect<GitHubIssue, GitHubClientError> {
  return github.getIssue(owner, repo, number).pipe(
    Effect.catchTag('IssueNotFound', (err) => {
      if (attempt >= START_PLANNING_GITHUB_FETCH_ATTEMPTS) {
        return Effect.fail(new TrackerApiError({
          tracker: 'github',
          message: `could not fetch ${issueId.toUpperCase()} from GitHub after ${START_PLANNING_GITHUB_FETCH_ATTEMPTS} attempts`,
          cause: err,
        }));
      }

      const delayMs = START_PLANNING_GITHUB_FETCH_BACKOFF_MS[
        Math.min(attempt - 1, START_PLANNING_GITHUB_FETCH_BACKOFF_MS.length - 1)
      ] ?? 1000;
      return Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.flatMap(() => getGitHubIssueForStartPlanning(github, owner, repo, number, issueId, attempt + 1)),
      );
    }),
  );
}

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

/** Map Rally child-issue service contract into the planning-context shape. */
export function buildChildStoriesFromRally(
  children: readonly { ref: string; title: string; status: string; description: string }[],
): Array<{ ref: string; title: string; status: string; description: string }> {
  return children.map((c) => ({
    ref: c.ref,
    title: c.title,
    status: c.status,
    description: c.description || '',
  }));
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

async function closeIssuePullRequest(issueId: string, reason = 'Canceled via Overdeck'): Promise<string[]> {
  const githubCheck = isGitHubIssue(issueId);
  if (!githubCheck.isGitHub || !githubCheck.owner || !githubCheck.repo) {
    return ['No GitHub PR to close'];
  }

  const branchName = `feature/${issueId.toLowerCase()}`;
  try {
    const { stdout: prListRaw } = await execFileAsync(
      'gh',
      [
        'pr', 'list',
        '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
        '--head', branchName,
        '--state', 'open',
        '--json', 'number',
        '--jq', '.[0].number',
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const prNumber = prListRaw.trim();
    if (!prNumber) {
      return ['No open PR found for branch'];
    }

    await execFileAsync(
      'gh',
      [
        'pr', 'close', prNumber,
        '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
        '--comment', reason,
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    try {
      const { setReviewStatusSync } = await import('../../../lib/review-status.js');
      setReviewStatusSync(issueId.toUpperCase(), { prUrl: undefined });
    } catch { /* non-fatal — validator catches this downstream */ }
    return [`Closed PR #${prNumber} on ${githubCheck.owner}/${githubCheck.repo}`];
  } catch (err: any) {
    return [`PR close warning: ${err.message}`];
  }
}

function buildLifecycleContext(id: string, issueSource: string | undefined) {
  const issuePrefix = extractTeamPrefix(id);
  const projectPath = getProjectPath(undefined, issuePrefix ?? undefined);
  const projectConfig = issuePrefix ? findProjectByTeamSync(issuePrefix) : null;
  const githubCheck = isGitHubIssue(id);

  const ctx: any = {
    issueId: id,
    projectPath,
    projectName: projectConfig?.name || '',
    ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
      ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
      : {}),
  };

  if (issueSource === 'rally') {
    const rallyConfig = getRallyConfig();
    if (rallyConfig) {
      ctx.rally = {
        apiKey: rallyConfig.apiKey,
        server: rallyConfig.server,
        workspace: rallyConfig.workspace,
        project: rallyConfig.project,
      };
    }
  }

  return { ctx, projectConfig, githubCheck };
}

function isOrphanedIssue(issue: { status?: string; state?: string; rawTrackerState?: string; completedAt?: string | null }): boolean {
  const status = issue.status?.toLowerCase() ?? '';
  const state = issue.state?.toLowerCase() ?? '';
  const rawTrackerState = issue.rawTrackerState?.toLowerCase() ?? '';
  return Boolean(
    issue.completedAt
    || status.includes('closed')
    || status.includes('done')
    || status.includes('completed')
    || state.includes('closed')
    || state.includes('done')
    || state.includes('completed')
    || rawTrackerState.includes('closed')
    || rawTrackerState.includes('done')
    || rawTrackerState.includes('completed'),
  );
}

function getIssueForCleanup(issueId: string) {
  const issueDataService = getIssueDataService();
  return issueDataService.getIssues({ includeCompleted: true }).find((issue: any) => {
    const identifier = typeof issue?.identifier === 'string' ? issue.identifier : '';
    return identifier.toUpperCase() === issueId.toUpperCase();
  }) as {
    status?: string;
    state?: string;
    rawTrackerState?: string;
    completedAt?: string | null;
  } | undefined;
}

async function runDestructiveIssueLifecycle(
  id: string,
  mode: 'reset' | 'cancel',
  opts: { deleteWorkspace?: boolean; onProgress?: (data: Record<string, unknown>) => void } = {},
): Promise<{ success: boolean; cleanupLog: string[]; error?: string }> {
  const cleanupLog: string[] = [];
  const issueDataService = getIssueDataService();
  const issueSource = issueDataService.getIssueSource(id);
  const { ctx, projectConfig } = buildLifecycleContext(id, issueSource ?? undefined);
  const deleteWorkspace = opts.deleteWorkspace ?? true;

  cleanupLog.push(...await closeIssuePullRequest(
    id,
    mode === 'cancel' ? 'Canceled via Overdeck' : 'Reset to Todo via Overdeck',
  ));

  const { resetToTodo, cancelIssueWorkflow } = await import('../../../lib/lifecycle/index.js');
  const workflow = mode === 'cancel' ? cancelIssueWorkflow : resetToTodo;
  const result = await Effect.runPromise(workflow(ctx, {
    deleteWorkspace,
    deleteBranches: deleteWorkspace,
    resetIssue: true,
    workspaceConfig: projectConfig?.workspace,
    projectName: projectConfig?.name || '',
    onProgress: opts.onProgress ? (event) => opts.onProgress?.({ type: 'progress', ...event }) : undefined,
  }));

  cleanupLog.push(...result.steps.flatMap((step: any) => step.details || [step.error].filter(Boolean)));

  // vBRIEF lifecycle transition for cancel (PAN-946): move to cancelled/ on main.
  if (mode === 'cancel') {
    try {
      const { transitionVBriefOnMain } = await import('../../../lib/vbrief/lifecycle-io.js');
      const tx = await Effect.runPromise(transitionVBriefOnMain(
        ctx.projectPath,
        id,
        'cancelled',
        'cancelled',
        `scope: cancel ${id.toUpperCase()} vBRIEF`,
      ));
      if (tx.moved) cleanupLog.push(`vBRIEF moved ${tx.fromDir} → cancelled`);
      if (tx.committed) cleanupLog.push(`Committed vBRIEF cancellation on main`);
    } catch (err: any) {
      cleanupLog.push(`vBRIEF cancel transition failed (non-fatal): ${err?.message ?? err}`);
    }
  }

  // Kill canonical reviewer/synthesis tmux sessions (PAN-915). They persist
  // across review rounds to preserve context, so reset/cancel/deep-wipe is the
  // right place to tear them down — the issue is going back to Todo or being
  // canceled outright.
  try {
    const { killAllReviewerSessions } = await import('../../../lib/cloister/review-agent.js');
    const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
    const resolved = resolveProjectFromIssueSync(id);
    const projectKey = resolved?.projectKey;
    if (projectKey) {
      const { killed } = await Effect.runPromise(killAllReviewerSessions(projectKey, id.toUpperCase()));
      if (killed.length > 0) {
        cleanupLog.push(`Killed ${killed.length} reviewer session(s)`);
      }
    }
  } catch (err) {
    cleanupLog.push(`Reviewer session cleanup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    clearReviewStatus(id.toUpperCase());
    cleanupLog.push('Cleared review status');
  } catch { /* non-fatal */ }

  try {
    const { resetPostMergeState } = await import('../../../lib/cloister/merge-agent.js');
    resetPostMergeState(id);
    resetPostMergeState(id.toUpperCase());
    cleanupLog.push('Cleared merge state');
  } catch { /* non-fatal */ }

  const issueDataServiceAfter = getIssueDataService();
  issueDataServiceAfter.invalidateTracker('github').catch(() => {});
  issueDataServiceAfter.invalidateTracker('linear').catch(() => {});
  issueDataServiceAfter.invalidateTracker('rally').catch(() => {});

  return {
    success: result.success,
    cleanupLog,
    error: result.success ? undefined : result.steps.find((s: any) => !s.success && !s.skipped)?.error,
  };
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
    const issues = issueDataService.getIssues({ cycle, includeCompleted });
    return jsonResponse(issues);
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
    const linear = yield* LinearClient;

    const issue = yield* Effect.promise(() =>
      Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))),
    );

    if (!issue) {
      return jsonResponse({ error: 'Issue not found' }, { status: 404 });
    }

    const desc = (issue.description || '').toLowerCase();
    const title = issue.title.toLowerCase();
    const combined = `${title} ${desc}`;

    const reasons: string[] = [];
    const subsystems: string[] = [];
    let estimatedTasks = 1;

    if (combined.includes('frontend') || combined.includes('ui') || combined.includes('component')) subsystems.push('frontend');
    if (combined.includes('backend') || combined.includes('api') || combined.includes('endpoint')) subsystems.push('backend');
    if (combined.includes('database') || combined.includes('migration') || combined.includes('schema')) subsystems.push('database');
    if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) subsystems.push('tests');

    if (subsystems.length > 1) {
      reasons.push(`Multiple subsystems involved: ${subsystems.join(', ')}`);
      estimatedTasks += subsystems.length;
    }

    const ambiguousPatterns = ['should we', 'maybe', 'or', 'consider', 'option', 'approach', 'tbd', 'unclear'];
    for (const pattern of ambiguousPatterns) {
      if (combined.includes(pattern)) { reasons.push('Requirements may be ambiguous'); break; }
    }

    const architecturePatterns = ['refactor', 'architecture', 'redesign', 'migrate', 'integration', 'authentication'];
    for (const pattern of architecturePatterns) {
      if (combined.includes(pattern)) {
        reasons.push(`Architecture decision needed: ${pattern}`);
        estimatedTasks += 2;
        break;
      }
    }

    if (desc.length > 500) { reasons.push('Detailed description suggests complexity'); estimatedTasks += 1; }

    const labels = issue.labels.map((l) => l.name);
    const complexLabels = ['complex', 'large', 'epic', 'multi-phase', 'architecture'];
    for (const label of labels) {
      if (complexLabels.some((cl: string) => label.toLowerCase().includes(cl))) {
        reasons.push(`Label indicates complexity: ${label}`);
        estimatedTasks += 2;
      }
    }

    const isComplex = reasons.length >= 2 || subsystems.length > 1 || estimatedTasks >= 4;

    return jsonResponse({
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.state.name,
        priority: issue.priority,
        url: issue.url,
        labels,
      },
      complexity: {
        isComplex,
        reasons,
        subsystems,
        estimatedTasks: Math.max(estimatedTasks, subsystems.length + 1),
      },
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

    const { reason } = body as any;
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);

    const { close: closeWorkflow } = yield* Effect.promise(() => import('../../../lib/lifecycle/index.js'));
    const githubCheck = isGitHubIssue(issueId);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(issueId);

    const ctx: any = {
      issueId,
      projectPath,
      ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
        ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
        : {}),
    };

    if (issueSource === 'rally') {
      const rallyConfig = getRallyConfig();
      if (rallyConfig) {
        ctx.rally = {
          apiKey: rallyConfig.apiKey,
          server: rallyConfig.server,
          workspace: rallyConfig.workspace,
          project: rallyConfig.project,
        };
      }
    }

    const result = yield* closeWorkflow(ctx, { reason });

    if (githubCheck.isGitHub) {
      execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 }).catch(() => {});
    }

    // Invalidate tracker caches (fire and forget)
    if (githubCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    if (result.success) {
      yield* eventStore.append({
        type: 'issues.updated',
        timestamp: new Date().toISOString(),
        payload: { issueId },
      });
    }

    return jsonResponse({
      success: result.success,
      message: result.success
        ? `Closed ${issueId}${reason ? ': ' + reason : ''}`
        : `Close failed for ${issueId}`,
      steps: result.steps,
    });
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

    const {
      skipWorkspace = false,
      startDocker = false,
      workspaceLocation = 'local',
      shadowMode = false,
      model: modelOverride,
      effort,
      auto = false,
      autoStart = false,
      probe = false,
      harness = 'claude-code',
    } = body as any;
    const requestedHarness = harness === 'ohmypi' || harness === 'claude-code' || harness === 'codex' ? harness : 'claude-code';

    console.log(`[start-planning] START for ${id}, workspaceLocation=${workspaceLocation}, shadow=${shadowMode}`);

    // TTS announcement so the operator hears the lifecycle without watching the dashboard
    emitActivityEntrySync({
      source: 'plan',
      level: 'info',
      message: `${id} planning agent starting`,
      issueId: id,
    });
    emitActivityTtsSync({
      utterance: `Planning agent starting for ${id}`,
      priority: 2,
      issueId: id,
      source: 'planning-agent',
      eventType: 'planning.started',
    });

    // Clear agents cache so the next dashboard poll sees the new planning agent
    invalidateAgentsCache();

    // Check if a work agent is already running
    const issueLowerForCheck = id.toLowerCase();
    const tmuxSessions = yield* listSessionNames();
    const workAgentSession = tmuxSessions.find((s: string) => s === `agent-${issueLowerForCheck}`);
    if (workAgentSession) {
      return jsonResponse({
        error: `Cannot start planning: work agent already running for ${id.toUpperCase()}`,
        hint: 'Stop the agent first or use the terminal view to interact with it',
        existingSession: workAgentSession,
      }, { status: 409 });
    }

    const trackerTypeForIssue = resolveTrackerTypeSync(id);
    const githubCheck = isGitHubIssue(id);

    let issue: {
      id: string;
      identifier: string;
      title: string;
      description: string;
      url: string;
      source: 'linear' | 'github' | 'rally';
      comments?: Array<{ author: string; body: string; createdAt: string }>;
      artifactType?: string;
      childStories?: Array<{ ref: string; title: string; status: string; description: string }>;
    };
    let newStateName = 'In Planning';

    if (trackerTypeForIssue === 'github' && githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      const ghIssue = yield* getGitHubIssueForStartPlanning(github, owner, repo, number, id);

      const ghConfig = getGitHubConfig();
      const repoConfig = ghConfig?.repos.find((r: any) => r.owner === owner && r.repo === repo);
      const prefix = repoConfig?.prefix || repo.toUpperCase();

      const ghComments = yield* github.getComments(owner, repo, number, 50).pipe(
        Effect.map((cs) => cs.map((c) => ({ author: c.user, body: c.body, createdAt: c.createdAt }))),
        Effect.catch(() => Effect.succeed([] as Array<{ author: string; body: string; createdAt: string }>)),
      );

      issue = {
        id: `github-${owner}-${repo}-${number}`,
        identifier: `${prefix}-${number}`,
        title: ghIssue.title,
        description: ghIssue.body || '',
        url: ghIssue.htmlUrl,
        source: 'github',
        comments: ghComments.length > 0 ? ghComments : undefined,
      };

      // Add "planning" label (ensure it exists, then apply to issue)
      yield* lifecycle.addLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));

    } else if (trackerTypeForIssue === 'rally') {
      const rallyIssue = yield* rally.getIssue(id);

      // Fetch child stories for Rally Features
      let childStories: Array<{ ref: string; title: string; status: string; description: string }> = [];
      if (rallyIssue.artifactType?.includes('PortfolioItem')) {
        const children = yield* rally.getChildIssues(id).pipe(
          Effect.catch(() => Effect.succeed([] as readonly { ref: string; title: string; status: string; description: string }[])),
        );
        childStories = buildChildStoriesFromRally(children);
      }

      issue = {
        id: rallyIssue.id,
        identifier: rallyIssue.ref,
        title: rallyIssue.title,
        description: rallyIssue.description || '',
        url: rallyIssue.url,
        source: 'rally',
        artifactType: rallyIssue.artifactType,
        childStories: childStories.length > 0 ? childStories : undefined,
      };

    } else {
      // Linear
      const linearIssue = yield* linear.getIssue(id);

      issue = {
        id: linearIssue.id,
        identifier: linearIssue.identifier,
        title: linearIssue.title,
        description: linearIssue.description || '',
        url: linearIssue.url,
        source: 'linear',
      };
    }

    const issuePrefix = extractPrefixSync(issue.identifier) ?? issue.identifier.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issue.identifier.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const sessionName = `planning-${issueLower}`;

    // PAN-1048: Write preliminary agent state BEFORE lifecycle.transitionTo so
    // reactive Cloister sees role: 'plan' for this issue the moment it observes
    // the in_planning transition. Writing state.json AFTER transitionTo opened
    // a small race window where Cloister's onIssueStateChange could run
    // activeRoleRunExists() and find no plan agent, then spawn a duplicate
    // planning run via spawnRun (session name 'agent-pan-X-plan') alongside
    // the route's own planning-pan-x session.
    // state.json must declare role: 'plan' — parseAgentState() drops state files
    // lacking a valid role, so writing the legacy type/agentPhase shape would
    // make the dashboard discard this planning session on the next startup scan.
    const agentStateDir = join(homedir(), '.overdeck', 'agents', sessionName);
    yield* Effect.promise(() => mkdir(agentStateDir, { recursive: true }));
    yield* Effect.promise(() => {
      saveAgentStateSync({
        id: sessionName,
        issueId: issue.identifier,
        workspace: workspacePath,
        status: 'starting',
        startedAt: new Date().toISOString(),
        role: 'plan',
        model: '',
      });
      return Promise.resolve();
    });

    // Transition to "In Planning" state — emits issue.transitioned which
    // reactive Cloister consumes. State.json was written above so the
    // observer can see role: 'plan' before mapping in_planning → plan role.
    // PAN-1994: call for ALL tracker types (not just linear). For GitHub
    // issues this cleans up stale labels (merged, verifying-on-main, etc.)
    // left by a prior pipeline cycle when re-planning starts.
    yield* lifecycle.transitionTo(id, 'in_planning').pipe(Effect.catch(() => Effect.void));

    yield* eventStore.append({
      type: 'workspace.created',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, workspacePath },
    });
    yield* eventStore.append({
      type: 'planning.started',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, sessionName, harness: requestedHarness },
    });
    // PAN-1048: lifecycle.transitionTo(id, 'in_planning') above already emits
    // issue.transitioned with state 'in_planning'. The redundant
    // issue.statusChanged emit (formerly broadcasting canonicalStatus
    // 'in_progress', not 'in_planning') was a second source of truth that
    // raced with reactive Cloister: 'in_progress' maps to the work role,
    // so Cloister could spawn a work agent while the planning agent was
    // still being created. Removed in favor of the single transitionTo emit.

    try { getIssueDataService().patchIssue(issue.identifier, { status: newStateName, canonicalStatus: 'in_planning' }); } catch { /* non-fatal */ }

    // SSE stream: await spawnPlanningSession and stream progress events
    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const sendEvent = (data: Record<string, unknown>) => {
          if (closed) {
            console.warn(`[start-planning] SSE event dropped (stream closed):`, JSON.stringify(data).slice(0, 200));
            return;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (err: any) {
            console.error(`[start-planning] SSE enqueue failed:`, err.message);
            closed = true;
          }
        };

        console.log(`[start-planning] SSE stream opened for ${id}`);

        // Send initial metadata
        sendEvent({
          type: 'started',
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            newState: newStateName,
            source: issue.source,
          },
          workspace: { path: workspacePath },
          sessionName,
        });

        try {
          let effectiveHarness = requestedHarness;
          if (typeof modelOverride === 'string' && modelOverride.trim()) {
            const decision = canUseHarnessSync(requestedHarness, modelOverride.trim(), await getProviderAuthMode(modelOverride.trim()));
            if (!decision.allowed) effectiveHarness = 'claude-code';
          }
          const result = await spawnPlanningSession({
            issue: issue as PlanningIssue,
            workspacePath,
            projectPath,
            sessionName,
            workspaceLocation: workspaceLocation as 'local' | 'remote',
            startDocker: body.startDocker,
            shadowMode,
            model: modelOverride || undefined,
            harness: effectiveHarness,
            effort: effort || undefined,
            auto: auto === true,
            probe: probe === true,
            autoSpawnOnFinalize: autoStart === true,
            onProgress: (event) => {
              console.log(`[start-planning] Progress: step=${event.step} label="${event.label}" status=${event.status} detail="${event.detail}"`);
              sendEvent({ type: 'progress', ...event });
            },
          });

          if (result.success) {
            console.log(`[start-planning] SSE complete for ${id}, sessionName=${sessionName}`);
            sendEvent({ type: 'complete', sessionName });
          } else {
            console.error(`[start-planning] SSE error for ${id}: ${result.error}`);
            sendEvent({ type: 'error', error: result.error });
          }
        } catch (streamErr: any) {
          console.error(`[start-planning] SSE stream exception for ${id}:`, streamErr);
          sendEvent({ type: 'error', error: streamErr.message || 'Unexpected error during setup' });
        }

        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
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

    const { deleteWorkspace } = body as any;
    const githubCheck = isGitHubIssue(id);

    let revertedState = 'Todo';
    let issueIdentifier: string | undefined;
    let sessionName: string = `planning-${id.toLowerCase()}`;

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      issueIdentifier = id;
      sessionName = `planning-${id.toLowerCase()}`;
      // Remove planning label via IssueLifecycle
      yield* lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));
      revertedState = 'Todo';
    } else {
      // Resolve issue identifier and session name via LinearClient, then transition to 'open' (Todo)
      const linearIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));

      if (linearIssue) {
        issueIdentifier = linearIssue.identifier;
        sessionName = `planning-${linearIssue.identifier.toLowerCase()}`;
      }

      yield* lifecycle.transitionTo(id, 'open').pipe(Effect.catch(() => Effect.void));
      revertedState = 'Todo';
    }

    // Kill tmux sessions
    yield* killSession(sessionName).pipe(Effect.ignore);
    yield* killSession(`planning-${id.toLowerCase()}`).pipe(Effect.ignore);

    // Clean up agent state files (non-fatal, so absorbed inside the promise)
    const agentStateDir = join(homedir(), '.overdeck', 'agents', sessionName);
    const workAgentStateDir = issueIdentifier
      ? join(homedir(), '.overdeck', 'agents', `agent-${issueIdentifier.toLowerCase()}`)
      : join(homedir(), '.overdeck', 'agents', `agent-${id.toLowerCase()}`);

    yield* Effect.promise(() =>
      cleanupAgentStateDirs([agentStateDir, workAgentStateDir]).catch((cleanupErr: unknown) => {
        console.log('[abort-planning] Warning: Could not clean up agent state:', cleanupErr);
      })
    );

    let workspaceDeleted = false;
    let workspaceError: string | undefined;

    if (deleteWorkspace && issueIdentifier) {
      const wipeResult = yield* Effect.promise(async (): Promise<{ deleted: boolean; error?: string }> => {
        try {
          let projectPath: string | undefined;
          if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
            const localPaths = getGitHubLocalPaths();
            projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`];
          }
          if (!projectPath) {
            const prefix = extractPrefixSync(issueIdentifier!) ?? issueIdentifier!.split('-')[0].toUpperCase();
            const projConfig = findProjectByTeamSync(prefix);
            if (projConfig) projectPath = projConfig.path;
          }

          if (projectPath) {
            const featureWorkspacePath = join(projectPath, 'workspaces', `feature-${issueIdentifier!.toLowerCase()}`);
            const plainWorkspacePath = join(projectPath, 'workspaces', issueIdentifier!.toLowerCase());
            const workspacePath = existsSync(featureWorkspacePath) ? featureWorkspacePath : plainWorkspacePath;

            if (existsSync(workspacePath)) {
              await execFileAsync('pan', ['workspace', 'destroy', issueIdentifier!.toLowerCase(), '--force'], {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
              });
              return { deleted: true };
            } else {
              return { deleted: false, error: 'Workspace not found' };
            }
          } else {
            return { deleted: false, error: 'Could not determine project path' };
          }
        } catch (err: any) {
          return { deleted: false, error: err.message };
        }
      });
      workspaceDeleted = wipeResult.deleted;
      workspaceError = wipeResult.error;
    }

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier || id, status: revertedState, canonicalStatus: 'todo' },
    });
    yield* eventStore.append({
      type: 'workspace.aborted',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier || id, sessionName },
    });
    try { getIssueDataService().patchIssue(issueIdentifier || id, { status: revertedState, canonicalStatus: 'todo' }); } catch { /* non-fatal */ }

    // Clear agents cache so the dashboard stops showing the planning agent as active
    invalidateAgentsCache();

    return jsonResponse({
      success: true,
      issueId: id,
      revertedState,
      sessionKilled: true,
      workspaceDeleted,
      workspacePreserved: !deleteWorkspace && !workspaceDeleted,
      workspaceError,
    });
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

    const skipKill = (body as any)?.skipKill === true;
    // Honor the launch-time --auto-start intent persisted at planning spawn
    // (auto-spawn-on-finalize.json) when the caller doesn't explicitly set
    // autoSpawn. This makes the dashboard "Done" button and host auto-finalize
    // spawn the work agent for sessions launched with --auto-start, matching
    // `pan plan finalize`. An explicit body value always wins.
    const bodyAutoSpawn = (body as any)?.autoSpawn;
    const autoSpawn = resolveAutoSpawnOnFinalize(bodyAutoSpawn, id);
    // PRD-first gate bypass (PAN-2234): `--no-prd` from `pan plan finalize` /
    // `pan plan done` propagates here as body.noPrd. The dashboard Done button
    // never sets it, so a manual Done still requires a qualifying PRD draft.
    const noPrd = (body as any)?.noPrd === true;
    // The origin gate guards the cross-process CLI caller, which sets autoSpawn
    // explicitly in the body and carries a trusted Origin. A flag-derived
    // autoSpawn comes from the same dashboard finalize request the operator
    // already initiated (the rest of complete-planning runs without an origin
    // gate), so don't add a new gate that could 403 a browser whose Origin host
    // lags the rename (e.g. overdeck.localhost not yet in trusted origins).
    if (bodyAutoSpawn === true) {
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const sessionName = `planning-${id.toLowerCase()}`;
    const issueLower = id.toLowerCase();
    const completePlanningLease = beginCompletePlanningLease(id);
    if (!completePlanningLease.started) {
      console.log(`[complete-planning] ${id} already has an in-flight finalize; returning in-flight status`);
      return jsonResponse({
        success: true,
        issueId: id,
        inFlight: true,
        message: 'Planning completion is already in progress for this issue',
      }, { status: 202 });
    }

    try {
      console.log(autoSpawn
        ? `[complete-planning] CALLED for ${id} (skipKill=${skipKill}, autoSpawn=true)`
        : `[complete-planning] CALLED for ${id} (skipKill=${skipKill})`);

    // A planning agent waiting for an operator answer is NOT done. Real callers
    // are pan plan finalize, pan plan done, the PlanDialog Done button, and the
    // kanban Done planning action. Completing while AskUserQuestion is pending
    // would mark the session stopped, which trips the reducer that clears
    // pendingAskUserQuestion (event-reducers.ts), so the dashboard question
    // dialog would vanish the instant it was asked. If there's an unanswered
    // AskUserQuestion, no-op.
    //
    // Scan ALL of the planning session's JSONL files, not just the newest:
    // Claude Code rotates session files mid-run, so the open question can live
    // in a non-active file, and the active-file lookup can transiently fail with
    // ENOENT as files are renamed. Scanning only the active file is exactly how
    // TIN-1 completed planning while the operator's question was still open.
    const pendingAuq = yield* countPendingAskUserQuestionsForAgent(sessionName);
    if (pendingAuq > 0) {
      console.log(`[complete-planning] ${id} has ${pendingAuq} pending AskUserQuestion(s) — agent is waiting for the operator, not done. No-op.`);
      return jsonResponse({ ok: true, skipped: 'pending-ask-user-question' });
    }

    // Detect remote planning session (non-fatal reads)
    const { isRemotePlanning, remoteVmName } = yield* Effect.promise(async (): Promise<{ isRemotePlanning: boolean; remoteVmName: string | null }> => {
      try {
        const remoteState = loadRemoteAgentState(sessionName);
        if (remoteState?.vmName) return { isRemotePlanning: true, remoteVmName: remoteState.vmName };
        const remoteMetadataPath = join(homedir(), '.overdeck', 'agents', sessionName, 'remote-workspace.json');
        if (existsSync(remoteMetadataPath)) {
          const remoteMetadata = JSON.parse(await readFile(remoteMetadataPath, 'utf-8'));
          if (remoteMetadata.vmName) return { isRemotePlanning: true, remoteVmName: remoteMetadata.vmName };
        }
      } catch { /* Not a remote session */ }
      return { isRemotePlanning: false, remoteVmName: null };
    });

    // Session kill is deferred to after the HTTP response is sent. When
    // `pan plan finalize` chains to this endpoint from inside the planning
    // session itself, killing the session synchronously here would kill the
    // caller mid-fetch and they would never see their own success response.
    // Keep this name in scope; we schedule the kill at the very end.

    // Mark planning agent as stopped so KanbanBoard shows "Start Agent" instead of "Watch Planning"
    yield* Effect.promise(async () => {
      try {
        const planningState = getAgentStateSync(sessionName);
        if (planningState) {
          saveAgentStateSync({ ...planningState, status: 'stopped', stoppedAt: new Date().toISOString() });
          console.log(`[complete-planning] Marked ${sessionName} as stopped`);
        }
      } catch { /* Non-fatal — agent status is cosmetic */ }
    });

    // Determine project path
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const teamPrefix = extractTeamPrefix(id);
      const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
      projectPath = projectConfig?.path || '';
    }

    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';
    if (workspacePath) {
      // PRD-first gate (PAN-2234): refuse promotion without a non-trivial PRD
      // draft. Runs before the vBRIEF quality-lint pre-check so a missing PRD
      // short-circuits before any spec read. noPrd bypass is loud (phase event).
      if (noPrd) {
        emitCompletePlanningPhase(id, 'prdGate', 'skipped', 'noPrd bypass requested');
      } else {
        const prdGate = checkPrdGateSync({ projectRoot: projectPath || null, workspacePath, issueId: id });
        if (!prdGate.ok) {
          emitCompletePlanningPhase(id, 'prdGate', 'failure', prdGate.reason ?? 'missing', { prdGate });
          return jsonResponse({ error: `PRD-first gate: no PRD draft for ${id.toUpperCase()}`, prdGate }, { status: 422 });
        }
        emitCompletePlanningPhase(id, 'prdGate', 'success', `found ${prdGate.path} (${prdGate.lineCount} lines)`);
      }

      const workspacePlanPath = yield* Effect.promise(async () =>
        (await Effect.runPromise(findWorkspaceDraftPlan(workspacePath))) ?? (await Effect.runPromise(findPlan(workspacePath)))
      );
      if (workspacePlanPath) {
        const workspaceDoc = yield* readPlan(workspacePlanPath);
        try {
          assertPlanQuality(workspaceDoc);
        } catch (error) {
          if (error instanceof PlanQualityLintError) {
            return jsonResponse({ error: 'vBRIEF quality lint failed', qualityIssues: error.issues }, { status: 422 });
          }
          throw error;
        }
      }
    }

    // Git operations: write planning marker, commit, push (complex nested async — kept as async block)
    const { pushed: gitPushed, beadsWarning } = yield* Effect.promise(async (): Promise<{ pushed: boolean; beadsWarning: string | null }> => {
      if (!projectPath) {
        throw new Error(`Cannot complete planning for ${id}: project path could not be resolved`);
      }

      const gitRoot = workspacePath;
      const upperIssueId = id.toUpperCase();
      const artifacts = await completePlanningArtifacts({ projectPath, workspacePath, issueId: id });
      const { proposed, beadCount, beadsWarning } = artifacts;
      console.log(`[complete-planning] Wrote pan spec to ${proposed.path}`);
      console.log(`[complete-planning] Materialized ${beadCount} beads for ${upperIssueId}`);

      const filesToStage = completePlanningFilesToStage(projectPath, proposed.filename);
      // Polyrepo project roots (e.g. myn) have no .git at projectPath — the
      // sub-worktrees are the repos. Spec promotion still lands on disk; only
      // the convenience commit on main is skipped.
      const projectIsGitRepo = existsSync(join(projectPath, '.git'));
      if (!projectIsGitRepo) {
        console.log(`[complete-planning] Project root ${projectPath} is not a git repository (polyrepo) — pan spec updated on disk but not committed`);
      } else {
        const { stdout: branchStdout } = await execFileAsync(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: projectPath, encoding: 'utf-8' },
        );
        const currentBranch = branchStdout.trim();
        if (currentBranch === 'main') {
          await execFileAsync('git', ['add', '--', ...filesToStage], { cwd: projectPath, encoding: 'utf-8' });
          try {
            await execFileAsync('git', ['diff', '--cached', '--quiet', '--', ...filesToStage], { cwd: projectPath, encoding: 'utf-8' });
          } catch {
            await execFileAsync(
              'git',
              ['commit', '-m', `chore(scope): propose ${upperIssueId} vBRIEF`, '--no-verify', '--', ...filesToStage],
              { cwd: projectPath, encoding: 'utf-8' },
            );
            console.log(`[complete-planning] Committed pan spec on main for ${upperIssueId}`);
            try {
              const { stdout: remotes } = await execFileAsync('git', ['remote'], { cwd: projectPath, encoding: 'utf-8' });
              if (remotes.trim()) {
                const pushChild = spawn('git', ['push'], { cwd: projectPath, detached: true, stdio: 'ignore' });
                pushChild.unref();
              }
            } catch { /* push failed — no remote or auth — non-fatal */ }
          }
        } else {
          console.log(`[complete-planning] Project root not on main (${currentBranch}) — pan spec updated on disk but not committed on main`);
        }
      }

      const isGitRepo = existsSync(join(gitRoot, '.git'));
      if (!isGitRepo) {
        await execFileAsync('git', ['init'], { cwd: gitRoot, encoding: 'utf-8' });
      }

      for (const args of completePlanningWorkspaceGitAddCommands(gitRoot)) {
        await execFileAsync('git', args, { cwd: gitRoot, encoding: 'utf-8' });
      }

      try {
        await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: gitRoot, encoding: 'utf-8' });
      } catch {
        await execFileAsync('git', ['commit', '-m', `chore(plan): complete planning for ${id}`, '--no-verify'], { cwd: gitRoot, encoding: 'utf-8' });
      }

      try {
        const { stdout: remotes } = await execFileAsync('git', ['remote'], { cwd: gitRoot, encoding: 'utf-8' });
        if (remotes.trim()) {
          const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
          pushChild.unref();
        }
        return { pushed: true, beadsWarning };
      } catch {
        return { pushed: false, beadsWarning };
      }
    });

    // Update Linear/GitHub issue state
    let newState = 'Planned';

    // Skip status reset if a work agent is already running — complete-planning fires after
    // planning finishes, but the user may have already clicked "Start Agent". Resetting the
    // issue to Planned would undo that and flash the card back to To Do.
    const workAgentSession = `agent-${issueLower}`;
    const workAgentAlreadyRunning = yield* sessionExists(workAgentSession);
    if (workAgentAlreadyRunning) {
      console.log(`[complete-planning] Work agent ${workAgentSession} is already running — skipping status reset to Planned`);
    }

    // For Linear: check if already in a 'started' state — if so, skip the transition
    let skipStateUpdate = workAgentAlreadyRunning;
    if (!skipStateUpdate && !githubCheck?.isGitHub) {
      const currentIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
      if (currentIssue?.state.name && currentIssue.state.name.toLowerCase() !== 'in planning' && currentIssue.state.name.toLowerCase() !== 'planning') {
        // Check if already in a "started" state by seeing if it's not an unstarted/planning state
        const stateType = yield* linear.getTeamStates(currentIssue.team.id).pipe(
          Effect.map((states) => states.find((s) => s.id === currentIssue.state.id)?.type ?? ''),
          Effect.catch(() => Effect.succeed('')),
        );
        if (stateType === 'started') {
          skipStateUpdate = true;
        }
      }
    }

    if (!skipStateUpdate) {
      if (githubCheck.isGitHub) {
        // GitHub: remove 'planning' label, add 'planned' label
        yield* lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.addLabel(id, 'planned').pipe(Effect.catch(() => Effect.void));
      } else {
        // Linear: transition to 'open' (maps to unstarted — Planned/Todo/Ready)
        const updatedIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
        yield* lifecycle.transitionTo(id, 'open').pipe(Effect.catch(() => Effect.void));
        // Re-fetch to get new state name for response
        const refreshed = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
        newState = refreshed?.state.name ?? (updatedIssue?.state.name ?? 'Planned');
      }
    } else {
      newState = 'Skipped (already in progress)';
    }

    yield* eventStore.append({
      type: 'planning.sync',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'completed' },
    });

    const completeCanonical = newState === 'Skipped (already in progress)' ? 'in_progress' : 'todo';
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: newState, canonicalStatus: completeCanonical },
    });
    try { getIssueDataService().patchIssue(id, { status: newState, canonicalStatus: completeCanonical }); } catch { /* non-fatal */ }

    // Clear agents cache so the dashboard stops showing the planning agent as active
    invalidateAgentsCache();

    // Emit activity + TTS for planning completion
    emitActivityEntrySync({
      source: 'plan',
      level: 'info',
      message: `${id} planning complete — ready for work`,
      issueId: id,
    });
    emitActivityTtsSync({
      utterance: `${id} planning complete, ready for work`,
      priority: 2,
      issueId: id,
      source: 'planning-agent',
      eventType: 'planning.complete',
    });

    // Suppress unused variable warning — remoteVmName used for remote session cleanup if added later
    void isRemotePlanning; void remoteVmName;

    const autoSpawnResult = yield* Effect.promise(() => completePlanningAutoSpawnAndKill({
      issueId: id,
      autoSpawn,
      skipKill,
      sessionName,
    }));
    emitCompletePlanningPhase(id, 'terminal', 'success', autoSpawnResult?.workAgentSpawned ? 'planning complete and work agent spawn requested' : autoSpawnResult?.workAgentSkipReason ?? 'planning complete', {
      autoSpawn,
      workAgentSpawned: autoSpawnResult?.workAgentSpawned ?? false,
      workAgentSkipReason: autoSpawnResult?.workAgentSkipReason,
    });

      return jsonResponse({
        success: true,
        issueId: id,
        newState,
        gitPushed,
        ...(beadsWarning ? { beadsWarning } : {}),
        ...(autoSpawnResult ?? {}),
        message: autoSpawnResult?.workAgentSpawned
          ? 'Planning complete and work agent spawn requested'
          : gitPushed
            ? 'Planning complete and pushed to git - ready for execution'
            : 'Planning complete - ready for execution',
      });
    } finally {
      completePlanningLease.release();
    }
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

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the reset succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeAbort = yield* getAgentState(workAgentId);

    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'reset', { deleteWorkspace: true }));

    if (result.success) {
      // PAN-1908: write-through projection for the real work agent.
      if (workAgentStateBeforeAbort) {
        yield* saveAgentStateAndEmitEventProgram(workAgentStateBeforeAbort, {
          type: 'agent.stopped',
          timestamp: new Date().toISOString(),
          payload: { agentId: workAgentId, issueId: workAgentStateBeforeAbort.issueId },
        }).pipe(Effect.catch(() => Effect.void));
      }
      // Planning sessions are not agents in the runtime registry; keep raw emit.
      yield* eventStore.append({
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: planningAgentId },
      } as any).pipe(Effect.catch(() => Effect.void));
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
      });
      yield* eventStore.append({
        type: 'workspace.destroyed',
        timestamp: new Date().toISOString(),
        payload: { issueId: id },
      });
      try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
    }

    const responseBody = {
      success: result.success,
      message: result.success ? `Reset ${id} to Todo` : `Reset completed with errors for ${id}`,
      cleanupLog: result.cleanupLog,
      error: result.error,
    };
    return result.success
      ? jsonResponse(responseBody)
      : jsonResponse(responseBody, { status: 500 });
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

    const { deleteWorkspace = true } = body as any || {};

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the reset succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeReset = yield* getAgentState(workAgentId);

    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        sendEvent({ type: 'started', issueId: id });

        await Effect.runPromise(eventStore.append({
          type: 'workspace.wipe_started',
          timestamp: new Date().toISOString(),
          payload: { issueId: id },
        }));

        const result = await runDestructiveIssueLifecycle(id, 'reset', {
          deleteWorkspace,
          onProgress: sendEvent,
        });

        if (result.success) {
          // PAN-1908: write-through projection for the real work agent.
          if (workAgentStateBeforeReset) {
            try {
              saveAgentStateAndEmitEvent(workAgentStateBeforeReset, {
                type: 'agent.stopped',
                timestamp: new Date().toISOString(),
                payload: { agentId: workAgentId, issueId: workAgentStateBeforeReset.issueId },
              });
            } catch { /* non-fatal */ }
          }
          // Planning sessions are not agents in the runtime registry; keep raw emit.
          try {
            await Effect.runPromise(eventStore.append({
              type: 'agent.stopped',
              timestamp: new Date().toISOString(),
              payload: { agentId: planningAgentId },
            } as any));
          } catch { /* non-fatal */ }
          await Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
          }));
          await Effect.runPromise(eventStore.append({
            type: 'workspace.destroyed',
            timestamp: new Date().toISOString(),
            payload: { issueId: id },
          }));
          try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
          sendEvent({ type: 'complete', message: `Reset completed for ${id}` });
        } else {
          sendEvent({ type: 'error', error: result.error || 'Reset failed' });
        }
        controller.close();
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
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

    const { wipeWorkspace = true } = body as any;
    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'cancel', { deleteWorkspace: wipeWorkspace }));

    if (result.success) {
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Canceled', canonicalStatus: 'canceled' },
      });
      try { getIssueDataService().patchIssue(id, { status: 'Canceled', canonicalStatus: 'canceled' }); } catch { /* non-fatal */ }
    }

    const responseBody = {
      success: result.success,
      message: result.success ? `Canceled ${id}` : `Cancel completed with errors for ${id}`,
      cleanupLog: result.cleanupLog,
      error: result.error,
    };
    return result.success
      ? jsonResponse(responseBody)
      : jsonResponse(responseBody, { status: 500 });
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

    const { reason: _reason } = body as any || {};
    const githubCheck = isGitHubIssue(id);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(id);

    const reviewStatus = getReviewStatusSync(id.toUpperCase());
    const cachedIssue = issueDataService.getIssues()
      .find((issue: any) => String(issue.identifier ?? issue.id ?? '').toUpperCase() === id.toUpperCase());
    const reopenToVerifying = reviewStatus?.mergeStatus === 'merged' || cachedIssue?.mergeStatus === 'merged';
    const targetState: IssueState = reopenToVerifying ? 'verifying_on_main' : 'in_progress';
    const targetCanonicalStatus = targetState;

    let newState = reopenToVerifying ? 'Verifying on Main' : 'In Progress';
    let issueIdentifier = id;

    yield* lifecycle.transitionTo(id, targetState).pipe(Effect.catch(() => Effect.void));

    if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
      if (!reopenToVerifying) newState = 'Open';

    } else if (githubCheck.isGitHub) {
      if (!reopenToVerifying) {
        yield* lifecycle.removeLabel(id, 'done').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.removeLabel(id, 'needs-close-out').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.removeLabel(id, 'merged').pipe(Effect.catch(() => Effect.void));
      }

      // Reopen closed (not merged) PR for the feature branch if one exists
      yield* Effect.promise(async () => {
        try {
          const branchName = `feature/${id.toLowerCase()}`;
          const { stdout } = await execAsync(
            `gh pr list --head ${branchName} --state closed --json number,mergedAt --limit 1`,
            { encoding: 'utf-8', timeout: 15000 }
          );
          const prs = JSON.parse(stdout.trim() || '[]');
          if (prs.length > 0 && !prs[0].mergedAt) {
            await execAsync(`gh pr reopen ${prs[0].number}`, { encoding: 'utf-8', timeout: 15000 });
            console.log(`[reopen] Reopened PR #${prs[0].number} for ${id}`);
          }
        } catch (err: any) {
          console.warn(`[reopen] Could not reopen PR for ${id}: ${err.message}`);
        }
      });

      issueDataService.invalidateTracker('github').catch(() => {});
      if (!reopenToVerifying) newState = 'In Progress';

    } else {
      const updatedIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
      issueIdentifier = updatedIssue?.identifier ?? id;
      if (!reopenToVerifying) newState = updatedIssue?.state.name ?? 'In Progress';
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    // Reset specialist pipeline state, post-merge state, and agent markers (all non-fatal)
    yield* Effect.promise(async () => {
      // Reset specialist pipeline state, remove from queues, and update continue file
      // via reopenWorkspaceState (shared logic with `pan reopen` CLI command)
      try {
        const teamPrefix = extractTeamPrefix(id);
        const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        const workspacePath = projectPath
          ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
          : '';
        if (workspacePath) {
          await Effect.runPromise(reopenWorkspaceState(id.toUpperCase(), workspacePath, { reason: (body as any)?.reason }));
        } else {
          // Fallback: no workspace path, just clear review status
          clearReviewStatus(id.toUpperCase());
        }
      } catch { /* non-fatal */ }

      // Reset post-merge state
      try {
        const { resetPostMergeState } = await import('../../../lib/cloister/merge-agent.js');
        resetPostMergeState(id);
        resetPostMergeState(id.toUpperCase());
      } catch { /* non-fatal */ }

      // Clear agent completion markers so Deacon doesn't re-dispatch to specialists
      try {
        const agentDir = join(homedir(), '.overdeck', 'agents', `agent-${id.toLowerCase()}`);
        for (const marker of ['completed', 'completed.processed']) {
          const markerPath = join(agentDir, marker);
          await removeCompletionMarker(markerPath);
          if (!existsSync(markerPath)) console.log(`[reopen] Cleared ${marker} marker for ${id}`);
        }
      } catch { /* non-fatal */ }
    });

    // Recreate beads from vBRIEF plan if workspace exists but beads are missing
    const beadsRecreated = yield* Effect.promise(async (): Promise<boolean> => {
      try {
        const issueLower = id.toLowerCase();
        const teamPrefix = extractTeamPrefix(id);
        const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        if (projectPath) {
          const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
          const { createBeadsFromVBrief } = await import('../../../lib/vbrief/beads.js');
          if (existsSync(workspacePath) && await Effect.runPromise(findPlan(workspacePath))) {
            try {
              const { stdout: bdCheck } = await Effect.runPromise(withBdMutex(() => Effect.promise(() => execFileAsync(
                'bd',
                ['list', '--json', '-l', issueLower, '--limit', '1'],
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 },
              ))));
              const existing = JSON.parse(bdCheck.trim() || '[]');
              if (existing.length === 0) {
                const result = await Effect.runPromise(createBeadsFromVBrief(workspacePath));
                if (result.created.length > 0) {
                  console.log(`[reopen] Recreated ${result.created.length} beads for ${id} from vBRIEF plan`);
                  return true;
                }
              }
            } catch { /* Non-fatal — beads recreation is best-effort */ }
          }
        }
      } catch { /* non-fatal */ }
      return false;
    });

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier, status: newState, canonicalStatus: targetCanonicalStatus },
    });
    // Emit pipeline reset so frontend read model clears the stale readyForMerge badge
    yield* eventStore.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        issueId: issueIdentifier,
        status: {
          issueId: issueIdentifier,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
        },
      },
    });
    try { getIssueDataService().patchIssue(issueIdentifier, { status: newState, canonicalStatus: targetCanonicalStatus }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} reopened and moved to ${newState}${beadsRecreated ? ' (beads recreated from plan)' : ''}`,
      issueId: issueIdentifier,
      newState,
      resetSummary: null,
      agentRunning: false,
      nextStep: `Start an agent: pan start ${id}`,
    });
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
    const issueLower = id.toLowerCase();

    // 1. Resolve workspace path
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath
      ? join(projectPath, 'workspaces', `feature-${issueLower}`)
      : '';

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    // 2. Kill work agent tmux session and remove agent state dir
    yield* Effect.promise(async () => {
      const workAgentSession = `agent-${issueLower}`;
      try {
        if (await Effect.runPromise(sessionExists(workAgentSession))) {
          await Effect.runPromise(killSession(workAgentSession));
          console.log(`[restart-from-plan] Killed work agent session ${workAgentSession}`);
        }
      } catch { /* non-fatal */ }
      const agentStateDir = join(homedir(), '.overdeck', 'agents', `agent-${issueLower}`);
      if (existsSync(agentStateDir)) {
        try {
          await rm(agentStateDir, { recursive: true, force: true });
          console.log(`[restart-from-plan] Removed agent state dir ${agentStateDir}`);
        } catch { /* non-fatal */ }
      }
    });

    // 2b. Clean up stale specialist artifacts (.pan/ and feedback) that survive git resets
    yield* Effect.promise(async () => {
      const dirsToClean = [
        join(workspacePath, '.pan', 'review'),
        join(workspacePath, '.pan', 'prompts'),
        join(workspacePath, '.pan', 'events'),
        join(workspacePath, '.pan', 'feedback'),
      ];
      for (const dir of dirsToClean) {
        if (existsSync(dir)) {
          try {
            await rm(dir, { recursive: true, force: true });
            console.log(`[restart-from-plan] Cleaned ${dir}`);
          } catch { /* non-fatal */ }
        }
      }
    });

    // 3. Find the planning commit and reset to it.
    //
    // Planning commits come from two sources:
    //   - complete-planning endpoint: "Complete planning for PAN-XXX"
    //   - agent start flow: "chore: planning artifacts for PAN-XXX before agent start"
    // Fall back to finding the commit that added `.pan/spec.vbrief.json`.
    //
    // If no planning commit is found, we DO NOT auto-clean. The previous
    // behaviour used a broad git-clean fallback that
    // silently destroyed `.devcontainer/`, `.env`, `node_modules/`, and
    // anything else untracked — see PAN-955/956. The fix is to surface a
    // structured error pointing the user at `pan workspace deep-clean <id>`,
    // which they invoke from a TTY after seeing what would be deleted.
    type ResetOutcome =
      | { success: true; commit: string; method: string }
      | {
          success: false;
          code: 'DANGEROUS_OP_BLOCKED';
          operation: 'git_clean';
          reason: string;
          recovery: string;
        }
      | { success: false; error: string };

    const resetResult = yield* Effect.promise(async (): Promise<ResetOutcome> => {
      try {
        const { runGitResetHard } = await import('../../../lib/safety/dangerous-git-ops.js');

        async function findPlanningCommit(grep: string, label: string): Promise<{ sha: string; method: string } | null> {
          try {
            const { stdout } = await execAsync(
              `git log --grep="${grep.replace(/"/g, '\\"')}" --format=%H -1`,
              { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 },
            );
            const sha = stdout.trim();
            return sha ? { sha, method: label } : null;
          } catch {
            return null;
          }
        }

        const found =
          (await findPlanningCommit(`Complete planning for ${id}`, 'complete-planning message')) ??
          (await findPlanningCommit(`chore: planning artifacts for ${id}`, 'agent-start message')) ??
          (await (async () => {
            try {
              const { stdout } = await execAsync(
                `git log --diff-filter=A --format=%H -1 -- .pan/spec.vbrief.json`,
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 },
              );
              const sha = stdout.trim();
              return sha ? { sha, method: '.pan/spec.vbrief.json add' } : null;
            } catch {
              return null;
            }
          })());

        if (!found) {
          // No tracked planning state to reset to. Refuse to auto-clean —
          // the user has to opt in via `pan workspace deep-clean <id>`.
          return {
            success: false,
            code: 'DANGEROUS_OP_BLOCKED',
            operation: 'git_clean',
            reason:
              `restart-from-plan could not find a planning commit for ${id}. The previous ` +
              `behaviour was to auto-clean untracked files, which silently destroyed .devcontainer/, ` +
              `.env, and other regenerable artifacts. That auto-clean is no longer allowed.`,
            recovery:
              `Run \`pan workspace deep-clean ${issueLower}\` from a terminal — it will list every ` +
              `untracked file/dir before deleting anything and ask you to confirm. After that, retry ` +
              `restart-from-plan.`,
          };
        }

        await Effect.runPromise(runGitResetHard({
          workspacePath,
          ref: found.sha,
          reason: `restart-from-plan ${id} (${found.method})`,
        }));
        console.log(`[restart-from-plan] Reset branch to planning commit ${found.sha} for ${id}`);
        return { success: true, commit: found.sha, method: found.method };
      } catch (err: any) {
        return { success: false, error: err.message || 'Git reset failed' };
      }
    });

    if (!resetResult.success) {
      if ('code' in resetResult && resetResult.code === 'DANGEROUS_OP_BLOCKED') {
        return jsonResponse(
          {
            success: false,
            error: resetResult.reason,
            code: resetResult.code,
            operation: resetResult.operation,
            recovery: resetResult.recovery,
          },
          { status: 409 },
        );
      }
      const errMsg = 'error' in resetResult ? resetResult.error : 'reason' in resetResult ? resetResult.reason : 'unknown error';
      return jsonResponse({ success: false, error: errMsg }, { status: 400 });
    }

    // 4. Reset specialist pipeline states
    clearReviewStatus(id.toUpperCase());

    // 5. Append restart entry to continue file (lifecycle-aware)
    yield* Effect.promise(async () => {
      const upperId = id.toUpperCase();
      try {
        appendContinueSessionEntryForIssue(projectPath, upperId, {
          reason: 'resume',
          note: `Restarted from plan — branch reset to planning commit ${resetResult.commit}. Specialist states cleared.`,
        });
      } catch {
        // Non-fatal: continue file may not exist yet
      }
    });

    // 6. Move issue to In Progress
    yield* lifecycle.transitionTo(id, 'in_progress').pipe(Effect.catch(() => Effect.void));

    // 7. Emit events
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    const restartAgentState = yield* getAgentState(`agent-${issueLower}`);
    if (restartAgentState) {
      yield* saveAgentStateAndEmitEventProgram(restartAgentState, {
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: `agent-${issueLower}`, issueId: restartAgentState.issueId },
      });
    }
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'In Progress', canonicalStatus: 'in_progress' },
    });
    yield* eventStore.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        issueId: id,
        status: {
          issueId: id,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
        },
      },
    });
    try { getIssueDataService().patchIssue(id, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} restarted from plan. Branch reset to ${resetResult.commit}`,
      issueId: id,
      newState: 'In Progress',
      planningCommit: resetResult.commit,
    });
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

    const { targetStatus, syncToTracker = false } = body as any || {};

    const validStatuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
    if (!targetStatus || !validStatuses.includes(targetStatus)) {
      return jsonResponse(
        { error: `Invalid targetStatus. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const { updateShadowState } = yield* Effect.promise(() => import('../../../lib/shadow-state.js'));

    const canonicalToIssueState: Record<string, 'open' | 'in_progress' | 'closed'> = {
      backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_progress', done: 'closed',
    };
    const issueState = canonicalToIssueState[targetStatus];

    const shadowResult = yield* updateShadowState(id, issueState, 'dashboard-drag-drop', targetStatus);

    const issueDataService = getIssueDataService();
    // Refresh the in-memory shadow-state cache so subsequent getIssues() calls
    // see this drag-drop change without hitting the disk.
    yield* Effect.promise(() => issueDataService.refreshShadowStatesCache());
    const issueSource = issueDataService.getIssueSource(id);
    const githubCheck = isGitHubIssue(id);

    if (syncToTracker) {
      // Map canonical status to IssueState for the lifecycle service
      const canonicalToLifecycleState: Record<string, IssueState> = {
        backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_review', done: 'closed',
      };
      const lifecycleState = canonicalToLifecycleState[targetStatus];

      if (lifecycleState) {
        yield* lifecycle.transitionTo(id, lifecycleState).pipe(
          Effect.catch((err) =>
            Effect.sync(() => console.error(`Tracker sync failed for ${id}:`, String(err))),
          ),
        );
      }
    }

    // Invalidate tracker caches
    if (githubCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    const canonicalToDisplay: Record<string, string> = {
      backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress',
      in_review: 'In Review', done: 'Done',
    };

    const displayStatus = canonicalToDisplay[targetStatus] || targetStatus;
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: displayStatus, canonicalStatus: targetStatus },
    });

    try { issueDataService.patchIssue(id, { status: displayStatus, canonicalStatus: targetStatus }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} moved to ${targetStatus}`,
      issueId: id,
      newStatus: targetStatus,
      syncToTracker,
      shadowState: shadowResult,
    });
  })),
);

// ─── Route: POST /api/issues/:id/cleanup-workspace ───────────────────────────

const postIssueCleanupWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cleanup-workspace',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const parsedIssueId = parseIssueIdSync(rawId);
    if (!parsedIssueId) {
      return jsonResponse({ error: 'Invalid issue id: ' + rawId }, { status: 400 });
    }
    const id = parsedIssueId.raw.toUpperCase();
    const issue = getIssueForCleanup(id);
    if (!issue || !isOrphanedIssue(issue)) {
      return jsonResponse({ error: 'Cleanup is only allowed for closed/orphaned issues' }, { status: 409 });
    }
    const cleanupLog: string[] = [];
    const eventStore = yield* EventStoreService;

    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);

    let projectRoot: string | null = null;
    if (githubCheck.isGitHub) {
      const localPaths = getGitHubLocalPaths();
      const repoKey = `${githubCheck.owner}/${githubCheck.repo}`;
      projectRoot = localPaths[repoKey] || null;
    }
    if (!projectRoot) {
      const teamPrefix = extractTeamPrefix(id);
      const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
      projectRoot = projectConfig?.path || null;
    }

    // Git worktree/workspace and agent dir cleanup (all async with meaningful branching on error)
    yield* Effect.promise(async () => {
      if (projectRoot) {
        const workspacePath = join(projectRoot, 'workspaces', `feature-${issueLower}`);
        try {
          const worktreeList = await execAsync('git worktree list --porcelain', { cwd: projectRoot, encoding: 'utf-8' });
          if (worktreeList.stdout.includes(workspacePath)) {
            await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectRoot, encoding: 'utf-8' });
            cleanupLog.push(`Removed git worktree: ${workspacePath}`);
          } else if (existsSync(workspacePath)) {
            await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
            cleanupLog.push(`Removed directory: ${workspacePath}`);
          }
        } catch {
          if (existsSync(workspacePath)) {
            await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
            cleanupLog.push(`Removed directory: ${workspacePath}`);
          }
        }

        const branchName = `feature/${issueLower}`;
        try {
          await execAsync(`git branch -D "${branchName}" 2>/dev/null || true`, { cwd: projectRoot, encoding: 'utf-8' });
          cleanupLog.push(`Deleted local branch: ${branchName}`);
        } catch { /* Branch might not exist */ }
      }

      const agentDir = join(homedir(), '.overdeck', 'agents', `agent-${issueLower}`);
      if (existsSync(agentDir)) {
        await execAsync(`rm -rf "${agentDir}"`, { encoding: 'utf-8' });
        cleanupLog.push(`Removed agent state: ${agentDir}`);
      }
    });

    yield* eventStore.append({
      type: 'workspace.deleted',
      timestamp: new Date().toISOString(),
      payload: { issueId: id },
    });

    return jsonResponse({
      success: true,
      message: `Workspace cleaned up for ${id}`,
      cleanupLog,
    });
  })),
);

// ─── Route: POST /api/issues/:id/deep-wipe ───────────────────────────────────

const postIssueDeepWipeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/deep-wipe',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: 'Invalid issue id: ' + id }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { deleteWorkspace = true } = body as any || {};

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the wipe succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeWipe = yield* getAgentState(workAgentId);

    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        sendEvent({ type: 'started', issueId: id });

        await Effect.runPromise(eventStore.append({
          type: 'workspace.wipe_started',
          timestamp: new Date().toISOString(),
          payload: { issueId: id },
        }));

        const result = await runDestructiveIssueLifecycle(id, 'reset', {
          deleteWorkspace,
          onProgress: sendEvent,
        });

        if (result.success) {
          await Effect.runPromise(eventStore.appendAsync(operatorInterventionEvent({
            issueId: id.toUpperCase(),
            kind: 'deep_wipe',
            source: 'dashboard',
          })));
          // PAN-1908: write-through projection for the real work agent.
          if (workAgentStateBeforeWipe) {
            try {
              saveAgentStateAndEmitEvent(workAgentStateBeforeWipe, {
                type: 'agent.stopped',
                timestamp: new Date().toISOString(),
                payload: { agentId: workAgentId, issueId: workAgentStateBeforeWipe.issueId },
              });
            } catch { /* non-fatal */ }
          }
          // Planning sessions are not agents in the runtime registry; keep raw emit.
          try {
            await Effect.runPromise(eventStore.append({
              type: 'agent.stopped',
              timestamp: new Date().toISOString(),
              payload: { agentId: planningAgentId },
            } as any));
          } catch { /* non-fatal */ }
          await Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
          }));
          await Effect.runPromise(eventStore.append({
            type: 'workspace.destroyed',
            timestamp: new Date().toISOString(),
            payload: { issueId: id },
          }));
          try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
          sendEvent({ type: 'complete', message: `Reset completed for ${id}` });
        } else {
          sendEvent({ type: 'error', error: result.error || 'Reset failed' });
        }
        controller.close();
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  })),
);

// ─── Route: POST /api/issues/:id/copy-settings ───────────────────────────────

const postIssueCopySettingsRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/copy-settings',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath
      ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
      : '';

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    const { copyOverdeckSettingsToWorkspaceSync } = yield* Effect.promise(() =>
      import('../../../lib/workspace-manager.js')
    );

    const result = copyOverdeckSettingsToWorkspaceSync(workspacePath);
    return jsonResponse({
      success: result.errors.length === 0 || result.copied.length > 0,
      copied: result.copied.map(p => p.replace(workspacePath + '/', '')),
      errors: result.errors,
    });
  })),
);

function buildCloseOutContext(id: string): LifecycleContext | null {
  const resolvedProject = resolveProjectFromIssueSync(id);
  if (!resolvedProject) return null;

  const githubCheck = isGitHubIssue(id);
  return {
    issueId: id,
    projectPath: resolvedProject.projectPath,
    projectName: resolvedProject.projectName,
    ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
      ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
      : {}),
  };
}

function closeOutFailureResponse(result: WorkflowResult) {
  const failedStep = result.steps.find((s: StepResult) => !s.success && !s.skipped);
  return jsonResponse({
    ...result,
    error: failedStep?.error ?? 'Close-out workflow failed',
    failedStep,
  }, { status: 422 });
}

const CLOSED_OUT_CACHE_WORKFLOW_LABELS = new Set([
  'in-review',
  'in-progress',
  'needs-close-out',
  'verifying-on-main',
]);

function buildClosedOutCacheLabels(labels: string[]): string[] {
  return [
    ...labels.filter((label) => {
      const normalized = label.toLowerCase();
      return normalized !== 'closed-out' && !CLOSED_OUT_CACHE_WORKFLOW_LABELS.has(normalized);
    }),
    'closed-out',
  ];
}

function sanitizeCloseOutError(error: unknown): string {
  console.error('Close-out route failed:', error);
  return 'Internal server error';
}

function getCachedIssueForCloseOut(issueDataService: IssueDataService, issueId: string): any | undefined {
  return issueDataService.getIssues().find(
    (issue: any) => String(issue.identifier ?? issue.id ?? '').toUpperCase() === issueId.toUpperCase(),
  );
}

function isCachedIssueClosedOut(issue: any | undefined): boolean {
  return Array.isArray(issue?.labels)
    && issue.labels.some((label: unknown) => String(label).toLowerCase() === 'closed-out');
}

function closeOutAlreadyCompletedResult(issueId: string): WorkflowResult {
  return {
    workflow: 'close-out',
    issueId,
    success: true,
    steps: [{ step: 'close-out:idempotent', success: true, skipped: true, details: ['Issue already closed out'] }],
    duration: 0,
  };
}

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

    const ctx = buildCloseOutContext(id);
    if (!ctx) {
      return jsonResponse({ error: `Could not resolve project for ${id}` }, { status: 404 });
    }

    const eventStore = yield* EventStoreService;
    const issueDataService = getIssueDataService();
    if (isCachedIssueClosedOut(getCachedIssueForCloseOut(issueDataService, id))) {
      return jsonResponse(closeOutAlreadyCompletedResult(id));
    }
    const issueSource = issueDataService.getIssueSource(id);

    if (issueSource === 'rally') {
      const rallyConfig = getRallyConfig();
      if (rallyConfig) {
        ctx.rally = {
          apiKey: rallyConfig.apiKey,
          server: rallyConfig.server,
          workspace: rallyConfig.workspace,
          project: rallyConfig.project,
        };
      }
    }

    const closeOutResult = yield* Effect.promise(async () => {
      try {
        const { closeOut } = await import('../../../lib/lifecycle/index.js');
        // PAN-1249: closeOut returns Effect<WorkflowResult>; bridge to Promise.
        const result = await Effect.runPromise(closeOut(ctx));
        return { ok: true as const, result };
      } catch (error) {
        return { ok: false as const, error };
      }
    });

    if (!closeOutResult.ok) {
      return jsonResponse({ error: sanitizeCloseOutError(closeOutResult.error) }, { status: 500 });
    }

    const result = closeOutResult.result;
    if (!result.success) {
      return closeOutFailureResponse(result);
    }

    let newLabels: string[] = ['closed-out'];
    try {
      const cachedIssues = issueDataService.getIssues();
      const cachedIssue = cachedIssues.find(
        (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
      );
      const currentLabels: string[] = cachedIssue?.labels || [];
      newLabels = buildClosedOutCacheLabels(currentLabels);
      issueDataService.patchIssue(id, {
        status: 'Done',
        state: 'done',
        canonicalStatus: 'done',
        targetCanonicalState: 'done',
        mergeStatus: undefined,
        labels: newLabels,
      });
    } catch { /* non-fatal */ }

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'Done', state: 'done', canonicalStatus: 'done', labels: newLabels },
    });

    issueDataService.invalidateTracker('github').catch(() => {});
    issueDataService.invalidateTracker('linear').catch(() => {});
    issueDataService.invalidateTracker('rally').catch(() => {});

    return jsonResponse(result);
  })),
);

const MAX_BULK_CLOSE_OUT = 50;

const VALID_TMUX_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/** Normalize an issue ID to a planning session name, mirroring normalizeAgentId logic. */
function normalizePlanningId(issueId: string): string {
  if (issueId.startsWith('planning-')) return issueId;
  return `planning-${issueId.toLowerCase()}`;
}

function isInactiveAgentStatus(status: string | undefined): boolean {
  return status === 'dead' || status === 'stopped' || status === 'failed';
}

function isPausedMergedAgentSafe(agentState: { paused?: boolean } | null | undefined, allowPausedMerged: boolean): boolean {
  return allowPausedMerged && agentState?.paused === true;
}

async function hasActiveAgentForIssue(issueId: string, allowPausedMerged = false): Promise<boolean> {
  const agentId = normalizeAgentId(issueId);
  const planningId = normalizePlanningId(issueId);

  return Effect.runPromise(Effect.gen(function* () {
    // Only query tmux for valid session names (GitHub IDs like owner/repo#123 produce invalid names)
    if (VALID_TMUX_NAME_RE.test(agentId) && (yield* sessionExists(agentId))) return true;
    if (VALID_TMUX_NAME_RE.test(planningId) && (yield* sessionExists(planningId))) return true;

    const agentState = yield* getAgentState(agentId);
    if (agentState && !isInactiveAgentStatus(agentState.status) && !isPausedMergedAgentSafe(agentState, allowPausedMerged)) return true;

    const planningState = yield* getAgentState(planningId);
    if (planningState && !isInactiveAgentStatus(planningState.status) && !isPausedMergedAgentSafe(planningState, allowPausedMerged)) return true;

    return false;
  }));
}

// ─── Route: POST /api/issues/bulk-close-out ──────────────────────────────────

/** Validate issue ID format (PAN-123, TEAM-456, or GitHub owner/repo#number) */
function isValidIssueId(id: string): boolean {
  if (typeof id !== 'string') return false;
  // Linear-style: PREFIX-123
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id)) return true;
  // GitHub-style: owner/repo#number (alphanumeric, hyphens, underscores, periods only)
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+#\d+$/.test(id)) return true;
  return false;
}

const postIssuesBulkCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/bulk-close-out',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const text = yield* request.text;
    const body: Record<string, unknown> = (() => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } })();
    const rawIssueIds = Array.isArray(body.issueIds) ? body.issueIds : [];
    const issueIds = [...new Set(rawIssueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];

    // Input validation
    if (issueIds.length === 0) {
      return jsonResponse({ error: 'issueIds array is required' }, { status: 400 });
    }
    if (issueIds.length > MAX_BULK_CLOSE_OUT) {
      return jsonResponse({ error: `Maximum ${MAX_BULK_CLOSE_OUT} issues allowed` }, { status: 400 });
    }

    const invalidIds = issueIds.filter(id => !isValidIssueId(id));
    if (invalidIds.length > 0) {
      return jsonResponse({ error: `Invalid issue ID format: ${invalidIds.join(', ')}` }, { status: 400 });
    }

    const eventStore = yield* EventStoreService;
    const { closeOut } = yield* Effect.promise(() => import('../../../lib/lifecycle/index.js'));
    const issueDataService = getIssueDataService();

    // Pre-validate all issues: run agent checks in parallel, then build contexts.
    // CloseOut runs with bounded concurrency (max 3) to avoid unbounded
    // resource use while keeping git index-lock risk low for independent issues.
    type CloseOutTask = { id: string; ctx: LifecycleContext } | { id: string; skipped: true; error: string };
    const tasks: CloseOutTask[] = [];

    const agentChecks = yield* withConcurrencyLimit(
      issueIds.map(id => Effect.promise(async () => {
        const cachedIssue = issueDataService.getIssues().find(
          (issue: any) => (issue.identifier || '').toUpperCase() === id.toUpperCase(),
        );
        const reviewStatus = getReviewStatusSync(id.toUpperCase());
        const allowPausedMerged = reviewStatus?.mergeStatus === 'merged' || cachedIssue?.mergeStatus === 'merged';
        const hasActiveAgent = await hasActiveAgentForIssue(id, allowPausedMerged);
        return { id, hasActiveAgent };
      })),
      10
    );

    for (const { id, hasActiveAgent } of agentChecks) {
      if (hasActiveAgent) {
        tasks.push({ id, skipped: true, error: 'Skipped: active agent running' });
        continue;
      }

      const githubCheck = isGitHubIssue(id);
      let projectPath = '';

      if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
        const localPaths = getGitHubLocalPaths();
        projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
      }
      if (!projectPath) {
        const issuePrefix = extractPrefixSync(id);
        if (issuePrefix) {
          projectPath = getProjectPath(undefined, issuePrefix);
        }
      }
      if (!projectPath) {
        tasks.push({ id, skipped: true, error: `Could not resolve project path for ${id}` });
        continue;
      }

      const ctx: LifecycleContext = {
        issueId: id,
        projectPath,
        ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
          ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
          : {}),
      };

      const issueSource = issueDataService.getIssueSource(id);
      if (issueSource === 'rally') {
        const rallyConfig = getRallyConfig();
        if (rallyConfig) {
          ctx.rally = {
            apiKey: rallyConfig.apiKey,
            server: rallyConfig.server,
            workspace: rallyConfig.workspace,
            project: rallyConfig.project,
          };
        }
      }

      tasks.push({ id, ctx });
    }

    const closeOutTasks = tasks
      .filter((t): t is { id: string; ctx: LifecycleContext } => !('skipped' in t))
      .map(({ id, ctx }) => Effect.promise(async () => {
        try {
          const closeResult = await Effect.runPromise(closeOut(ctx));
          return { id, closeResult };
        } catch (error) {
          const closeResult: WorkflowResult = {
            workflow: 'close-out',
            issueId: id,
            success: false,
            steps: [{
              step: 'close-out',
              success: false,
              skipped: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }],
            duration: 0,
          };
          return { id, closeResult };
        }
      }));

    const closeOutResults = yield* withConcurrencyLimit(closeOutTasks, 3);

    const results: Array<{ issueId: string; success: boolean; error?: string; skipped: boolean }> = [];
    for (const { id, closeResult } of closeOutResults) {
      if (closeResult.success) {
        let newLabels: string[] = ['closed-out'];
        try {
          const cachedIssues = issueDataService.getIssues();
          const cachedIssue = cachedIssues.find(
            (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
          );
          const currentLabels: string[] = cachedIssue?.labels || [];
          newLabels = buildClosedOutCacheLabels(currentLabels);
          issueDataService.patchIssue(id, {
            status: 'Done',
            state: 'done',
            canonicalStatus: 'done',
            targetCanonicalState: 'done',
            mergeStatus: undefined,
            labels: newLabels,
          });
        } catch (e) {
          console.error('Failed to patch issue status:', e);
        }
        yield* eventStore.append({
          type: 'issue.statusChanged',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'Done', state: 'done', canonicalStatus: 'done', labels: newLabels },
        });
      }

      const failedStep = closeResult.steps.find((s: StepResult) => !s.success);
      results.push({
        issueId: id,
        success: closeResult.success,
        error: closeResult.success ? undefined : failedStep?.error,
        skipped: false,
      });
    }

    for (const task of tasks) {
      if ('skipped' in task) {
        results.push({ issueId: task.id, success: false, error: task.error, skipped: true });
      }
    }

    // Invalidate trackers once if any issue closed successfully
    const anySucceeded = results.some(r => r.success);
    if (anySucceeded) {
      issueDataService.invalidateTracker('github').catch((e: Error) => { console.error('Failed to invalidate github tracker:', e); });
      issueDataService.invalidateTracker('linear').catch((e: Error) => { console.error('Failed to invalidate linear tracker:', e); });
    }

    return jsonResponse({ results });
  })),
);

// ─── Route: GET /api/issues/:id/beads ────────────────────────────────────────

const getIssueBeadsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/beads',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';

    // Check for remote workspace (reads non-fatal state files)
    const { isRemoteWorkspace, remoteVmName } = yield* Effect.promise(async (): Promise<{ isRemoteWorkspace: boolean; remoteVmName: string | null }> => {
      const planningSessionName = `planning-${issueLower}`;
      try {
        const remoteState = loadRemoteAgentState(planningSessionName);
        if (remoteState?.vmName) return { isRemoteWorkspace: true, remoteVmName: remoteState.vmName };
      } catch { /* Ignore */ }

      try {
        const remoteMetadataPath = join(homedir(), '.overdeck', 'agents', planningSessionName, 'remote-workspace.json');
        if (existsSync(remoteMetadataPath)) {
          const remoteMetadata = JSON.parse(await readFile(remoteMetadataPath, 'utf-8'));
          if (remoteMetadata.vmName) return { isRemoteWorkspace: true, remoteVmName: remoteMetadata.vmName };
        }
      } catch { /* Ignore parse errors */ }

      try {
        const wsMetadata = loadWorkspaceMetadataStatic(id);
        if (wsMetadata?.vmName) return { isRemoteWorkspace: true, remoteVmName: wsMetadata.vmName };
      } catch { /* Not a remote workspace */ }

      return { isRemoteWorkspace: false, remoteVmName: null };
    });

    // Try local beads query (non-fatal on bd error)
    const { beads, querySource } = yield* Effect.promise(async (): Promise<{ beads: any[]; querySource: string }> => {
      try {
        const bdSearchDir = (workspacePath && existsSync(workspacePath)) ? workspacePath : (projectPath || homedir());
        const { stdout } = await Effect.runPromise(withBdMutex(() => Effect.promise(() => execFileAsync('bd', ['list', '--json', '-l', id.toLowerCase(), '--status', 'all', '--limit', '0'], {
          cwd: bdSearchDir,
          encoding: 'utf-8',
          timeout: 10000,
        }))));
        return { beads: JSON.parse(stdout || '[]'), querySource: 'local' };
      } catch (bdError: any) {
        console.error('bd search failed:', bdError.message);
        return { beads: [], querySource: 'local' };
      }
    });

    const tasks = beads.map((bead: any) => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      type: bead.issue_type || bead.type || 'task',
      blockedBy: bead.blocked_by || [],
      createdAt: bead.created_at,
      startedAt: bead.started_at,
      updatedAt: bead.updated_at,
      closedAt: bead.closed_at,
      labels: bead.labels || [],
      priority: bead.priority,
    }));

    tasks.sort((a: any, b: any) => {
      if (a.priority !== b.priority) return (a.priority || 4) - (b.priority || 4);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Suppress unused variable warning — remoteVmName available for callers if needed
    void remoteVmName;

    return jsonResponse({
      tasks,
      workspacePath,
      count: tasks.length,
      source: querySource,
      isRemote: isRemoteWorkspace,
    });
  })),
);

// ─── Route: POST /api/issues/:id/beads/:beadId/inspect ───────────────────────

function isValidBeadId(beadId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(beadId);
}

const postIssueBeadInspectRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/beads/:beadId/inspect',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const id = (params['id'] ?? '').toUpperCase();
    const beadId = params['beadId'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!beadId.trim()) {
      return jsonResponse({ error: 'Missing bead ID' }, { status: 400 });
    }
    if (!isValidBeadId(beadId)) {
      return jsonResponse({ error: 'Invalid bead ID' }, { status: 400 });
    }

    const body = yield* readJsonBody;
    const project = resolveProjectFromIssueSync(id);
    if (!project) {
      return jsonResponse({ error: `Could not resolve project for ${id}` }, { status: 404 });
    }

    const issueLower = id.toLowerCase();
    const workspace = join(project.projectPath, 'workspaces', `feature-${issueLower}`);
    const workspaceExists = yield* Effect.promise(() => pathIsDirectory(workspace));
    if (!workspaceExists) {
      return jsonResponse({ error: `No workspace found for ${id}` }, { status: 404 });
    }

    const result = yield* spawnInspectAgent({
      projectKey: project.projectKey,
      projectPath: project.projectPath,
      issueId: id,
      beadId,
      workspace,
      branch: `feature/${issueLower}`,
    }, { deep: (body as { deep?: unknown }).deep === true });

    if (!result.success) {
      return jsonResponse({ success: false, error: result.error ?? result.message }, { status: 500 });
    }

    if (result.skipped) {
      return jsonResponse({ success: true, skipped: true, message: result.message, tmuxSession: result.tmuxSession });
    }

    return jsonResponse({ success: true, runId: result.runId, tmuxSession: result.tmuxSession });
  })),
);

// ─── Route: GET /api/issues/:id/planning-state ───────────────────────────────
//
// Lightweight summary of an issue's planning artifacts:
//   { hasPlan, hasBeads, beadsCount }
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
    const issueLower = id.toLowerCase();

    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath
      ? join(projectPath, 'workspaces', `feature-${issueLower}`)
      : '';
    const planPath = workspacePath ? yield* findPlan(workspacePath) : null;
    const hasPlan = planPath !== null;
    // planningComplete now means "plan.status indicates planning has finished" —
    // any of proposed/approved/pending/running/completed/blocked.
    // It's the definitive signal for "tasks have been generated from this plan."
    const planningComplete = workspacePath ? yield* isPlanningComplete(workspacePath) : false;

    const hasBeads = !!planningComplete;

    return jsonResponse({
      hasPlan,
      hasBeads,
      beadsCount: 0,  // Deprecated — use hasBeads. Kept for backward compat.
      planningComplete,
      workspacePath,
    });
  })),
);

// ─── Route: POST /api/issues/:id/generate-tasks ──────────────────────────────
//
// Runs createBeadsFromVBrief() against the workspace. Same logic as
// `pan plan finalize`, exposed so the
// dashboard can offer a one-click "Generate Tasks" action when a vBRIEF plan
// exists but beads were never created (e.g. plans authored before the
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
    const issueLower = id.toLowerCase();

    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    if (!projectPath) {
      return jsonResponse({ success: false, error: `Could not resolve project path for ${id}` }, { status: 404 });
    }

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planPath = yield* findPlan(workspacePath);
    if (!planPath || !existsSync(planPath)) {
      return jsonResponse(
        { success: false, error: `No vBRIEF spec found on main for ${id} — run planning first.` },
        { status: 409 },
      );
    }

    const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../../../lib/vbrief/beads.js'));
    const result = yield* createBeadsFromVBrief(workspacePath);

    if (!result.success || result.created.length === 0) {
      const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
      return jsonResponse({ success: false, created: result.created, errors }, { status: 500 });
    }

    return jsonResponse({
      success: true,
      created: result.created,
      count: result.created.length,
    });
  })),
);

// ─── Route: GET /api/issues/:id/pr ───────────────────────────────────────────
//
// Shells out to `gh pr view --head feature/<id-lower> --repo <owner>/<repo>`
// and `gh pr diff <number> --repo <owner>/<repo> --patch` to assemble a
// structured response for the Command Deck PR/Diff tab. Returns
// `{ pr: null, diff: null }` when the issue is not a GitHub-tracked issue or
// no PR exists for the feature branch yet.

const GH_PR_VIEW_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'baseRefName',
  'headRefName',
  'headRefOid',
  'author',
  'createdAt',
  'updatedAt',
  'reviewDecision',
  'reviewRequests',
  'statusCheckRollup',
  'additions',
  'deletions',
  'changedFiles',
  'files',
  'labels',
  'mergeable',
  'body',
].join(',');

export interface IssuePullRequestData {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid?: string;
  author: { login?: string; name?: string } | null;
  createdAt: string;
  updatedAt: string;
  reviewDecision: string | null;
  reviewRequests: Array<{ login?: string; name?: string; __typename?: string }>;
  statusCheckRollup: Array<{
    name?: string;
    state?: string;
    conclusion?: string;
    status?: string;
    detailsUrl?: string;
    workflowName?: string;
    __typename?: string;
  }>;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
  labels: Array<{ name?: string; color?: string }>;
  mergeable: string | null;
  body: string;
}

export interface IssuePrEndpointResponse {
  issueId: string;
  pr: IssuePullRequestData | null;
  error?: string;
}

export interface IssuePrDiffEndpointResponse {
  issueId: string;
  diff: string | null;
  error?: string;
}

export interface IssuePrDetailsResponse extends IssuePrEndpointResponse {
  diff: string | null;
}

async function resolveIssuePullRequestRef(issueId: string): Promise<
  | { issueId: string; repoArg: string; prNumber: string }
  | { issueId: string; repoArg: null; prNumber: null; error?: string }
> {
  const upper = issueId.toUpperCase();
  const githubCheck = isGitHubIssue(issueId);
  if (!githubCheck.isGitHub || !githubCheck.owner || !githubCheck.repo) {
    return { issueId: upper, repoArg: null, prNumber: null };
  }

  const branchName = `feature/${issueId.toLowerCase()}`;
  const repoArg = `${githubCheck.owner}/${githubCheck.repo}`;

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'list',
        '--repo', repoArg,
        '--head', branchName,
        '--state', 'all',
        '--json', 'number',
        '--limit', '1',
        '--jq', '.[0].number',
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const prNumber = stdout.trim();
    if (!prNumber) {
      return { issueId: upper, repoArg: null, prNumber: null };
    }
    return { issueId: upper, repoArg, prNumber };
  } catch (err: any) {
    return { issueId: upper, repoArg: null, prNumber: null, error: `gh pr list failed: ${err.message}` };
  }
}

async function fetchIssuePullRequestFromRef(
  prRef: Awaited<ReturnType<typeof resolveIssuePullRequestRef>>,
): Promise<IssuePrEndpointResponse> {
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, pr: null, error: (prRef as { error?: string }).error};
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'view', prRef.prNumber,
        '--repo', prRef.repoArg,
        '--json', GH_PR_VIEW_FIELDS,
      ],
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    return {
      issueId: prRef.issueId,
      pr: JSON.parse(stdout) as IssuePullRequestData,
    };
  } catch (err: any) {
    return { issueId: prRef.issueId, pr: null, error: `gh pr view failed: ${err.message}` };
  }
}

export async function fetchIssuePullRequest(issueId: string): Promise<IssuePrEndpointResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  return fetchIssuePullRequestFromRef(prRef);
}

async function fetchIssuePullRequestDiffFromRef(
  prRef: Awaited<ReturnType<typeof resolveIssuePullRequestRef>>,
): Promise<IssuePrDiffEndpointResponse> {
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, diff: null, error: (prRef as { error?: string }).error};
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'diff', prRef.prNumber,
        '--repo', prRef.repoArg,
        '--patch',
      ],
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
    );
    return { issueId: prRef.issueId, diff: stdout };
  } catch (err: any) {
    return { issueId: prRef.issueId, diff: null, error: `gh pr diff failed: ${err.message}` };
  }
}

export async function fetchIssuePullRequestDiff(issueId: string): Promise<IssuePrDiffEndpointResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  return fetchIssuePullRequestDiffFromRef(prRef);
}

export async function fetchIssuePullRequestDetails(issueId: string): Promise<IssuePrDetailsResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, pr: null, diff: null, error: (prRef as { error?: string }).error};
  }

  const [prResult, diffResult] = await Promise.all([
    fetchIssuePullRequestFromRef(prRef),
    fetchIssuePullRequestDiffFromRef(prRef),
  ]);

  return {
    issueId: prRef.issueId,
    pr: prResult.pr,
    diff: diffResult.diff,
    error: prResult.error ?? diffResult.error,
  };
}

type CheckRunConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'startup_failure' | null;
type CheckRunStatus = 'queued' | 'in_progress' | 'completed' | 'requested' | 'pending' | 'waiting' | string;

export interface IssueCheckRun {
  id: number;
  name: string;
  status: CheckRunStatus;
  conclusion: CheckRunConclusion;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
  htmlUrl?: string | null;
  app?: string | null;
  workflowName?: string | null;
}

export interface IssueCheckRunsSummary {
  total: number;
  passed: number;
  failed: number;
  running: number;
  skipped: number;
  pending: number;
  cancelled: number;
}

export interface IssueCheckRunsResponse {
  issueId: string;
  pr: Pick<IssuePullRequestData, 'number' | 'url' | 'headRefName' | 'headRefOid' | 'mergeable' | 'statusCheckRollup'> | null;
  checkRuns: IssueCheckRun[];
  summary: IssueCheckRunsSummary;
  error?: string;
}

function emptyCheckRunsSummary(): IssueCheckRunsSummary {
  return { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 };
}

function summarizeCheckRuns(checkRuns: IssueCheckRun[]): IssueCheckRunsSummary {
  const summary = emptyCheckRunsSummary();
  summary.total = checkRuns.length;
  for (const run of checkRuns) {
    const status = (run.status || '').toLowerCase();
    const conclusion = (run.conclusion || '').toLowerCase();
    if (status !== 'completed') {
      if (status === 'in_progress') summary.running += 1;
      else summary.pending += 1;
      continue;
    }
    if (conclusion === 'success' || conclusion === 'neutral') summary.passed += 1;
    else if (conclusion === 'skipped') summary.skipped += 1;
    else if (conclusion === 'cancelled') summary.cancelled += 1;
    else if (conclusion) summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}

function normalizeCheckRun(raw: any): IssueCheckRun {
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? raw.workflow_name ?? 'Unnamed check'),
    status: String(raw.status ?? 'pending'),
    conclusion: (raw.conclusion ?? null) as CheckRunConclusion,
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    detailsUrl: raw.details_url ?? null,
    htmlUrl: raw.html_url ?? null,
    app: typeof raw.app?.name === 'string' ? raw.app.name : null,
    workflowName: typeof raw.workflow_name === 'string' ? raw.workflow_name : null,
  };
}

export async function fetchIssueCheckRuns(issueId: string): Promise<IssueCheckRunsResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  if (!prRef.repoArg || !prRef.prNumber) {
    return {
      issueId: prRef.issueId,
      pr: null,
      checkRuns: [],
      summary: emptyCheckRunsSummary(),
      error: (prRef as { error?: string }).error,
    };
  }

  const prResult = await fetchIssuePullRequestFromRef(prRef);
  if (!prResult.pr) {
    return {
      issueId: prRef.issueId,
      pr: null,
      checkRuns: [],
      summary: emptyCheckRunsSummary(),
      error: prResult.error,
    };
  }

  const pr = prResult.pr;
  const [defaultOwner, defaultRepo] = prRef.repoArg.split('/');
  const repoOwner = defaultOwner ?? '';
  const repoName = defaultRepo ?? '';
  const checkRef = pr.headRefOid || pr.headRefName || `feature/${issueId.toLowerCase()}`;

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${repoOwner}/${repoName}/commits/${encodeURIComponent(checkRef)}/check-runs?per_page=100`,
        '-H',
        'Accept: application/vnd.github+json',
      ],
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout) as { check_runs?: any[] };
    const checkRuns = (payload.check_runs ?? []).map(normalizeCheckRun);
    return {
      issueId: prRef.issueId,
      pr: {
        number: pr.number,
        url: pr.url,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        mergeable: pr.mergeable,
        statusCheckRollup: pr.statusCheckRollup,
      },
      checkRuns,
      summary: summarizeCheckRuns(checkRuns),
    };
  } catch (err: any) {
    return {
      issueId: prRef.issueId,
      pr: {
        number: pr.number,
        url: pr.url,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        mergeable: pr.mergeable,
        statusCheckRollup: pr.statusCheckRollup,
      },
      checkRuns: [],
      summary: emptyCheckRunsSummary(),
      error: `gh api check-runs failed: ${err.message}`,
    };
  }
}

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

// ─── Route: GET /api/issues/:id/discussions ──────────────────────────────────
// Combined Linear + GitHub timeline. Sources merged into a single chronological
// list:
//   - Linear issue comments (when tracker resolves to Linear)
//   - GitHub issue comments (when tracker resolves to GitHub)
//   - GitHub PR conversation comments (when a feature/<id> PR exists)
//   - GitHub PR review submissions (approve / changes-requested / commented)
//   - GitHub PR inline review comments (review-thread replies on diff lines)
//
// Linear comments are fetched via the LinearClient service so we reuse the
// existing API key / retry plumbing. GitHub data is shelled out via `gh api`
// (consistent with the PR endpoint — same rationale as D13).

export type DiscussionSource =
  | 'linear'
  | 'github-issue'
  | 'github-pr-conversation'
  | 'github-pr-review'
  | 'github-pr-review-comment';

export interface DiscussionItem {
  id: string;
  source: DiscussionSource;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  prNumber?: number;
  reviewState?: string;
  filePath?: string;
  line?: number;
}

export interface IssueDiscussionsResponse {
  issueId: string;
  items: DiscussionItem[];
  prNumber: number | null;
  errors?: string[];
}

interface FetchDiscussionsDeps {
  /** Resolve a Linear issue ref ("MIN-449") to its UUID. */
  linearGetIssueId?: (ref: string) => Promise<string | null>;
  /** Fetch comments for a Linear issue UUID. */
  linearGetComments?: (
    uuid: string,
  ) => Promise<readonly { author: string; body: string; createdAt: string }[]>;
}

export async function fetchIssueDiscussions(
  issueId: string,
  deps: FetchDiscussionsDeps = {},
): Promise<IssueDiscussionsResponse> {
  const upper = issueId.toUpperCase();
  const items: DiscussionItem[] = [];
  const errors: string[] = [];
  let prNumber: number | null = null;

  const trackerType = resolveTrackerTypeSync(issueId);
  const githubCheck = isGitHubIssue(issueId);

  // Steps 1-3 are independent network calls. Fan them out with Promise.all
  // so the slowest governs total wall-clock instead of the sum (PAN-847).
  const linearTask = (async () => {
    // 1. Linear issue comments — only when tracker is Linear and deps provided.
    if (trackerType === 'linear' && deps.linearGetIssueId && deps.linearGetComments) {
      try {
        const uuid = await deps.linearGetIssueId(issueId);
        if (uuid) {
          const linearComments = await deps.linearGetComments(uuid);
          const collected: DiscussionItem[] = [];
          for (let i = 0; i < linearComments.length; i++) {
            const c = linearComments[i]!;
            collected.push({
              id: `linear-${uuid}-${i}`,
              source: 'linear',
              author: c.author,
              body: c.body,
              createdAt: c.createdAt,
            });
          }
          return collected;
        }
      } catch (err: any) {
        errors.push(`linear comments failed: ${err?.message ?? String(err)}`);
      }
    }
    return [] as DiscussionItem[];
  })();

  const ghIssueCommentsTask = (async () => {
    // 2. GitHub issue comments — only when the tracker resolves the issue to
    //    GitHub (not when we're in Linear and a PR happens to exist).
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${owner}/${repo}/issues/${number}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
        }>;
        const collected: DiscussionItem[] = [];
        for (const c of arr) {
          collected.push({
            id: `gh-issue-${c.id}`,
            source: 'github-issue',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
          });
        }
        return collected;
      } catch (err: any) {
        errors.push(`gh issue comments failed: ${err?.message ?? String(err)}`);
      }
    }
    return [] as DiscussionItem[];
  })();

  // 3. Resolve PR number for the feature branch (if a GitHub repo is mapped
  //    via tracker config). This is independent of the issue tracker — even
  //    Linear-tracked issues end up with feature/<id-lower> branches in a
  //    GitHub repo, so PR comments belong on the timeline.
  let prRepoArg: string | null = null;
  let prOwner: string | null = null;
  let prRepo: string | null = null;
  if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
    prRepoArg = `${githubCheck.owner}/${githubCheck.repo}`;
    prOwner = githubCheck.owner;
    prRepo = githubCheck.repo;
  } else {
    // Try the project-resolved repo (Linear-tracked issues whose project maps
    // to a GitHub repo — common for Overdeck).
    const issuePrefix = extractPrefixSync(issueId);
    const projectKey = issuePrefix ?? issueId.split('-')[0] ?? '';
    const ghConfig = getGitHubConfig();
    const repoConfig = ghConfig?.repos.find((r) => {
      const prefix = (r.prefix ?? r.repo).toUpperCase().replace(/-/g, '');
      return prefix === projectKey.toUpperCase();
    });
    if (repoConfig) {
      prRepoArg = `${repoConfig.owner}/${repoConfig.repo}`;
      prOwner = repoConfig.owner;
      prRepo = repoConfig.repo;
    }
  }

  const prNumberTask = (async () => {
    if (prRepoArg) {
      if (!parseIssueIdSync(issueId)) {
        throw new Error(`Invalid issue id: ${issueId}`);
      }
      const branchName = `feature/${issueId.toLowerCase()}`;
      try {
        const { stdout } = await execFileAsync(
          'gh',
          [
            'pr', 'list',
            '--repo', prRepoArg,
            '--head', branchName,
            '--state', 'all',
            '--json', 'number',
            '--limit', '1',
            '--jq', '.[0].number',
          ],
          { encoding: 'utf-8', timeout: 15000 },
        );
        const trimmed = stdout.trim();
        if (trimmed) {
          const parsed = parseInt(trimmed, 10);
          if (Number.isFinite(parsed)) return parsed;
        }
      } catch (err: any) {
        errors.push(`gh pr list failed: ${err?.message ?? String(err)}`);
      }
    }
    return null;
  })();

  const [linearItems, ghIssueItems, resolvedPrNumber] = await Promise.all([
    linearTask,
    ghIssueCommentsTask,
    prNumberTask,
  ]);
  items.push(...linearItems, ...ghIssueItems);
  prNumber = resolvedPrNumber;

  if (prNumber !== null && prRepoArg && prOwner && prRepo) {
    // Three independent gh API calls. Each takes 200–800ms; running them
    // sequentially compounded latency on every 30s poll. Fan out with
    // Promise.all (each block catches its own error so the outer await never
    // rejects) and the slowest call now governs total wall-clock instead of
    // the sum of all three.
    const collectedItems: DiscussionItem[] = [];

    // 4. PR conversation comments (issue-comments endpoint against the PR).
    const prConversation = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/issues/${prNumber}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
        }>;
        for (const c of arr) {
          collectedItems.push({
            id: `gh-pr-conv-${c.id}`,
            source: 'github-pr-conversation',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
            prNumber,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr conversation failed: ${err?.message ?? String(err)}`);
      }
    })();

    // 5. PR review submissions (approve / changes-requested / commented).
    const prReviews = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/pulls/${prNumber}/reviews?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          state?: string;
          submitted_at?: string;
          html_url?: string;
        }>;
        for (const r of arr) {
          if (!r.body && r.state === 'COMMENTED') continue; // empty comment-only reviews are noise
          collectedItems.push({
            id: `gh-pr-review-${r.id}`,
            source: 'github-pr-review',
            author: r.user?.login ?? 'unknown',
            body: r.body ?? '',
            createdAt: r.submitted_at ?? '',
            url: r.html_url,
            prNumber,
            reviewState: r.state,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr reviews failed: ${err?.message ?? String(err)}`);
      }
    })();

    // 6. Inline PR review comments (review-thread replies on diff lines).
    const prInlineComments = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/pulls/${prNumber}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
          path?: string;
          line?: number | null;
        }>;
        for (const c of arr) {
          collectedItems.push({
            id: `gh-pr-rc-${c.id}`,
            source: 'github-pr-review-comment',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
            prNumber,
            filePath: c.path,
            line: typeof c.line === 'number' ? c.line : undefined,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr review comments failed: ${err?.message ?? String(err)}`);
      }
    })();

    await Promise.all([prConversation, prReviews, prInlineComments]);
    items.push(...collectedItems);
  }

  // Sort chronologically (oldest first). Items with no createdAt sink to the bottom.
  items.sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return {
    issueId: upper,
    items,
    prNumber,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

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

    const issueData = getCostsForIssueSync(id);
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
      budget: issueData.budget,
      budgetWarning: issueData.budgetWarning,
      lastUpdated: issueData.lastUpdated,
    });
  })),
);

const getResourceAllocatedIssuesRoute = HttpRouter.add(
  'GET',
  '/api/issues/resource-allocated',
  httpHandler(Effect.gen(function* () {
    const issues = yield* Effect.tryPromise({
      try: async () => sanitizeResourceAllocatedIssues(await getCachedResourceAllocatedIssues()),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(issues);
  })),
);

const getIssueResourceDetailsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/resource-details',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const parsedIssueId = parseIssueIdSync(rawId);
    if (!parsedIssueId) {
      return jsonResponse({ error: 'Invalid issue id: ' + rawId }, { status: 400 });
    }
    const id = parsedIssueId.raw.toUpperCase();

    const details = yield* Effect.tryPromise({
      try: () => getResourceDetailIdentifiers(id),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (!details) {
      return jsonResponse({ error: `No resource details found for ${id}` }, { status: 404 });
    }

    return jsonResponse(details);
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const issuesRouteLayer = Layer.mergeAll(
  getIssuesRoute,
  getIssueAnalyzeRoute,
  postIssueCloseRoute,
  postIssueStartPlanningRoute,
  postIssueAbortPlanningRoute,
  postIssueCompletePlanningRoute,
  postIssueAbortRoute,
  postIssueResetRoute,
  postIssueCancelRoute,
  postIssueReopenRoute,
  postIssueRestartFromPlanRoute,
  postIssueMoveStatusRoute,
  postIssueCleanupWorkspaceRoute,
  postIssueDeepWipeRoute,
  postIssueCopySettingsRoute,
  postIssueCloseOutRoute,
  postIssuesBulkCloseOutRoute,
  getIssueBeadsRoute,
  postIssueBeadInspectRoute,
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
