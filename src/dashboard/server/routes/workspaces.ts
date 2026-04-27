import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from './http-handler.js';
/**
 * Workspaces route module — Effect HttpRouter.Layer (PAN-428 B8)
 *
 * Workspaces + lifecycle + review HTTP routes.
 *
 * Workspace data endpoints (/api/workspaces/):
 *   GET    /api/workspaces/:issueId
 *   POST   /api/workspaces
 *   GET    /api/workspaces/:issueId/plan
 *   GET    /api/workspaces/:issueId/clean/preview
 *   POST   /api/workspaces/:issueId/clean
 *   POST   /api/workspaces/:issueId/containerize
 *   POST   /api/workspaces/:issueId/containers/:containerName/:action
 *   POST   /api/workspaces/:issueId/refresh-db
 *   GET    /api/workspaces/:issueId/tldr
 *
 * Lifecycle endpoints (/api/issues/):
 *   POST   /api/issues/:issueId/start
 *   POST   /api/issues/:issueId/sync-main
 *   POST   /api/issues/:issueId/approve
 *   POST   /api/issues/:issueId/merge
 *
 * Review endpoints (/api/review/):
 *   GET    /api/review/:issueId/status
 *   POST   /api/review/:issueId/status
 *   POST   /api/review/:issueId/trigger
 *   POST   /api/review/:issueId/request
 *   POST   /api/review/:issueId/reset
 *   DELETE /api/review/:issueId/pending
 *
 * Stuck-state endpoints (/api/workspaces/):
 *   POST   /api/workspaces/:issueId/unstick
 */

import { exec, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, chmod, mkdir, readdir, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  resolveProjectFromIssue,
  listProjects,
  findProjectByTeam,
  extractTeamPrefix,
} from '../../../lib/projects.js';
import { resolveGitHubIssue as resolveGitHubIssueShared } from '../../../lib/tracker-utils.js';
import { getGitHubConfig } from '../services/tracker-config.js';
import { EventStoreService } from '../services/domain-services.js';
import {
  enqueuePendingFeedbackDelivery,
  markPendingFeedbackDelivered,
} from '../pending-feedback.js';
import {
  getReviewStatus,
  setReviewStatus as setReviewStatusBase,
  markWorkspaceStuck,
  setDeaconIgnored,
  type ReviewStatus,
} from '../../../lib/review-status.js';
import { gitPush, MainDivergedError } from '../../../lib/git/operations.js';
import { listGitOperations } from '../../../lib/git-activity.js';
import {
  computeQueuePositionFromStatus,
  findPositionInQueue,
} from '../../../lib/queue-position.js';
import {
  messageAgent,
  saveAgentRuntimeState,
  getAgentRuntimeState,
  transitionIssueToInReview,
  getAgentState,
  getAgentStateAsync,
  spawnAgent,
} from '../../../lib/agents.js';
import { getActiveSessionModel } from '../../../lib/cost-parsers/jsonl-parser.js';
import { findPlan, readPlan, readWorkspacePlan } from '../../../lib/vbrief/io.js';
import { criticalPath } from '../../../lib/vbrief/dag.js';
import { syncMainIntoWorkspace } from '../../../lib/cloister/merge-agent.js';
import { capturePaneAsync, killSessionAsync, listSessionNamesAsync } from '../../../lib/tmux.js';
import { syncBeadStatusToVBrief } from '../../../lib/vbrief/beads.js';
import { getUnblockedItems } from '../../../lib/cloister/task-readiness.js';
import { runVerificationForIssue } from '../../../lib/cloister/verification-runner.js';
import { getTldrDaemonService } from '../../../lib/tldr-daemon.js';
import { loadWorkspaceMetadata } from '../../../lib/remote/workspace-metadata.js';
import { extractPrefix, extractNumber } from '../../../lib/issue-id.js';
import { setMergeQueueTriggerHandler } from '../services/merge-queue-service.js';
import { getWorkAgentLifecycleState } from '../../../lib/work-agent-lifecycle.js';
import { enrichReviewStatusFromSessions } from '../../../lib/review-status-enrichment.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function shouldTreatAsRerun(status: Pick<ReviewStatus, 'readyForMerge' | 'reviewStatus' | 'testStatus' | 'mergeStatus'> | null | undefined): boolean {
  if (!status) return false;
  return status.readyForMerge === true
    || status.reviewStatus === 'passed'
    || status.testStatus === 'passed'
    || (status.reviewStatus === 'passed' && status.testStatus === 'passed' && status.mergeStatus === 'failed');
}

async function deliverQueuedFeedback(
  issueId: string,
  kind: 'review-blocked' | 'review-failed' | 'test-failed',
  filePath: string,
  message: string,
): Promise<void> {
  const agentId = `agent-${issueId.toLowerCase()}`;
  await enqueuePendingFeedbackDelivery({
    issueId,
    agentId,
    kind,
    filePath,
    message,
    createdAt: new Date().toISOString(),
  });
  await messageAgent(agentId, message);
  await markPendingFeedbackDelivered(issueId, kind);
}

async function ensureWorkAgentReadyForMerge(
  issueId: string,
  workspacePath: string,
  rebaseMsg: string,
): Promise<{ recovered: boolean; agentId: string; detail: string }> {
  const agentId = `agent-${issueId.toLowerCase()}`;
  const lifecycle = getWorkAgentLifecycleState(agentId);

  if (lifecycle.hasLiveTmuxSession) {
    await messageAgent(agentId, rebaseMsg);
    return { recovered: true, agentId, detail: 'Work agent already running; sent merge preparation request.' };
  }

  const agentState = await getAgentStateAsync(agentId);
  if (agentState) {
    try {
      await messageAgent(agentId, rebaseMsg);
      const updatedLifecycle = getWorkAgentLifecycleState(agentId);
      return {
        recovered: true,
        agentId,
        detail: updatedLifecycle.canResumeSession
          ? 'Resumed work agent and sent merge preparation request.'
          : 'Restarted work agent and sent merge preparation request.',
      };
    } catch (err: any) {
      if (!lifecycle.canStartFresh) {
        throw err;
      }
    }
  }

  if (!lifecycle.canStartFresh) {
    throw new Error(lifecycle.reason || `Work agent ${agentId} cannot be resumed or started for merge preparation.`);
  }

  const state = await spawnAgent({
    issueId,
    workspace: workspacePath,
    phase: 'implementation',
    agentType: 'work-agent',
    prompt: rebaseMsg,
  });

  return {
    recovered: true,
    agentId,
    detail: `Started fresh work agent ${state.id} and sent merge preparation request.`,
  };
}

/**
 * Check whether origin/branchName already contains origin/targetBranch.
 * If true, no rebase is needed — the branch is already up to date with target.
 */
export async function isBranchAlreadyRebased(
  workspacePath: string,
  branchName: string,
  targetBranch: string,
): Promise<{ alreadyRebased: boolean; currentHead?: string }> {
  try {
    await Promise.all([
      execFileAsync('git', ['fetch', 'origin', targetBranch], { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 }),
      execFileAsync('git', ['fetch', 'origin', branchName], { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 }),
    ]);
    await execFileAsync(
      'git',
      ['merge-base', '--is-ancestor', `origin/${targetBranch}`, `origin/${branchName}`],
      { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
    );
    const { stdout: currentHead } = await execFileAsync(
      'git',
      ['rev-parse', `origin/${branchName}`],
      { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
    );
    return { alreadyRebased: true, currentHead: currentHead.trim() };
  } catch {
    return { alreadyRebased: false };
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3011', 10);
const MAX_AUTO_REQUEUE = 7;

// Track server-managed merges — imported from specialists.ts (single source of truth).
// Previously this was a local Set that was never in sync with specialists.ts's export (PAN-632).
import { _serverManagedMerges } from './specialists.js';

// ─── Activity log (in-memory, shared with server startup) ─────────────────────

interface ActivityEntry {
  id: string;
  timestamp: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
}

const activityLog: ActivityEntry[] = [];

function logActivity(entry: ActivityEntry): void {
  activityLog.unshift(entry);
  if (activityLog.length > 100) activityLog.pop();
}

function updateActivity(id: string, updates: Partial<ActivityEntry>): void {
  const entry = activityLog.find(e => e.id === id);
  if (entry) Object.assign(entry, updates);
}

function appendActivityOutput(id: string, line: string): void {
  const entry = activityLog.find(e => e.id === id);
  if (entry) {
    entry.output.push(line);
    if (entry.output.length > 500) entry.output.shift();
  }
}

// ─── Pending operations (in-memory) ──────────────────────────────────────────

interface PendingOperation {
  type: 'review' | 'merge' | 'approve' | 'start' | 'clean' | 'containerize' | 'refresh-db';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  error?: string;
}

const pendingOperations = new Map<string, PendingOperation>();

function setPendingOperation(issueId: string, type: PendingOperation['type']): void {
  pendingOperations.set(issueId.toLowerCase(), {
    type,
    status: 'running',
    startedAt: new Date().toISOString(),
  });
}

function completePendingOperation(issueId: string, error?: string | null): void {
  const op = pendingOperations.get(issueId.toLowerCase());
  if (op) {
    op.status = error ? 'failed' : 'completed';
    if (error) op.error = error;
  }
}

function getPendingOperation(issueId: string): PendingOperation | null {
  return pendingOperations.get(issueId.toLowerCase()) ?? null;
}

function clearPendingOperation(issueId: string): void {
  pendingOperations.delete(issueId.toLowerCase());
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssue(issueId);
    if (resolved) return resolved.projectPath;

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

function getWorkspaceLocation(issueId: string): 'local' | 'remote' | undefined {
  try {
    const meta = loadWorkspaceMetadata(issueId);
    if (meta?.location) return meta.location as 'local' | 'remote';
  } catch { /* non-fatal */ }
  return undefined;
}

function parseGitHubPullRequestUrl(url?: string | null): { owner: string; repo: string; number: number } | null {
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

// Exported for unit tests covering late-success merge reconciliation guards.
export async function reconcileGitHubMergeStatus(issueId: string, status: Pick<ReviewStatus, 'prUrl' | 'mergeStatus' | 'readyForMerge'> | null | undefined): Promise<boolean> {
  if (!status?.prUrl) return false;

  const prRef = parseGitHubPullRequestUrl(status.prUrl);
  if (!prRef) return false;

  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../../../lib/github-app.js');
    if (!isGitHubAppConfigured()) return false;

    const prState = await getPullRequestState(prRef.owner, prRef.repo, prRef.number);
    if (!prState.merged) return false;

    setReviewStatus(issueId, {
      mergeStatus: 'merged',
      mergeNotes: undefined,
      readyForMerge: false,
    });
    completePendingOperation(issueId, null);
    return true;
  } catch (err: any) {
    console.warn(`[merge] Failed to reconcile PR state for ${issueId}: ${err.message}`);
    return false;
  }
}

interface WorkspaceInfo {
  exists: boolean;
  isRemote: boolean;
  vmName?: string;
  remotePath?: string;
  localPath?: string;
  agentId?: string;
}

function getWorkspaceInfoForIssue(issueId: string): WorkspaceInfo {
  try {
    const meta = loadWorkspaceMetadata(issueId);
    if (meta?.location === 'remote' && meta.vmName) {
      return {
        exists: true,
        isRemote: true,
        vmName: meta.vmName,
        remotePath: meta.remotePath,
        agentId: meta.agentId,
      };
    }
  } catch { /* non-fatal */ }

  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
  const issueLower = issueId.toLowerCase();
  const numericSuffix = issueLower.replace(/^[a-z]+-/, '');

  // Scan all configured projects for legacy naming (e.g. feature-484 for PAN-484)
  for (const { config } of listProjects()) {
    if (!config.path) continue;
    for (const candidate of [`feature-${issueLower}`, `feature-${numericSuffix}`]) {
      const p = join(config.path, 'workspaces', candidate);
      if (existsSync(p)) return { exists: true, isRemote: false, localPath: p };
    }
  }

  // Fallback: canonical path under getProjectPath
  const projectPath = getProjectPath(undefined, issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  if (existsSync(workspacePath)) return { exists: true, isRemote: false, localPath: workspacePath };

  return { exists: false, isRemote: false };
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

function spawnPanCommand(args: string[], description: string, cwd?: string): string {
  const activityId = Date.now().toString();
  logActivity({
    id: activityId,
    timestamp: new Date().toISOString(),
    command: `pan ${args.join(' ')}`,
    status: 'running',
    output: [],
  });

  const child = spawn('pan', args, {
    cwd: cwd || process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach((line: string) => {
      appendActivityOutput(activityId, line);
    });
  });
  child.stderr?.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach((line: string) => {
      appendActivityOutput(activityId, `[stderr] ${line}`);
    });
  });
  child.on('close', (code) => {
    updateActivity(activityId, { status: code === 0 ? 'completed' : 'failed' });
  });

  return activityId;
}

async function getGitStatusAsync(workspacePath: string): Promise<{
  branch: string;
  uncommittedFiles: number;
  latestCommit: string;
} | null> {
  try {
    const [branchResult, statusResult, logResult] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, encoding: 'utf-8' }),
      execAsync('git status --porcelain', { cwd: workspacePath, encoding: 'utf-8' }),
      execAsync('git log -1 --format="%s"', { cwd: workspacePath, encoding: 'utf-8' }),
    ]);
    return {
      branch: branchResult.stdout.trim(),
      uncommittedFiles: statusResult.stdout.trim() ? statusResult.stdout.trim().split('\n').length : 0,
      latestCommit: logResult.stdout.trim(),
    };
  } catch {
    return null;
  }
}

async function getRepoGitStatusAsync(workspacePath: string): Promise<{
  ahead: number;
  behind: number;
  hasOrigin: boolean;
} | null> {
  try {
    const { stdout: remoteOut } = await execAsync('git remote -v', { cwd: workspacePath, encoding: 'utf-8' });
    if (!remoteOut.includes('origin')) return { ahead: 0, behind: 0, hasOrigin: false };
    const { stdout: revlistOut } = await execAsync(
      'git rev-list --left-right --count HEAD...origin/HEAD 2>/dev/null || echo "0\t0"',
      { cwd: workspacePath, encoding: 'utf-8' }
    );
    const parts = revlistOut.trim().split('\t');
    return {
      ahead: parseInt(parts[0] || '0', 10),
      behind: parseInt(parts[1] || '0', 10),
      hasOrigin: true,
    };
  } catch {
    return null;
  }
}

async function getContainerStatusAsync(
  issueId: string,
  projectPath?: string
): Promise<Record<string, { running: boolean; uptime: string | null; status?: string }>> {
  const result: Record<string, { running: boolean; uptime: string | null; status?: string }> = {};
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format "{{.Names}}\\t{{.Status}}" 2>/dev/null | grep "${issueId.toLowerCase()}" || true`,
      { encoding: 'utf-8' }
    );
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const [name, ...statusParts] = line.split('\t');
      const statusStr = statusParts.join('\t');
      const running = statusStr.toLowerCase().startsWith('up');
      const uptimeMatch = statusStr.match(/Up (.+)/);
      result[name] = {
        running,
        uptime: running ? (uptimeMatch ? uptimeMatch[1] : null) : null,
        status: statusStr,
      };
    }
  } catch { /* non-fatal */ }
  return result;
}

async function getMrUrlAsync(issueId: string, workspacePath: string): Promise<string | null> {
  try {
    const issueLower = issueId.toLowerCase();
    const branchName = `feature/${issueLower}`;
    const { stdout } = await execAsync(
      `gh pr view ${branchName} --json url --jq .url 2>/dev/null || true`,
      { cwd: workspacePath, encoding: 'utf-8' }
    );
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Build a rich PR body with issue link, beads task summary, and AC checklist
 * from the vBRIEF plan. Exported for testing.
 */
export async function buildRichPRBody(issueId: string, workspacePath: string): Promise<string> {
  const lines: string[] = [];

  lines.push(`Closes #${extractNumber(issueId) ?? issueId}`);
  lines.push('');

  // Acceptance criteria checklist from vBRIEF plan items
  try {
    const planPath = join(workspacePath, '.planning', 'plan.vbrief.json');
    if (existsSync(planPath)) {
      const raw = await readFile(planPath, 'utf-8');
      const doc = JSON.parse(raw);
      const items: Array<{ status: string; title: string }> = doc?.plan?.items ?? [];
      if (items.length > 0) {
        lines.push('## Acceptance Criteria');
        lines.push('');
        for (const item of items) {
          const checked = item.status === 'completed' ? 'x' : ' ';
          lines.push(`- [${checked}] ${item.title}`);
        }
        lines.push('');
      }
    }
  } catch {
    // No vBRIEF plan — omit checklist
  }

  // Beads task summary from .beads/issues.jsonl (if available)
  try {
    let beadsPath: string | null = null;
    const workspaceBeadsRedirect = join(workspacePath, '.beads', 'redirect');
    if (existsSync(workspaceBeadsRedirect)) {
      const redirectTarget = (await readFile(workspaceBeadsRedirect, 'utf-8')).trim();
      const resolvedPath = redirectTarget.startsWith('/')
        ? redirectTarget
        : join(workspacePath, '.beads', redirectTarget);
      beadsPath = join(resolvedPath, 'issues.jsonl');
    }
    const localBeadsPath = join(workspacePath, '.beads', 'issues.jsonl');
    if (!beadsPath && existsSync(localBeadsPath)) beadsPath = localBeadsPath;

    if (beadsPath && existsSync(beadsPath)) {
      const issueLower = issueId.toLowerCase();
      const beads = (await readFile(beadsPath, 'utf-8'))
        .split('\n')
        .filter(l => l.trim())
        .map(l => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(b => b && b.labels?.some((lbl: string) => lbl.toLowerCase() === issueLower));

      if (beads.length > 0) {
        lines.push('## Implementation Tasks');
        lines.push('');
        for (const bead of beads) {
          const checked = bead.status === 'closed' ? 'x' : ' ';
          lines.push(`- [${checked}] ${bead.title.replace(/^[^:]+:\s*/, '')}`);
        }
        lines.push('');
      }
    }
  } catch {
    // No beads — omit task list
  }

  return lines.join('\n') || `Automated PR for ${issueId}`;
}

async function ensurePRExists(
  issueId: string,
  options?: { cwd?: string; branchName?: string; targetBranch?: string }
): Promise<{ created: boolean; prUrl?: string; error?: string }> {
  try {
    const issueLower = issueId.toLowerCase();
    const branchName = options?.branchName ?? `feature/${issueLower}`;
    const targetBranch = options?.targetBranch ?? 'main';
    const execOptions: Parameters<typeof execAsync>[1] = { encoding: 'utf-8' };
    if (options?.cwd) execOptions.cwd = options.cwd;

    // Check for existing PR
    const { stdout: existingOut } = await execAsync(
      `gh pr view ${branchName} --json url --jq .url 2>/dev/null || true`,
      execOptions
    );
    const existing = existingOut.trim();
    if (existing) return { created: false, prUrl: existing };

    // Build rich PR body if workspace path is available
    const prBody = options?.cwd ? await buildRichPRBody(issueId, options.cwd) : `Automated PR for ${issueId}`;

    // Write body to a temp file to avoid shell escaping issues
    const { tmpdir } = await import('os');
    const { join: pathJoin } = await import('path');
    const { writeFile: writeFileAsync, unlink: unlinkAsync } = await import('fs/promises');
    const bodyFile = pathJoin(tmpdir(), `pan-pr-body-${issueId}-${Date.now()}.md`);
    await writeFileAsync(bodyFile, prBody, 'utf-8');

    try {
      const { stdout: createOut } = await execAsync(
        `gh pr create --head ${branchName} --base ${targetBranch} --title "${issueId}" --body-file "${bodyFile}"`,
        execOptions
      );
      // gh pr create prints the PR URL as the last line of stdout
      const prUrl = createOut.trim().split('\n').pop()?.trim() || createOut.trim();
      return { created: true, prUrl };
    } finally {
      unlinkAsync(bodyFile).catch(() => {});
    }
  } catch (err: any) {
    return { created: false, error: err.message };
  }
}

function getFlyAppName(vmName: string): string {
  const match = vmName.match(/^([^-]+-[^-]+)/);
  return match ? match[1] : vmName;
}

function flyExecCmd(vmName: string, command: string): string {
  const appName = getFlyAppName(vmName);
  return `fly ssh console -a ${appName} -C "${command.replace(/"/g, '\\"')}"`;
}

async function repairFlywayIfNeeded(
  issueId: string,
  pgContainer: string,
  dbName: string,
  projectConfig: any,
  workspacePath: string,
  log?: (msg: string) => void
): Promise<{ repaired: boolean; message: string }> {
  const emit = log || ((msg: string) => console.log(`[flyway-repair] ${msg}`));

  try {
    await execAsync(`docker exec "${pgContainer}" pg_isready -U postgres`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    return { repaired: false, message: 'Postgres container not ready, skipping Flyway check' };
  }

  let rowCount = 0;
  try {
    const { stdout } = await execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d ${dbName} -t -A -c "SELECT count(*) FROM flyway_schema_history;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    rowCount = parseInt(stdout.trim(), 10) || 0;
  } catch {
    rowCount = 0;
  }

  if (rowCount >= 10) {
    return { repaired: false, message: `Flyway schema_history has ${rowCount} entries, no repair needed` };
  }

  emit(`Flyway schema_history has only ${rowCount} entries — repairing`);

  const seedRelPath = projectConfig.workspace?.database?.seed_file;
  if (!seedRelPath) {
    return { repaired: false, message: 'No seed_file configured, cannot locate Flyway baseline' };
  }

  const seedFile = join(projectConfig.path, seedRelPath);
  const flywayFile = join(dirname(seedFile), 'zzz-flyway-workspace-baseline.sql');
  if (!existsSync(flywayFile)) {
    return { repaired: false, message: `Flyway baseline not found: ${flywayFile}` };
  }

  emit(`Loading Flyway baseline from ${flywayFile}`);
  await execAsync(
    `docker exec -i "${pgContainer}" psql -U postgres -d ${dbName} < "${flywayFile}"`,
    { encoding: 'utf-8', timeout: 60000 }
  );

  const migrationsRelPath = projectConfig.workspace?.database?.migrations?.path;
  if (migrationsRelPath) {
    const migrationsDir = join(workspacePath, migrationsRelPath);
    if (existsSync(migrationsDir)) {
      emit(`Syncing Flyway checksums from workspace migrations`);
      const migrationFiles = (await readdir(migrationsDir)).filter(f => /^V\d+__.*\.sql$/.test(f));
      const updates: string[] = [];

      for (const file of migrationFiles) {
        const version = file.match(/^V(\d+)__/)?.[1];
        if (!version) continue;
        let content = await readFile(join(migrationsDir, file));
        if (content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF) {
          content = content.slice(3);
        }
        const lines = content.toString('utf-8').split(/\r?\n/);
        const checksum = crc32(Buffer.from(lines.join(''), 'utf-8')) | 0;
        updates.push(
          `UPDATE flyway_schema_history SET checksum = ${checksum} WHERE version = '${version}' AND checksum IS NOT NULL;`
        );
      }

      if (updates.length > 0) {
        const tmpSql = `/tmp/flyway-checksum-sync-${Date.now()}.sql`;
        await writeFile(tmpSql, updates.join('\n'));
        try {
          const { stdout } = await execAsync(
            `docker exec -i "${pgContainer}" psql -U postgres -d ${dbName} < "${tmpSql}"`,
            { encoding: 'utf-8', timeout: 30000 }
          );
          const updatedCount = (stdout.match(/UPDATE \d+/g) || [])
            .reduce((sum, m) => sum + parseInt(m.replace('UPDATE ', ''), 10), 0);
          emit(`Synced ${migrationFiles.length} migration checksums (${updatedCount} rows updated)`);
        } finally {
          try { await unlink(tmpSql); } catch {}
        }
      }
    }
  }

  try {
    const { stdout } = await execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d ${dbName} -t -A -c "SELECT count(*) FROM flyway_schema_history;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const newCount = parseInt(stdout.trim(), 10) || 0;
    emit(`Repair complete: flyway_schema_history now has ${newCount} entries (was ${rowCount})`);
    return { repaired: true, message: `Repaired Flyway schema_history: ${rowCount} → ${newCount} entries` };
  } catch (err: any) {
    return { repaired: false, message: `Repair may have failed: ${err.message}` };
  }
}

async function getIndexStats(workspacePath: string): Promise<{
  fileCount?: number;
  indexAge?: string;
  edgeCount?: number;
}> {
  const tldrPath = join(workspacePath, '.tldr');
  const tldrExists = await access(tldrPath).then(() => true, () => false);
  if (!tldrExists) return {};
  try {
    let indexAge: string | undefined;
    const langPath = join(tldrPath, 'languages.json');
    const langContent = await readFile(langPath, 'utf-8').catch(() => null);
    if (langContent) {
      const langData = JSON.parse(langContent);
      if (langData.timestamp) {
        const ageMs = Date.now() - langData.timestamp * 1000;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        indexAge =
          ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
      }
    }
    if (!indexAge) {
      const stats = await stat(tldrPath);
      const ageMs = Date.now() - stats.mtimeMs;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      indexAge =
        ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
    }
    let fileCount: number | undefined;
    let edgeCount: number | undefined;
    const cgPath = join(tldrPath, 'cache', 'call_graph.json');
    const cgContent = await readFile(cgPath, 'utf-8').catch(() => null);
    if (cgContent) {
      const cg = JSON.parse(cgContent);
      edgeCount = Array.isArray(cg.edges) ? cg.edges.length : undefined;
      if (Array.isArray(cg.edges)) {
        const files = new Set<string>();
        for (const e of cg.edges) {
          if (e.from_file) files.add(e.from_file);
          if (e.to_file) files.add(e.to_file);
        }
        fileCount = files.size;
      }
    }
    return { fileCount, indexAge, edgeCount };
  } catch (err) {
    console.error(`[getIndexStats] Error for ${workspacePath}:`, err);
    return {};
  }
}

// setReviewStatus wrapper (mirrors the index.ts version; side-effects are
// intentionally omitted here — the server-side side-effects (auto-PR, auto-merge)
// live in the Express server until full migration is complete).
function setReviewStatus(issueId: string, update: Partial<ReviewStatus>): ReviewStatus {
  return setReviewStatusBase(issueId, update);
}

// ─── Exported helper: approve push with divergence guard ─────────────────────
// Exported for unit testing — encapsulates the gitPush try-catch block from the
// approve route so the 409/400/success branches can be tested without a full
// Effect HTTP server.

export type ApprovePushResult =
  | { pushed: true }
  | { pushed: false; httpStatus: 409 | 400; error: string };

/**
 * Push merged main with a divergence guard.
 *
 * Throws `MainDivergedError` when origin/main has advanced past our local
 * ancestor — marks the workspace stuck and returns a 409 result so the route
 * handler can complete the pending operation and surface the error to the UI.
 *
 * All three outcomes (success, divergence/409, other-push-error/400) are tested
 * in `tests/unit/dashboard/server/routes/approve-push.test.ts`.
 */
export async function pushApproveMain(
  issueId: string,
  projectPath: string,
): Promise<ApprovePushResult> {
  try {
    await gitPush(projectPath, 'origin', 'main', { issueId });
    return { pushed: true };
  } catch (pushErr: unknown) {
    if (pushErr instanceof MainDivergedError) {
      // Mark the workspace stuck so Deacon skips it — no automatic retry.
      // Do NOT hard-reset local main here: that is a destructive operation that
      // must be explicit/user-confirmed, not a silent side-effect of a failed push.
      // The stuck flag prevents any further automatic approve attempts; when the
      // user manually unsticks and retries, the approve route's git pull --ff-only
      // step will detect the orphaned merge commit and surface a recoverable error
      // with instructions to run: git reset --hard origin/main
      markWorkspaceStuck(issueId, 'main_diverged', {
        localSha: pushErr.localSha,
        remoteSha: pushErr.remoteSha,
      });
      const error = `Push aborted: origin/main has advanced past your local ancestor (remote: ${pushErr.remoteSha?.slice(0, 7)}, local: ${pushErr.localSha?.slice(0, 7)}). A hotfix may have landed. Workspace marked stuck — to recover: cd ${projectPath} && git reset --hard origin/main, then unstick and retry.`;
      return { pushed: false, httpStatus: 409, error };
    }
    const message = pushErr instanceof Error ? pushErr.message : String(pushErr);
    const error = `Merge succeeded but push failed! Your work is safe locally.\nPlease push manually: cd ${projectPath} && git push origin main\nError: ${message}`;
    return { pushed: false, httpStatus: 400, error };
  }
}

// ─── Read JSON body helper ────────────────────────────────────────────────────

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: GET /api/workspaces/:issueId ─────────────────────────────────────

const getWorkspaceRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);

        if (workspaceInfo.isRemote && workspaceInfo.vmName) {
          return jsonResponse({
            exists: true,
            issueId,
            isRemote: true,
            vmName: workspaceInfo.vmName,
            remotePath: workspaceInfo.remotePath,
            agentId: workspaceInfo.agentId,
            path: `${workspaceInfo.vmName}:${workspaceInfo.remotePath}`,
            location: 'remote',
            message: `Workspace is on remote Fly machine: ${workspaceInfo.vmName}`,
          });
        }

        const workspaceName = `feature-${issueLower}`;
        const workspacePath = join(projectPath, 'workspaces', workspaceName);

        if (!existsSync(workspacePath)) {
          return jsonResponse({ exists: false, issueId });
        }

        const gitFile = join(workspacePath, '.git');
        const apiGit = join(workspacePath, 'api', '.git');
        const feGit = join(workspacePath, 'fe', '.git');
        const srcGit = join(workspacePath, 'src', '.git');
        const devcontainer = join(workspacePath, '.devcontainer');
        const claudeMd = join(workspacePath, 'CLAUDE.md');

        const hasValidStructure =
          existsSync(gitFile) ||
          existsSync(apiGit) ||
          existsSync(feGit) ||
          existsSync(srcGit) ||
          existsSync(devcontainer) ||
          existsSync(claudeMd);

        if (!hasValidStructure) {
          const location = getWorkspaceLocation(issueId);
          return jsonResponse({
            exists: true,
            corrupted: true,
            issueId,
            path: workspacePath,
            message: 'Workspace exists but is not a valid git worktree or containerized workspace',
            location,
          });
        }

        const projectConfig = findProjectByTeam(issuePrefix);
        const dnsDomain = projectConfig?.workspace?.dns?.domain || 'localhost';
        const featureFolder = `feature-${issueLower}`;

        let frontendUrl = `https://${featureFolder}.${dnsDomain}`;
        let apiUrl = `https://api-${featureFolder}.${dnsDomain}`;

        if (projectConfig?.workspace?.dns?.entries) {
          const entries = projectConfig.workspace.dns.entries;
          if (entries[0]) {
            frontendUrl = `https://${entries[0]
              .replace('{{FEATURE_FOLDER}}', featureFolder)
              .replace('{{DOMAIN}}', dnsDomain)}`;
          }
          if (entries[1]) {
            apiUrl = `https://${entries[1]
              .replace('{{FEATURE_FOLDER}}', featureFolder)
              .replace('{{DOMAIN}}', dnsDomain)}`;
          }
        }

        let services: { name: string; url?: string }[] = [];
        const stateMd = join(workspacePath, '.planning', 'STATE.md');
        const workspaceMd = join(workspacePath, 'WORKSPACE.md');
        const dockerCompose = join(workspacePath, 'docker-compose.yml');

        const urlSourceFile = existsSync(stateMd)
          ? stateMd
          : existsSync(workspaceMd)
          ? workspaceMd
          : null;

        if (urlSourceFile) {
          try {
            const content = yield* Effect.promise(() => readFile(urlSourceFile, 'utf-8'));
            const urlMatches = content.matchAll(/(\w+):\s*(https?:\/\/[^\s\n]+)/gi);
            for (const match of urlMatches) {
              services.push({ name: match[1], url: match[2] });
            }
          } catch {}
        }

        if (services.length === 0) {
          services = [
            { name: 'Frontend', url: frontendUrl },
            { name: 'API', url: apiUrl },
          ];
        }

        const devcontainerPath = join(workspacePath, '.devcontainer');
        const hasDocker =
          existsSync(dockerCompose) ||
          existsSync(join(workspacePath, 'compose.yaml')) ||
          existsSync(join(devcontainerPath, 'docker-compose.yml')) ||
          existsSync(join(devcontainerPath, 'docker-compose.devcontainer.yml')) ||
          existsSync(join(devcontainerPath, 'compose.yaml')) ||
          existsSync(join(devcontainerPath, 'compose.infra.yml')) ||
          existsSync(devcontainerPath);

        const canContainerize = !hasDocker && existsSync(join(projectPath, 'infra', 'new-feature'));

        const agentSession = `agent-${issueLower}`;
        const [git, repoGit, containers, mrUrl, sessionNames, paneOutput] = yield* Effect.promise(() => Promise.all([
          getGitStatusAsync(workspacePath),
          getRepoGitStatusAsync(workspacePath),
          hasDocker ? getContainerStatusAsync(issueId, projectPath) : Promise.resolve(null),
          getMrUrlAsync(issueId, workspacePath),
          listSessionNamesAsync(),
          capturePaneAsync(agentSession, 50).catch(() => ''),
        ]));

        let hasAgent = false;
        let agentSessionId: string | null = null;
        let agentModel: string | undefined;
        let agentModelFull: string | undefined;

        if (sessionNames.includes(agentSession)) {
          hasAgent = true;
          agentSessionId = agentSession;

          // Match Anthropic models: [Opus], [Sonnet 4.6], [Haiku 4.5]
          // Also match OpenAI models: [gpt-5.4], [oai@gpt-5.4], [o3], [cx@o3], [o4-mini]
          const modelMatch = paneOutput.match(
            /\[((?:oai|cx|go)?@?(?:gpt-[0-9.]+(?:-mini|-nano|-pro)?|o[1-4](?:-mini)?(?:-high)?|gemini-[0-9.]+(?:-pro|-flash|-lite)?))[^\]]*\]/i
          ) || paneOutput.match(/\[(Opus|Sonnet|Haiku)[^\]]*\]/i);
          agentModel = modelMatch ? modelMatch[1] : undefined;

          const fullModel = getActiveSessionModel(workspacePath);
          if (fullModel) agentModelFull = fullModel;
        }

        const pendingOperation = getPendingOperation(issueId);
        const location = getWorkspaceLocation(issueId);
        const reviewStatus = getReviewStatus(issueId);

        if (
          pendingOperation?.type === 'merge' &&
          pendingOperation.status === 'failed' &&
          reviewStatus?.mergeStatus !== 'merged'
        ) {
          yield* Effect.promise(() => reconcileGitHubMergeStatus(issueId, reviewStatus));
        }

        return jsonResponse({
          exists: true,
          issueId,
          path: workspacePath,
          frontendUrl,
          apiUrl,
          mrUrl,
          hasAgent,
          agentSessionId,
          agentModel,
          agentModelFull,
          git,
          repoGit,
          services,
          containers,
          hasDocker,
          canContainerize,
          pendingOperation,
          location,
        });
  }))
);

// ─── Route: POST /api/workspaces ─────────────────────────────────────────────

const postWorkspacesRoute = HttpRouter.add(
  'POST',
  '/api/workspaces',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { issueId, projectId } = body as { issueId?: string; projectId?: string };

    if (!issueId) {
      return jsonResponse({ error: 'issueId required' }, { status: 400 });
    }

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(projectId, issuePrefix);
    const activityId = spawnPanCommand(
      ['workspace', 'create', issueId],
      `Create workspace for ${issueId}`,
      projectPath
    );
    return jsonResponse({
      success: true,
      message: `Creating workspace for ${issueId}`,
      activityId,
      projectPath,
    });
  }))
);

// ─── Route: GET /api/workspaces/:issueId/plan ─────────────────────────────────

const getWorkspacePlanRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);

    const planPath = findPlan(workspacePath);
    if (!planPath) {
      return jsonResponse(
        { error: 'No vBRIEF plan found for this workspace' },
        { status: 404 }
      );
    }

    const doc = readPlan(planPath);
    const cp = criticalPath(doc);
    return jsonResponse({ ...doc, criticalPath: cp });
  }))
);

// ─── Route: GET /api/workspaces/:issueId/clean/preview ───────────────────────

const getWorkspaceCleanPreviewRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/clean/preview',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 404 });
    }

    return yield* Effect.promise(async () => {
        const excludeDirs = [
          'node_modules', 'target', 'dist', 'build', '.git', '__pycache__', '.cache', '.next', 'coverage',
        ];
        const excludePattern = excludeDirs.map(d => `-name "${d}" -prune`).join(' -o ');
        const findCmd = `find "${workspacePath}" \\( ${excludePattern} \\) -o -type f -print 2>/dev/null | head -500`;
        const { stdout: filesOutput } = await execAsync(findCmd, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
        const files = filesOutput.trim()
          ? filesOutput.trim().split('\n').map(f => f.replace(workspacePath + '/', ''))
          : [];

        let totalSize = '0';
        try {
          const duCmd = `du -sh "${workspacePath}" --exclude=node_modules --exclude=target --exclude=dist --exclude=.git 2>/dev/null | cut -f1`;
          const { stdout: sizeOutput } = await execAsync(duCmd, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
          });
          totalSize = sizeOutput.trim() || '0';
        } catch {
          totalSize = 'unknown';
        }

        const codeFiles = files.filter(f =>
          /\.(ts|tsx|js|jsx|java|py|rs|go|rb|php|cs|swift|kt)$/.test(f)
        );
        const configFiles = files.filter(
          f => /\.(json|yaml|yml|toml|xml|env|md)$/.test(f) || f.includes('config')
        );
        const otherFiles = files.filter(f => !codeFiles.includes(f) && !configFiles.includes(f));

        let diffAnalysis: {
          modifiedFiles: string[];
          newFiles: string[];
          unchangedFiles: string[];
          comparedAgainst: string;
          error?: string;
        } = { modifiedFiles: [], newFiles: [], unchangedFiles: [], comparedAgainst: 'main' };

        try {
          const subrepos: { prefix: string; gitRoot: string }[] = [];
          const possibleSubrepos = ['fe', 'api', 'frontend', 'backend', 'web', 'server'];
          for (const subdir of possibleSubrepos) {
            const subdirPath = join(workspacePath, subdir);
            if (existsSync(join(subdirPath, '.git'))) {
              subrepos.push({ prefix: subdir + '/', gitRoot: subdirPath });
            }
          }

          let mainGitRoot: string | null = null;
          const possibleRoots = [projectPath, join(projectPath, '..'), workspacePath];
          for (const root of possibleRoots) {
            if (existsSync(join(root, '.git'))) {
              mainGitRoot = root;
              break;
            }
          }

          const filesToCheck = codeFiles.slice(0, 100);
          const reposUsed: string[] = [];

          for (const file of filesToCheck) {
            const workspaceFilePath = join(workspacePath, file);
            let gitRoot: string | null = null;
            let relativePath = file;

            for (const { prefix, gitRoot: subGitRoot } of subrepos) {
              if (file.startsWith(prefix)) {
                gitRoot = subGitRoot;
                relativePath = file.slice(prefix.length);
                if (!reposUsed.includes(prefix)) reposUsed.push(prefix);
                break;
              }
            }

            if (!gitRoot && mainGitRoot) {
              gitRoot = mainGitRoot;
              if (!reposUsed.includes('main')) reposUsed.push('main');
            }

            if (!gitRoot) {
              diffAnalysis.newFiles.push(file);
              continue;
            }

            try {
              const branchName = `feature/${issueLower}`;
              let compareRef = 'main';
              try {
                await execAsync(`git rev-parse --verify ${branchName} 2>/dev/null`, {
                  cwd: gitRoot,
                  encoding: 'utf-8',
                  maxBuffer: 10 * 1024 * 1024,
                });
                compareRef = branchName;
              } catch {
                try {
                  await execAsync(`git rev-parse --verify main 2>/dev/null`, {
                    cwd: gitRoot,
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                  });
                } catch {
                  compareRef = 'master';
                }
              }

              const { stdout: gitContent } = await execAsync(
                `git show ${compareRef}:${relativePath} 2>/dev/null`,
                { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
              );
              const workspaceContent = await readFile(workspaceFilePath, 'utf-8');
              if (gitContent === workspaceContent) {
                diffAnalysis.unchangedFiles.push(file);
              } else {
                diffAnalysis.modifiedFiles.push(file);
              }
            } catch {
              diffAnalysis.newFiles.push(file);
            }
          }

          diffAnalysis.comparedAgainst =
            reposUsed.length > 0 ? `${reposUsed.join(', ')} repos (main branch)` : 'main';

          if (subrepos.length === 0 && !mainGitRoot) {
            diffAnalysis.error = 'Could not find git repository to compare against';
          }
        } catch (diffError: any) {
          diffAnalysis.error = `Diff analysis failed: ${diffError.message}`;
        }

    return jsonResponse({
      workspacePath,
      totalSize,
      fileCount: files.length,
      codeFiles: codeFiles.slice(0, 50),
      configFiles: configFiles.slice(0, 30),
      otherFiles: otherFiles.slice(0, 20),
      hasMore: files.length > 100,
      backupPath: join(
        projectPath,
        'workspaces',
        `.backup-${workspaceName}-${Date.now()}`
      ),
      diffAnalysis,
    });
    });
  }))
);

// ─── Route: POST /api/workspaces/:issueId/clean ───────────────────────────────

const postWorkspaceCleanRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/clean',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const { createBackup } = body as { createBackup?: boolean };

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 404 });
    }

    let backupPath: string | null = null;

    if (createBackup) {
      backupPath = join(
        projectPath,
        'workspaces',
        `.backup-${workspaceName}-${Date.now()}`
      );
      console.log(`Creating backup: ${workspacePath} -> ${backupPath}`);
      yield* Effect.promise(() => execAsync(
        `rsync -a --quiet --exclude=node_modules --exclude=target --exclude=dist --exclude=.git --exclude=__pycache__ --exclude=.cache --exclude=.next --exclude=coverage "${workspacePath}/" "${backupPath}/"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      ));
    }

    console.log(`Removing corrupted workspace: ${workspacePath}`);
    try {
      yield* Effect.promise(() => execAsync(`rm -rf "${workspacePath}"`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      }));
    } catch {
      console.log('Regular rm failed, using Docker to clean up root-owned files...');
      yield* Effect.promise(() => execAsync(
        `docker run --rm -v "${workspacePath}:/cleanup" alpine sh -c "rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      ));
      yield* Effect.promise(() => execAsync(`rmdir "${workspacePath}"`, { encoding: 'utf-8' }));
    }

    const activityId = spawnPanCommand(
      ['workspace', 'create', issueId],
      `Recreate workspace for ${issueId}`,
      projectPath
    );

    return jsonResponse({
      success: true,
      message: createBackup
        ? `Backed up to ${backupPath} and recreating workspace for ${issueId}`
        : `Cleaned corrupted workspace and recreating for ${issueId}`,
      activityId,
      projectPath,
      backupPath,
    });
  }))
);

// ─── Route: POST /api/workspaces/:issueId/containerize ───────────────────────

const postWorkspaceContainerizeRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/containerize',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();

    const newFeatureScript = join(projectPath, 'infra', 'new-feature');
    if (!existsSync(newFeatureScript)) {
      return jsonResponse(
        { error: 'Project does not support containerization (no infra/new-feature script)' },
        { status: 400 }
      );
    }

    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);
    if (existsSync(join(workspacePath, '.devcontainer'))) {
      return jsonResponse({ error: 'Workspace is already containerized' }, { status: 400 });
    }

    try {
      yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
    } catch {
      return jsonResponse(
        { error: 'Docker is not running. Start Docker Desktop first.' },
        { status: 400 }
      );
    }

    if (existsSync(workspacePath)) {
      yield* Effect.promise(() => execAsync(`pan workspace destroy ${issueId} --force 2>/dev/null || true`, {
        cwd: projectPath,
        encoding: 'utf-8',
      }));
    }

    const featureName = issueLower;
    const activityId = Date.now().toString();

    logActivity({
      id: activityId,
      timestamp: new Date().toISOString(),
      command: `./new-feature ${featureName}`,
      status: 'running',
      output: [],
    });

    const child = spawn('./new-feature', [featureName], {
      cwd: join(projectPath, 'infra'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, line);
      });
    });
    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, `[stderr] ${line}`);
      });
    });

    child.on('close', (code) => {
      appendActivityOutput(
        activityId,
        `[${new Date().toISOString()}] new-feature exited with code ${code}`
      );
      if (code === 0) {
        appendActivityOutput(activityId, '');
        appendActivityOutput(activityId, '=== Starting containers ===');

        const workspaceDir = join(projectPath, 'workspaces', `feature-${featureName}`);
        const uid = process.getuid?.() ?? 1000;
        const gid = process.getgid?.() ?? 1000;
        const devUp = spawn('./dev', ['all'], {
          cwd: workspaceDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            UID: String(uid),
            GID: String(gid),
            DOCKER_USER: `${uid}:${gid}`,
          },
        });

        devUp.stdout?.on('data', (data) => {
          data.toString().split('\n').filter(Boolean).forEach((line: string) => {
            appendActivityOutput(activityId, line);
          });
        });
        devUp.stderr?.on('data', (data) => {
          data.toString().split('\n').filter(Boolean).forEach((line: string) => {
            appendActivityOutput(activityId, `[stderr] ${line}`);
          });
        });
        devUp.on('close', (devCode) => {
          appendActivityOutput(
            activityId,
            `[${new Date().toISOString()}] ./dev all exited with code ${devCode}`
          );
          updateActivity(activityId, { status: devCode === 0 ? 'completed' : 'failed' });
        });
        devUp.on('error', (err) => {
          appendActivityOutput(activityId, `[error] ${err.message}`);
          updateActivity(activityId, { status: 'failed' });
        });
      } else {
        updateActivity(activityId, { status: 'failed' });
      }
    });

    child.on('error', (err) => {
      appendActivityOutput(activityId, `[error] ${err.message}`);
      updateActivity(activityId, { status: 'failed' });
    });

    return jsonResponse({
      success: true,
      message: `Containerizing workspace for ${issueId}`,
      activityId,
      projectPath,
    });
  }))
);

// ─── Route: POST /api/issues/:issueId/start ───────────────────────────────

const postWorkspaceStartRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 400 });
    }

    // Copy planning artifacts from project root if needed
    const workspacePlanningDir = join(workspacePath, '.planning');
    if (!existsSync(join(workspacePlanningDir, 'STATE.md'))) {
      const legacyPlanningDir = join(projectPath, '.planning', issueLower);
      if (existsSync(legacyPlanningDir)) {
        try {
          yield* Effect.promise(() => mkdir(workspacePlanningDir, { recursive: true }));
          yield* Effect.promise(() => execAsync(
            `cp -r "${legacyPlanningDir}/"* "${workspacePlanningDir}/"`,
            { encoding: 'utf-8', shell: '/bin/bash' }
          ));
          console.log(
            `[workspace/start] Copied planning from ${legacyPlanningDir} to workspace for ${issueId}`
          );
        } catch (e) {
          console.warn(`[workspace/start] Could not copy planning: ${e}`);
        }
      }
    }

    const workspaceBeadsDir = join(workspacePath, '.beads');
    if (!existsSync(workspaceBeadsDir)) {
      const projectRootBeadsDir = join(projectPath, '.beads');
      if (existsSync(projectRootBeadsDir)) {
        try {
          yield* Effect.promise(() => execAsync(`cp -r "${projectRootBeadsDir}" "${workspaceBeadsDir}"`, {
            encoding: 'utf-8',
          }));
          console.log(
            `[workspace/start] Copied beads from project root to workspace for ${issueId}`
          );
        } catch (e) {
          console.warn(`[workspace/start] Could not copy beads: ${e}`);
        }
      }
    }

    // Check for ./dev script
    const devScript = join(workspacePath, 'dev');
    const devScriptInContainer = join(workspacePath, '.devcontainer', 'dev');

    if (!existsSync(devScript)) {
      if (existsSync(devScriptInContainer)) {
        try {
          yield* Effect.promise(() => symlink('.devcontainer/dev', devScript));
          yield* Effect.promise(() => chmod(devScriptInContainer, 0o755));
          console.log(`[workspace/start] Repaired: created ./dev symlink for ${issueId}`);
        } catch (repairErr) {
          return jsonResponse(
            {
              error: `Workspace has no ./dev script and repair failed: ${repairErr}`,
            },
            { status: 400 }
          );
        }
      } else {
        return jsonResponse(
          { error: 'Workspace has no ./dev script (checked root and .devcontainer/)' },
          { status: 400 }
        );
      }
    }

    // Repair .env if needed
    const envFilePath = join(workspacePath, '.env');
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

    if (projectConfig?.workspace?.ports && projectConfig?.workspace?.env?.template) {
      const featureFolder = `feature-${issueLower}`;
      let needsRepair = !existsSync(envFilePath);

      if (!needsRepair && existsSync(envFilePath)) {
        const existingEnv = yield* Effect.promise(() => readFile(envFilePath, 'utf-8'));
        for (const portName of Object.keys(projectConfig.workspace.ports)) {
          const portVar = `${portName.toUpperCase()}_PORT`;
          if (!existingEnv.includes(portVar)) {
            needsRepair = true;
            break;
          }
        }
      }

      if (needsRepair) {
        try {
          const placeholders: Record<string, string> = { FEATURE_FOLDER: featureFolder };
          for (const [portName, portConfig] of Object.entries(
            projectConfig.workspace.ports
          )) {
            const portFile = join(projectPath, `.${portName}-ports`);
            const range = (portConfig as any).range as [number, number];
            let content = '';
            if (existsSync(portFile)) content = yield* Effect.promise(() => readFile(portFile, 'utf-8'));
            const lines = content.split('\n').filter(Boolean);
            let port: number | null = null;
            for (const line of lines) {
              const [folder, p] = line.split(':');
              if (folder === featureFolder) {
                port = parseInt(p, 10);
                break;
              }
            }
            if (!port) {
              const usedPorts = new Set(lines.map(l => parseInt(l.split(':')[1], 10)));
              for (let p = range[0]; p <= range[1]; p++) {
                if (!usedPorts.has(p)) {
                  port = p;
                  yield* Effect.promise(() => writeFile(
                    portFile,
                    content +
                      (content.endsWith('\n') || !content ? '' : '\n') +
                      `${featureFolder}:${port}\n`
                  ));
                  break;
                }
              }
            }
            if (port) placeholders[`${portName.toUpperCase()}_PORT`] = String(port);
          }
          let envContent = projectConfig.workspace.env.template;
          for (const [key, value] of Object.entries(placeholders)) {
            envContent = envContent.replace(
              new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
              value
            );
          }
          yield* Effect.promise(() => writeFile(envFilePath, envContent));
          console.log(
            `[workspace/start] Repaired: created .env with port assignments for ${issueId}`
          );
        } catch (envErr) {
          console.warn(
            `[workspace/start] Could not repair .env for ${issueId}: ${envErr}`
          );
        }
      }
    }

    // Check Docker is running
    try {
      yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
    } catch {
      return jsonResponse(
        { error: 'Docker is not running. Start Docker Desktop first.' },
        { status: 400 }
      );
    }

    // Pre-start Flyway repair if applicable
    if (projectConfig?.workspace?.database?.migrations?.type === 'flyway') {
      try {
        const composePaths = [
          join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
          join(workspacePath, 'docker-compose.yml'),
        ];
        let compFile: string | undefined;
        for (const cp of composePaths) {
          if (existsSync(cp)) { compFile = cp; break; }
        }
        if (compFile) {
          const { stdout: pnOut } = yield* Effect.promise(() => execAsync(
            `docker compose -f "${compFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
            { encoding: 'utf-8' }
          ));
          const composeName = pnOut.trim();
          if (composeName) {
            const pgContainer = `${composeName}-postgres-1`;
            const result = yield* Effect.promise(() => repairFlywayIfNeeded(
              issueId,
              pgContainer,
              'myn',
              projectConfig,
              workspacePath
            ));
            if (result.repaired) {
              console.log(`[workspace/start] Pre-start Flyway repair: ${result.message}`);
            }
          }
        }
      } catch (preCheckErr: any) {
        console.log(
          `[workspace/start] Pre-start Flyway check skipped: ${preCheckErr.message}`
        );
      }
    }

    const activityId = Date.now().toString();
    logActivity({
      id: activityId,
      timestamp: new Date().toISOString(),
      command: `./dev all (${issueId})`,
      status: 'running',
      output: [],
    });

    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;

    const child = spawn('./dev', ['all'], {
      cwd: workspacePath,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        UID: String(uid),
        GID: String(gid),
        DOCKER_USER: `${uid}:${gid}`,
      },
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, line);
      });
    });
    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, `[stderr] ${line}`);
      });
    });

    child.on('close', (code) => {
      appendActivityOutput(
        activityId,
        `[${new Date().toISOString()}] ./dev all exited with code ${code}`
      );

      if (code !== 0 && projectConfig?.workspace?.database?.migrations?.type === 'flyway') {
        (async () => {
          try {
            const composePaths = [
              join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
              join(workspacePath, 'docker-compose.yml'),
            ];
            let composeFile: string | undefined;
            for (const cp of composePaths) {
              if (existsSync(cp)) { composeFile = cp; break; }
            }
            if (!composeFile) return;

            const { stdout: pnOut } = await execAsync(
              `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
              { encoding: 'utf-8' }
            );
            const composeName = pnOut.trim();
            if (!composeName) return;

            const apiContainer = `${composeName}-api-1`;
            const pgContainer = `${composeName}-postgres-1`;

            const { stdout: apiStatus } = await execAsync(
              `docker ps -a --filter "name=^${apiContainer}$" --format "{{.Status}}" 2>/dev/null`,
              { encoding: 'utf-8' }
            );
            if (!apiStatus.trim().startsWith('Exited')) return;

            const { stdout: logs } = await execAsync(
              `docker logs --tail 50 "${apiContainer}" 2>&1 || true`,
              { encoding: 'utf-8', timeout: 10000 }
            );
            if (!logs.toLowerCase().includes('flyway')) return;

            appendActivityOutput(activityId, '');
            appendActivityOutput(
              activityId,
              '=== Detected Flyway failure — attempting auto-repair ==='
            );

            const result = await repairFlywayIfNeeded(
              issueId,
              pgContainer,
              'myn',
              projectConfig,
              workspacePath,
              (msg) => appendActivityOutput(activityId, `[flyway-repair] ${msg}`)
            );

            if (result.repaired) {
              appendActivityOutput(activityId, `[flyway-repair] Restarting API container...`);
              await execAsync(`docker start "${apiContainer}"`, {
                encoding: 'utf-8',
                timeout: 30000,
              });
              appendActivityOutput(
                activityId,
                `[flyway-repair] API container restarted successfully`
              );
              updateActivity(activityId, { status: 'completed' });
              return;
            }
          } catch (repairErr: any) {
            appendActivityOutput(
              activityId,
              `[flyway-repair] Auto-repair failed: ${repairErr.message}`
            );
          }
          updateActivity(activityId, { status: 'failed' });
        })();
      } else {
        updateActivity(activityId, { status: code === 0 ? 'completed' : 'failed' });
      }
    });

    child.on('error', (err) => {
      appendActivityOutput(activityId, `[error] ${err.message}`);
      updateActivity(activityId, { status: 'failed' });
    });

    return jsonResponse({
      success: true,
      message: `Starting containers for ${issueId}`,
      activityId,
    });
  }))
);

// ─── Route: POST /api/workspaces/:issueId/containers/:containerName/:action ───

const postWorkspaceContainerActionRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/containers/:containerName/:action',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const containerName = params['containerName'] ?? '';
    const action = params['action'] ?? '';

    if (!['start', 'stop', 'restart'].includes(action)) {
      return jsonResponse(
        { error: 'Invalid action. Must be start, stop, or restart.' },
        { status: 400 }
      );
    }

    const teamPrefix = extractTeamPrefix(issueId);
    const containerProjectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
    const projectPaths = containerProjectConfig
      ? [
          join(
            containerProjectConfig.path,
            'workspaces',
            `feature-${issueId.toLowerCase()}`
          ),
        ]
      : listProjects().map(p =>
          join(p.path, 'workspaces', `feature-${issueId.toLowerCase()}`)
        );

    let workspacePath: string | null = null;
    let composeFile: string | null = null;

    for (const path of projectPaths) {
      if (existsSync(path)) {
        workspacePath = path;
        const composePaths = [
          join(path, '.devcontainer/docker-compose.devcontainer.yml'),
          join(path, 'docker-compose.yml'),
          join(path, 'docker-compose.yaml'),
        ];
        for (const cp of composePaths) {
          if (existsSync(cp)) {
            composeFile = cp;
            break;
          }
        }
        break;
      }
    }

    if (!workspacePath) {
      return jsonResponse(
        { error: `Workspace not found for ${issueId}` },
        { status: 404 }
      );
    }

    if (!composeFile) {
      return jsonResponse(
        { error: `No docker-compose file found in workspace` },
        { status: 404 }
      );
    }

    try {
      yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
    } catch {
      return jsonResponse(
        { error: 'Docker is not running. Start Docker Desktop first.' },
        { status: 400 }
      );
    }

    const serviceMap: Record<string, string[]> = {
      frontend: ['fe', 'frontend'],
      api: ['api'],
      dev: ['dev'],
      postgres: ['postgres'],
      redis: ['redis'],
      fe: ['fe', 'frontend'],
    };

    const serviceNames = serviceMap[containerName.toLowerCase()];
    if (!serviceNames) {
      return jsonResponse(
        {
          error: `Unknown container: ${containerName}. Valid: ${Object.keys(serviceMap).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const { stdout: projectNameOut } = yield* Effect.promise(() => execAsync(
      `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
      { encoding: 'utf-8' }
    ));
    const projectName = projectNameOut.trim();

    // Pre-start Flyway repair for API containers
    if (
      containerName.toLowerCase() === 'api' &&
      ['start', 'restart'].includes(action)
    ) {
      const tPrefix = extractTeamPrefix(issueId);
      const pConfig = tPrefix ? findProjectByTeam(tPrefix) : null;
      if (
        pConfig?.workspace?.database?.migrations?.type === 'flyway' &&
        projectName
      ) {
        const pgContainer = `${projectName}-postgres-1`;
        try {
          const result = yield* Effect.promise(() => repairFlywayIfNeeded(
            issueId,
            pgContainer,
            'myn',
            pConfig,
            workspacePath!
          ));
          if (result.repaired) {
            console.log(`[container-control] ${result.message}`);
          }
        } catch (repairErr: any) {
          console.warn(
            `[container-control] Flyway pre-check failed (non-fatal): ${repairErr.message}`
          );
        }
      }
    }

    let success = false;
    let lastError = '';

    for (const serviceName of serviceNames) {
      try {
        const cmd = `docker compose -f "${composeFile}" ${projectName ? `--project-name "${projectName}"` : ''} ${action} ${serviceName}`;
        console.log(`[container-control] Running: ${cmd}`);
        yield* Effect.promise(() => execAsync(cmd, { encoding: 'utf-8', timeout: 30000 }));
        success = true;
        console.log(
          `[container-control] Successfully ${action}ed ${serviceName} for ${issueId}`
        );
        break;
      } catch (err: any) {
        lastError = err.message || String(err);
      }
    }

    if (success) {
      return jsonResponse({
        success: true,
        message: `Container ${containerName} ${action}ed successfully`,
      });
    } else {
      return jsonResponse(
        { error: `Failed to ${action} ${containerName}: ${lastError}` },
        { status: 500 }
      );
    }
  }))
);

// ─── Route: POST /api/workspaces/:issueId/refresh-db ─────────────────────────

const postWorkspaceRefreshDbRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/refresh-db',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

    if (!projectConfig) {
      return jsonResponse(
        { error: `No project found for issue prefix: ${issueId}` },
        { status: 404 }
      );
    }

    const dbConfig = projectConfig.workspace?.database;
    if (!dbConfig?.seed_file) {
      return jsonResponse(
        { error: 'No seed_file configured in projects.yaml database config' },
        { status: 400 }
      );
    }

    const seedFile = join(projectConfig.path, dbConfig.seed_file);
    if (!existsSync(seedFile)) {
      return jsonResponse(
        { error: `Seed file not found: ${seedFile}` },
        { status: 400 }
      );
    }

    const flywayFile = join(dirname(seedFile), 'zzz-flyway-workspace-baseline.sql');
    if (!existsSync(flywayFile)) {
      return jsonResponse(
        { error: `Flyway baseline not found: ${flywayFile}` },
        { status: 400 }
      );
    }

    const issueLower = issueId.toLowerCase();
    const featureFolder = `feature-${issueLower}`;
    const workspacesDir = projectConfig.workspace?.workspaces_dir || 'workspaces';
    const workspacePath = join(projectConfig.path, workspacesDir, featureFolder);

    if (!existsSync(workspacePath)) {
      return jsonResponse(
        { error: `Workspace not found: ${featureFolder}` },
        { status: 404 }
      );
    }

    const composePaths = [
      join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
      join(workspacePath, 'docker-compose.yml'),
      join(workspacePath, 'docker-compose.yaml'),
    ];
    let composeFile: string | null = null;
    for (const cp of composePaths) {
      if (existsSync(cp)) { composeFile = cp; break; }
    }

    if (!composeFile) {
      return jsonResponse(
        { error: 'No docker-compose file found in workspace' },
        { status: 404 }
      );
    }

    const { stdout: projectNameOut } = yield* Effect.promise(() => execAsync(
      `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
      { encoding: 'utf-8' }
    ));
    const projectName = projectNameOut.trim();

    if (!projectName) {
      return jsonResponse(
        { error: 'Could not determine docker compose project name' },
        { status: 500 }
      );
    }

    const pgContainer = `${projectName}-postgres-1`;
    const apiContainer = `${projectName}-api-1`;

    console.log(`[refresh-db] Starting DB refresh for ${issueId} (project: ${projectName})`);

    try {
      yield* Effect.promise(() => execAsync(`docker stop "${apiContainer}"`, { encoding: 'utf-8', timeout: 30000 }));
    } catch {
      console.log(`[refresh-db] API container not running or already stopped`);
    }

    yield* Effect.promise(() => execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'myn' AND pid <> pg_backend_pid();"`,
      { encoding: 'utf-8', timeout: 10000 }
    ));
    yield* Effect.promise(() => execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS myn;"`,
      { encoding: 'utf-8', timeout: 10000 }
    ));
    yield* Effect.promise(() => execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d postgres -c "CREATE DATABASE myn OWNER postgres;"`,
      { encoding: 'utf-8', timeout: 10000 }
    ));

    console.log(`[refresh-db] Loading seed file: ${seedFile}`);
    yield* Effect.promise(() => execAsync(
      `docker exec -i "${pgContainer}" psql -U postgres -d myn < "${seedFile}"`,
      { encoding: 'utf-8', timeout: 600000 }
    ));

    const repairResult = yield* Effect.promise(() => repairFlywayIfNeeded(
      issueId,
      pgContainer,
      'myn',
      projectConfig,
      workspacePath,
      (msg) => console.log(`[refresh-db] ${msg}`)
    ));
    console.log(`[refresh-db] Flyway setup: ${repairResult.message}`);

    try {
      yield* Effect.promise(() => execAsync(`docker start "${apiContainer}"`, { encoding: 'utf-8', timeout: 30000 }));
    } catch {
      console.log(`[refresh-db] Could not start API container (may need manual start)`);
    }

    let customerCount = 0;
    try {
      const { stdout } = yield* Effect.promise(() => execAsync(
        `docker exec "${pgContainer}" psql -U postgres -d myn -t -A -c "SELECT count(*) FROM customer;"`,
        { encoding: 'utf-8', timeout: 10000 }
      ));
      customerCount = parseInt(stdout.trim(), 10) || 0;
    } catch {}

    console.log(
      `[refresh-db] DB refresh complete for ${issueId}: ${customerCount} customers`
    );

    return jsonResponse({
      success: true,
      message: `Database refreshed successfully`,
      customerCount,
    });
  }))
);

// ─── Route: GET /api/review/:issueId/status ───────────────────────

const getWorkspaceReviewStatusRoute = HttpRouter.add(
  'GET',
  '/api/review/:issueId/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const status = getReviewStatus(issueId);
    const base: ReviewStatus = status || {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
    };

    let { queuePosition, activeSpecialist } = computeQueuePositionFromStatus(status);

    // Discover active parallel review sessions for this issue
    let reviewCoordinatorSessionName: string | undefined;
    let reviewSessionNames: string[] | undefined;
    let reviewSubStatuses: Record<string, 'running' | 'done'> | undefined;
    try {
      const allSessions = yield* Effect.promise(() => listSessionNamesAsync());
      const enriched = enrichReviewStatusFromSessions(issueId, base, allSessions);
      reviewCoordinatorSessionName = enriched.reviewCoordinatorSessionName;
      reviewSessionNames = enriched.reviewSessionNames;
      reviewSubStatuses = enriched.reviewSubStatuses;
    } catch { /* non-fatal: tmux may not be available */ }

    // Only the merge queue is persistent — check it when no active phase is detected
    if (queuePosition === null) {
      try {
        const resolved = resolveProjectFromIssue(issueId);
        if (resolved) {
          const { getQueueForProject } = yield* Effect.promise(() =>
            import('../../../lib/database/merge-queue-db.js')
          );
          const mergeQueue = getQueueForProject(resolved.projectKey);
          const mergePos = findPositionInQueue(issueId, mergeQueue.map(e => ({
            id: String(e.id),
            type: 'task' as const,
            priority: 'normal' as const,
            source: 'merge-queue',
            payload: { issueId: e.issueId },
            createdAt: e.queuedAt,
          })));
          if (mergePos > 0) {
            queuePosition = mergePos;
            activeSpecialist = 'merge';
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[review-status] Merge queue lookup failed for ${issueId} (non-fatal): ${msg}`);
      }
    }

    return jsonResponse({ ...base, queuePosition, activeSpecialist, reviewCoordinatorSessionName, reviewSessionNames, reviewSubStatuses });
  }))
);

// ─── Route: POST /api/review/:issueId/status ──────────────────────

const postWorkspaceReviewStatusRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { reviewStatus, testStatus, mergeStatus, reviewNotes, testNotes, verificationStatus, readyForMerge } = body as {
      reviewStatus?: string;
      testStatus?: string;
      mergeStatus?: string;
      reviewNotes?: string;
      testNotes?: string;
      verificationStatus?: string;
      readyForMerge?: boolean;
    };

    const update: Partial<ReviewStatus> = {};
    if (reviewStatus) update.reviewStatus = reviewStatus as any;
    if (testStatus) update.testStatus = testStatus as any;
    if (mergeStatus) update.mergeStatus = mergeStatus as any;
    if (reviewNotes) update.reviewNotes = reviewNotes;
    if (testNotes) update.testNotes = testNotes;
    if (verificationStatus) update.verificationStatus = verificationStatus as any;
    if (readyForMerge !== undefined) update.readyForMerge = readyForMerge;

    const status = setReviewStatus(issueId, update);
    console.log(`[review-status] Updated ${issueId}:`, status);

    const { getTmuxSessionName } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    const resolvedProject = resolveProjectFromIssue(issueId);
    const projectKey = resolvedProject?.projectKey;

    if (reviewStatus && ['passed', 'blocked', 'failed'].includes(reviewStatus)) {
      const tmuxSession = getTmuxSessionName('review-agent', projectKey);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        currentIssue: undefined,
        lastActivity: new Date().toISOString(),
      });
      console.log(`[review-status] Set review-agent (${tmuxSession}) to idle`);

      if (['blocked', 'failed'].includes(reviewStatus) && reviewNotes) {
        const agentId = `agent-${issueId.toLowerCase()}`;
        const feedbackBody = `CODE REVIEW ${reviewStatus.toUpperCase()} for ${issueId}:\n\n${reviewNotes}\n\n## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill\n\n1. Read each blocking issue carefully\n2. Fix the code for EVERY issue listed\n3. Run tests locally to verify your fixes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.`;
        try {
          const { writeFeedbackFile } = yield* Effect.promise(() => import(
            '../../../lib/cloister/feedback-writer.js'
          ));
          const wsInfo = getWorkspaceInfoForIssue(issueId);
          const fileResult = yield* Effect.promise(() => writeFeedbackFile({
            issueId,
            workspacePath: wsInfo.localPath,
            specialist: 'review-agent',
            outcome: reviewStatus === 'blocked' ? 'changes-requested' : 'failed',
            summary: `Review ${reviewStatus.toUpperCase()}: ${(reviewNotes || '').slice(0, 80)}`,
            markdownBody: feedbackBody,
          }));
          if (!fileResult.success) {
            console.error(
              `[review-status] Failed to write feedback file for ${issueId}: ${fileResult.error}`
            );
          } else {
            const msg = `SPECIALIST FEEDBACK: review-agent reported ${reviewStatus.toUpperCase()} for ${issueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix ALL issues. Do NOT stop at the prompt — keep working until every blocking issue is resolved and you have invoked /rebase-and-submit.`;
            const deliveryKind = reviewStatus === 'blocked' ? 'review-blocked' : 'review-failed';
            yield* Effect.promise(() => deliverQueuedFeedback(issueId, deliveryKind, fileResult.filePath!, msg));
            console.log(
              `[review-status] Auto-sent feedback to ${agentId} (file: ${fileResult.relativePath})`
            );
          }
        } catch (err) {
          console.error(`[review-status] Failed to send feedback to ${agentId}:`, err);
        }
      }

      if (reviewStatus === 'passed') {
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.review-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: true },
        })));
        const issueLower = issueId.toLowerCase();
        const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
        const projectPath = getProjectPath(undefined, issuePrefix);
        const testWorkspace =
          body.workspace || join(projectPath, 'workspaces', `feature-${issueLower}`);
        const testBranch = body.branch || `feature/${issueLower}`;

        const { dispatchTestAgentAndNotify } = yield* Effect.promise(() => import(
          '../../../lib/cloister/test-agent-queue.js'
        ));
        try {
          yield* Effect.promise(() => dispatchTestAgentAndNotify(issueId, testWorkspace, testBranch, messageAgent));
          yield* Effect.promise(() => Effect.runPromise(eventStore.append({
            type: 'pipeline.test-started',
            timestamp: new Date().toISOString(),
            payload: { issueId },
          })));
        } catch (err) {
          console.error(
            `[review-status] Unhandled error in dispatchTestAgentAndNotify for ${issueId}:`,
            err
          );
        }
      } else if (['blocked', 'failed'].includes(reviewStatus)) {
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.review-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: false },
        })));
      }
    }

    if (testStatus && ['passed', 'failed', 'skipped'].includes(testStatus)) {
      const tmuxSession = getTmuxSessionName('test-agent', projectKey);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        currentIssue: undefined,
        lastActivity: new Date().toISOString(),
      });
      console.log(`[review-status] Set test-agent (${tmuxSession}) to idle`);

      if (testStatus === 'failed') {
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.test-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: false },
        })));
      }

      if (testStatus === 'failed' && testNotes) {
        const agentId = `agent-${issueId.toLowerCase()}`;
        const feedbackBody = `TESTS FAILED for ${issueId}:\n\n${testNotes}\n\n## REQUIRED: Fix ALL test failures, then invoke the /rebase-and-submit skill\n\n1. Read each test failure carefully\n2. Fix the code causing EVERY failure\n3. Run the test suite locally to verify your fixes pass\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.`;
        try {
          const { writeFeedbackFile } = yield* Effect.promise(() => import(
            '../../../lib/cloister/feedback-writer.js'
          ));
          const wsInfo = getWorkspaceInfoForIssue(issueId);
          const fileResult = yield* Effect.promise(() => writeFeedbackFile({
            issueId,
            workspacePath: wsInfo.localPath,
            specialist: 'test-agent',
            outcome: 'failed',
            summary: `Tests FAILED: ${(testNotes || '').slice(0, 80)}`,
            markdownBody: feedbackBody,
          }));
          if (!fileResult.success) {
            console.error(
              `[review-status] Failed to write test feedback file for ${issueId}: ${fileResult.error}`
            );
          } else {
            const msg = `SPECIALIST FEEDBACK: test-agent reported FAILED for ${issueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix the failing tests and re-submit. Do NOT stop at the prompt — keep working until all tests pass and you have invoked /rebase-and-submit.`;
            yield* Effect.promise(() => deliverQueuedFeedback(issueId, 'test-failed', fileResult.filePath!, msg));
            console.log(
              `[review-status] Auto-sent test failure to ${agentId} (file: ${fileResult.relativePath})`
            );
          }
        } catch (err) {
          console.error(`[review-status] Failed to send test feedback to ${agentId}:`, err);
        }
      }

      if (testStatus === 'passed') {
        // Mark ready for merge when tests pass. Post-rebase verification in
        // triggerMerge() is the real quality gate — don't block on stale pre-merge verification.
        setReviewStatus(issueId, { readyForMerge: true });
        console.log(`[review-status] ${issueId} marked ready for merge after test=passed`);

        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.test-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: true },
        })));
        try {
          const agentId = `agent-${issueId.toLowerCase()}`;
          yield* Effect.promise(() => messageAgent(
            agentId,
            `ALL CHECKS PASSED for ${issueId}. Review: passed. Tests: passed. Your work is complete — ready for merge. You may stop working on this issue.`
          ));
          console.log(`[review-status] Notified ${agentId} that all checks passed`);
        } catch (err) {
          console.log(
            `[review-status] Could not notify work agent for ${issueId} (may not be running): ${(err as Error).message}`
          );
        }
      }
    }

    return jsonResponse(status);
  }))
);

// ─── Route: POST /api/review/:issueId/trigger ─────────────────────────────

const postWorkspaceReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/trigger',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const urlOpt = HttpServerRequest.toURL(request);
    const forceReview =
      (Option.isSome(urlOpt) && urlOpt.value.searchParams.get('force') === 'true') ||
      (body as any)?.force === true;

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const branchName = `feature/${issueLower}`;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const workspacePath = workspaceInfo.isRemote
      ? workspaceInfo.remotePath!
      : workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${issueLower}`);

    const existingStatus = getReviewStatus(issueId);

    if (existingStatus?.reviewNotes && ['blocked', 'failed'].includes(existingStatus.reviewStatus || '')) {
      const infraFailurePatterns = [
        'Failed to send task',
        "can't find pane",
        'Command failed: tmux',
        'Operation timed out',
        'specialist.*not running',
        'specialist.*busy',
        'wakeSpecialistOrQueue',
      ];
      const isInfraFailure = infraFailurePatterns.some(pattern =>
        new RegExp(pattern, 'i').test(existingStatus.reviewNotes || '')
      );

      if (!isInfraFailure && !forceReview) {
        return jsonResponse({
          success: false,
          alreadyReviewed: true,
          message: `Review already completed with status: ${existingStatus.reviewStatus}`,
          reviewNotes: existingStatus.reviewNotes,
          hint: 'Address the review feedback before requesting another review, or use force=true to override',
        });
      }

      console.log(
        `[review] Re-triggering review for ${issueId} (${isInfraFailure ? 'infrastructure failure' : 'forced'})`
      );
    }

    if (existingStatus?.reviewStatus === 'passed' && !forceReview) {
      console.log(`[review] Skipping ${issueId}: already passed review`);
      return jsonResponse({
        success: false,
        alreadyReviewed: true,
        message: `Review already passed for ${issueId}`,
        hint: 'Issue already passed review — proceed to testing or merge',
      });
    }

    if (existingStatus?.mergeStatus === 'merged') {
      console.log(`[review] Skipping ${issueId}: already merged`);
      return jsonResponse({
        success: false,
        alreadyMerged: true,
        message: `${issueId} is already merged`,
      });
    }

    if (!workspaceInfo.exists) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 400 });
    }

    // Reset review status — keep 'pending' until dispatch succeeds (PAN-511 atomicity fix).
    // reviewStatus is set to 'reviewing' only after the specialist is successfully dispatched
    // or queued, not before. This prevents stuck 'reviewing' state if Cloister crashes mid-dispatch.
    setPendingOperation(issueId, 'review');
    const reviewReset: Record<string, unknown> = {
      reviewStatus: 'pending',
      testStatus: 'pending',
      autoRequeueCount: 0,
      verificationCycleCount: 0,
      verificationStatus: 'pending',
      verificationNotes: undefined,
    };
    if (forceReview) {
      reviewReset.readyForMerge = false;
      reviewReset.mergeStatus = 'pending';
      reviewReset.reviewNotes = undefined;
      reviewReset.testNotes = undefined;
    }
    setReviewStatus(issueId, reviewReset);

    // Respond immediately
    // Run pipeline in background
    (async () => {
          try {
            transitionIssueToInReview(issueId, workspacePath).catch((err: any) => {
              console.warn(`[review] Could not transition ${issueId} to in_review: ${err.message}`);
            });

            try {
              if (workspaceInfo.isRemote && workspaceInfo.vmName) {
                await execAsync(
                  flyExecCmd(
                    workspaceInfo.vmName,
                    `cd ${workspacePath} && git push origin ${branchName} 2>&1 || true`
                  ),
                  { encoding: 'utf-8', timeout: 30000 }
                );
              } else {
                await execAsync(`git push origin ${branchName}`, {
                  cwd: workspacePath,
                  encoding: 'utf-8',
                });
              }
            } catch (pushErr: any) {
              console.log(`Feature branch push note: ${pushErr.message}`);
            }

	            if (!workspaceInfo.isRemote) {
	              try {
	                const { getWorkspaceGitInfo } = await import('../../../lib/git-utils.js');
	                const commits = await getWorkspaceGitInfo(workspacePath);
	                setReviewStatus(issueId, { lastReviewCommits: commits });
	              } catch {}
	            }

	            // Ensure review artifacts exist so review/test agents have stable URLs.
	            let reviewTargetBranch: string | undefined;
	            try {
	              const { createReviewArtifactsForIssue } = await import('../../../lib/review-artifacts.js');
	              const artifactResult = await createReviewArtifactsForIssue(issueId, workspacePath);
	              const primaryArtifact = artifactResult.mergeSet?.repos.find(repo => !!repo.artifactUrl);
	              reviewTargetBranch = artifactResult.mergeSet?.repos.find(repo => repo.mergeStatus !== 'skipped')?.targetBranch;
	              if (primaryArtifact?.artifactUrl) {
	                setReviewStatus(issueId, { prUrl: primaryArtifact.artifactUrl });
	                console.log(`[review] Review artifact ready for ${issueId}: ${primaryArtifact.artifactUrl}`);
	              } else {
	                console.warn(`[review] No review artifact URL available for ${issueId}`);
	              }
	            } catch (artifactErr: any) {
	              console.warn(`[review] Review artifact creation failed for ${issueId}: ${artifactErr.message}`);
	            }

            try {
              eventStore.append({
                type: 'pipeline.verification-started',
                timestamp: new Date().toISOString(),
                payload: { issueId },
              } as any);
            } catch { /* non-fatal */ }

            const verifyOutcome = await runVerificationForIssue(
              issueId,
              workspacePath,
              workspaceInfo,
              'review'
            );
            if (verifyOutcome.outcome === 'failed') {
              completePendingOperation(
                issueId,
                `Verification failed at ${verifyOutcome.failedCheck}`
              );
              setReviewStatus(issueId, {
                reviewStatus: 'failed',
                reviewNotes: `Verification failed at ${verifyOutcome.failedCheck}`,
              });
              try {
                eventStore.append({
                  type: 'pipeline.verification-failed',
                  timestamp: new Date().toISOString(),
                  payload: { issueId, failedCheck: verifyOutcome.failedCheck },
                } as any);
              } catch { /* non-fatal */ }
              return;
            }
            if (verifyOutcome.outcome === 'error') {
              completePendingOperation(
                issueId,
                `Verification infrastructure error: ${verifyOutcome.message}`
              );
              setReviewStatus(issueId, {
                reviewStatus: 'failed',
                reviewNotes: `Verification error: ${verifyOutcome.message}`,
              });
              try {
                eventStore.append({
                  type: 'pipeline.verification-failed',
                  timestamp: new Date().toISOString(),
                  payload: { issueId, message: verifyOutcome.message },
                } as any);
              } catch { /* non-fatal */ }
              return;
            }

            const { dispatchParallelReview } = await import('../../../lib/cloister/review-agent.js');
            const prUrl = getReviewStatus(issueId)?.prUrl;
            const reviewResult = await dispatchParallelReview({
              issueId,
              branch: branchName,
              workspace: workspacePath,
              prUrl,
            });

            if (!reviewResult.success) {
              console.warn(
                `[review] review dispatch failed: ${reviewResult.message}`
              );
              completePendingOperation(issueId, `Failed to start review: ${reviewResult.message}`);
              setReviewStatus(issueId, {
                reviewStatus: 'pending',
                reviewNotes: reviewResult.message,
              });
              return;
            }

            console.log(`[review] Parallel review dispatched for ${issueId}`);
            // PAN-511: set 'reviewing' only after dispatch succeeds
            setReviewStatus(issueId, { reviewStatus: 'reviewing' });
            completePendingOperation(issueId, null);
            try {
              eventStore.append({
                type: 'pipeline.review-started',
                timestamp: new Date().toISOString(),
                payload: { issueId },
              } as any);
            } catch { /* non-fatal */ }
          } catch (error: any) {
            console.error(`[review] Error starting review:`, error);
            completePendingOperation(issueId, error.message);
            setReviewStatus(issueId, { reviewStatus: 'pending', reviewNotes: error.message });
          }
        })();

    return jsonResponse({
      success: true,
      message: `Review pipeline starting for ${issueId}`,
      pipeline: 'verification → review → test',
      note: 'Watch the status panel for progress.',
    });
  }))
);

// ─── Route: POST /api/review/:issueId/request ─────────────────────

const postWorkspaceRequestReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/request',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const { message } = body as { message?: string };
    const eventStore = yield* EventStoreService;

    const existingStatus = getReviewStatus(issueId);

    if (existingStatus?.mergeStatus === 'merged') {
      console.log(`[request-review] Rejecting ${issueId}: already merged`);
      return jsonResponse({
        success: false,
        alreadyMerged: true,
        message: `${issueId} is already merged. Use Reopen or Reset Reviews first.`,
      });
    }

    if (existingStatus?.reviewStatus === 'passed') {
      if (shouldTreatAsRerun(existingStatus)) {
        console.log(`[request-review] ${issueId}: forcing full review/test rerun from passed state`);
        setPendingOperation(issueId, 'review');
        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          testStatus: 'pending',
          mergeStatus: 'pending',
          readyForMerge: false,
          autoRequeueCount: 0,
          verificationCycleCount: 0,
          verificationStatus: 'pending',
          verificationNotes: undefined,
          reviewNotes: undefined,
          testNotes: undefined,
          mergeNotes: undefined,
        });

        (async () => {
          try {
            // Resolve workspace info locally — outer scope vars (workspacePath, branchName)
            // are declared after the early return below and must not be relied on here.
            const issueLowerRerun = issueId.toLowerCase();
            const issuePrefixRerun = extractPrefix(issueId) ?? issueId.split('-')[0];
            const projectPathRerun = getProjectPath(undefined, issuePrefixRerun);
            const branchNameRerun = `feature/${issueLowerRerun}`;
            const wsInfoRerun = getWorkspaceInfoForIssue(issueId);
            const workspacePathRerun = wsInfoRerun.isRemote
              ? wsInfoRerun.remotePath!
              : wsInfoRerun.localPath || join(projectPathRerun, 'workspaces', `feature-${issueLowerRerun}`);

            transitionIssueToInReview(issueId, workspacePathRerun).catch((err: any) => {
              console.warn(`[request-review] Could not transition ${issueId} to in_review: ${err.message}`);
            });

            try {
              if (wsInfoRerun.isRemote && wsInfoRerun.vmName) {
                await execAsync(
                  flyExecCmd(
                    wsInfoRerun.vmName,
                    `cd ${workspacePathRerun} && git push origin ${branchNameRerun} 2>&1 || true`
                  ),
                  { encoding: 'utf-8', timeout: 30000 }
                );
              } else {
                await execAsync(`git push origin ${branchNameRerun}`, {
                  cwd: workspacePathRerun,
                  encoding: 'utf-8',
                });
              }
            } catch (pushErr: any) {
              console.log(`[request-review] Feature branch push note: ${pushErr.message}`);
            }

            const prUrl = getReviewStatus(issueId)?.prUrl;
            const { dispatchParallelReview } = await import('../../../lib/cloister/review-agent.js');
            const result = await dispatchParallelReview({
              issueId,
              workspace: workspacePathRerun,
              branch: branchNameRerun,
              prUrl,
            });

            if (result.success) {
              // reviewStatus transitions ('reviewing' → passed/blocked/failed) are
              // managed entirely inside dispatchParallelReview — do not write here.
              console.log(`[request-review] Parallel review dispatched for ${issueId}`);
            } else {
              const errorMsg = result.error || result.message || 'Failed to dispatch review';
              console.error(`[request-review] Dispatch failed for ${issueId}: ${errorMsg}`);
              setReviewStatus(issueId, { reviewStatus: 'pending', reviewNotes: errorMsg });
            }
          } catch (error: any) {
            console.error(`[request-review] Error:`, error);
            setReviewStatus(issueId, {
              reviewStatus: 'pending',
              reviewNotes: error.message || 'Unknown error',
            });
          }
        })();

        return jsonResponse({
          success: true,
          rerun: true,
          message: `Re-running review & test pipeline for ${issueId}`,
        });
      }

      if (existingStatus.testStatus === 'failed' || existingStatus.testStatus === 'pending' || existingStatus.testStatus === 'dispatch_failed') {
        console.log(
          `[request-review] ${issueId}: review passed but tests ${existingStatus.testStatus} — dispatching test specialist`
        );
        setReviewStatus(issueId, { testStatus: 'pending' });

        try {
          const resolved = resolveProjectFromIssue(issueId);
          if (!resolved) {
            console.error(
              `[request-review] No project configured for ${issueId} — cannot spawn test specialist`
            );
            setReviewStatus(issueId, {
              testStatus: 'dispatch_failed',
              testNotes: 'No project configured',
            });
          } else {
            const workspacePath = join(
              resolved.projectPath,
              'workspaces',
              `feature-${issueId.toLowerCase()}`
            );
            const branchName = `feature/${issueId.toLowerCase()}`;
            setReviewStatus(issueId, { testStatus: 'testing' });
            const { spawnEphemeralSpecialist } = yield* Effect.promise(() => import(
              '../../../lib/cloister/specialists.js'
            ));
            const testResult = yield* Effect.promise(() => spawnEphemeralSpecialist(
              resolved.projectKey,
              'test-agent',
              { issueId, workspace: workspacePath, branch: branchName }
            ));
            console.log(
              `[request-review] Test specialist ${testResult.success ? 'spawned' : 'failed'} for ${issueId}`
            );
            if (!testResult.success) {
              setReviewStatus(issueId, {
                testStatus: 'dispatch_failed',
                testNotes: `Test dispatch failed: ${testResult.error || testResult.message}`,
              });
            }
          }
        } catch (err: any) {
          console.warn(
            `[request-review] Failed to queue test specialist for ${issueId}: ${err.message}`
          );
        }
        return jsonResponse({
          success: true,
          requeued: true,
          message: `Tests re-queued for ${issueId} (review already passed)`,
        });
      }
      console.log(
        `[request-review] ${issueId}: review already passed — returning success no-op`
      );
      return jsonResponse({
        success: true,
        alreadyPassed: true,
        message: `Review already passed for ${issueId}`,
      });
    }

    const currentCount = existingStatus?.autoRequeueCount || 0;

    if (currentCount >= MAX_AUTO_REQUEUE) {
      console.log(
        `[request-review] Circuit breaker: ${issueId} exceeded max auto-requeues (${currentCount}/${MAX_AUTO_REQUEUE})`
      );
      return jsonResponse(
        {
          success: false,
          error: 'Circuit breaker triggered',
          message: `Maximum automatic re-review requests (${MAX_AUTO_REQUEUE}) exceeded. Human intervention required.`,
          autoRequeueCount: currentCount,
          hint: 'A human must click the Review button to continue.',
        },
        { status: 429 }
      );
    }

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const branchName = `feature/${issueLower}`;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const workspacePath = workspaceInfo.isRemote
      ? workspaceInfo.remotePath!
      : workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!workspaceInfo.exists) {
      return jsonResponse(
        { success: false, error: 'Workspace does not exist' },
        { status: 400 }
      );
    }

    transitionIssueToInReview(issueId, workspacePath).catch((err: any) => {
      console.warn(
        `[request-review] Could not transition ${issueId} to in_review: ${err.message}`
      );
    });

    const newCount = currentCount + 1;
    const reviewNotes = message
      ? `Agent re-review request (${newCount}/${MAX_AUTO_REQUEUE}): ${message}`
      : undefined;

    let requestReviewCommits: Record<string, string> | undefined;
    if (!workspaceInfo.isRemote) {
      try {
        const { getWorkspaceGitInfo } = yield* Effect.promise(() => import('../../../lib/git-utils.js'));
        requestReviewCommits = yield* Effect.promise(() => getWorkspaceGitInfo(workspacePath));
      } catch {}
    }

    const reqVerifyOutcome = yield* Effect.promise(() => runVerificationForIssue(
      issueId,
      workspacePath,
      workspaceInfo,
      'request-review'
    ));
    if (reqVerifyOutcome.outcome === 'failed') {
      return jsonResponse({
        success: false,
        verificationFailed: true,
        failedCheck: reqVerifyOutcome.failedCheck,
        message: `Verification failed at ${reqVerifyOutcome.failedCheck} — fix and resubmit`,
        cycleCount: reqVerifyOutcome.cycleCount,
        maxCycles: reqVerifyOutcome.maxCycles,
      });
    }
    if (reqVerifyOutcome.outcome === 'error') {
      return jsonResponse(
        {
          success: false,
          error: `Verification infrastructure error: ${reqVerifyOutcome.message}`,
          autoRequeueCount: currentCount,
        },
        { status: 500 }
      );
    }

    // PAN-511: set metadata fields but keep reviewStatus='pending' until dispatch succeeds.
    // reviewStatus is set to 'reviewing' only after specialist is dispatched or queued.
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      testStatus: 'pending',
      autoRequeueCount: newCount,
      reviewNotes,
      ...(requestReviewCommits ? { lastReviewCommits: requestReviewCommits } : {}),
    });

    console.log(
      `[request-review] Agent requested re-review for ${issueId} (${newCount}/${MAX_AUTO_REQUEUE})${workspaceInfo.isRemote ? ` (remote: ${workspaceInfo.vmName})` : ''}`
    );

    try {
      const resolved = resolveProjectFromIssue(issueId);

      if (!resolved) {
        return jsonResponse(
          {
            success: false,
            error: `No project configured for ${issueId}. Add it to projects.yaml.`,
            autoRequeueCount: newCount,
          },
          { status: 500 }
        );
      }

      const result = yield* Effect.promise(async () => {
        const { dispatchParallelReview } = await import('../../../lib/cloister/review-agent.js');
        return dispatchParallelReview({
          issueId,
          workspace: workspacePath,
          branch: branchName,
        });
      });

      if (result.success) {
        console.log(`[request-review] Parallel review dispatched for ${issueId}`);
        // PAN-511: set 'reviewing' only after dispatch succeeds
        setReviewStatus(issueId, { reviewStatus: 'reviewing' });
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.review-started',
          timestamp: new Date().toISOString(),
          payload: { issueId },
        })));
        return jsonResponse({
          success: true,
          queued: false,
          message: `Review started (${newCount}/${MAX_AUTO_REQUEUE} auto-requeues used)`,
          autoRequeueCount: newCount,
          remainingRequeues: MAX_AUTO_REQUEUE - newCount,
        });
      } else {
        console.warn(
          `[request-review] Dispatch failed for ${issueId}: ${result.error}`
        );
        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          reviewNotes: `Dispatch failed: ${result.error || result.message}`,
        });
        return jsonResponse(
          {
            success: false,
            error: result.error || 'Failed to dispatch review',
            autoRequeueCount: newCount,
          },
          { status: 500 }
        );
      }
    } catch (error: any) {
      console.error(`[request-review] Error:`, error);
      setReviewStatus(issueId, {
        reviewStatus: 'pending',
        reviewNotes: `Dispatch error: ${error.message}`,
      });
      return jsonResponse(
        { success: false, error: error.message, autoRequeueCount: newCount },
        { status: 500 }
      );
    }
  }))
);

// ─── Route: POST /api/review/:issueId/reset ───────────────────────

/** HTTP-contract result from the reset-review endpoint. Exported for unit testing. */
export type ResetReviewResult =
  | { httpStatus: 400; body: { success: false; error: string } }
  | {
      httpStatus: 200;
      body: {
        success: true;
        /** Work-agent runtime state observed before the reset — informational, logged for debugging. */
        preservedResolution?: { agentId: string; resolution?: string; resolutionCount?: number };
      };
    };

/**
 * Core logic for POST /api/review/:issueId/reset (synchronous, testable).
 *
 * Resets the specialist pipeline state (review / test / merge / verification) for
 * a workspace. Writes ONE setReviewStatus() call, reads the work-agent's runtime
 * state purely for logging, and returns a structured result that the route
 * handler maps to an HTTP response.
 *
 * CRITICAL — resolution preservation:
 * This function deliberately does NOT mutate the work-agent's runtime state
 * (resolution / resolutionCount / activity). `resolution` tracks the WORK
 * agent's own lifecycle (working/done/unclear/stuck/needs_input) and is written
 * exclusively by `work-agent-stop-hook` based on the agent's tail. The pipeline
 * reset is about specialist state — wiping resolution here previously erased
 * legitimate unclear/stuck counts when `pan done`'s self-heal path triggered a
 * reset, which prevented the deacon from noticing genuinely confused agents.
 * (Root cause of PAN-805 never escalating to stuck.)
 *
 * Regression test: tests/unit/dashboard/server/routes/reset-review-route.test.ts
 *
 * Exported so a unit test can assert the sync mutation set is exactly
 * {reset review status} — nothing else.
 */
export function processResetReviewPipeline(
  issueId: string,
  workspaceExists: boolean,
): ResetReviewResult {
  if (!workspaceExists) {
    return {
      httpStatus: 400,
      body: { success: false, error: 'Workspace does not exist' },
    };
  }

  const agentId = `agent-${issueId.toLowerCase()}`;
  const priorRuntime = getAgentRuntimeState(agentId);

  console.log(
    `[reset-review] Human-initiated pipeline reset for ${issueId} ` +
      `(work-agent ${agentId} resolution=${priorRuntime?.resolution ?? 'none'}/` +
      `${priorRuntime?.resolutionCount ?? 0} — preserved, not reset)`
  );

  setReviewStatus(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    reviewNotes: undefined,
    testNotes: undefined,
    mergeNotes: undefined,
    readyForMerge: false,
    autoRequeueCount: 0,
    verificationStatus: 'pending',
    verificationNotes: undefined,
    verificationCycleCount: 0,
  });

  return {
    httpStatus: 200,
    body: {
      success: true,
      preservedResolution: priorRuntime
        ? {
            agentId,
            resolution: priorRuntime.resolution,
            resolutionCount: priorRuntime.resolutionCount,
          }
        : undefined,
    },
  };
}

const postWorkspaceResetReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/reset',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const result = processResetReviewPipeline(issueId, workspaceInfo.exists);
    if (result.httpStatus !== 200) {
      return jsonResponse(result.body, { status: result.httpStatus });
    }

    try {
      const { resetPostMergeState } = yield* Effect.promise(() => import(
        '../../../lib/cloister/merge-agent.js'
      ));
      resetPostMergeState(issueId);
    } catch (err) {
      console.warn(`[reset-review] resetPostMergeState best-effort failed for ${issueId}:`, err);
    }

    console.log(
      `[reset-review] Pipeline state reset for ${issueId} — awaiting agent to request review`
    );

    const rerun = (body as any)?.rerun === true;
    if (rerun) {
      try {
        yield* Effect.promise(async () => {
          const { dispatchParallelReview } = await import('../../../lib/cloister/review-agent.js');
          const resolved = resolveProjectFromIssue(issueId);
          if (resolved) {
            const wsInfo = getWorkspaceInfoForIssue(issueId);
            const issueLower = issueId.toLowerCase();
            const branchName = `feature/${issueLower}`;
            const wsPath =
              wsInfo.localPath ||
              join(resolved.projectPath, 'workspaces', `feature-${issueLower}`);

            const result = await dispatchParallelReview({
              issueId,
              workspace: wsPath,
              branch: branchName,
              prUrl: getReviewStatus(issueId)?.prUrl,
            });

            if (result.success) {
              setReviewStatus(issueId, { reviewStatus: 'reviewing' });
              console.log(`[reset-review] Re-dispatched review for ${issueId}`);
            } else {
              console.warn(
                `[reset-review] Re-dispatch failed for ${issueId}: ${result.message || result.error}`
              );
              setReviewStatus(issueId, { reviewStatus: 'pending' });
            }
          } else {
            console.warn(
              `[reset-review] Could not resolve project for ${issueId}, skipping re-dispatch`
            );
          }
        });
      } catch (rerunErr) {
        console.warn(`[reset-review] Re-dispatch error for ${issueId}: ${rerunErr}`);
        setReviewStatus(issueId, { reviewStatus: 'pending' });
      }
    }

    return jsonResponse({
      success: true,
      message: rerun
        ? `Pipeline reset and review re-dispatched for ${issueId}.`
        : `Review cycles reset for ${issueId}. Agent can now request review when ready.`,
      rerun,
    });
  }))
);

// ─── Route: POST /api/review/:issueId/abort ────────────────────────────────
//
// Kill all running reviewer tmux sessions for an issue and reset reviewStatus
// to 'pending'. Does NOT message the work agent — leaves the worker idle.
// Use this to stop a runaway or stuck review without triggering a resubmit.

const postWorkspaceAbortReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/abort',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();
    if (!issueId) {
      return jsonResponse({ success: false, error: 'Missing issueId' }, { status: 400 });
    }

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    if (!workspaceInfo.exists) {
      return jsonResponse({ success: false, error: 'Workspace does not exist' }, { status: 400 });
    }

    // Kill all reviewer AND coordinator tmux sessions for this issue.
    // Session name patterns (see docs/REVIEW-AGENT-ARCHITECTURE.md):
    //   review-<issueId>-<ts>-<role>         (per-reviewer session)
    //   review-<issueId>-<ts>-synthesis      (synthesis session)
    //   review-coordinator-<issueId>-<ts>    (detached `pan review run` orchestrator)
    const reviewerPrefix = `review-${issueId}-`;
    const coordinatorPrefix = `review-coordinator-${issueId}-`;
    const allSessions = yield* Effect.promise(() => listSessionNamesAsync());
    const reviewSessions = allSessions.filter(
      s => s.startsWith(reviewerPrefix) || s.startsWith(coordinatorPrefix),
    );

    const killed: string[] = [];
    const failed: string[] = [];
    for (const session of reviewSessions) {
      try {
        yield* Effect.promise(() => killSessionAsync(session));
        killed.push(session);
      } catch {
        failed.push(session);
      }
    }

    // Reset only reviewStatus — leave test/merge/verification untouched
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      reviewNotes: undefined,
    });

    console.log(
      `[abort-review] Aborted ${killed.length} reviewer session(s) for ${issueId}` +
      (failed.length ? ` (${failed.length} kill failed)` : '')
    );

    return jsonResponse({
      success: true,
      message: `Aborted ${killed.length} reviewer session(s) for ${issueId}. Worker left idle.`,
      killed,
      failed,
    });
  }))
);

// ─── Route: POST /api/workspaces/:issueId/unstick ────────────────────────
//
// Clears the persistent stuck flag set by markWorkspaceStuck() so Deacon
// resumes normal patrol for this workspace. Does NOT restart the agent —
// the user should do that separately via the start-agent UI once they have
// resolved the divergence (e.g. by syncing main and re-approving).

/** HTTP-contract result from the unstick endpoint. Exported for unit testing. */
export type UnstickResult =
  | { httpStatus: 404; body: { success: false; error: string } }
  | { httpStatus: 400; body: { success: false; error: string } }
  | { httpStatus: 409; body: { success: false; error: string } }
  | { httpStatus: 200; body: { success: true; issueId: string; previousReason?: string } };

/**
 * Core logic for POST /api/workspaces/:issueId/unstick.
 *
 * Validates preconditions (workspace exists, workspace is stuck, git state is
 * repaired), clears the persistent stuck marker, and invalidates stale
 * review/test results by resetting the lifecycle to pending.
 *
 * The recovery path requires `git reset --hard origin/main` which moves the
 * workspace HEAD away from the reviewed commit, making prior passed results
 * invalid. Keeping reviewStatus=passed after that would let the UI present
 * a stale approval. One atomic setReviewStatus() call clears stuck state and
 * resets the lifecycle in a single DB write and a single notifyPipeline event.
 *
 * gitSafeState must be pre-verified by the caller (async git check). Passing
 * false returns 409 with recovery instructions before any DB mutation.
 *
 * Exported for unit testing — the route handler calls this and maps the result
 * directly to an HTTP response.
 */
export function processUnstickRequest(
  issueId: string,
  workspaceExists: boolean,
  currentStatus: ReturnType<typeof getReviewStatus>,
  gitSafeState: boolean,
): UnstickResult {
  if (!workspaceExists) {
    return { httpStatus: 404, body: { success: false, error: 'Workspace does not exist' } };
  }
  if (!currentStatus?.stuck) {
    return { httpStatus: 400, body: { success: false, error: `Workspace ${issueId} is not stuck` } };
  }
  // Enforce that the operator has actually repaired the git state before we
  // clear the stuck flag. If local main is still ahead of origin/main, Deacon
  // would immediately re-enter the same broken approve/merge path.
  if (!gitSafeState) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        error: `Workspace git state is not yet repaired. Run: git reset --hard origin/main in the project repo, then retry.`,
      },
    };
  }
  // Single atomic write: clear stuck fields and reset lifecycle to pending.
  setReviewStatusBase(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    stuck: undefined,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
    reviewedAtCommit: undefined,
    // PAN-794: unstick opens a fresh recovery cycle — arm the breaker budget
    // again so legitimate transient failures don't inherit prior cycle counts.
    reviewRetryCount: 0,
    recoveryStartedAt: undefined,
  });
  console.log(`[unstick] Cleared stuck flag and reset lifecycle for ${issueId} (was: ${currentStatus.stuckReason ?? 'unknown'})`);
  return { httpStatus: 200, body: { success: true, issueId, previousReason: currentStatus.stuckReason } };
}

/**
 * Check whether the project repo's local main branch is at or behind origin/main.
 * Returns true (safe) if main is not ahead of origin/main — i.e., the operator
 * has already run `git reset --hard origin/main` to discard the orphaned merge commit.
 * Returns false if main is still ahead (orphaned commit still present).
 * Returns true for any git error so a transient failure doesn't permanently block unstick.
 */
async function checkProjectGitSafeState(projectPath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'git rev-list origin/main..main --count',
      { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
    );
    const aheadCount = parseInt(stdout.trim(), 10) || 0;
    return aheadCount === 0;
  } catch {
    // If we can't check (no git repo, no origin/main), don't block the operator.
    return true;
  }
}

const postWorkspaceUnstickRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/unstick',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const current = getReviewStatus(issueId);

    // Pre-verify git state before mutating stuck flag.
    // For main_diverged: check that local main is not ahead of origin/main.
    // PAN-794: review_infrastructure_failure is unrelated to git divergence —
    // skip the git safe-state check so operators can unstick review-infra
    // workspaces without touching the project's main branch.
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const skipGitCheck = current?.stuckReason === 'review_infrastructure_failure';
    const gitSafeState = skipGitCheck
      ? true
      : yield* Effect.promise(() => checkProjectGitSafeState(projectPath));

    const result = processUnstickRequest(issueId, workspaceInfo.exists, current, gitSafeState);
    return jsonResponse(result.body, result.httpStatus !== 200 ? { status: result.httpStatus } : undefined);
  }))
);

// ─── Route: POST /api/workspaces/:issueId/deacon-ignore ──────────────────

/**
 * Operator toggle: tell Deacon to stop patrolling this issue. Body:
 *   { ignored: boolean, reason?: string }
 *
 * Idempotent — calling with ignored=true repeatedly refreshes the timestamp
 * but otherwise no-ops. Separate from stuck/unstick: stuck is a system-set
 * failure marker, deaconIgnored is an explicit human "hands off".
 */
const postWorkspaceDeaconIgnoreRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/deacon-ignore',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();
    if (!issueId) {
      return jsonResponse({ success: false, error: 'Missing issueId' }, { status: 400 });
    }

    const body = (yield* readJsonBody) as { ignored?: unknown; reason?: unknown };
    if (typeof body.ignored !== 'boolean') {
      return jsonResponse(
        { success: false, error: 'Body must include { ignored: boolean }' },
        { status: 400 },
      );
    }
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : undefined;

    setDeaconIgnored(issueId, body.ignored, reason);
    const updated = getReviewStatus(issueId);
    return jsonResponse({
      success: true,
      issueId,
      deaconIgnored: updated?.deaconIgnored ?? body.ignored,
      deaconIgnoredAt: updated?.deaconIgnoredAt,
      deaconIgnoredReason: updated?.deaconIgnoredReason,
    });
  }))
);

// ─── Route: POST /api/issues/:issueId/sync-main ──────────────────────────

const postWorkspaceSyncMainRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/sync-main',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    if (workspaceInfo.isRemote) {
      return jsonResponse(
        {
          success: false,
          error: 'Sync with Main is not supported for remote workspaces',
        },
        { status: 400 }
      );
    }

    const workspacePath =
      workspaceInfo.localPath ||
      join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!existsSync(workspacePath)) {
      return jsonResponse(
        { success: false, error: 'Workspace does not exist' },
        { status: 400 }
      );
    }

    console.log(`[sync-main] Starting sync for ${issueId} at ${workspacePath}`);

    const result = yield* Effect.promise(() => syncMainIntoWorkspace(workspacePath, issueId));

    if (result.success) {
      if (result.alreadyUpToDate) {
        return jsonResponse({
          success: true,
          alreadyUpToDate: true,
          message: 'Already up to date with main',
        });
      }
      return jsonResponse({
        success: true,
        commitCount: result.commitCount || 0,
        changedFiles: result.changedFiles || [],
        message: `Synced ${result.commitCount || 0} commit(s) from main`,
      });
    } else {
      const status = result.reason?.includes('uncommitted') ? 400 : 500;
      return jsonResponse(
        {
          success: false,
          error: result.reason || 'Sync failed',
          conflictFiles: result.conflictFiles,
        },
        { status }
      );
    }
  }))
);

// ─── Shared triggerMerge logic ────────────────────────────────────────────────

interface TriggerMergeResult {
  success: boolean;
  statusCode: number;
  error?: string;
  message?: string;
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  prUrl?: string;
  remote?: boolean;
  repos?: Array<{ repo: string; success: boolean; message: string; testsStatus?: string }>;
  testsStatus?: string;
  note?: string;
  mergeResult?: unknown;
}

// Per-project merge queue backed by SQLite (PAN-632).
// Replaces the in-memory _mergeQueues Map — survives server restarts.
import {
  enqueueMerge,
  getCurrentMerge,
  markMergeProcessing,
  dequeueMerge,
  getAllActiveQueues,
} from '../../../lib/database/merge-queue-db.js';

/** Dequeue the next merge after current completes (success or failure). */
function dequeueNextMerge(projectKey: string, completedIssueId?: string): void {
  const nextIssueId = dequeueMerge(projectKey, completedIssueId);
  if (nextIssueId) {
    console.log(`[merge] Dequeuing next merge: ${nextIssueId}`);
    triggerMerge(nextIssueId).catch(err =>
      console.error(`[merge] Queue error for ${nextIssueId}: ${err}`)
    );
  }
}

async function triggerMerge(issueId: string): Promise<TriggerMergeResult> {
  const reviewStatus = getReviewStatus(issueId);
  if (!reviewStatus?.readyForMerge) {
    return {
      success: false,
      statusCode: 400,
      error: 'Cannot merge: review and tests have not passed yet',
      reviewStatus: reviewStatus?.reviewStatus || 'pending',
      testStatus: reviewStatus?.testStatus || 'pending',
    };
  }

  // NOTE: Commit status reporting moved to AFTER rebase — see below.
  // The rebase changes the HEAD SHA, so statuses must be reported on the new commit.
  if (false && reviewStatus.prUrl) {
    try {
      const { isGitHubAppConfigured, reportCommitStatus } = await import('../../../lib/github-app.js');
      if (isGitHubAppConfigured()) {
        const prMatch = reviewStatus.prUrl.match(/\/pull\/(\d+)/);
        if (prMatch) {
          const { stdout } = await execAsync(
            `gh pr view ${prMatch[1]} --json headRefOid --jq .headRefOid`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          const sha = stdout.trim();
          if (sha) {
            await reportCommitStatus('eltmon', 'panopticon-cli', sha, 'success', 'panopticon/review', 'Review passed');
            await reportCommitStatus('eltmon', 'panopticon-cli', sha, 'success', 'panopticon/test', 'Tests passed');
            console.log(`[merge] Reported commit statuses for ${issueId} (${sha.slice(0, 8)})`);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[merge] Failed to report commit statuses: ${err.message}`);
    }
  }

  if (reviewStatus?.mergeStatus === 'merging') {
    const pendingOp = getPendingOperation(issueId);
    const activelyMerging = pendingOp?.type === 'merge' && pendingOp?.status === 'running';
    if (activelyMerging) {
      return {
        success: false,
        statusCode: 400,
        error: 'Merge already in progress',
        mergeStatus: 'merging',
      };
    }
    console.log(
      `[merge] Clearing stuck mergeStatus for ${issueId} (pending op: ${pendingOp?.status ?? 'absent'})`
    );
    setReviewStatus(issueId, { mergeStatus: undefined });
  }

  if (reviewStatus?.mergeStatus === 'merged') {
    return { success: false, statusCode: 400, error: 'Already merged', mergeStatus: 'merged' };
  }

  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();

  // Serialize merges per project via persistent SQLite queue (PAN-632).
  // Survives server restarts — no more lost queues.
  const projectKey = issuePrefix.toLowerCase();
  const normalizedId = issueId.toUpperCase();
  const currentlyMerging = getCurrentMerge(projectKey);
  if (currentlyMerging && currentlyMerging !== normalizedId) {
    // Another merge is in progress — queue this one
    const position = enqueueMerge(projectKey, normalizedId);
    setReviewStatus(issueId, { mergeStatus: 'queued' });
    console.log(`[merge] Queued ${issueId} (position ${position}, waiting for ${currentlyMerging})`);
    return {
      success: true,
      statusCode: 200,
      message: `Queued for merge (position ${position}, waiting for ${currentlyMerging})`,
    };
  }
  // Mark as processing IMMEDIATELY — before any async work — to prevent race conditions.
  // SQLite write is atomic — no window for concurrent calls to both pass the check.
  enqueueMerge(projectKey, normalizedId);
  markMergeProcessing(projectKey, normalizedId);

  const workspaceInfo = getWorkspaceInfoForIssue(issueId);

  // Use the actual resolved workspace path (handles legacy feature-484 naming)
  const workspacePath = (!workspaceInfo.isRemote && workspaceInfo.localPath)
    ? workspaceInfo.localPath
    : join(projectPath, 'workspaces', `feature-${issueLower}`);
  const workspaceDirName = basename(workspacePath);
  const branchName = workspaceDirName.startsWith('feature-')
    ? `feature/${workspaceDirName.slice('feature-'.length)}`
    : `feature/${issueLower}`;

  setReviewStatus(issueId, { mergeStatus: 'merging' });

  const normalizedMergeId = issueId.toUpperCase();
  _serverManagedMerges.add(normalizedMergeId);
  setPendingOperation(issueId, 'merge');
  let queueAdvanced = false;

  const advanceQueue = (): void => {
    if (queueAdvanced) return;
    queueAdvanced = true;
    _serverManagedMerges.delete(normalizedMergeId);
    dequeueNextMerge(projectKey, normalizedId);
  };

  try {
    if (workspaceInfo.isRemote && workspaceInfo.vmName) {
      console.log(
        `[merge] Remote workspace detected for ${issueId}, using review artifact merge...`
      );
      const { getMergeSet, ensureMergeSetForIssue } = await import('../../../lib/merge-set.js');
      const { getForgeAdapter } = await import('../../../lib/forge.js');
      const remoteMergeSet = getMergeSet(issueId) || ensureMergeSetForIssue(issueId);
      const remotePrimaryRepo = remoteMergeSet?.repos[0];
      const remoteTargetBranch = remotePrimaryRepo?.targetBranch || 'main';
      const remoteForge = remotePrimaryRepo?.forge || 'github';

      const prResult = await ensurePRExists(issueId, { targetBranch: remoteTargetBranch });
      if (!prResult.prUrl) {
        const error = `Failed to create PR: ${prResult.error || 'Unknown error'}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }
      const artifactUrl = remotePrimaryRepo?.artifactUrl || prResult.prUrl;
      const artifactId = remotePrimaryRepo?.artifactId;

      try {
        console.log(`[merge] Merging ${remoteForge} review artifact for ${issueId}...`);
        await getForgeAdapter(remoteForge).mergeReviewArtifact({
          forge: remoteForge,
          url: artifactUrl,
          id: artifactId,
          method: 'squash',
        });

        setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
        completePendingOperation(issueId, null);

        const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
        await postMergeLifecycle(issueId, projectPath);

        return {
          success: true,
          statusCode: 200,
          message: `Successfully merged PR #${prNumber} for ${issueId}`,
          prUrl: prResult.prUrl,
          remote: true,
        };
      } catch (remoteErr: any) {
        const mergeErrorMessage = `Remote merge failed: ${remoteErr.message}`;
        console.error(`[merge] Remote merge failed for ${issueId}:`, remoteErr);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: mergeErrorMessage });
        completePendingOperation(issueId, remoteErr.message);
        return {
          success: false,
          statusCode: 500,
          error: mergeErrorMessage,
        };
      }
    }

    if (!existsSync(workspacePath)) {
      completePendingOperation(issueId, 'Workspace does not exist');
      return { success: false, statusCode: 400, error: 'Workspace does not exist' };
    }

    const projectConfig = findProjectByTeam(issuePrefix);
    const isPolyrepo = projectConfig?.workspace?.type === 'polyrepo';

    if (isPolyrepo && projectConfig?.workspace?.repos) {
      console.log(`[merge] Polyrepo detected for ${issueId}, coordinating merge set...`);
      const { getMergeSet, ensureMergeSetForIssue, upsertMergeSet, withRepoState } = await import('../../../lib/merge-set.js');
      const { runQualityGates } = await import('../../../lib/cloister/validation.js');
      const { getForgeAdapter } = await import('../../../lib/forge.js');
      const { messageAgent } = await import('../../../lib/agents.js');
      const { sessionExistsAsync } = await import('../../../lib/tmux.js');
      let mergeSet = getMergeSet(issueId) || ensureMergeSetForIssue(issueId);
      if (!mergeSet) {
        const error = `No merge set found for ${issueId}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      const activeRepos = mergeSet.repos
        .filter(repo => repo.mergeStatus !== 'skipped' && !!repo.artifactUrl)
        .sort((a, b) => a.mergeOrder - b.mergeOrder);

      if (activeRepos.length === 0) {
        const error = `No changed repos are marked ready for coordinated merge in ${issueId}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      const agentId = `agent-${issueId.toLowerCase()}`;
      if (!await sessionExistsAsync(agentId)) {
        const error = `Work agent ${agentId} is not running. Polyrepo merge requires the work agent to rebase every affected repo and push.`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      mergeSet = {
        ...mergeSet,
        status: 'merging',
        updatedAt: new Date().toISOString(),
      };
      upsertMergeSet(mergeSet);

      const mergeResults: Array<{
        repo: string;
        success: boolean;
        message: string;
        testsStatus?: string;
      }> = [];
      const repoHeadsBefore = new Map<string, string>();

      for (const repo of activeRepos) {
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        if (!existsSync(repoWorkspacePath) || !existsSync(join(repoWorkspacePath, '.git'))) {
          const error = `Workspace repo ${repo.repoKey} is missing`;
          mergeResults.push({ repo: repo.repoKey, success: false, message: error });
          continue;
        }

        const { stdout: headBefore } = await execAsync(
          `git rev-parse origin/${repo.sourceBranch} 2>/dev/null || echo NONE`,
          { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 10000 }
        );
        repoHeadsBefore.set(repo.repoKey, headBefore.trim());
        mergeSet = withRepoState(mergeSet, repo.repoKey, { rebaseStatus: 'requested' });
      }
      upsertMergeSet(mergeSet);

      if (mergeResults.some(result => !result.success)) {
        const failedDetails = mergeResults.filter(r => !r.success).map(r => `${r.repo}: ${r.message}`).join('; ');
        const error = `Polyrepo merge prerequisites failed for ${issueId}: ${failedDetails}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error, repos: mergeResults };
      }

      const rebaseInstructions = activeRepos.map((repo, index) => (
        `${index + 1}. cd ${repo.repoKey}\n   git fetch origin ${repo.targetBranch}\n   git rebase origin/${repo.targetBranch}\n   git push --force-with-lease`
      )).join('\n');
      const rebaseMsg = `MERGE REQUESTED: The human has clicked MERGE for ${issueId}. Rebase and push every affected repo in this merge set:\n\n${rebaseInstructions}\n\nResolve any conflicts in the workspaces above, complete every rebase, and push all affected branches. Do NOT merge PRs/MRs yourself.`;
      await messageAgent(agentId, rebaseMsg);

      const REBASE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — complex polyrepo rebases need time for conflict resolution
      const POLL_INTERVAL_MS = 5000;
      const pushedRepos = new Set<string>();
      const rebaseStart = Date.now();

      while (Date.now() - rebaseStart < REBASE_TIMEOUT_MS && pushedRepos.size < activeRepos.length) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        for (const repo of activeRepos) {
          if (pushedRepos.has(repo.repoKey)) continue;

          const repoWorkspacePath = join(workspacePath, repo.repoKey);
          try {
            await execAsync('git fetch origin', { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 15000 });
            const { stdout: headNow } = await execAsync(
              `git rev-parse origin/${repo.sourceBranch}`,
              { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 5000 }
            );
            if (headNow.trim() !== repoHeadsBefore.get(repo.repoKey)) {
              pushedRepos.add(repo.repoKey);
              mergeSet = withRepoState(mergeSet, repo.repoKey, { rebaseStatus: 'passed' });
              upsertMergeSet(mergeSet);
            }
          } catch {
            // Retry until timeout or agent exit.
          }
        }

        if (!await sessionExistsAsync(agentId)) break;
      }

      if (pushedRepos.size !== activeRepos.length) {
        const remaining = activeRepos
          .filter(repo => !pushedRepos.has(repo.repoKey))
          .map(repo => repo.repoKey);
        const agentRunning = await sessionExistsAsync(agentId);
        const error = !agentRunning
          ? `Work agent ${agentId} stopped before completing polyrepo rebases for ${remaining.join(', ')}`
          : `Work agent did not push rebased branches for ${remaining.join(', ')} within ${REBASE_TIMEOUT_MS / 60000} minutes`;
        for (const repoKey of remaining) {
          mergeSet = withRepoState(mergeSet, repoKey, { rebaseStatus: 'failed' });
        }
        upsertMergeSet(mergeSet);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error };
      }

      setReviewStatus(issueId, { mergeStatus: 'verifying', mergeNotes: undefined });
      for (const repo of activeRepos) {
        const repoConfig = projectConfig.workspace.repos.find(configRepo => configRepo.name === repo.repoKey);
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        const gateIdentifiers = new Set<string>([
          repo.repoKey,
          repoConfig?.path || '',
        ].filter(Boolean));
        const gates = Object.fromEntries(
          Object.entries(projectConfig.quality_gates || {}).filter(
            ([, gate]) => gate.path && gateIdentifiers.has(gate.path)
          )
        );

        mergeSet = withRepoState(mergeSet, repo.repoKey, { verificationStatus: 'running' });
        upsertMergeSet(mergeSet);

        if (Object.keys(gates).length === 0) {
          mergeSet = withRepoState(mergeSet, repo.repoKey, { verificationStatus: 'skipped' });
          upsertMergeSet(mergeSet);
          continue;
        }

        const gateResults = await runQualityGates(gates, repoWorkspacePath, 'pre_push');
        const failedGate = gateResults.find(result => !result.passed && result.required !== false);
        if (failedGate) {
          const error = `Polyrepo post-rebase verification failed for ${repo.repoKey} at ${failedGate.name}`;
          mergeSet = withRepoState(mergeSet, repo.repoKey, { verificationStatus: 'failed' });
          upsertMergeSet(mergeSet);
          setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
          completePendingOperation(issueId, error);
          return { success: false, statusCode: 500, error };
        }

        mergeSet = withRepoState(mergeSet, repo.repoKey, { verificationStatus: 'passed' });
        upsertMergeSet(mergeSet);
      }

      setReviewStatus(issueId, { mergeStatus: 'merging' });
      for (const repo of activeRepos) {
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        try {
          mergeSet = withRepoState(mergeSet, repo.repoKey, { mergeStatus: 'merging' });
          upsertMergeSet(mergeSet);
          await getForgeAdapter(repo.forge).mergeReviewArtifact({
            forge: repo.forge,
            url: repo.artifactUrl,
            id: repo.artifactId,
            cwd: repoWorkspacePath,
            method: 'squash',
          });
          mergeSet = withRepoState(mergeSet, repo.repoKey, { mergeStatus: 'merged' });
          upsertMergeSet(mergeSet);
          mergeResults.push({
            repo: repo.repoKey,
            success: true,
            message: `Merged via ${repo.forge}`,
          });
        } catch (mergeErr: any) {
          const error = mergeErr.message || 'Artifact merge failed';
          mergeSet = withRepoState(mergeSet, repo.repoKey, { mergeStatus: 'failed' });
          upsertMergeSet(mergeSet);
          mergeResults.push({ repo: repo.repoKey, success: false, message: error });
          break;
        }
      }

      const failedRepos = mergeResults.filter(r => !r.success);

      if (failedRepos.length > 0) {
        const error = `Polyrepo merge failed for: ${failedRepos
          .map(r => `${r.repo} (${r.message})`)
          .join(', ')}`;
        mergeSet = {
          ...mergeSet,
          status: 'failed',
          updatedAt: new Date().toISOString(),
        };
        upsertMergeSet(mergeSet);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error, repos: mergeResults };
      }

      mergeSet = {
        ...mergeSet,
        status: 'merged',
        updatedAt: new Date().toISOString(),
      };
      upsertMergeSet(mergeSet);
      setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
      completePendingOperation(issueId, null);

      const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
      advanceQueue();
      await postMergeLifecycle(issueId, projectPath);

      return {
        success: true,
        statusCode: 200,
        message: `Polyrepo merge complete for ${issueId}`,
        repos: mergeResults,
      };
    }

    // Monorepo / single-repo merge: PR-based flow
    const { getMergeSet, ensureMergeSetForIssue } = await import('../../../lib/merge-set.js');
    const { getForgeAdapter } = await import('../../../lib/forge.js');
    const monorepoMergeSet = getMergeSet(issueId) || ensureMergeSetForIssue(issueId);
    const primaryRepo = monorepoMergeSet?.repos[0];
    const targetBranch = primaryRepo?.targetBranch || 'main';
    const primaryForge = primaryRepo?.forge || 'github';

    // Step 1: Ensure PR exists (creates if needed)
    const prResult = await ensurePRExists(issueId, { cwd: workspacePath, branchName, targetBranch });
    if (!prResult.prUrl) {
      const error = `Failed to create PR: ${prResult.error || 'Unknown error'}`;
      setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: 400, error };
    }

    const artifactUrl = primaryRepo?.artifactUrl || prResult.prUrl;
    const artifactId = primaryRepo?.artifactId;
    const githubPrRef = primaryForge === 'github' ? parseGitHubPullRequestUrl(artifactUrl) : null;
    const prNumber = githubPrRef ? String(githubPrRef.number) : undefined;
    if (primaryForge === 'github' && !prNumber) {
      const error = `Could not parse PR number from URL: ${artifactUrl}`;
      setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: 400, error };
    }

    // Step 1b: Validate that the PR is still OPEN before rebasing/merging.
    // A cancel-flow or manual `gh pr close` can leave stale `prUrl` pointing at a
    // CLOSED PR while Panopticon state still shows readyForMerge=true. Without this
    // check, the rebase + merge pipeline runs against a dead PR and dies silently
    // inside `gh pr merge` (see PAN-509 cancel-flow divergence).
    if (githubPrRef) {
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../lib/github-app.js');
        if (isGitHubAppConfigured()) {
          const prState = await getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number);
          if (prState.state !== 'OPEN' && !prState.merged) {
            const error = `PR #${githubPrRef.number} is ${prState.state} (not OPEN). Panopticon state is out of sync — likely a cancel-flow left a stale prUrl. Re-open the work agent to create a fresh PR, or reset review state.`;
            console.error(`[merge] ${error}`);
            setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          // Defense-in-depth: refuse to merge when required CI checks are failing on the
          // PR's current HEAD. Without this gate, we attempt a rebase and `gh pr merge`
          // against a branch whose CI is red; branch protection blocks the merge and we
          // get a generic error. Surface the real blocker (failing CI) up-front so the
          // work-agent can fix it instead of us churning the queue. See PAN-611/PAN-544
          // (Run 7): feature branches had gitignored source + stale bun.lock; local
          // verification passed but CI failed — the divergence was invisible until merge.
          if (prState.checksFailed && !prState.merged) {
            const error = `GitHub PR #${githubPrRef.number} has failing required checks on HEAD ${prState.headSha.slice(0, 8)}. Fix CI before merging — see ${prState.url || 'the PR page'} for details.`;
            console.error(`[merge] ${error}`);
            setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          if (prState.merged) {
            console.log(`[merge] PR #${githubPrRef.number} for ${issueId} is already merged — running post-merge lifecycle`);
            setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
            completePendingOperation(issueId, null);
            const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
            await postMergeLifecycle(issueId, projectPath, branchName);
            return {
              success: true,
              statusCode: 200,
              message: `PR #${githubPrRef.number} for ${issueId} was already merged`,
              prUrl: prResult.prUrl,
            };
          }
        }
      } catch (prStateErr: any) {
        console.warn(`[merge] Pre-merge PR state check failed for ${issueId}: ${prStateErr.message} — proceeding (check is best-effort)`);
      }
    }

    // Step 2: Tell the WORK AGENT to rebase onto the target branch and push.
    // The server coordinates; the work agent owns all code-changing git operations.
    const { postMergeLifecycle } = await import(
      '../../../lib/cloister/merge-agent.js'
    );
    const { sessionExistsAsync } = await import('../../../lib/tmux.js');
    const agentId = `agent-${issueId.toLowerCase()}`;
    const rebaseMsg = `MERGE REQUESTED: The human has clicked MERGE for ${issueId}. Please rebase onto ${targetBranch} and push:\n\n1. git fetch origin ${targetBranch}\n2. git rebase origin/${targetBranch}\n3. If conflicts: resolve them, git add, git rebase --continue\n4. git push --force-with-lease\n\nAfter pushing, the server will handle verification and merge automatically. Do NOT run gh pr merge yourself.`;

    console.log(`[merge] Rebasing ${branchName} onto ${targetBranch} for ${issueId} (agent=${await sessionExistsAsync(agentId) ? 'running' : 'stopped'})...`);

    let rebaseResult: { success: boolean; reason?: string; conflictFiles?: string[]; newHead?: string };

    // Pre-check: if origin/<branch> already contains origin/<target>, the branch
    // is already rebased — no rebase or push is needed.
    const { alreadyRebased, currentHead } = await isBranchAlreadyRebased(workspacePath, branchName, targetBranch);

    if (alreadyRebased && currentHead) {
      console.log(`[merge] ${branchName} already contains origin/${targetBranch} — skipping rebase request for ${issueId}`);
      rebaseResult = { success: true, newHead: currentHead };
    } else {
      try {
        const recovery = await ensureWorkAgentReadyForMerge(issueId, workspacePath, rebaseMsg);
        console.log(`[merge] ${recovery.detail}`);

        // Poll for the push: check if remote HEAD changed
        const { stdout: headBefore } = await execAsync(
          `git rev-parse origin/${branchName} 2>/dev/null || echo NONE`,
          { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
        );

        const REBASE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — complex rebases with conflicts need time
        const POLL_INTERVAL_MS = 5000;
        const startTime = Date.now();
        let newHead: string | null = null;

        while (Date.now() - startTime < REBASE_TIMEOUT_MS) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          try {
            await execAsync('git fetch origin', { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 });
            const { stdout: headNow } = await execAsync(
              `git rev-parse origin/${branchName}`,
              { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
            );
            if (headNow.trim() !== headBefore.trim()) {
              newHead = headNow.trim();
              console.log(`[merge] Work agent pushed rebased branch for ${issueId} (new HEAD: ${newHead.slice(0, 8)})`);
              break;
            }
          } catch { /* fetch failed, retry */ }

          if (!await sessionExistsAsync(agentId)) {
            console.log(`[merge] Work agent ${agentId} stopped during rebase`);
            break;
          }
        }

        if (newHead) {
          rebaseResult = { success: true, newHead };
        } else if (!await sessionExistsAsync(agentId)) {
          rebaseResult = {
            success: false,
            reason: `Work agent ${agentId} stopped before completing the rebase onto ${targetBranch}`,
          };
        } else {
          rebaseResult = { success: false, reason: `Work agent did not push the rebased branch within ${REBASE_TIMEOUT_MS / 60000} minutes` };
        }
      } catch (recoveryErr: any) {
        rebaseResult = {
          success: false,
          reason: recoveryErr.message || `Work agent ${agentId} could not be prepared for merge`,
        };
      }
    }

    if (!rebaseResult.success) {
      const error = rebaseResult.reason || 'Rebase failed';
      setReviewStatus(issueId, { mergeStatus: 'failed', mergeNotes: error, readyForMerge: false });
      completePendingOperation(issueId, error);

      // Post PR comment about failure
      try {
        if (artifactUrl) {
          const body = rebaseResult.conflictFiles?.length
            ? `## Merge Failed — Rebase Conflicts\n\nConflicts in: ${rebaseResult.conflictFiles.join(', ')}\n\nThe work agent has been notified to resolve conflicts.`
            : `## Merge Failed\n\n${error}`;
          await getForgeAdapter(primaryForge).commentOnArtifact({
            forge: primaryForge,
            url: artifactUrl,
            id: artifactId,
            cwd: workspacePath,
            body,
          });
        }
      } catch { /* non-fatal */ }

      return { success: false, statusCode: 500, error };
    }

    // Step 3: Post-rebase verification gate (typecheck, lint, test)
    // Ensures the rebase didn't introduce issues before merging.
    setReviewStatus(issueId, { mergeStatus: 'verifying', mergeNotes: undefined });
    console.log(`[merge] Running post-rebase verification for ${issueId}...`);

    const { runVerificationForIssue } = await import(
      '../../../lib/cloister/verification-runner.js'
    );
    const verifyResult = await runVerificationForIssue(
      issueId,
      workspacePath,
      { isRemote: false },
      'merge-verify',
      { syncTargetBranch: false },
    );

    if (verifyResult.outcome === 'failed') {
      const error = `Post-rebase verification failed at ${verifyResult.failedCheck}`;
      console.log(`[merge] ${error}`);
      setReviewStatus(issueId, { mergeStatus: 'failed', mergeNotes: error, readyForMerge: false });
      completePendingOperation(issueId, error);

      // Post comment on PR so failure is visible
      try {
        if (artifactUrl) {
          await getForgeAdapter(primaryForge).commentOnArtifact({
            forge: primaryForge,
            url: artifactUrl,
            id: artifactId,
            cwd: workspacePath,
            body: `## Merge Blocked — Post-Rebase Verification Failed\n\nFailed check: ${verifyResult.failedCheck}\n\nThe branch was rebased successfully but verification failed. The work agent needs to fix the errors and resubmit.`,
          });
        }
      } catch { /* non-fatal */ }

      return { success: false, statusCode: 500, error };
    }
    console.log(`[merge] Post-rebase verification ${verifyResult.outcome} for ${issueId}`);

    // Step 4a: Report commit statuses on post-rebase HEAD (branch protection requires them).
    // Must happen AFTER rebase because rebase changes the HEAD SHA.
    try {
      const { getPullRequestState, isGitHubAppConfigured, reportCommitStatus } = await import('../../../lib/github-app.js');
      if (githubPrRef && isGitHubAppConfigured()) {
        const prState = await getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number);
        const sha = prState.headSha.trim();
        if (sha) {
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'panopticon/review', 'Review passed');
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'panopticon/test', 'Tests passed');
          console.log(`[merge] Reported commit statuses on post-rebase HEAD for ${issueId} (${sha.slice(0, 8)})`);
        }
      }
    } catch (statusErr: any) {
      console.warn(`[merge] Failed to report commit statuses: ${statusErr.message}`);
    }

    // Step 4b: Merge the review artifact via the configured forge.
    let artifactMerged = false;
    try {
      console.log(`[merge] Merging ${primaryForge} review artifact for ${issueId}...`);
      await getForgeAdapter(primaryForge).mergeReviewArtifact({
        forge: primaryForge,
        url: artifactUrl,
        id: artifactId,
        cwd: workspacePath,
        method: 'squash',
      });
      artifactMerged = true;
    } catch (prMergeErr: any) {
      console.error(`[merge] Review artifact merge threw for ${issueId}:`, prMergeErr);
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../lib/github-app.js');
        if (githubPrRef && isGitHubAppConfigured()) {
          const prState = await getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number);
          artifactMerged = prState.merged;
          if (artifactMerged) {
            console.log(`[merge] Race-detected: PR #${githubPrRef.number} for ${issueId} was already merged despite thrown error; proceeding`);
          }
        }
      } catch (stateCheckErr: any) {
        console.warn(`[merge] Post-error PR state check failed for ${issueId}: ${stateCheckErr.message}`);
      }

      if (!artifactMerged) {
        const error = `${primaryForge} merge failed: ${prMergeErr.message}`;
        console.error(`[merge] ${error}`);
        const isTransient =
          prMergeErr.message?.includes('Timed out waiting for GitHub PR') ||
          prMergeErr.message?.includes('ECONNRESET') ||
          prMergeErr.message?.includes('ETIMEDOUT') ||
          prMergeErr.message?.includes('ECONNREFUSED');
        if (isTransient) {
          const reconciled = await reconcileGitHubMergeStatus(issueId, getReviewStatus(issueId));
          if (reconciled) {
            artifactMerged = true;
            console.log(`[merge] Reconciliation confirmed PR merged for ${issueId} after transient error; proceeding to success path`);
          } else {
            setReviewStatus(issueId, { mergeStatus: 'verifying', mergeNotes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 500, error };
          }
          // readyForMerge stays true while reconciliation catches up or the operator retries.
        } else {
          setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
          completePendingOperation(issueId, error);
          return { success: false, statusCode: 500, error };
        }
      }
    }

    // Step 5: Mark merged and dequeue next BEFORE post-merge lifecycle.
    // postMergeLifecycle spawns a deploy script that may kill this server process,
    // so queue processing must happen before that point.
    setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
    completePendingOperation(issueId, null);

    // Dequeue next merge before lifecycle (which may kill the process)
    advanceQueue();

    // Post-merge lifecycle runs last — may spawn deploy script that kills this server
    await postMergeLifecycle(issueId, projectPath, branchName);

    return {
      success: true,
      statusCode: 200,
      message: `Successfully merged ${primaryForge} review artifact for ${issueId}`,
      prUrl: prResult.prUrl,
    };
  } catch (error: any) {
    const mergeErrorMessage = `Merge pipeline error: ${error.message}`;
    console.error(`[merge] Error for ${issueId}:`, error);
    setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: mergeErrorMessage });
    completePendingOperation(issueId, error.message);
    return { success: false, statusCode: 500, error: error.message };
  } finally {
    advanceQueue();
  }

}

setMergeQueueTriggerHandler(triggerMerge);

// ─── Route: POST /api/issues/:issueId/merge ───────────────────────────────

const postWorkspaceMergeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/merge',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!/^[A-Z]+-\d+$/i.test(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID format' }, { status: 400 });
    }
    const eventStore = yield* EventStoreService;

    const result = yield* Effect.promise(() => triggerMerge(issueId));
    if (result.success) {
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
        type: 'merge.ready',
        timestamp: new Date().toISOString(),
        payload: { issueId },
      })));
    }
    const { statusCode, ...body } = result;
    return jsonResponse(body, { status: statusCode });
  }))
);

// ─── Route: POST /api/issues/:issueId/approve ────────────────────────────

const postWorkspaceApproveRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/approve',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const existingStatus = getReviewStatus(issueId);
    if (
      existingStatus?.readyForMerge &&
      existingStatus.reviewStatus === 'passed' &&
      existingStatus.testStatus === 'passed'
    ) {
      console.log(
        `[approve] Review+test already passed for ${issueId}, forwarding to merge endpoint...`
      );
      const apiPort = process.env.API_PORT || process.env.PORT || '3011';
      try {
        const mergeRes = yield* Effect.promise(() => fetch(
          `http://localhost:${apiPort}/api/issues/${issueId}/merge`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        ));
        const mergeData = (yield* Effect.promise(() => mergeRes.json())) as any;
        return jsonResponse(mergeData, { status: mergeRes.status });
      } catch (err: any) {
        return jsonResponse(
          { error: `Failed to forward to merge: ${err.message}` },
          { status: 500 }
        );
      }
    }

    return yield* Effect.promise(async () => {
        const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
        const projectPath = getProjectPath(undefined, issuePrefix);
        const issueLower = issueId.toLowerCase();
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const branchName = `feature/${issueLower}`;

        setPendingOperation(issueId, 'approve');

        if (!existsSync(workspacePath)) {
          completePendingOperation(issueId, 'Workspace does not exist');
          return jsonResponse({ error: 'Workspace does not exist' }, { status: 400 });
        }

        try {
          await execAsync(`git rev-parse --verify ${branchName}`, {
            cwd: projectPath,
            encoding: 'utf-8',
          });
        } catch {
          completePendingOperation(issueId, `Branch ${branchName} does not exist`);
          return jsonResponse(
            { error: `Branch ${branchName} does not exist` },
            { status: 400 }
          );
        }

        try {
          const { stdout: status } = await execAsync(
            'git status --porcelain -uno',
            { cwd: workspacePath, encoding: 'utf-8' }
          );
          if (status.trim()) {
            const error = `Workspace has uncommitted changes. Please commit or stash them first:\ncd ${workspacePath}\ngit status`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 400 });
          }
        } catch {}

        try {
          await execAsync(`git push origin ${branchName}`, {
            cwd: workspacePath,
            encoding: 'utf-8',
          });
        } catch (pushErr: any) {
          console.log(`Feature branch push note: ${pushErr.message}`);
        }

        // Concurrent-merge detection: warn if another push to main succeeded in the last 30s.
        // recentPushWarning is included in the success response body below (line ~4146) so
        // the caller can surface it to the operator without a separate lookup.
        const recentCutoff = new Date(Date.now() - 30_000).toISOString();
        const recentMainPushes = listGitOperations({ operation: 'push', since: recentCutoff })
          .filter((op) => op.status === 'success' && op.branch === 'main' && op.issueId !== issueId);
        const recentPushWarning = recentMainPushes.length > 0
          ? `Another workspace pushed to main ${Math.round((Date.now() - new Date(recentMainPushes[0].ts).getTime()) / 1000)}s ago — divergence possible`
          : undefined;
        if (recentPushWarning) {
          console.warn(`[approve] ${recentPushWarning} (${issueId})`);
        }

        try {
          await execAsync('git checkout main', { cwd: projectPath, encoding: 'utf-8' });
          await execAsync('git fetch origin main', { cwd: projectPath, encoding: 'utf-8' });
          // Detect orphaned merge commit: local main is AHEAD of origin/main from a
          // previous approve attempt whose push failed. git pull --ff-only would fail
          // here with "not possible to fast-forward". Surface a recoverable error
          // with explicit instructions rather than silently hard-resetting.
          const { stdout: aheadCountRaw } = await execAsync(
            'git rev-list origin/main..HEAD --count',
            { cwd: projectPath, encoding: 'utf-8' }
          );
          const aheadCount = parseInt(aheadCountRaw.trim(), 10) || 0;
          if (aheadCount > 0) {
            const error = `Local main is ${aheadCount} commit(s) ahead of origin/main — a previous approve attempt left an unpushed merge commit. To recover, run:\n  cd ${projectPath} && git reset --hard origin/main\nThen unstick the workspace and retry.`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 409 });
          }
          await execAsync('git pull origin main --ff-only', {
            cwd: projectPath,
            encoding: 'utf-8',
          });
        } catch (checkoutErr: any) {
          const error = `Failed to checkout/update main branch: ${checkoutErr.message}`;
          completePendingOperation(issueId, error);
          return jsonResponse({ error }, { status: 400 });
        }

        // Divergence preview: count how many commits main has advanced past the feature branch
        let mainAdvancedBy = 0;
        try {
          const { stdout: aheadRaw } = await execAsync(
            `git rev-list ${branchName}..main --count`,
            { cwd: projectPath, encoding: 'utf-8' }
          );
          mainAdvancedBy = parseInt(aheadRaw.trim(), 10) || 0;
          if (mainAdvancedBy > 0) {
            console.log(`[approve] main has advanced ${mainAdvancedBy} commit(s) past ${branchName}`);
          }
        } catch {}

        const { wakeSpecialist, spawnEphemeralSpecialist: spawnApproveEphemeral } =
          await import('../../../lib/cloister/specialists.js');
        const approveProjectKey = resolveProjectFromIssue(issueId)?.projectKey ?? null;

        console.log(`[approve] Starting specialist pipeline for ${issueId}...`);

        const pipelinePrompt = `STRICT REVIEW WORKFLOW for ${issueId}

You are a DEMANDING code reviewer. Your job is to find EVERY issue before code can proceed.
DO NOT BE NICE. BE THOROUGH. The code must be PERFECT before it can proceed to testing.

=== CONTEXT ===
ISSUE: ${issueId}
WORKSPACE: ${workspacePath}
BRANCH: ${branchName}
PROJECT: ${projectPath}

=== MANDATORY REQUIREMENTS (Block if ANY violated) ===
1. **Tests Required** - Every new function MUST have test files. No exceptions.
2. **No In-Memory Only Storage** - Important data MUST persist to files/DB.
3. **No Dead Code** - Remove unused imports, functions, variables.
4. **Error Handling** - All async operations must handle errors.
5. **Type Safety** - No \`any\` without justification.

=== YOUR TASK (EXHAUSTIVE REVIEW) ===
1. cd ${workspacePath}
2. Review ALL changes: git diff main...${branchName}
3. Check EVERY file for:
   - Missing test FILES (AUTOMATIC REJECTION)
   - In-memory storage for persistent data (AUTOMATIC REJECTION)
   - Security vulnerabilities
   - Performance issues
   - Code quality problems
4. List EVERY issue found with file:line references

**IMPORTANT: DO NOT run tests (npm test). You are the REVIEW agent - you only review code.**
**The TEST agent will run tests in the next step. Just verify test FILES exist.**

=== DECISION ===
**IF ANY ISSUES FOUND:**
- Update status: curl -X POST http://localhost:${PORT}/api/review/${issueId}/status -H "Content-Type: application/json" -d '{"reviewStatus":"blocked","reviewNotes":"[detailed list of all issues found]"}'
- Use /send-feedback-to-agent to send detailed feedback to agent-${issueId.toLowerCase()}
- DO NOT hand off to test-agent

**ONLY IF CODE IS PERFECT (rare):**
- Update status: curl -X POST http://localhost:${PORT}/api/review/${issueId}/status -H "Content-Type: application/json" -d '{"reviewStatus":"passed"}'
- Queue test-agent (DO NOT use pan specialists wake directly):

curl -X POST http://localhost:${PORT}/api/specialists/test-agent/queue -H "Content-Type: application/json" -d '{"issueId":"${issueId}","workspace":"${workspacePath}","branch":"${branchName}","customPrompt":"TEST TASK for ${issueId}:\\nWORKSPACE: ${workspacePath}\\nBRANCH: ${branchName}\\n\\n1. cd ${workspacePath}\\n2. Run tests: npm test\\n3. Update status via API:\\n   - PASS: curl -X POST http://localhost:${PORT}/api/review/${issueId}/status -H Content-Type:application/json -d {testStatus:passed}\\n   - FAIL: curl -X POST http://localhost:${PORT}/api/review/${issueId}/status -d {testStatus:failed,testNotes:[details]}\\n\\nIMPORTANT: Do NOT hand off to merge-agent. Human clicks Merge button when ready."}'

=== REVIEW PHILOSOPHY ===
- Your default answer is BLOCK, not PASS
- Missing tests alone is enough to reject
- In-memory storage for important data is enough to reject
- "It works" is NOT enough - code must be EXCELLENT
- Find EVERYTHING. The agent should learn from your feedback.`;

        let reviewResult: { success: boolean; message: string; error?: string };
        if (approveProjectKey) {
          reviewResult = await spawnApproveEphemeral(approveProjectKey, 'review-agent', {
            issueId,
            branch: branchName,
            workspace: workspacePath,
            promptOverride: pipelinePrompt,
          });
        } else {
          reviewResult = await wakeSpecialist('review-agent', pipelinePrompt, {
            waitForReady: true,
            startIfNotRunning: true,
          });
        }

        if (!reviewResult.success) {
          console.warn(`[approve] review-agent failed to wake: ${reviewResult.message}`);
          console.log(`[approve] Falling back to direct merge...`);
        } else {
          console.log(
            `[approve] Pipeline started - review-agent will queue test-agent when done`
          );
          completePendingOperation(issueId, null);
          return jsonResponse({
            success: true,
            message: `Approval pipeline started for ${issueId}. Specialists: review → test`,
            pipeline: 'running',
            note: 'Watch the specialists panel for progress. Click Merge when review+test pass.',
            ...(recentPushWarning && { recentPushWarning }),
            ...(mainAdvancedBy > 0 && { mainAdvancedBy }),
          });
        }

        // Fallback: direct merge via merge-agent
        console.log(`[approve] Step 3/3: Waking merge-agent for ${issueId}...`);

        try {
          const { spawnMergeAgentForBranches } = await import(
            '../../../lib/cloister/merge-agent.js'
          );
          const mergeResult = await spawnMergeAgentForBranches(
            projectPath,
            branchName,
            'main',
            issueId
          );

          if (mergeResult.success && mergeResult.testsStatus === 'PASS') {
            console.log(`merge-agent successfully merged ${issueId}`);
          } else if (mergeResult.success && mergeResult.testsStatus === 'SKIP') {
            console.log(`merge-agent merged ${issueId} (tests skipped)`);
          } else if (mergeResult.success && mergeResult.testsStatus === 'FAIL') {
            try {
              await execAsync('git reset --hard HEAD~1', {
                cwd: projectPath,
                encoding: 'utf-8',
              });
            } catch {}
            const error = `merge-agent completed merge but tests failed.\nReason: ${mergeResult.reason || 'Tests did not pass'}\n\nPlease fix tests and try again.`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 400 });
          } else {
            try {
              await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' });
            } catch {}
            try {
              await execAsync('git reset --hard HEAD', { cwd: projectPath, encoding: 'utf-8' });
            } catch {}
            const error = `merge-agent could not complete merge.\nReason: ${mergeResult.reason || 'Unknown'}\nFailed files: ${mergeResult.failedFiles?.join(', ') || 'N/A'}\n\nPlease resolve manually:\ncd ${projectPath}\ngit merge ${branchName}`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 400 });
          }
        } catch (agentError: any) {
          try {
            await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' });
          } catch {}
          try {
            await execAsync('git reset --hard HEAD', { cwd: projectPath, encoding: 'utf-8' });
          } catch {}
          const error = `merge-agent failed to run: ${agentError.message}\n\nPlease resolve manually:\ncd ${projectPath}\ngit merge ${branchName}`;
          completePendingOperation(issueId, error);
          return jsonResponse({ error }, { status: 400 });
        }

        // Push merged main (with divergence guard — pushApproveMain catches MainDivergedError
        // and marks workspace stuck if origin/main advanced past our local ancestor)
        const pushResult = await pushApproveMain(issueId, projectPath);
        if (!pushResult.pushed) {
          completePendingOperation(issueId, pushResult.error);
          return jsonResponse({ error: pushResult.error }, { status: pushResult.httpStatus });
        }

        // Post-merge lifecycle
        const { approve: lifecycleApprove } = await import('../../../lib/lifecycle/index.js');
        const ghResolved = resolveGitHubIssueShared(issueId);
        const isGitHubIssueFlag = ghResolved.isGitHub;
        const lifecycleCtx = {
          issueId,
          projectPath,
          ...(ghResolved.isGitHub
            ? {
                github: {
                  owner: ghResolved.owner,
                  repo: ghResolved.repo,
                  number: ghResolved.number,
                },
              }
            : {}),
        };

        const lifecycleResult = await lifecycleApprove(lifecycleCtx);
        console.log(
          `[approve] Lifecycle completed for ${issueId}: ${lifecycleResult.steps
            .filter((s: any) => s.success && !s.skipped)
            .map((s: any) => s.step)
            .join(', ')}`
        );

        if (isGitHubIssueFlag) {
          try {
            await execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 });
          } catch (syncError: any) {
            console.error('pan sync failed (non-fatal):', syncError.message);
          }
        }

        completePendingOperation(issueId);

        return jsonResponse({
          success: true,
          message: `Approved ${issueId}: ${lifecycleResult.steps
            .filter((s: any) => s.success && !s.skipped)
            .map((s: any) => s.step)
            .join(', ')}${isGitHubIssueFlag ? ', skills synced' : ''}`,
        });
    });
  }))
);

// ─── Route: DELETE /api/review/:issueId/pending ──────────────────────────

const deleteWorkspacePendingRoute = HttpRouter.add(
  'DELETE',
  '/api/review/:issueId/pending',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    clearPendingOperation(issueId);
    return jsonResponse({ success: true });
  }))
);

// ─── Route: GET /api/workspaces/:issueId/tldr ─────────────────────────────────

const getWorkspaceTldrRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/tldr',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.promise(async () => {
        const projectRoot = process.cwd();
        const workspacePath = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
        const venvPath = join(workspacePath, '.venv');

        if (!existsSync(workspacePath)) {
          return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
        }

        if (!existsSync(venvPath)) {
          return jsonResponse({
            available: false,
            reason: 'No .venv found in workspace',
          });
        }

        const service = getTldrDaemonService(workspacePath, venvPath);
        const status = await service.getStatus();
        const { fileCount, indexAge, edgeCount } = await getIndexStats(workspacePath);

        return jsonResponse({
          available: true,
          running: status.running,
          pid: status.pid,
          healthy: status.healthy,
          workspacePath,
          fileCount,
          indexAge,
          edgeCount,
        });
    })
  }))
);

// ─── Route: POST /api/workspaces/:issueId/refresh-token ───────────────────────

const postWorkspaceRefreshTokenRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/refresh-token',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    const { refreshWorkspaceToken, isGitHubAppConfigured } = yield* Effect.promise(() => import('../../../lib/github-app.js'));
    if (!isGitHubAppConfigured()) {
      return jsonResponse({ success: false, error: 'GitHub App not configured' }, { status: 400 });
    }

    yield* Effect.promise(() => refreshWorkspaceToken(workspacePath));
    return jsonResponse({ success: true, message: `Token refreshed for ${issueId}` });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

// ─── Route: GET /api/merge-queue ─────────────────────────────────────────────

const getMergeQueueRoute = HttpRouter.add(
  'GET',
  '/api/merge-queue',
  httpHandler(Effect.gen(function* () {
    const queues = getAllActiveQueues();
    return jsonResponse({ queues });
  })),
);

export const workspacesRouteLayer = Layer.mergeAll(
  getWorkspaceRoute,
  postWorkspacesRoute,
  getWorkspacePlanRoute,
  getWorkspaceCleanPreviewRoute,
  postWorkspaceCleanRoute,
  postWorkspaceContainerizeRoute,
  postWorkspaceStartRoute,
  postWorkspaceContainerActionRoute,
  postWorkspaceRefreshDbRoute,
  getWorkspaceReviewStatusRoute,
  postWorkspaceReviewStatusRoute,
  postWorkspaceReviewRoute,
  postWorkspaceRequestReviewRoute,
  postWorkspaceResetReviewRoute,
  postWorkspaceAbortReviewRoute,
  postWorkspaceUnstickRoute,
  postWorkspaceDeaconIgnoreRoute,
  postWorkspaceSyncMainRoute,
  postWorkspaceMergeRoute,
  postWorkspaceApproveRoute,
  deleteWorkspacePendingRoute,
  getWorkspaceTldrRoute,
  postWorkspaceRefreshTokenRoute,
  getMergeQueueRoute,
);

export default workspacesRouteLayer;
