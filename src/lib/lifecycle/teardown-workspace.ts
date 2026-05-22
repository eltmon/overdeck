/**
 * teardown-workspace — Full workspace cleanup.
 *
 * Consolidates workspace teardown from close-out.ts and workspace-manager.ts.
 * Handles: tmux sessions, TLDR daemon, Docker containers, git worktrees,
 * agent state directories, and (optionally) git branches.
 *
 * The workspace-manager's removeWorkspace() handles additional project-specific
 * cleanup (DNS, tunnels, Hume, ports) that this module does not cover.
 * In Phase 2, removeWorkspace() will delegate to this module for the common steps.
 */

import { existsSync } from 'fs';
import { appendFile, readFile, rm, writeFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { AGENTS_DIR } from '../paths.js';
import { killSessionAsyncEffect, sessionExistsAsyncEffect, listSessionNamesAsyncEffect } from '../tmux.js';
import type { LifecycleContext, StepResult, TeardownOptions } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';
import { findAllWorkspacePaths, findWorkspacePath } from './archive-planning.js';
import { getContainersReferencingWorkspacePath } from '../workspace-manager.js';
import { DEVCONTAINER_DIRNAME } from '../workspace/devcontainer-renderer.js';

const execAsync = promisify(exec);

/**
 * Kill tmux sessions associated with an issue.
 */
function killTmuxSessions(issueLower: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => killTmuxSessionsImpl(issueLower),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:tmux-sessions', `Failed: ${(err as Error).message}`)),
    ),
  );
}

async function killTmuxSessionsImpl(issueLower: string): Promise<StepResult> {
  const step = 'teardown:tmux-sessions';
  let killed = 0;

  // Exact-match sessions (agent, test, merge, planning).
  const exactPatterns = [
    `agent-${issueLower}`,
    `test-${issueLower}`,
    `merge-${issueLower}`,
    `planning-${issueLower}`,
  ];
  for (const session of exactPatterns) {
    if (await Effect.runPromise(sessionExistsAsyncEffect(session))) {
      try {
        await Effect.runPromise(killSessionAsyncEffect(session));
        killed++;
      } catch {
        // session may have died between check and kill
      }
    }
  }

  // Pattern-match sessions for review coordinators, review specialists, and
  // canonical specialists. Today's naming uses the UPPER issue ID (PAN-1024)
  // not the lower form, and includes session families that the prior
  // single-regex didn't cover. PAN-1024 close-out left
  // `review-coordinator-PAN-1024-...` and
  // `specialist-panopticon-cli-PAN-1024-test-agent` alive (2026-05-09).
  //
  // Patterns we now match (case-insensitive on the issue ID):
  //   - review-coordinator-<ISSUE>-<timestamp>
  //   - review-<ISSUE>-<timestamp>-<role>          (legacy)
  //   - specialist-<projectKey>-<ISSUE>-<role>     (canonical PAN-830/915)
  try {
    const allSessions = await Effect.runPromise(listSessionNamesAsyncEffect());
    const escapedLower = issueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedUpper = issueLower.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const issuePart = `(${escapedLower}|${escapedUpper})`;
    const patterns: RegExp[] = [
      new RegExp(`^review-coordinator-${issuePart}-\\d+`),
      new RegExp(`^review-${issuePart}-\\d+`),
      new RegExp(`^specialist-[^-]+(?:-[^-]+)*?-${issuePart}-`),
    ];
    const matchedSessions = allSessions.filter(s => patterns.some(p => p.test(s)));
    for (const session of matchedSessions) {
      try {
        await Effect.runPromise(killSessionAsyncEffect(session));
        killed++;
      } catch {
        // session may have died between check and kill
      }
    }
  } catch {
    // Session listing may fail if tmux server is not running
  }

  // NOTE: Per-project ephemeral specialists (specialist-{project}-{type}) are NOT killed here.
  // They belong to the project, not the issue, and accumulate context across issues via --resume.
  // Their grace period / idle timeout handles cleanup when no new work arrives.

  if (killed > 0) {
    return stepOk(step, [`Killed ${killed} tmux session(s)`]);
  }
  return stepSkipped(step, ['No tmux sessions found']);
}

/**
 * Stop TLDR daemon if workspace has a .venv.
 */
function stopTldrDaemon(workspacePath: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => stopTldrDaemonImpl(workspacePath),
    catch: (err) => err,
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(stepSkipped('teardown:tldr-daemon', ['TLDR daemon not running or failed to stop (non-fatal)'])),
    ),
  );
}

async function stopTldrDaemonImpl(workspacePath: string): Promise<StepResult> {
  const step = 'teardown:tldr-daemon';
  const venvPath = join(workspacePath, '.venv');
  if (!existsSync(venvPath)) {
    return stepSkipped(step, ['No .venv found']);
  }
  try {
    const { getTldrDaemonService } = await import('../tldr-daemon.js');
    const tldrService = getTldrDaemonService(workspacePath, venvPath);
    await tldrService.stop();
    return stepOk(step, ['Stopped TLDR daemon']);
  } catch {
    return stepSkipped(step, ['TLDR daemon not running or failed to stop (non-fatal)']);
  }
}

/**
 * Stop Docker containers for the workspace.
 */
function stopDocker(
  workspacePath: string,
  issueLower: string,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => stopDockerImpl(workspacePath, issueLower),
    catch: (err) => err,
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(stepSkipped('teardown:docker', ['Docker cleanup skipped (not running or failed)'])),
    ),
  );
}

async function stopDockerImpl(
  workspacePath: string,
  issueLower: string,
): Promise<StepResult> {
  const step = 'teardown:docker';
  try {
    const { stopWorkspaceDocker } = await import('../workspace-manager.js');
    await stopWorkspaceDocker(workspacePath, issueLower);
    return stepOk(step, ['Stopped Docker containers']);
  } catch {
    return stepSkipped(step, ['Docker cleanup skipped (not running or failed)']);
  }
}

/**
 * Detect whether a PID belongs to a process running inside a Docker container.
 * Container processes appear in host lsof output when paths are bind-mounted.
 */
async function isDockerContainerProcess(pid: string): Promise<boolean> {
  try {
    const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf-8');
    return cgroup.includes('/docker-') || cgroup.includes('/docker/');
  } catch {
    return false;
  }
}

/**
 * Kill orphaned host processes for a workspace.
 */
function killOrphanedProcesses(workspacePath: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => killOrphanedProcessesImpl(workspacePath),
    catch: (err) => err,
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(stepSkipped('teardown:orphaned-processes', ['Orphaned process cleanup failed (non-fatal)'])),
    ),
  );
}

async function killOrphanedProcessesImpl(workspacePath: string): Promise<StepResult> {
  const step = 'teardown:orphaned-processes';
  try {
    // Find PIDs with cwd matching the workspace path
    const { stdout } = await execAsync(
      `lsof +D "${workspacePath}" -t 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 10000 },
    );
    const pids = stdout.trim().split('\n').filter(Boolean).map(p => p.trim()).filter(p => /^\d+$/.test(p));

    if (pids.length === 0) {
      return stepSkipped(step, ['No orphaned processes found']);
    }

    // Don't kill our own process or the dashboard
    const myPid = String(process.pid);
    const safePids = pids.filter(p => p !== myPid);

    if (safePids.length === 0) {
      return stepSkipped(step, ['No orphaned processes to kill']);
    }

    // Filter out Docker container processes — they appear in host lsof due to bind mounts
    const hostPids: string[] = [];
    for (const pid of safePids) {
      if (!(await isDockerContainerProcess(pid))) {
        hostPids.push(pid);
      }
    }

    if (hostPids.length === 0) {
      return stepSkipped(step, ['No orphaned host processes to kill (all were container processes)']);
    }

    await execAsync(`kill ${hostPids.join(' ')} 2>/dev/null || true`, { encoding: 'utf-8', timeout: 5000 });
    return stepOk(step, [`Killed ${hostPids.length} orphaned process(es)`]);
  } catch {
    return stepSkipped(step, ['Orphaned process cleanup failed (non-fatal)']);
  }
}

/**
 * Sync workspace beads to the project-root beads database before workspace deletion.
 */
function syncWorkspaceBeads(
  projectPath: string,
  workspacePath: string,
  issueLower: string,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => syncWorkspaceBeadsImpl(projectPath, workspacePath, issueLower),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:sync-beads', `Failed to sync workspace beads: ${(err as Error).message}`)),
    ),
  );
}

async function syncWorkspaceBeadsImpl(
  projectPath: string,
  workspacePath: string,
  issueLower: string,
): Promise<StepResult> {
  const step = 'teardown:sync-beads';
  const workspaceBeadsDir = join(workspacePath, '.beads');

  if (!existsSync(workspaceBeadsDir)) {
    return stepSkipped(step, ['No .beads directory in workspace']);
  }

  try {
    // Export workspace beads to JSONL
    await execAsync(
      'bd export --output .beads/issues-export.jsonl 2>&1 || true',
      { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 }
    );

    const exportPath = join(workspacePath, '.beads', 'issues-export.jsonl');
    if (!existsSync(exportPath)) {
      await execAsync('bd export --output .beads/issues.jsonl 2>&1 || true', { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 });
    }

    // Import workspace beads into project-root database
    // Use bd import if available, otherwise copy JSONL entries
    try {
      await execAsync(
        `bd import "${join(workspacePath, '.beads', 'issues.jsonl')}" 2>&1 || true`,
        { cwd: projectPath, encoding: 'utf-8', timeout: 15000 }
      );
      return stepOk(step, [`Synced workspace beads to project root for ${issueLower}`]);
    } catch {
      // bd import may not exist — try manual JSONL merge
      const wsJsonl = join(workspacePath, '.beads', 'issues.jsonl');
      const projJsonl = join(projectPath, '.beads', 'issues.jsonl');

      if (existsSync(wsJsonl) && existsSync(projJsonl)) {
        const wsContent = await readFile(wsJsonl, 'utf-8');
        const issuePattern = issueLower.replace('-', '[-_]');
        const relevantLines = wsContent.split('\n').filter(
          line => line.trim() && new RegExp(issuePattern, 'i').test(line)
        );
        if (relevantLines.length > 0) {
          await appendFile(projJsonl, '\n' + relevantLines.join('\n'));
          return stepOk(step, [`Appended ${relevantLines.length} beads entries for ${issueLower} to project JSONL`]);
        }
      }
      return stepSkipped(step, ['No beads to sync or import not available']);
    }
  } catch (err) {
    return stepFailed(step, `Failed to sync workspace beads: ${(err as Error).message}`);
  }
}

/**
 * Clear beads for this issue from the project-root .beads/issues.jsonl.
 */
function clearProjectBeads(
  projectPath: string,
  issueLower: string,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => clearProjectBeadsImpl(projectPath, issueLower),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:clear-beads', `Failed to clear beads: ${(err as Error).message}`)),
    ),
  );
}

async function clearProjectBeadsImpl(
  projectPath: string,
  issueLower: string,
): Promise<StepResult> {
  const step = 'teardown:clear-beads';
  const projJsonl = join(projectPath, '.beads', 'issues.jsonl');

  if (!existsSync(projJsonl)) {
    return stepSkipped(step, ['No .beads/issues.jsonl in project root']);
  }

  try {
    const content = await readFile(projJsonl, 'utf-8');
    const lines = content.split('\n');
    const issueUpper = issueLower.toUpperCase();
    const before = lines.length;
    // Remove lines that reference this issue (by ID in the title or issue field)
    const filtered = lines.filter(line => {
      if (!line.trim()) return true; // keep blank lines
      try {
        const entry = JSON.parse(line);
        const title = (entry.title || '').toUpperCase();
        const issue = (entry.issue || '').toUpperCase();
        return !title.includes(issueUpper) && issue !== issueUpper;
      } catch {
        return true; // keep unparseable lines
      }
    });
    const removed = before - filtered.length;
    if (removed > 0) {
      await writeFile(projJsonl, filtered.join('\n'));
      return stepOk(step, [`Removed ${removed} beads entries for ${issueLower} from project JSONL`]);
    }
    return stepSkipped(step, [`No beads entries found for ${issueLower}`]);
  } catch (err) {
    return stepFailed(step, `Failed to clear beads: ${(err as Error).message}`);
  }
}

/**
 * Remove git worktree for the workspace.
 */
function removeWorktree(
  projectPath: string,
  workspacePath: string,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => removeWorktreeImpl(projectPath, workspacePath),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:worktree', `Failed to remove workspace: ${(err as Error).message}`)),
    ),
  );
}

async function removeWorktreeImpl(
  projectPath: string,
  workspacePath: string,
): Promise<StepResult> {
  const step = 'teardown:worktree';
  if (!existsSync(workspacePath)) {
    return stepSkipped(step, ['Workspace directory does not exist']);
  }

  // Guard: never delete workspace (and its `.devcontainer/`) while containers
  // still reference compose paths inside it.
  const orphanedContainers = await getContainersReferencingWorkspacePath(workspacePath);
  if (orphanedContainers.length > 0) {
    return stepFailed(
      step,
      `Cannot remove workspace: ${orphanedContainers.length} Docker container(s) still reference compose paths in ${DEVCONTAINER_DIRNAME}/. ` +
        `Run workspace Docker cleanup first or stop the containers manually.`,
    );
  }

  try {
    await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectPath });
    return stepOk(step, ['Removed git worktree']);
  } catch {
    // worktree remove failed — try direct removal
    try {
      await rm(workspacePath, { recursive: true, force: true });
      return stepOk(step, ['Removed workspace directory after worktree removal failed']);
    } catch (err) {
      return stepFailed(step, `Failed to remove workspace: ${(err as Error).message}`);
    }
  }
}

/**
 * Remove every agent state directory tied to an issue.
 */
function removeAgentState(issueLower: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => removeAgentStateImpl(issueLower),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:agent-state', `Failed: ${(err as Error).message}`)),
    ),
  );
}

async function removeAgentStateImpl(issueLower: string): Promise<StepResult> {
  const step = 'teardown:agent-state';
  const { readdir, rm } = await import('fs/promises');

  let entries: string[];
  try {
    entries = await readdir(AGENTS_DIR);
  } catch {
    return stepSkipped(step, ['Agents directory not present']);
  }

  const work = `agent-${issueLower}`;
  const planner = `planning-${issueLower}`;
  const specialistPrefix = `agent-${issueLower}-`;
  const targets = entries.filter(name =>
    name === work || name === planner || name.startsWith(specialistPrefix),
  );

  let removed = 0;
  for (const name of targets) {
    try {
      await rm(join(AGENTS_DIR, name), { recursive: true, force: true });
      removed++;
    } catch { /* non-fatal */ }
  }

  if (removed > 0) {
    return stepOk(step, [`Removed ${removed} agent state director${removed === 1 ? 'y' : 'ies'}`]);
  }
  return stepSkipped(step, ['No agent state directories found']);
}

/**
 * Delete feature branches (local + remote).
 */
function deleteBranches(
  projectPath: string,
  issueLower: string,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => deleteBranchesImpl(projectPath, issueLower),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:branches', `Failed: ${(err as Error).message}`)),
    ),
  );
}

async function deleteBranchesImpl(
  projectPath: string,
  issueLower: string,
): Promise<StepResult> {
  const step = 'teardown:branches';
  const branchName = `feature/${issueLower}`;
  const details: string[] = [];

  // Delete local branch
  try {
    await execAsync(`git branch -D "${branchName}"`, { cwd: projectPath, encoding: 'utf-8' });
    details.push(`Deleted local branch ${branchName}`);
  } catch {
    details.push(`Local branch ${branchName} not found (already deleted)`);
  }

  // Delete remote branch
  try {
    await execAsync(`git push origin --delete "${branchName}"`, { cwd: projectPath, encoding: 'utf-8' });
    details.push(`Deleted remote branch ${branchName}`);
  } catch {
    details.push(`Remote branch ${branchName} not found (already deleted)`);
  }

  return stepOk(step, details);
}

/**
 * Clear shadow state for an issue.
 */
function clearShadowState(issueId: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => clearShadowStateImpl(issueId),
    catch: (err) => err,
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(stepSkipped('teardown:shadow-state', ['Shadow state cleanup skipped (non-fatal)'])),
    ),
  );
}

async function clearShadowStateImpl(issueId: string): Promise<StepResult> {
  const step = 'teardown:shadow-state';
  try {
    const { removeShadowState } = await import('../shadow-state.js');
    const result = removeShadowState(issueId);
    if (result.success) {
      return stepOk(step, [`Cleared shadow state for ${issueId}`]);
    }
    return stepSkipped(step, ['No shadow state found']);
  } catch {
    return stepSkipped(step, ['Shadow state cleanup skipped (non-fatal)']);
  }
}

/**
 * Remove legacy .planning/<issue>/ directory from project root.
 */
function clearLegacyPlanningDir(
  projectPath: string,
  issueLower: string,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: async () => {
      const step = 'teardown:legacy-planning-dir';
      const legacyDir = join(projectPath, '.planning', issueLower);
      if (!existsSync(legacyDir)) {
        return stepSkipped(step, ['No legacy planning directory found']);
      }
      await rm(legacyDir, { recursive: true, force: true });
      return stepOk(step, [`Deleted legacy planning dir: ${legacyDir}`]);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:legacy-planning-dir', `Failed to delete legacy planning dir: ${(err as Error).message}`)),
    ),
  );
}

/**
 * Build template placeholders for project-specific cleanup (tunnel, Hume).
 */
function buildPlaceholders(
  ctx: LifecycleContext,
  opts: TeardownOptions,
  workspacePath: string,
) {
  const issueLower = ctx.issueId.toLowerCase();
  const featureFolder = `feature-${issueLower}`;
  const projName = opts.projectName || ctx.projectName || basename(ctx.projectPath);
  const domain = opts.workspaceConfig?.dns?.domain || 'localhost';
  return {
    FEATURE_NAME: issueLower,
    FEATURE_FOLDER: featureFolder,
    BRANCH_NAME: `feature/${issueLower}`,
    COMPOSE_PROJECT: `${projName}-${featureFolder}`,
    DOMAIN: domain,
    PROJECT_NAME: projName,
    PROJECT_PATH: ctx.projectPath,
    WORKSPACE_PATH: workspacePath,
  };
}

/**
 * Remove Cloudflare tunnel ingress for workspace.
 */
function removeTunnelConfig(
  tunnelConfig: any,
  placeholders: Record<string, string>,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: async () => {
      const { removeTunnelIngress } = await import('../tunnel.js');
      const result = await removeTunnelIngress(tunnelConfig, placeholders as any);
      return stepOk('teardown:tunnel', result.steps || ['Removed tunnel ingress']);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('teardown:tunnel', [`Tunnel cleanup warning: ${(err as Error).message}`])),
    ),
  );
}

/**
 * Remove Hume EVI config for workspace.
 */
function removeHumeEviConfig(
  humeConfig: any,
  placeholders: Record<string, string>,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: async () => {
      const { deleteHumeConfig } = await import('../hume.js');
      const result = await deleteHumeConfig(humeConfig, placeholders as any);
      return stepOk('teardown:hume', result.steps || ['Removed Hume EVI config']);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('teardown:hume', [`Hume cleanup warning: ${(err as Error).message}`])),
    ),
  );
}

/**
 * Full workspace teardown.
 */
export function teardownWorkspace(
  ctx: LifecycleContext,
  opts: TeardownOptions = {},
): Effect.Effect<StepResult[]> {
  return Effect.gen(function* () {
    const issueLower = ctx.issueId.toLowerCase();
    const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);
    const shouldDeleteWorkspace = opts.deleteWorkspace !== false; // default true
    const results: StepResult[] = [];

    // 1. Kill tmux sessions
    results.push(yield* killTmuxSessions(issueLower));

    // 2. Clear shadow state (always runs)
    results.push(yield* clearShadowState(ctx.issueId));

    // 3. Clear legacy planning directory (always runs)
    results.push(yield* clearLegacyPlanningDir(ctx.projectPath, issueLower));

    // 4-9: Workspace-specific cleanup
    if (workspacePath && existsSync(workspacePath)) {
      // 4. Stop TLDR daemon (only if deleting workspace)
      if (shouldDeleteWorkspace) {
        results.push(yield* stopTldrDaemon(workspacePath));
      }

      // 5. Stop Docker containers (only if deleting workspace)
      if (shouldDeleteWorkspace && !opts.skipDocker) {
        results.push(yield* stopDocker(workspacePath, issueLower));
      }

      // 5b. Kill orphaned host processes (Vite, node) that survive Docker teardown
      if (shouldDeleteWorkspace) {
        results.push(yield* killOrphanedProcesses(workspacePath));
      }

      // 6. Beads lifecycle: sync or clear depending on context (PAN-412)
      if (opts.clearBeads) {
        results.push(yield* clearProjectBeads(ctx.projectPath, issueLower));
      } else if (shouldDeleteWorkspace) {
        results.push(yield* syncWorkspaceBeads(ctx.projectPath, workspacePath, issueLower));
      }

      // 7-8: Project-specific cleanup (tunnel, Hume)
      if (shouldDeleteWorkspace && (opts.workspaceConfig?.tunnel || opts.workspaceConfig?.hume)) {
        const placeholders = buildPlaceholders(ctx, opts, workspacePath);

        if (opts.workspaceConfig.tunnel) {
          results.push(yield* removeTunnelConfig(opts.workspaceConfig.tunnel, placeholders));
        }
        if (opts.workspaceConfig.hume) {
          results.push(yield* removeHumeEviConfig(opts.workspaceConfig.hume, placeholders));
        }
      }

      // 9. Remove worktree + workspace directory (only if deleting workspace).
      if (shouldDeleteWorkspace) {
        const allPaths = findAllWorkspacePaths(ctx.projectPath, issueLower);
        for (const p of allPaths) {
          results.push(yield* removeWorktree(ctx.projectPath, p));
        }
      }
    } else {
      results.push(stepSkipped('teardown:workspace', ['No workspace found to clean up']));
    }

    // 10. Remove agent state
    results.push(yield* removeAgentState(issueLower));

    // 11. Delete branches (only if explicitly requested)
    if (opts.deleteBranches) {
      results.push(yield* deleteBranches(ctx.projectPath, issueLower));
    }

    // 12. Prune checkpoint refs for this issue's agents.
    results.push(yield* pruneCheckpointRefs(ctx.projectPath, issueLower));

    // 13. Prune specialist registry entries for this issue.
    results.push(yield* pruneSpecialistRegistry(ctx.issueId));

    return results;
  });
}

function pruneSpecialistRegistry(issueId: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: async () => {
      const step = 'teardown:specialist-registry';
      const { pruneSpecialistRegistryEntriesForIssue } = await import('../cloister/specialists.js');
      const removed = pruneSpecialistRegistryEntriesForIssue(issueId);
      return removed > 0
        ? stepOk(step, [`Pruned ${removed} specialist registry entr${removed === 1 ? 'y' : 'ies'} for ${issueId}`])
        : stepSkipped(step, [`No specialist registry entries for ${issueId}`]);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('teardown:specialist-registry', [`Specialist registry prune failed (non-fatal): ${(err as Error).message}`])),
    ),
  );
}

function pruneCheckpointRefs(projectPath: string, issueLower: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: async () => {
      const step = 'teardown:checkpoint-refs';
      const { pruneCheckpointRefsForAgents } = await import('../checkpoint/checkpoint-manager.js');
      const agentIds = [`agent-${issueLower}`, `planning-${issueLower}`];
      const pruned = await pruneCheckpointRefsForAgents(projectPath, agentIds);
      return stepOk(step, [`Pruned ${pruned} checkpoint ref(s) for ${agentIds.join(', ')}`]);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('teardown:checkpoint-refs', `Checkpoint prune failed: ${(err as Error).message}`)),
    ),
  );
}
