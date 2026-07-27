/**
 * PAN-3154: notify the pipeline when a merge to main invalidates open branches.
 *
 * Watches each project's origin/main head SHA on a cooldown; when it moves,
 * probes every in-pipeline branch of that project for newly-created conflicts
 * and marks them with a merge_conflict blocker + conflictsSince, so the
 * existing conflict-gate machinery (review-dispatch defer, resolver dispatch,
 * dashboard stuckReason) picks them up without further work.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { emitActivityEntrySync, type EmitActivityOptions } from '../activity-logger.js';
import { getSetting, setSetting } from '../overdeck/control-settings.js';
import { listAllAgentsSync } from '../overdeck/agents.js';
import { messageAgent } from '../agents/messaging.js';
import {
  getReviewStatusSync,
  setReviewStatusSync,
  type BlockerReason,
  type ReviewStatus,
  type ReviewStatusUpdate,
} from '../review-status.js';
import { loadProjectsConfigSync, resolveProjectPath, type ProjectConfig } from '../projects.js';
import { gatherProjectLensSignals } from '../pipeline-membership-gather.js';
import { resolvePipelineMembership, type PipelineMembership } from '../pipeline-membership.js';
import { probeBranchConflictPaths, type BranchConflictProbeResult } from './conflict-gate.js';
import { resolveIssueFeedbackTarget, type IssueFeedbackTarget } from './feedback-target.js';

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const PROJECT_COOLDOWN_MS = 120 * 1000;

const projectCooldowns = new Map<string, number>();

interface AgentWorkspaceRow {
  issueId: string;
  workspace: string | null;
}

export interface ProjectDescriptor {
  projectKey: string;
  projectPath: string;
  projectConfig: ProjectConfig;
}

export interface ReconcileBranchInvalidationDeps {
  listProjects: () => ProjectDescriptor[];
  /** Canonical pipeline-membership signals for a project — never derive membership from ReviewStatus alone. */
  gatherPipelineMembership: (projectConfig: ProjectConfig) => Promise<PipelineMembership[]>;
  listAgentWorkspaces: () => AgentWorkspaceRow[];
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;
  /** Fresh canonical single-issue read — always re-read immediately before a write. */
  getReviewStatus: (issueId: string) => ReviewStatus | null;
  setReviewStatus: (issueId: string, update: ReviewStatusUpdate, existing?: ReviewStatus) => ReviewStatus;
  emitActivityEntry: (options: EmitActivityOptions) => void;
  lsRemoteMainSha: (projectPath: string) => Promise<string | null>;
  probeConflictPaths: (workspacePath: string, targetBranch: string) => Promise<BranchConflictProbeResult>;
  resolveFeedbackTarget: (issueId: string) => Promise<IssueFeedbackTarget>;
  messageAgent: (agentId: string, message: string, caller?: string) => Promise<unknown>;
  now: () => number;
}

async function lsRemoteMainShaReal(projectPath: string): Promise<string | null> {
  const options: ExecOptions = {
    cwd: projectPath,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  };
  try {
    const { stdout } = await execAsync('git ls-remote origin refs/heads/main', options);
    const sha = String(stdout).trim().split(/\s+/)[0];
    return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function buildRealBranchInvalidationDeps(): ReconcileBranchInvalidationDeps {
  return {
    listProjects: () =>
      Object.entries(loadProjectsConfigSync().projects)
        // Canonical membership needs forge signals (open PRs/issues); a project
        // without github_repo can't be resolved, so it's skipped rather than
        // falling back to a permissive "everything is in pipeline" guess.
        .filter(([, projectConfig]) => Boolean(projectConfig.github_repo))
        .map(([projectKey, projectConfig]) => ({
          projectKey,
          projectPath: resolveProjectPath(projectConfig),
          projectConfig,
        })),
    gatherPipelineMembership: (projectConfig) =>
      gatherProjectLensSignals(projectConfig).then((signals) => signals.map(resolvePipelineMembership)),
    listAgentWorkspaces: listAllAgentsSync,
    existsSync,
    readdirSync: (path: string) => readdirSync(path),
    getSetting,
    setSetting,
    getReviewStatus: getReviewStatusSync,
    setReviewStatus: setReviewStatusSync,
    emitActivityEntry: emitActivityEntrySync,
    lsRemoteMainSha: lsRemoteMainShaReal,
    probeConflictPaths: (workspacePath, targetBranch) => probeBranchConflictPaths(workspacePath, targetBranch),
    resolveFeedbackTarget: resolveIssueFeedbackTarget,
    messageAgent: (agentId, message, caller) => messageAgent(agentId, message, caller),
    now: () => Date.now(),
  };
}

/**
 * Resolve an issue's workspace: prefer the agents-table workspace column (fast,
 * covers -strike/-slot-N by construction), else the first existing
 * `feature-<issueLower>*` directory (prefix scan; a plain `feature-<issueLower>`
 * sorts before any `-strike`/`-slot-N` suffix). Agent-table rows and the
 * workspaces-directory listing are preloaded once per project sweep by the
 * caller — this function does no I/O beyond the `existsSync` check.
 */
function resolveWorkspacePath(
  deps: Pick<ReconcileBranchInvalidationDeps, 'existsSync'>,
  agentWorkspaces: AgentWorkspaceRow[],
  workspacesDirEntries: string[],
  projectPath: string,
  issueId: string,
): string | null {
  const upperIssueId = issueId.toUpperCase();
  const agentWorkspace = agentWorkspaces.find((a) => a.issueId.toUpperCase() === upperIssueId)?.workspace;
  if (agentWorkspace && deps.existsSync(agentWorkspace)) return agentWorkspace;

  const prefix = `feature-${issueId.toLowerCase()}`;
  const matches = workspacesDirEntries
    .filter((name) => name === prefix || name.startsWith(`${prefix}-`))
    .sort();
  if (matches.length === 0) return null;
  return join(projectPath, 'workspaces', matches[0]);
}

function formatPathSummary(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown}, …` : shown;
}

/**
 * Notify the live owning agent that main moved and now conflicts with its
 * branch. Skips silently when no agent is live (needsYou) — the blocker plus
 * the existing conflict-resolver dispatch already cover stopped agents; this
 * is not a second nudge channel.
 */
async function notifyBranchInvalidated(
  deps: Pick<ReconcileBranchInvalidationDeps, 'resolveFeedbackTarget' | 'messageAgent'>,
  issueId: string,
  info: { sha: string; paths: string[] },
): Promise<void> {
  const target = await deps.resolveFeedbackTarget(issueId);
  if ('needsYou' in target) return;

  const shortSha = info.sha.slice(0, 7);
  const message = [
    `main moved: merge ${shortSha} now conflicts with your branch in: ${info.paths.join(', ')}.`,
    `Rebase onto the new main NOW while the conflict is small — run \`pan sync-main ${issueId}\`,`,
    'resolve preserving BOTH intents, then continue your current task.',
  ].join(' ');

  await deps.messageAgent(target.agentId, message, 'internal');
}

async function sweepProject(
  deps: ReconcileBranchInvalidationDeps,
  project: ProjectDescriptor,
  nowMs: number,
  actions: string[],
): Promise<void> {
  const { projectKey, projectPath, projectConfig } = project;
  const newSha = await deps.lsRemoteMainSha(projectPath);
  if (!newSha) return; // ls-remote failure: skip, keep last-seen (NFR-2)

  const settingKey = `branch_invalidation.main_head.${projectKey}`;
  const lastSha = deps.getSetting(settingKey);
  if (lastSha === newSha) return; // unchanged: no workspace probing (AC-1)

  if (lastSha === null) {
    // First observation for this project (fresh deploy, or app_settings cache
    // loss) — establish the baseline without probing. Treating "no prior SHA"
    // as "main just moved" would backfill every pre-existing conflict as if it
    // happened just now, which the PRD's NonGoals explicitly forbid.
    deps.setSetting(settingKey, newSha);
    return;
  }

  let memberships: PipelineMembership[];
  try {
    memberships = await deps.gatherPipelineMembership(projectConfig);
  } catch (membershipErr: unknown) {
    console.warn(`[deacon] reconcileBranchInvalidation: ${projectKey} membership gather failed: ${membershipErr instanceof Error ? membershipErr.message : String(membershipErr)}`);
    return; // canonical membership unavailable this cycle — never fall back to a raw runtime scan
  }
  const issueIds = memberships.filter((m) => m.inPipeline).map((m) => m.issueId);

  const shortSha = newSha.slice(0, 7);
  const newlyMarkedIssueIds: string[] = [];
  let hadUnknownProbe = false;

  // Preload once per project sweep (not per issue) — avoids an N+1 agents-table
  // query and a redundant directory read/sort per issue.
  const agentWorkspaces = deps.listAgentWorkspaces();
  const workspacesDir = join(projectPath, 'workspaces');
  const workspacesDirEntries = deps.existsSync(workspacesDir) ? deps.readdirSync(workspacesDir) : [];

  for (const issueId of issueIds) {
    const workspacePath = resolveWorkspacePath(deps, agentWorkspaces, workspacesDirEntries, projectPath, issueId);
    if (!workspacePath) continue;

    const probe = await deps.probeConflictPaths(workspacePath, 'main');
    if (probe.mergeability === 'unknown') { hadUnknownProbe = true; continue; }
    if (probe.mergeability !== 'conflicts') continue; // clean: conflict-gate clears

    // Re-read canonical status immediately before writing — the probe above
    // awaited real Git I/O, so another actor (agent, reviewer, webhook, merge
    // route) may have updated this issue's status meanwhile. Passing a
    // snapshot taken before the probes as `existing` would tell
    // setReviewStatusSync to skip its fresh canonical read and silently
    // overwrite that newer state.
    const freshStatus = deps.getReviewStatus(issueId);
    if (!freshStatus) continue; // no canonical row (yet) — nothing to mark
    if (freshStatus.mergeStatus === 'merged') continue; // merged while we were probing
    if (freshStatus.conflictsSince?.sha === newSha) continue; // dedup per main head (AC-3)

    const detectedAt = new Date(nowMs).toISOString();
    const nonMergeBlockers = (freshStatus.blockerReasons ?? []).filter(
      (b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable',
    );
    const mergeConflictBlocker: BlockerReason = {
      type: 'merge_conflict',
      summary: `Conflicts with main since ${shortSha} (${probe.paths.length} path${probe.paths.length === 1 ? '' : 's'}): ${formatPathSummary(probe.paths)}`,
      detectedAt,
    };

    deps.setReviewStatus(issueId, {
      conflictsSince: { sha: newSha, detectedAt, paths: probe.paths },
      blockerReasons: [...nonMergeBlockers, mergeConflictBlocker],
    }, freshStatus);

    deps.emitActivityEntry({
      source: 'cloister',
      level: 'warn',
      issueId,
      message: `main moved: ${issueId} now conflicts with main (${shortSha}) in ${formatPathSummary(probe.paths)}`,
    });

    try {
      await notifyBranchInvalidated(deps, issueId, { sha: newSha, paths: probe.paths });
    } catch (notifyErr: unknown) {
      console.warn(`[deacon] reconcileBranchInvalidation: ${issueId} notify failed: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
    }

    newlyMarkedIssueIds.push(issueId);
    actions.push(`Marked ${issueId} conflicting with main since ${shortSha}`);
  }

  // NFR-2 / AC-4: an 'unknown' probe must not advance the stored main head —
  // doing so would permanently skip that issue's re-probe at this SHA (the
  // unchanged-head check above short-circuits every later sweep).
  if (!hadUnknownProbe) {
    deps.setSetting(settingKey, newSha);
  }

  if (newlyMarkedIssueIds.length > 0) {
    const summaryMessage = `main ${shortSha} invalidated ${newlyMarkedIssueIds.length} branch(es): ${newlyMarkedIssueIds.join(', ')}`;
    deps.emitActivityEntry({ source: 'cloister', level: 'warn', message: summaryMessage });
    actions.push(summaryMessage);
  }
}

/**
 * Deacon patrol reconciler (PAN-3154): fan out a conflict probe to every
 * in-pipeline branch of a project whenever that project's origin/main head
 * moves. Never throws — errors are logged and the patrol continues.
 */
export async function reconcileBranchInvalidation(
  deps: ReconcileBranchInvalidationDeps = buildRealBranchInvalidationDeps(),
): Promise<string[]> {
  const actions: string[] = [];
  try {
    const nowMs = deps.now();
    const projects = deps.listProjects();

    for (const project of projects) {
      const cooledUntil = projectCooldowns.get(project.projectKey);
      if (cooledUntil && nowMs < cooledUntil) continue;
      projectCooldowns.set(project.projectKey, nowMs + PROJECT_COOLDOWN_MS);

      try {
        await sweepProject(deps, project, nowMs, actions);
      } catch (projectErr: unknown) {
        console.warn(`[deacon] reconcileBranchInvalidation: ${project.projectKey} sweep failed: ${projectErr instanceof Error ? projectErr.message : String(projectErr)}`);
      }
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileBranchInvalidation: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}

export function __resetBranchInvalidationCooldownsForTests(): void {
  projectCooldowns.clear();
}
