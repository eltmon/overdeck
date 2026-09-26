import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { invalidateAgentsCache } from '../../dashboard/server/routes/agents.js';
import { AUTOMATIC_SPAWN_GUARDRAIL_ACKNOWLEDGEMENT } from '../../dashboard/server/routes/agents/shared.js';
import { validateOrigin } from '../../dashboard/server/routes/origin-validation.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { getGitHubConfig } from '../../dashboard/server/services/tracker-config.js';
import { countPendingAskUserQuestionsForAgent } from '../agent-enrichment.js';
import { getAgentState } from '../agents.js';
import { planningHandoffStartedBy } from '../agents/provenance.js';
import { emitActivityEntry, emitActivityTts } from '../activity-logger.js';
import { recordHandoffDeferred } from '../cloister/deferred-handoff.js';
import { createInFlightGuard } from '../cloister/in-flight-guard.js';
import { saveAgentStateAndEmitEvent } from '../../dashboard/server/services/agent-projection.js';
import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
import { checkPrdGate, promoteWorkspacePrdDraft, asPanSpecDocument, findSpecByIssue, writeSpecDocument, writeSpecForIssue, WORKSPACE_RUNTIME_DIRNAME } from '../pan-dir/index.js';
import { PENDING_PROMOTION_FILENAME } from '../pan-dir/types.js';
import { resolveAutoSpawnOnFinalize } from '../planning/spawn-planning-session.js';
import { extractTeamPrefix, findProjectByPath, findProjectByTeam, resolveProjectFromIssueSync } from '../projects.js';
import { commitPlanArtifacts, planArtifactCommitMessage } from './plan-artifact-commit.js';
import { loadRemoteAgentState } from '../remote/remote-agents.js';
import { resolveGitHubIssue } from '../tracker-utils.js';
import { sessionExists } from '../tmux.js';
import { agentPaneExists, closeAgentPane } from '../terminal-backends/launch.js';
import { findPlan, findWorkspaceDraftPlan, readPlan } from '../xbrief/io.js';
import { assertPlanQuality, PlanQualityLintError } from '../xbrief/quality-lint.js';
import { isPreWorktreeMetadataOnlyDir } from '../workspace-manager/worktree-ops.js';
import { resolveIssueProjectPath } from './issue-reads.js';

const execFileAsync = promisify(execFile);

function getIssueDataService() {
  return getSharedIssueService();
}

async function removePendingPromotionMarker(
  workspacePath: string,
  log: (message: string) => void = console.log,
): Promise<boolean> {
  const markerPath = join(workspacePath, WORKSPACE_RUNTIME_DIRNAME, PENDING_PROMOTION_FILENAME);
  if (!existsSync(markerPath)) return false;
  await rm(markerPath, { force: true });
  log(`[complete-planning] Removed pending-promotion marker at ${markerPath}`);
  return true;
}

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssue(issueId);
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

export interface CompletePlanningAutoSpawnResult {
  workAgentSpawned: boolean;
  workAgentQueued?: boolean;
  workAgentSession?: string;
  workAgentError?: string;
  workAgentSkipReason?: 'stack-unhealthy' | 'guardrails' | 'paused' | 'troubled' | 'unauthorized' | 'spawn-failed';
  /**
   * PAN-4155: a spawn guardrail refused the start (the response carried a
   * guardrail decision). Deacon-lite retries it later, so the hand-off is
   * deferred, not failed. Other 409s (start gate, dirty tree) stay failures.
   */
  workAgentDeferred?: boolean;
  workAgentHttpStatus?: number;
}

type CompletePlanningPhase = 'prdGate' | 'prdPromote' | 'beadsMaterialize' | 'specWrite' | 'autoSpawn' | 'terminal';
type CompletePlanningPhaseStatus = 'start' | 'success' | 'failure' | 'skipped';

const completePlanningGuard = createInFlightGuard();
const completePlanningAutoSpawnIntent = new Set<string>();

export function beginCompletePlanningLease(
  issueId: string,
  autoSpawnRequested = false,
): { started: boolean; autoSpawnRequested: () => boolean; release: () => void } {
  const key = issueId.toLowerCase();
  if (autoSpawnRequested) completePlanningAutoSpawnIntent.add(key);
  let release!: () => void;
  const lease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = completePlanningGuard.run(key, () => lease);
  return {
    started,
    autoSpawnRequested: () => completePlanningAutoSpawnIntent.has(key),
    release: started ? () => {
      completePlanningAutoSpawnIntent.delete(key);
      release();
    } : () => undefined,
  };
}

function emitCompletePlanningPhase(
  issueId: string,
  phase: CompletePlanningPhase,
  status: CompletePlanningPhaseStatus,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  const timestamp = new Date().toISOString();
  emitActivityEntry({
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
}): Promise<{ proposed: { path: string; filename: string }; taskCount: number; taskWarning: string | null }> {
  const { projectPath, workspacePath, issueId } = options;
  const issueLower = issueId.toLowerCase();
  const upperIssueId = issueId.toUpperCase();
  const workspacePlanPath = await Effect.runPromise(Effect.gen(function* () {
    return (yield* findWorkspaceDraftPlan(workspacePath, 'authored-first')) ?? (yield* findPlan(workspacePath));
  }));
  if (!workspacePlanPath) {
    throw new Error(`No workspace xBRIEF found for ${upperIssueId} at ${workspacePath}/.overdeck/spec.vbrief.json`);
  }

  const workspaceDoc = await Effect.runPromise(readPlan(workspacePlanPath));
  const workspaceIssueId = workspaceDoc.plan?.id;
  if (workspaceIssueId && workspaceIssueId.toLowerCase() !== issueLower) {
    throw new Error(`Workspace xBRIEF is for ${workspaceIssueId.toUpperCase()}, not ${upperIssueId}`);
  }
  assertPlanQuality(workspaceDoc);

  // PAN-3917: the promoted spec lands in the ISSUE WORKSPACE's own `.pan/specs`,
  // on the feature branch, and is committed there by this function's caller.
  // `getProjectPanPaths` resolves a workspace path to that workspace's `.pan`.
  emitCompletePlanningPhase(upperIssueId, 'specWrite', 'start', 'writing proposed xBRIEF spec', { projectPath: workspacePath });
  const existingSpec = await Effect.runPromise(findSpecByIssue(workspacePath, upperIssueId));
  let proposed: { path: string; filename: string };
  try {
    proposed = existingSpec
      ? await (async () => {
          const nextDoc = asPanSpecDocument(workspaceDoc, 'proposed');
          await Effect.runPromise(writeSpecDocument(workspacePath, existingSpec.path, nextDoc));
          return { path: existingSpec.path, filename: existingSpec.filename };
        })()
      : await Effect.runPromise(writeSpecForIssue(workspacePath, workspaceDoc, 'proposed')).then((e) => ({ path: e.path, filename: e.filename }));
    emitCompletePlanningPhase(upperIssueId, 'specWrite', 'success', 'proposed xBRIEF spec written', {
      path: proposed.path,
      filename: proposed.filename,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emitCompletePlanningPhase(upperIssueId, 'specWrite', 'failure', reason, { projectPath: workspacePath });
    throw error;
  }

  const planItemCount = workspaceDoc.plan.items?.length ?? 0;
  if (planItemCount === 0) throw new Error(`The xBRIEF for ${upperIssueId} contains no implementation items.`);
  return { proposed, taskCount: planItemCount, taskWarning: null };
}

export function completePlanningWorkspaceGitAddCommands(gitRoot: string): string[][] {
  const commands: string[][] = [];
  if (existsSync(join(gitRoot, '.pan'))) {
    commands.push(['add', '.pan/']);
  }
  // PAN-2386: the polyrepo scaffold .gitignore is created during workspace setup
  // but the workspace may not be a git repo yet, leaving it untracked. Stage it
  // as part of the planning commit so auto-start sees a clean tree.
  if (existsSync(join(gitRoot, '.gitignore'))) {
    commands.push(['add', '.gitignore']);
  }
  return commands;
}

/**
 * Git-init (when needed), stage, and commit the workspace planning artifacts,
 * then push when a remote exists.
 *
 * Skipped entirely for pre-worktree metadata-only directories (only `.pan/`
 * and/or `.overdeck/`): git-init'ing those leaves a staged `.git` that makes
 * `pan workspace create` refuse with "Workspace already exists" — and the
 * canonical spec was already committed on the state branch by the time this
 * runs. The `git init` stays for every other shape: PAN-2386 polyrepo
 * scaffolds are not git repos until this commit lands (see the comment on
 * completePlanningWorkspaceGitAddCommands).
 */
export async function commitCompletePlanningWorkspaceGit(
  gitRoot: string,
  issueId: string,
  taskWarning: string | null,
  execImpl: typeof execFileAsync = execFileAsync,
): Promise<{ pushed: boolean; taskWarning: string | null }> {
  if (isPreWorktreeMetadataOnlyDir(gitRoot)) {
    console.log('[complete-planning] workspace ' + gitRoot + ' is a pre-worktree metadata dir; skipping workspace git init/commit');
    return { pushed: true, taskWarning };
  }

  const isGitRepo = existsSync(join(gitRoot, '.git'));
  if (!isGitRepo) {
    await execImpl('git', ['init'], { cwd: gitRoot, encoding: 'utf-8' });
  }

  for (const args of completePlanningWorkspaceGitAddCommands(gitRoot)) {
    await execImpl('git', args, { cwd: gitRoot, encoding: 'utf-8' });
  }

  try {
    await execImpl('git', ['diff', '--cached', '--quiet'], { cwd: gitRoot, encoding: 'utf-8' });
  } catch {
    await execImpl('git', ['commit', '-m', `chore(plan): complete planning for ${issueId}`, '--no-verify'], { cwd: gitRoot, encoding: 'utf-8' });
  }

  try {
    const { stdout: remotes } = await execImpl('git', ['remote'], { cwd: gitRoot, encoding: 'utf-8' });
    if (remotes.trim()) {
      const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
      pushChild.unref();
    }
    return { pushed: true, taskWarning };
  } catch {
    return { pushed: false, taskWarning };
  }
}

/**
 * Commit the issue's `.pan/` plan artifacts on the feature branch before the
 * work agent is auto-started (PAN-3917).
 *
 * No daemon commits .pan/ any more: whoever writes a planning artifact commits it.
 * Promotion has just written the spec (and possibly the continue file) into the
 * workspace's own `.pan/`, so the tree handed to auto-start would otherwise be
 * dirty and the start-agent guard would refuse to spawn.
 */
async function commitWorkspacePlanArtifacts(gitRoot: string, issueId: string): Promise<void> {
  if (!existsSync(join(gitRoot, '.git'))) return;
  const outcome = await commitPlanArtifacts({
    cwd: gitRoot,
    paths: ['.pan'],
    message: planArtifactCommitMessage(issueId),
  });
  if (outcome.committed) {
    console.log(`[complete-planning] Committed plan artifacts for ${issueId.toUpperCase()} on the feature branch`);
  } else if (outcome.reason !== 'nothing to commit') {
    console.warn(`[complete-planning] Could not commit plan artifacts for ${issueId.toUpperCase()}: ${outcome.reason}`);
  }
}

function getInternalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

function classifyAutoSpawnSkip(status: number, body: Record<string, unknown>): NonNullable<CompletePlanningAutoSpawnResult['workAgentSkipReason']> {
  const error = typeof body['error'] === 'string' ? body['error'] : '';
  if (status === 401 || status === 403) return 'unauthorized';
  if (body['stackHealth'] || /workspace docker stack/i.test(error)) return 'stack-unhealthy';
  if (body['paused'] === true) return 'paused';
  if (body['troubled'] === true) return 'troubled';
  if (body['guardrails'] || body['requiresAcknowledgement'] === true || status === 409) return 'guardrails';
  return 'spawn-failed';
}

export function resolveCompletePlanningTerminalStatus(
  autoSpawnRequested: boolean,
  autoSpawnResult: CompletePlanningAutoSpawnResult | null,
): CompletePlanningPhaseStatus {
  return autoSpawnRequested && autoSpawnResult?.workAgentSpawned !== true ? 'failure' : 'success';
}

export async function recordPlanningAutoHandoffFailure(options: {
  issueId: string;
  result: CompletePlanningAutoSpawnResult;
  eventStore: any;
  now?: () => string;
  emitActivity?: typeof emitActivityEntry;
}): Promise<string> {
  const skipReason = options.result.workAgentSkipReason ?? 'spawn-failed';
  const error = options.result.workAgentError ?? `Work agent startup failed: ${skipReason}`;
  const details = {
    workAgentSkipReason: skipReason,
    workAgentError: error,
  };
  // PAN-3977: say it in dashboard.log too. The event store alone left the
  // failure invisible there, and the issue was misdiagnosed from the log.
  console.error(`[complete-planning] ${options.issueId} auto-handoff failed (${skipReason}): ${error}`);

  await Effect.runPromise(options.eventStore.append({
    type: 'planning.failed',
    timestamp: (options.now ?? (() => new Date().toISOString()))(),
    payload: {
      issueId: options.issueId,
      error,
      stage: 'auto-handoff',
      ...details,
    },
  }));
  (options.emitActivity ?? emitActivityEntry)({
    source: 'plan',
    level: 'error',
    message: `${options.issueId} planning complete, but work-agent startup failed: ${error}`,
    issueId: options.issueId,
    details: JSON.stringify(details),
  });

  return error;
}

/**
 * PAN-4155: a guardrail refused the hand-off. Journal the deferral in the
 * workspace so deacon-lite retries the spawn without acknowledgement, and say
 * so at warn level. No `planning.failed`: that is recorded only if the retries
 * give up.
 */
export function recordPlanningAutoHandoffDeferred(options: {
  issueId: string;
  workspacePath: string;
  result: CompletePlanningAutoSpawnResult;
  emitActivity?: typeof emitActivityEntry;
}): string {
  const error = options.result.workAgentError ?? 'Work agent startup refused by spawn guardrails';
  recordHandoffDeferred({
    workspacePath: options.workspacePath,
    issueId: options.issueId,
    error,
    httpStatus: options.result.workAgentHttpStatus,
  });
  console.warn(`[complete-planning] ${options.issueId} auto-handoff deferred by spawn guardrails: ${error}`);
  (options.emitActivity ?? emitActivityEntry)({
    source: 'plan',
    level: 'warn',
    message: `${options.issueId} planning complete; work-agent start deferred by spawn guardrails and retried for up to 2 hours: ${error}`,
    issueId: options.issueId,
    details: JSON.stringify({ workAgentSkipReason: 'guardrails', workAgentError: error }),
  });
  return error;
}

export async function completePlanningAutoSpawn(options: {
  issueId: string;
  autoSpawn?: boolean;
  fetchImpl?: typeof fetch;
  dashboardOrigin?: string;
  readAgentState?: typeof getAgentState;
}): Promise<CompletePlanningAutoSpawnResult | null> {
  if (options.autoSpawn !== true) {
    emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'skipped', 'autoSpawn not requested');
    return null;
  }

  const dashboardOrigin = options.dashboardOrigin ?? getInternalDashboardOrigin();
  const handoffStartedBy = planningHandoffStartedBy(
    (options.readAgentState ?? getAgentState)(`planning-${options.issueId.toLowerCase()}`)?.startedBy,
  );
  const internalToken = getInternalToken();
  const internalTokenHeaders: Record<string, string> = internalToken
    ? { [INTERNAL_TOKEN_HEADER]: internalToken }
    : {};
  emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'start', 'posting work-agent spawn request', { dashboardOrigin });
  try {
    const response = await (options.fetchImpl ?? fetch)(new URL('/api/agents', dashboardOrigin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: dashboardOrigin,
        ...internalTokenHeaders,
      },
      // PAN-3977: the operator consented to the work agent when they launched
      // planning with auto-start. Without an acknowledgement every finalize
      // under tight RAM or a high agent count got a 409 and no work agent.
      // Nobody is watching this request, so it acknowledges those two warning
      // kinds only. The agent ceiling and leaked specialists still refuse it,
      // and critical warnings refuse every request.
      body: JSON.stringify({
        issueId: options.issueId,
        role: 'work',
        startedBy: handoffStartedBy,
        autoSpawnConsentRequired: true,
        guardrailAcknowledgedWarnings: AUTOMATIC_SPAWN_GUARDRAIL_ACKNOWLEDGEMENT,
      }),
    });

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const agentId = typeof body['agentId'] === 'string'
      ? body['agentId']
      : `agent-${options.issueId.toLowerCase()}`;

    if (response.ok && body['success'] !== false) {
      const workAgentQueued = body['startingContainers'] === true;
      emitCompletePlanningPhase(
        options.issueId,
        'autoSpawn',
        'success',
        workAgentQueued ? 'container startup queued before work-agent spawn' : 'work agent spawn requested',
        { agentId },
      );
      return { workAgentSpawned: true, ...(workAgentQueued ? { workAgentQueued: true } : {}), workAgentSession: agentId };
    }

    const error = typeof body['error'] === 'string'
      ? body['error']
      : typeof body['message'] === 'string'
        ? body['message']
        : `Work agent spawn returned HTTP ${response.status}`;
    const skipReason = classifyAutoSpawnSkip(response.status, body);
    if (skipReason === 'stack-unhealthy') {
      const recovery = await (options.fetchImpl ?? fetch)(
        new URL(`/api/workspaces/${encodeURIComponent(options.issueId)}/rebuild-and-start`, dashboardOrigin),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: dashboardOrigin, ...internalTokenHeaders },
          body: JSON.stringify({
            startedBy: handoffStartedBy,
            autoSpawnConsentRequired: true,
          }),
        },
      );
      const recoveryBody = await recovery.json().catch(() => ({})) as Record<string, unknown>;
      if (recovery.ok && recoveryBody['success'] !== false) {
        emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'success', 'stack rebuild and work-agent spawn requested', {
          agentId,
          activityId: recoveryBody['activityId'],
        });
        return { workAgentSpawned: true, workAgentSession: agentId };
      }
    }
    emitCompletePlanningPhase(options.issueId, 'autoSpawn', 'skipped', skipReason, {
      httpStatus: response.status,
      error,
    });

    return {
      workAgentSpawned: false,
      workAgentError: error,
      workAgentSkipReason: skipReason,
      workAgentHttpStatus: response.status,
      ...(skipReason === 'guardrails' && body['guardrails'] ? { workAgentDeferred: true } : {}),
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
  /**
   * PAN-3338 — fired once the DEFERRED kill (autoSpawn:false path) actually
   * runs, so the caller can re-project hasLiveTmuxSession after the session
   * is truly gone. The immediate-kill path (autoSpawn:true) does not need
   * this: the caller re-checks liveness after this function already resolves,
   * by which point runKill() below has already been awaited.
   */
  onSessionKilled?: () => void | Promise<void>;
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

  // PAN-3960: planners launch through the host's terminal backend, so the
  // planner is closed through it too — a Herdr pane has no tmux session.
  const killSessionImpl = options.killSessionImpl
    ?? (async (target: string) => { await closeAgentPane(target); });
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
    (options.scheduleKill ?? setTimeout)(() => {
      void runKill().finally(() => { void options.onSessionKilled?.(); });
    }, 1500);
  }

  return autoSpawnResult;
}

export async function completePlanningForIssue(options: {
  request: unknown;
  id: string;
  body: unknown;
  eventStore: any;
  linear: any;
  lifecycle: any;
}) {
  const { request, id, body, eventStore, linear, lifecycle } = options;
  const skipKill = (body as any)?.skipKill === true;
  // Honor the launch-time --auto-start intent persisted at planning spawn
  // (auto-spawn-on-finalize.json) when the caller doesn't explicitly set
  // autoSpawn. This makes the dashboard "Done" button and host auto-finalize
  // spawn the work agent for sessions launched with --auto-start, matching
  // `pan plan finalize`. An explicit body value always wins.
  const bodyAutoSpawn = (body as any)?.autoSpawn;
  const autoSpawn = await resolveAutoSpawnOnFinalize(bodyAutoSpawn, id);
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
    const originCheck = validateOrigin(request as never);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  }
  const sessionName = `planning-${id.toLowerCase()}`;
  const issueLower = id.toLowerCase();
  const completePlanningLease = beginCompletePlanningLease(id, autoSpawn);
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
    const pendingAuq = await countPendingAskUserQuestionsForAgent(sessionName);
    if (pendingAuq > 0) {
      console.log(`[complete-planning] ${id} has ${pendingAuq} pending AskUserQuestion(s) — agent is waiting for the operator, not done. No-op.`);
      return jsonResponse({ ok: true, skipped: 'pending-ask-user-question' });
    }

    // Detect remote planning session (non-fatal reads)
    const { isRemotePlanning, remoteVmName } = await (async (): Promise<{ isRemotePlanning: boolean; remoteVmName: string | null }> => {
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
    })();

    // Session kill is deferred to after the HTTP response is sent. When
    // `pan plan finalize` chains to this endpoint from inside the planning
    // session itself, killing the session synchronously here would kill the
    // caller mid-fetch and they would never see their own success response.
    // Keep this name in scope; we schedule the kill at the very end.

    // Determine project path
    const githubCheck = isGitHubIssue(id);
    const projectPath = resolveIssueProjectPath(id);

    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';
    if (workspacePath) {
      // PRD-first gate (PAN-2234): refuse promotion without a non-trivial PRD
      // draft. Runs before the xBRIEF quality-lint pre-check so a missing PRD
      // short-circuits before any spec read. noPrd bypass is loud (phase event).
      if (noPrd) {
        emitCompletePlanningPhase(id, 'prdGate', 'skipped', 'noPrd bypass requested');
      } else {
        const prdGate = checkPrdGate({ projectRoot: projectPath || null, workspacePath, issueId: id });
        if (!prdGate.ok) {
          emitCompletePlanningPhase(id, 'prdGate', 'failure', prdGate.reason ?? 'missing', { prdGate });
          return jsonResponse({ error: `PRD-first gate: no PRD draft for ${id.toUpperCase()}`, prdGate }, { status: 422 });
        }
        emitCompletePlanningPhase(id, 'prdGate', 'success', `found ${prdGate.path} (${prdGate.lineCount} lines)`);
      }

      // PRD promotion: the gate accepts a workspace-authored draft, but the
      // workspace is disposable — promote it to drafts/ on the state plane so
      // the PRD survives workspace teardown (the PAN-2858 defect: spec promoted,
      // PRD stranded). Never overwrites an existing canonical draft. Runs even
      // under the noPrd bypass — if a draft exists anyway, promoting it is
      // strictly better than stranding it. A promotion failure is a state-door
      // write failure and fails promotion loudly, same as a spec-write failure.
      try {
        const draftPromotion = await Effect.runPromise(
          promoteWorkspacePrdDraft({ projectRoot: projectPath, workspacePath, issueId: id }),
        );
        if (draftPromotion.promoted) {
          const removalNote = draftPromotion.sourceRemoved ? '' : ' (workspace copy left in place)';
          emitCompletePlanningPhase(id, 'prdPromote', 'success', `promoted ${draftPromotion.source} -> ${draftPromotion.path}${removalNote}`);
        } else {
          emitCompletePlanningPhase(id, 'prdPromote', 'skipped', draftPromotion.reason);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        emitCompletePlanningPhase(id, 'prdPromote', 'failure', reason);
        return jsonResponse({ error: `PRD draft promotion failed for ${id.toUpperCase()}: ${reason}` }, { status: 500 });
      }

      const workspacePlanPath = await (async () =>
        (await Effect.runPromise(findWorkspaceDraftPlan(workspacePath, 'authored-first'))) ?? (await Effect.runPromise(findPlan(workspacePath)))
      )();
      if (workspacePlanPath) {
        const workspaceDoc = await Effect.runPromise(readPlan(workspacePlanPath));
        try {
          assertPlanQuality(workspaceDoc);
        } catch (error) {
          if (error instanceof PlanQualityLintError) {
            return jsonResponse({ error: 'xBRIEF quality lint failed', qualityIssues: error.issues }, { status: 422 });
          }
          throw error;
        }
      }
    }

    // Git operations: write planning marker, commit, push (complex nested async — kept as async block)
    const { pushed: gitPushed, taskWarning, specPath } = await (async (): Promise<{ pushed: boolean; taskWarning: string | null; specPath: string }> => {
      if (!projectPath) {
        throw new Error(`Cannot complete planning for ${id}: project path could not be resolved`);
      }

      const gitRoot = workspacePath;
      const upperIssueId = id.toUpperCase();
      const artifacts = await completePlanningArtifacts({ projectPath, workspacePath, issueId: id });
      const { proposed, taskCount, taskWarning } = artifacts;
      console.log(`[complete-planning] Wrote pan spec to ${proposed.path}`);
      console.log(`[complete-planning] Finalized ${taskCount} xBRIEF tasks for ${upperIssueId}`);

      // PAN-3917: the spec is promoted into the workspace's own `.pan/` and
      // committed on the feature branch below — there is no separate commit on
      // main, and no state branch to flush.
      const committed = await commitCompletePlanningWorkspaceGit(gitRoot, id, taskWarning);
      return { ...committed, specPath: proposed.path };
    })();

    // Update Linear/GitHub issue state
    let newState = 'Planned';

    // Skip status reset if a work agent is already running — complete-planning fires after
    // planning finishes, but the user may have already clicked "Start Agent". Resetting the
    // issue to Planned would undo that and flash the card back to To Do.
    const workAgentSession = `agent-${issueLower}`;
    const workAgentAlreadyRunning = await Effect.runPromise(sessionExists(workAgentSession));
    if (workAgentAlreadyRunning) {
      console.log(`[complete-planning] Work agent ${workAgentSession} is already running — skipping status reset to Planned`);
    }

    // For Linear: check if already in a 'started' state — if so, skip the transition
    let skipStateUpdate = workAgentAlreadyRunning;
    if (!skipStateUpdate && !githubCheck?.isGitHub) {
      const currentIssue = await Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))) as any;
      if (currentIssue?.state.name && currentIssue.state.name.toLowerCase() !== 'in planning' && currentIssue.state.name.toLowerCase() !== 'planning') {
        // Check if already in a "started" state by seeing if it's not an unstarted/planning state
        const stateType = await Effect.runPromise(linear.getTeamStates(currentIssue.team.id).pipe(
          Effect.map((states: any[]) => states.find((s) => s.id === currentIssue.state.id)?.type ?? ''),
          Effect.catch(() => Effect.succeed('')),
        ));
        if (stateType === 'started') {
          skipStateUpdate = true;
        }
      }
    }

    if (!skipStateUpdate) {
      if (githubCheck.isGitHub) {
        // GitHub: remove 'planning' label, add 'planned' label. PAN-3953:
        // `planned` means a finalized spec exists, so it is applied only here,
        // after the spec was written and committed, and only if it is on disk.
        await Effect.runPromise(lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void)));
        if (existsSync(specPath)) {
          await Effect.runPromise(lifecycle.addLabel(id, 'planned').pipe(Effect.catch(() => Effect.void)));
        } else {
          console.warn(`[complete-planning] Spec ${specPath} not found for ${id.toUpperCase()} — not applying the planned label`);
        }
      } else {
        // Linear: transition to 'open' (maps to unstarted — Planned/Todo/Ready)
        const updatedIssue = await Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))) as any;
        await Effect.runPromise(lifecycle.transitionTo(id, 'open').pipe(Effect.catch(() => Effect.void)));
        // Re-fetch to get new state name for response
        const refreshed = await Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))) as any;
        newState = refreshed?.state.name ?? (updatedIssue?.state.name ?? 'Planned');
      }
    } else {
      newState = 'Skipped (already in progress)';
    }

    // Mark planning agent as stopped so KanbanBoard shows "Start Agent" instead
    // of "Watch Planning". Runs only AFTER the PRD gate and spec promotion
    // succeeded — a rejected finalize leaves the agent running (PAN-3338).
    //
    // Routed through the canonical transactional write door
    // (saveAgentStateAndEmitEvent, PAN-1908) instead of a separate row write
    // + eventStore.append: that split write let a transient liveness-query or
    // event-store failure leave the agents-table row stopped with no matching
    // event, which is exactly the DB/read-model divergence this issue exists
    // to fix. The write door commits the row upsert and the event append in
    // one SQLite transaction, so a failure here leaves NEITHER changed —
    // never a split state — and the outer catch keeps it non-fatal to the
    // finalize response.
    //
    // hasLiveTmuxSession must be honest at the moment it is recorded, and
    // "the moment" matters: this is called (a) once after the auto-spawn/kill
    // decision below, by which point the immediate-kill path (autoSpawn:true)
    // has already awaited the kill, so sessionExists() correctly reports
    // false; and (b) a second time from onSessionKilled once the DEFERRED
    // kill (autoSpawn:false) actually runs ~1.5s later, correcting the
    // liveness flag the enrichment poller can never repair on its own (it
    // only processes tmux-active agents, so a projection left at
    // hasLiveTmuxSession:true after the session died would never self-heal).
    const projectPlanningAgentStopped = async (): Promise<void> => {
      try {
        const planningState = getAgentState(sessionName);
        if (!planningState) return;
        const previousStatus = planningState.status;
        const hasLiveTmuxSession = await agentPaneExists(sessionName).catch(() => false);
        saveAgentStateAndEmitEvent(
          { ...planningState, status: 'stopped', stoppedAt: planningState.stoppedAt ?? new Date().toISOString() },
          {
            type: 'agent.status_changed',
            timestamp: new Date().toISOString(),
            payload: { agentId: sessionName, status: 'stopped', previousStatus, hasLivePane: hasLiveTmuxSession, hasLiveTmuxSession },
          },
        );
        console.log(`[complete-planning] Marked ${sessionName} as stopped (hasLiveTmuxSession=${hasLiveTmuxSession})`);
      } catch { /* Non-fatal — agent status is cosmetic, and the write door is transactional so this never leaves a split state */ }
    };

    await Effect.runPromise(eventStore.append({
      type: 'planning.sync',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'completed' },
    }));

    const completeCanonical = newState === 'Skipped (already in progress)' ? 'in_progress' : 'todo';
    await Effect.runPromise(eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: newState, canonicalStatus: completeCanonical },
    }));
    try { getIssueDataService().patchIssue(id, { status: newState, canonicalStatus: completeCanonical }); } catch { /* non-fatal */ }

    // Clear agents cache so the dashboard stops showing the planning agent as active
    invalidateAgentsCache();

    // Suppress unused variable warning — remoteVmName used for remote session cleanup if added later
    void isRemotePlanning; void remoteVmName;

    // PAN-3917: if auto-start is requested, commit the plan artifacts finalize
    // just wrote so the tree handed to start-agent is clean.
    const effectiveAutoSpawn = autoSpawn || completePlanningLease.autoSpawnRequested();
    if (effectiveAutoSpawn && workspacePath) {
      await commitWorkspacePlanArtifacts(workspacePath, id);
    }

    const autoSpawnResult = await completePlanningAutoSpawnAndKill({
      issueId: id,
      autoSpawn: effectiveAutoSpawn,
      skipKill,
      sessionName,
      onSessionKilled: projectPlanningAgentStopped,
    });
    // Runs AFTER the auto-spawn/kill decision above, not before: on the
    // immediate-kill path (effectiveAutoSpawn:true, skipKill:false) the kill
    // has already been awaited inside completePlanningAutoSpawnAndKill, so
    // sessionExists() below correctly observes the session as dead instead of
    // recording a liveness snapshot that goes stale the instant the session
    // is killed (PAN-3338). The deferred-kill path additionally corrects the
    // projection via onSessionKilled once the delayed kill actually runs.
    await projectPlanningAgentStopped();
    const autoHandoffFailed = effectiveAutoSpawn && autoSpawnResult?.workAgentSpawned !== true;
    // PAN-4155: a guardrail refusal is retried by deacon-lite from the journal,
    // which needs the workspace. Without one it stays a plain failure.
    const autoHandoffDeferred = autoHandoffFailed && autoSpawnResult?.workAgentDeferred === true
      && Boolean(workspacePath) && existsSync(workspacePath);
    let autoHandoffError: string | undefined;
    if (autoHandoffDeferred && autoSpawnResult) {
      autoHandoffError = recordPlanningAutoHandoffDeferred({ issueId: id, workspacePath, result: autoSpawnResult });
    } else if (autoHandoffFailed && autoSpawnResult) {
      autoHandoffError = await recordPlanningAutoHandoffFailure({
        issueId: id,
        result: autoSpawnResult,
        eventStore,
      });
    } else {
      emitActivityEntry({
        source: 'plan',
        level: 'info',
        message: autoSpawnResult?.workAgentSpawned
          ? `${id} planning complete — work-agent startup accepted`
          : `${id} planning complete — ready for work`,
        issueId: id,
      });
      emitActivityTts({
        utterance: autoSpawnResult?.workAgentSpawned
          ? `${id} planning complete, work agent starting`
          : `${id} planning complete, ready for work`,
        priority: 2,
        issueId: id,
        source: 'planning-agent',
        eventType: 'planning.complete',
      });
    }
    emitCompletePlanningPhase(id, 'terminal', autoHandoffDeferred ? 'skipped' : resolveCompletePlanningTerminalStatus(effectiveAutoSpawn, autoSpawnResult), autoSpawnResult?.workAgentSpawned ? 'planning complete and work agent spawn requested' : autoSpawnResult?.workAgentSkipReason ?? 'planning complete', {
      autoSpawn: effectiveAutoSpawn,
      workAgentSpawned: autoSpawnResult?.workAgentSpawned ?? false,
      workAgentSkipReason: autoSpawnResult?.workAgentSkipReason,
    });
    await removePendingPromotionMarker(workspacePath);

    return jsonResponse({
      success: true,
      issueId: id,
      newState,
      gitPushed,
      ...(taskWarning ? { taskWarning } : {}),
      ...(autoSpawnResult ?? {}),
      // Only a journaled deferral is retried; say so when it was not journaled.
      ...(autoSpawnResult?.workAgentDeferred ? { workAgentDeferred: autoHandoffDeferred } : {}),
      message: autoHandoffDeferred
        ? `Planning complete; work-agent start deferred by spawn guardrails and retried automatically for up to 2 hours: ${autoHandoffError}`
        : autoHandoffFailed
        ? `Planning complete, but work-agent startup failed (${autoSpawnResult?.workAgentSkipReason ?? 'spawn-failed'}): ${autoHandoffError}`
        : autoSpawnResult?.workAgentSpawned
          ? 'Planning complete and work agent spawn requested'
          : gitPushed
            ? 'Planning complete and pushed to git - ready for execution'
            : 'Planning complete - ready for execution',
    });
  } finally {
    completePlanningLease.release();
  }
}
