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

import { existsSync, rmSync, unlinkSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AGENTS_DIR } from '../paths.js';
import { sessionExists } from '../tmux.js';
import type { LifecycleContext, StepResult, TeardownOptions } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';
import { findWorkspacePath } from './archive-planning.js';

const execAsync = promisify(exec);

/**
 * Kill tmux sessions associated with an issue.
 */
async function killTmuxSessions(issueLower: string): Promise<StepResult> {
  const step = 'teardown:tmux-sessions';
  // Legacy naming: agent-{issue}, review-{issue}, etc.
  const patterns = [
    `agent-${issueLower}`,
    `review-${issueLower}`,
    `test-${issueLower}`,
    `merge-${issueLower}`,
    `planning-${issueLower}`,
  ];

  let killed = 0;
  for (const session of patterns) {
    if (sessionExists(session)) {
      try {
        await execAsync(`tmux kill-session -t ${session}`);
        killed++;
      } catch {
        // session may have died between check and kill
      }
    }
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
async function stopTldrDaemon(workspacePath: string): Promise<StepResult> {
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
async function stopDocker(
  workspacePath: string,
  projectName: string,
  issueLower: string,
): Promise<StepResult> {
  const step = 'teardown:docker';
  try {
    const { stopWorkspaceDocker } = await import('../workspace-manager.js');
    await stopWorkspaceDocker(workspacePath, projectName, issueLower);
    return stepOk(step, ['Stopped Docker containers']);
  } catch {
    return stepSkipped(step, ['Docker cleanup skipped (not running or failed)']);
  }
}

/**
 * Sync workspace beads to the project-root beads database before workspace deletion.
 * Without this, beads created in the workspace's .beads/dolt/ are lost when the worktree is removed.
 */
async function syncWorkspaceBeads(
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
    const { stdout: exportOutput } = await execAsync(
      'bd export --output .beads/issues-export.jsonl 2>&1 || true',
      { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 }
    );

    const exportPath = join(workspacePath, '.beads', 'issues-export.jsonl');
    if (!existsSync(exportPath)) {
      // Try syncing directly — bd sync exports to the standard JSONL
      await execAsync('bd sync 2>&1 || true', { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 });
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
      const { readFileSync, appendFileSync } = await import('fs');
      const wsJsonl = join(workspacePath, '.beads', 'issues.jsonl');
      const projJsonl = join(projectPath, '.beads', 'issues.jsonl');

      if (existsSync(wsJsonl) && existsSync(projJsonl)) {
        const wsContent = readFileSync(wsJsonl, 'utf-8');
        const issuePattern = issueLower.replace('-', '[-_]');
        const relevantLines = wsContent.split('\n').filter(
          line => line.trim() && new RegExp(issuePattern, 'i').test(line)
        );
        if (relevantLines.length > 0) {
          appendFileSync(projJsonl, '\n' + relevantLines.join('\n'));
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
 * Remove git worktree for the workspace.
 */
async function removeWorktree(
  projectPath: string,
  workspacePath: string,
): Promise<StepResult> {
  const step = 'teardown:worktree';
  if (!existsSync(workspacePath)) {
    return stepSkipped(step, ['Workspace directory does not exist']);
  }

  try {
    await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectPath });
    return stepOk(step, ['Removed git worktree']);
  } catch {
    // worktree remove failed — try direct removal
    try {
      rmSync(workspacePath, { recursive: true, force: true });
      return stepOk(step, ['Removed workspace directory (worktree remove failed, used rmSync)']);
    } catch (err) {
      return stepFailed(step, `Failed to remove workspace: ${(err as Error).message}`);
    }
  }
}

/**
 * Remove agent state directories (~/.panopticon/agents/agent-<issue>/ and planning-<issue>/).
 */
async function removeAgentState(issueLower: string): Promise<StepResult> {
  const step = 'teardown:agent-state';
  const dirs = [
    join(AGENTS_DIR, `agent-${issueLower}`),
    join(AGENTS_DIR, `planning-${issueLower}`),
  ];

  let removed = 0;
  for (const dir of dirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed++;
    }
  }

  if (removed > 0) {
    return stepOk(step, [`Removed ${removed} agent state director${removed === 1 ? 'y' : 'ies'}`]);
  }
  return stepSkipped(step, ['No agent state directories found']);
}

/**
 * Delete feature branches (local + remote).
 */
async function deleteBranches(
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
async function clearShadowState(issueId: string): Promise<StepResult> {
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
async function clearLegacyPlanningDir(
  projectPath: string,
  issueLower: string,
): Promise<StepResult> {
  const step = 'teardown:legacy-planning-dir';
  const legacyDir = join(projectPath, '.planning', issueLower);
  if (existsSync(legacyDir)) {
    rmSync(legacyDir, { recursive: true, force: true });
    return stepOk(step, [`Deleted legacy planning dir: ${legacyDir}`]);
  }
  return stepSkipped(step, ['No legacy planning directory found']);
}

/**
 * Clear .planning/.planning-complete marker from workspace.
 * Only runs if workspace still exists (before worktree removal).
 */
async function clearPlanningMarker(workspacePath: string): Promise<StepResult> {
  const step = 'teardown:planning-marker';
  const markerPath = join(workspacePath, '.planning', '.planning-complete');
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
    return stepOk(step, ['Cleared .planning-complete marker']);
  }
  return stepSkipped(step, ['No .planning-complete marker found']);
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
async function removeTunnelConfig(
  tunnelConfig: any,
  placeholders: Record<string, string>,
): Promise<StepResult> {
  const step = 'teardown:tunnel';
  try {
    const { removeTunnelIngress } = await import('../tunnel.js');
    const result = await removeTunnelIngress(tunnelConfig, placeholders as any);
    return stepOk(step, result.steps || ['Removed tunnel ingress']);
  } catch (err) {
    return stepSkipped(step, [`Tunnel cleanup warning: ${(err as Error).message}`]);
  }
}

/**
 * Remove Hume EVI config for workspace.
 */
async function removeHumeEviConfig(
  humeConfig: any,
  placeholders: Record<string, string>,
): Promise<StepResult> {
  const step = 'teardown:hume';
  try {
    const { deleteHumeConfig } = await import('../hume.js');
    const result = await deleteHumeConfig(humeConfig, placeholders as any);
    return stepOk(step, result.steps || ['Removed Hume EVI config']);
  } catch (err) {
    return stepSkipped(step, [`Hume cleanup warning: ${(err as Error).message}`]);
  }
}

/**
 * Full workspace teardown.
 *
 * Steps (in order):
 *   1. Kill tmux sessions
 *   2. Clear shadow state
 *   3. Clear legacy planning directory
 *   4. Stop TLDR daemon (if workspace exists)
 *   5. Stop Docker containers (if workspace exists)
 *   6. Clear planning marker (if workspace exists, before deletion)
 *   7. Remove tunnel config (if workspace config provided)
 *   8. Remove Hume config (if workspace config provided)
 *   9. Remove git worktree + workspace directory
 *  10. Remove agent state directories
 *  11. (Optional) Delete feature branches
 */
export async function teardownWorkspace(
  ctx: LifecycleContext,
  opts: TeardownOptions = {},
): Promise<StepResult[]> {
  const issueLower = ctx.issueId.toLowerCase();
  const projName = opts.projectName || ctx.projectName || ctx.issueId.split('-')[0].toLowerCase();
  const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);
  const shouldDeleteWorkspace = opts.deleteWorkspace !== false; // default true
  const results: StepResult[] = [];

  // 1. Kill tmux sessions
  results.push(await killTmuxSessions(issueLower));

  // 2. Clear shadow state (always runs)
  results.push(await clearShadowState(ctx.issueId));

  // 3. Clear legacy planning directory (always runs)
  results.push(await clearLegacyPlanningDir(ctx.projectPath, issueLower));

  // 4-9: Workspace-specific cleanup
  if (workspacePath && existsSync(workspacePath)) {
    // 4. Stop TLDR daemon (only if deleting workspace)
    if (shouldDeleteWorkspace) {
      results.push(await stopTldrDaemon(workspacePath));
    }

    // 5. Stop Docker containers (only if deleting workspace)
    if (shouldDeleteWorkspace && !opts.skipDocker) {
      results.push(await stopDocker(workspacePath, projName, issueLower));
    }

    // 6. Clear planning marker (before workspace deletion, or when preserving workspace)
    results.push(await clearPlanningMarker(workspacePath));

    // 6b. Sync workspace beads to project root before deletion (PAN-412)
    // Workspace beads live in the worktree's .beads/dolt/ — they're lost when the worktree is deleted.
    if (shouldDeleteWorkspace) {
      results.push(await syncWorkspaceBeads(ctx.projectPath, workspacePath, issueLower));
    }

    // 7-8: Project-specific cleanup (tunnel, Hume) — only when deleting workspace and config provided
    if (shouldDeleteWorkspace && (opts.workspaceConfig?.tunnel || opts.workspaceConfig?.hume)) {
      const placeholders = buildPlaceholders(ctx, opts, workspacePath);

      if (opts.workspaceConfig.tunnel) {
        results.push(await removeTunnelConfig(opts.workspaceConfig.tunnel, placeholders));
      }
      if (opts.workspaceConfig.hume) {
        results.push(await removeHumeEviConfig(opts.workspaceConfig.hume, placeholders));
      }
    }

    // 9. Remove worktree + workspace directory (only if deleting workspace)
    if (shouldDeleteWorkspace) {
      results.push(await removeWorktree(ctx.projectPath, workspacePath));
    }
  } else {
    results.push(stepSkipped('teardown:workspace', ['No workspace found to clean up']));
  }

  // 10. Remove agent state
  results.push(await removeAgentState(issueLower));

  // 11. Delete branches (only if explicitly requested)
  if (opts.deleteBranches) {
    results.push(await deleteBranches(ctx.projectPath, issueLower));
  }

  return results;
}
