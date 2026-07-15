import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { invalidateAgentsCache } from '../../dashboard/server/routes/agents.js';
import { validateOrigin } from '../../dashboard/server/routes/origin-validation.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { getGitHubConfig } from '../../dashboard/server/services/tracker-config.js';
import { countPendingAskUserQuestionsForAgent } from '../agent-enrichment.js';
import { getAgentStateSync, saveAgentStateSync } from '../agents.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { createInFlightGuard } from '../cloister/in-flight-guard.js';
import { checkPrdGateSync, asPanSpecDocument, findSpecByIssue, writeSpecDocument, writeSpecForIssue } from '../pan-dir/index.js';
import { resolveAutoSpawnOnFinalize } from '../planning/spawn-planning-session.js';
import { extractTeamPrefix, findProjectByPathSync, findProjectByTeamSync, resolveProjectFromIssueSync } from '../projects.js';
import { isStateMigrated } from '../state-home.js';
import { loadRemoteAgentState } from '../remote/remote-agents.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { killSession, sessionExists } from '../tmux.js';
import { findPlan, findWorkspaceDraftPlan, readPlan } from '../vbrief/io.js';
import { assertPlanQuality, PlanQualityLintError } from '../vbrief/quality-lint.js';
import { flushAutoCommits } from '../pan-dir/auto-commit.js';
import { resolveIssueProjectPathSync } from './issue-reads.js';

const execFileAsync = promisify(execFile);

function getIssueDataService() {
  return getSharedIssueService();
}

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
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
  workAgentSession?: string;
  workAgentError?: string;
  workAgentSkipReason?: 'stack-unhealthy' | 'guardrails' | 'paused' | 'troubled' | 'spawn-failed';
}

type CompletePlanningPhase = 'prdGate' | 'beadsMaterialize' | 'specWrite' | 'autoSpawn' | 'terminal';
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
}): Promise<{ proposed: { path: string; filename: string }; taskCount: number; taskWarning: string | null }> {
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

  emitCompletePlanningPhase(upperIssueId, 'specWrite', 'start', 'writing proposed vBRIEF spec', { projectPath });
  const existingSpec = await Effect.runPromise(findSpecByIssue(projectPath, upperIssueId));
  let proposed: { path: string; filename: string };
  try {
    proposed = existingSpec
      ? await (async () => {
          const nextDoc = asPanSpecDocument(workspaceDoc, 'proposed');
          await Effect.runPromise(writeSpecDocument(projectPath, existingSpec.path, nextDoc));
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

  const planItemCount = workspaceDoc.plan.items?.length ?? 0;
  if (planItemCount === 0) throw new Error(`The vBRIEF for ${upperIssueId} contains no implementation items.`);
  return { proposed, taskCount: planItemCount, taskWarning: null };
}

export function completePlanningFilesToStage(projectPath: string, proposedFilename: string, migrated = false): string[] {
  const filesToStage = migrated ? [] : [`.pan/specs/${proposedFilename}`];
  if (existsSync(join(projectPath, '.overdeck', 'context', 'codebase'))) {
    filesToStage.push('.overdeck/context/codebase/');
  } else if (!migrated && existsSync(join(projectPath, '.pan', 'context', 'codebase'))) {
    filesToStage.push('.pan/context/codebase/');
  }
  return filesToStage;
}

export function completePlanningWorkspaceGitAddCommands(gitRoot: string, migrated = false): string[][] {
  const commands: string[][] = [];
  if (!migrated && existsSync(join(gitRoot, '.pan'))) {
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
 * PAN-2386: complete-planning can leave `.pan/records/<issue>.json` modified after
 * the main `chore(plan): complete planning` commit because record writes are
 * queued for debounced auto-commit. If auto-start is requested, the subsequent
 * start-agent dirty-workspace guard refuses to spawn the work agent. Flush any
 * pending auto-commits and explicitly stage/commit the per-issue record so the
 * tree handed to auto-start is clean.
 */
export async function commitWorkspaceRecordBeforeAutoSpawn(gitRoot: string, issueId: string): Promise<void> {
  const project = findProjectByPathSync(gitRoot);
  if (project && await isStateMigrated(project)) {
    await Effect.runPromise(flushAutoCommits(project.path));
    return;
  }
  if (!existsSync(join(gitRoot, '.git'))) return;
  const issueLower = issueId.toLowerCase();

  try {
    await Effect.runPromise(flushAutoCommits(gitRoot));
  } catch {
    // Non-fatal — explicit status check below will catch uncommitted changes.
  }

  const recordPath = join('.pan', 'records', `${issueLower}.json`);
  try {
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain', '--', recordPath], {
      cwd: gitRoot,
      encoding: 'utf-8',
    });
    if (!statusOut.trim()) return;

    await execFileAsync('git', ['add', '--', recordPath], { cwd: gitRoot, encoding: 'utf-8' });
    try {
      await execFileAsync('git', ['diff', '--cached', '--quiet', '--', recordPath], { cwd: gitRoot, encoding: 'utf-8' });
      return;
    } catch {
      // There are staged changes — commit them.
    }

    await execFileAsync(
      'git',
      ['commit', '-m', `chore(records): update ${issueId.toUpperCase()} per-issue record before auto-start`, '--', recordPath],
      { cwd: gitRoot, encoding: 'utf-8' },
    );
    console.log(`[complete-planning] Committed per-issue record for ${issueId.toUpperCase()} before auto-start`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[complete-planning] Could not commit per-issue record for ${issueId.toUpperCase()}: ${message}`);
  }
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
    const pendingAuq = await Effect.runPromise(countPendingAskUserQuestionsForAgent(sessionName));
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

    // Mark planning agent as stopped so KanbanBoard shows "Start Agent" instead of "Watch Planning"
    await (async () => {
      try {
        const planningState = getAgentStateSync(sessionName);
        if (planningState) {
          saveAgentStateSync({ ...planningState, status: 'stopped', stoppedAt: new Date().toISOString() });
          console.log(`[complete-planning] Marked ${sessionName} as stopped`);
        }
      } catch { /* Non-fatal — agent status is cosmetic */ }
    })();

    // Determine project path
    const githubCheck = isGitHubIssue(id);
    const projectPath = resolveIssueProjectPathSync(id);

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

      const workspacePlanPath = await (async () =>
        (await Effect.runPromise(findWorkspaceDraftPlan(workspacePath))) ?? (await Effect.runPromise(findPlan(workspacePath)))
      )();
      if (workspacePlanPath) {
        const workspaceDoc = await Effect.runPromise(readPlan(workspacePlanPath));
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
    const { pushed: gitPushed, taskWarning } = await (async (): Promise<{ pushed: boolean; taskWarning: string | null }> => {
      if (!projectPath) {
        throw new Error(`Cannot complete planning for ${id}: project path could not be resolved`);
      }

      const gitRoot = workspacePath;
      const upperIssueId = id.toUpperCase();
      const artifacts = await completePlanningArtifacts({ projectPath, workspacePath, issueId: id });
      const { proposed, taskCount, taskWarning } = artifacts;
      console.log(`[complete-planning] Wrote pan spec to ${proposed.path}`);
      console.log(`[complete-planning] Finalized ${taskCount} vBRIEF tasks for ${upperIssueId}`);

      const project = findProjectByPathSync(projectPath);
      const migrated = project ? await isStateMigrated(project) : false;
      const filesToStage = completePlanningFilesToStage(projectPath, proposed.filename, migrated);
      // Polyrepo project roots (e.g. myn) have no .git at projectPath — the
      // sub-worktrees are the repos. Spec promotion still lands on disk; only
      // the convenience commit on main is skipped.
      const projectIsGitRepo = existsSync(join(projectPath, '.git'));
      if (migrated) {
        await Effect.runPromise(flushAutoCommits(projectPath));
      } else if (!projectIsGitRepo) {
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

      for (const args of completePlanningWorkspaceGitAddCommands(gitRoot, migrated)) {
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
        return { pushed: true, taskWarning };
      } catch {
        return { pushed: false, taskWarning };
      }
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
        // GitHub: remove 'planning' label, add 'planned' label
        await Effect.runPromise(lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void)));
        await Effect.runPromise(lifecycle.addLabel(id, 'planned').pipe(Effect.catch(() => Effect.void)));
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

    // PAN-2386: if auto-start is requested, make sure the workspace tree is clean
    // before we ask start-agent to spawn. The per-issue record may have been
    // modified by debounced auto-commit writes during finalize.
    const effectiveAutoSpawn = autoSpawn || completePlanningLease.autoSpawnRequested();
    if (effectiveAutoSpawn && workspacePath) {
      await commitWorkspaceRecordBeforeAutoSpawn(workspacePath, id);
    }

    const autoSpawnResult = await completePlanningAutoSpawnAndKill({
      issueId: id,
      autoSpawn: effectiveAutoSpawn,
      skipKill,
      sessionName,
    });
    emitCompletePlanningPhase(id, 'terminal', 'success', autoSpawnResult?.workAgentSpawned ? 'planning complete and work agent spawn requested' : autoSpawnResult?.workAgentSkipReason ?? 'planning complete', {
      autoSpawn: effectiveAutoSpawn,
      workAgentSpawned: autoSpawnResult?.workAgentSpawned ?? false,
      workAgentSkipReason: autoSpawnResult?.workAgentSkipReason,
    });

    return jsonResponse({
      success: true,
      issueId: id,
      newState,
      gitPushed,
      ...(taskWarning ? { taskWarning } : {}),
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
}
