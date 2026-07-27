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
import {
  loadReviewStatuses,
  setReviewStatusSync,
  type BlockerReason,
  type ReviewStatus,
  type ReviewStatusUpdate,
} from '../review-status.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { probeBranchConflictPaths, type BranchConflictProbeResult } from './conflict-gate.js';

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const PROJECT_COOLDOWN_MS = 120 * 1000;

const projectCooldowns = new Map<string, number>();

interface AgentWorkspaceRow {
  issueId: string;
  workspace: string | null;
}

export interface ReconcileBranchInvalidationDeps {
  loadReviewStatuses: () => Record<string, ReviewStatus>;
  resolveProject: (issueId: string) => { projectKey: string; projectPath: string } | null;
  listAgentWorkspaces: () => AgentWorkspaceRow[];
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;
  setReviewStatus: (issueId: string, update: ReviewStatusUpdate, existing?: ReviewStatus) => ReviewStatus;
  emitActivityEntry: (options: EmitActivityOptions) => void;
  lsRemoteMainSha: (projectPath: string) => Promise<string | null>;
  probeConflictPaths: (workspacePath: string, targetBranch: string) => Promise<BranchConflictProbeResult>;
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
    loadReviewStatuses,
    resolveProject: resolveProjectFromIssueSync,
    listAgentWorkspaces: listAllAgentsSync,
    existsSync,
    readdirSync: (path: string) => readdirSync(path),
    getSetting,
    setSetting,
    setReviewStatus: setReviewStatusSync,
    emitActivityEntry: emitActivityEntrySync,
    lsRemoteMainSha: lsRemoteMainShaReal,
    probeConflictPaths: (workspacePath, targetBranch) => probeBranchConflictPaths(workspacePath, targetBranch),
    now: () => Date.now(),
  };
}

/**
 * Resolve an issue's workspace: prefer the agents-table workspace column (fast,
 * covers -strike/-slot-N by construction), else the first existing
 * `feature-<issueLower>*` directory (prefix scan; a plain `feature-<issueLower>`
 * sorts before any `-strike`/`-slot-N` suffix).
 */
function resolveWorkspacePath(
  deps: Pick<ReconcileBranchInvalidationDeps, 'listAgentWorkspaces' | 'existsSync' | 'readdirSync'>,
  projectPath: string,
  issueId: string,
): string | null {
  const upperIssueId = issueId.toUpperCase();
  const agentWorkspace = deps.listAgentWorkspaces().find((a) => a.issueId.toUpperCase() === upperIssueId)?.workspace;
  if (agentWorkspace && deps.existsSync(agentWorkspace)) return agentWorkspace;

  const workspacesDir = join(projectPath, 'workspaces');
  if (!deps.existsSync(workspacesDir)) return null;

  const prefix = `feature-${issueId.toLowerCase()}`;
  const matches = deps.readdirSync(workspacesDir)
    .filter((name) => name === prefix || name.startsWith(`${prefix}-`))
    .sort();
  if (matches.length === 0) return null;
  return join(workspacesDir, matches[0]);
}

function formatPathSummary(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown}, …` : shown;
}

async function sweepProject(
  deps: ReconcileBranchInvalidationDeps,
  projectKey: string,
  projectPath: string,
  issueIds: string[],
  statuses: Record<string, ReviewStatus>,
  nowMs: number,
  actions: string[],
): Promise<void> {
  const newSha = await deps.lsRemoteMainSha(projectPath);
  if (!newSha) return; // ls-remote failure: skip, keep last-seen (NFR-2)

  const settingKey = `branch_invalidation.main_head.${projectKey}`;
  const lastSha = deps.getSetting(settingKey);
  if (lastSha === newSha) return; // unchanged: no workspace probing (AC-1)

  const shortSha = newSha.slice(0, 7);
  const newlyMarkedIssueIds: string[] = [];
  let hadUnknownProbe = false;

  for (const issueId of issueIds) {
    const status = statuses[issueId];
    const workspacePath = resolveWorkspacePath(deps, projectPath, issueId);
    if (!workspacePath) continue;

    const probe = await deps.probeConflictPaths(workspacePath, 'main');
    if (probe.mergeability === 'unknown') { hadUnknownProbe = true; continue; }
    if (probe.mergeability !== 'conflicts') continue; // clean: conflict-gate clears
    if (status.conflictsSince?.sha === newSha) continue; // dedup per main head (AC-3)

    const detectedAt = new Date(nowMs).toISOString();
    const nonMergeBlockers = (status.blockerReasons ?? []).filter(
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
    }, status);

    deps.emitActivityEntry({
      source: 'cloister',
      level: 'warn',
      issueId,
      message: `main moved: ${issueId} now conflicts with main (${shortSha}) in ${formatPathSummary(probe.paths)}`,
    });

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
    const statuses = deps.loadReviewStatuses();
    const nowMs = deps.now();

    const byProject = new Map<string, { projectPath: string; issueIds: string[] }>();
    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus === 'merged') continue;
      const resolved = deps.resolveProject(issueId);
      if (!resolved) continue;
      const entry = byProject.get(resolved.projectKey) ?? { projectPath: resolved.projectPath, issueIds: [] };
      entry.issueIds.push(issueId);
      byProject.set(resolved.projectKey, entry);
    }

    for (const [projectKey, { projectPath, issueIds }] of byProject) {
      const cooledUntil = projectCooldowns.get(projectKey);
      if (cooledUntil && nowMs < cooledUntil) continue;
      projectCooldowns.set(projectKey, nowMs + PROJECT_COOLDOWN_MS);

      try {
        await sweepProject(deps, projectKey, projectPath, issueIds, statuses, nowMs, actions);
      } catch (projectErr: unknown) {
        console.warn(`[deacon] reconcileBranchInvalidation: ${projectKey} sweep failed: ${projectErr instanceof Error ? projectErr.message : String(projectErr)}`);
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
