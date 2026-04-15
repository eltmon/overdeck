/**
 * Lifecycle workflows — Compose atomic operations into complete workflows.
 *
 * approve()  — Post-merge: archive + close + teardown + compact-beads
 * close()    — Simple close: close-issue + teardown
 * closeOut() — Full ceremony: verify-merged + archive + teardown + close + label + clear-status
 * deepWipe() — Destructive: teardown(deleteBranches) + delete agent state + reset issue
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PANOPTICON_HOME } from '../paths.js';
import type {
  LifecycleContext,
  WorkflowResult,
  StepResult,
  ApproveOptions,
  DeepWipeOptions,
  ArchiveOptions,
} from './types.js';
import { stepOk, stepSkipped, stepFailed, getLinearApiKey } from './types.js';
import { archivePlanning, findWorkspacePath } from './archive-planning.js';
import { closeIssue, type CloseIssueOptions } from './close-issue.js';
import { teardownWorkspace } from './teardown-workspace.js';
import { compactBeads } from './compact-beads.js';
import { extractNumber, extractPrefix } from '../issue-id.js';

const execAsync = promisify(exec);

/**
 * Build a WorkflowResult from collected steps.
 */
function buildResult(
  workflow: WorkflowResult['workflow'],
  issueId: string,
  steps: StepResult[],
  startTime: number,
): WorkflowResult {
  return {
    workflow,
    issueId,
    success: steps.every(s => s.success),
    steps,
    duration: Date.now() - startTime,
  };
}

/**
 * approve() — Post-merge lifecycle.
 *
 * 1. Archive planning artifacts (PRD move + .planning/ preservation)
 * 2. Close issue on tracker
 * 3. Teardown workspace
 * 4. Compact beads
 * 5. Clear review status
 *
 * Note: The actual merge step is NOT included here — the merge-agent
 * handles merge validation. This workflow runs AFTER merge completes.
 */
export async function approve(
  ctx: LifecycleContext,
  opts: ApproveOptions & CloseIssueOptions & ArchiveOptions = {},
): Promise<WorkflowResult> {
  const start = Date.now();
  const allSteps: StepResult[] = [];

  // 1. Archive planning
  const archiveSteps = await archivePlanning(ctx, opts);
  allSteps.push(...archiveSteps);

  // If archive failed, stop — don't destroy unarchived artifacts
  const archiveFailed = archiveSteps.some(s => !s.success && !s.skipped);
  if (archiveFailed) {
    allSteps.push(stepFailed('approve:abort', 'Stopped — archiving failed, workspace preserved'));
    return buildResult('approve', ctx.issueId, allSteps, start);
  }

  // 2. Close issue
  const closeSteps = await closeIssue(ctx, {
    tracker: opts.tracker,
    comment: 'Merged to main via Panopticon lifecycle',
    applyLabel: true,
  });
  allSteps.push(...closeSteps);

  // 3. Teardown workspace
  const teardownSteps = await teardownWorkspace(ctx);
  allSteps.push(...teardownSteps);

  // 4. Compact beads (non-blocking — failure doesn't affect workflow success)
  if (!opts.skipBeadsCompaction) {
    const beadsResult = await compactBeads(ctx);
    allSteps.push(beadsResult);
  }

  // 5. Clear review status
  const clearResult = await clearReviewStatusStep(ctx.issueId);
  allSteps.push(clearResult);

  return buildResult('approve', ctx.issueId, allSteps, start);
}

/**
 * close() — Simple issue close with teardown.
 *
 * Used when an issue is being closed without merge (canceled, won't-do, etc.)
 * Does NOT archive workspace artifacts.
 *
 * 1. Close issue on tracker
 * 2. Teardown workspace
 * 3. Clear review status
 */
export async function close(
  ctx: LifecycleContext,
  opts: CloseIssueOptions = {},
): Promise<WorkflowResult> {
  const start = Date.now();
  const allSteps: StepResult[] = [];

  // 1. Close issue
  const closeSteps = await closeIssue(ctx, {
    tracker: opts.tracker,
    reason: opts.reason,
    applyLabel: false,
  });
  allSteps.push(...closeSteps);

  // 2. Teardown workspace
  const teardownSteps = await teardownWorkspace(ctx);
  allSteps.push(...teardownSteps);

  // 3. Clear review status
  const clearResult = await clearReviewStatusStep(ctx.issueId);
  allSteps.push(clearResult);

  return buildResult('close', ctx.issueId, allSteps, start);
}

/**
 * closeOut() — Full close-out ceremony.
 *
 * This is the human-gated verification and cleanup workflow.
 * Replaces the monolithic executeCloseOut() function.
 *
 * 1. Verify branch merged (hard fail if not — must pass before any cleanup)
 * 2. Move PRD + archive workspace artifacts (hard fail if archiving fails)
 * 3. Clean up workspace (tmux, TLDR, Docker, worktree)
 * 4. Clean up agent state
 * 5. Close issue on tracker
 * 6. Apply closed-out label
 * 7. Clear review status
 */
export async function closeOut(
  ctx: LifecycleContext,
  opts: CloseIssueOptions & ArchiveOptions = {},
): Promise<WorkflowResult> {
  const start = Date.now();
  const allSteps: StepResult[] = [];

  // 1. Verify branch merged (hard fail — must pass before we archive or clean up)
  const mergeVerify = await verifyBranchMerged(ctx);
  allSteps.push(mergeVerify);
  if (!mergeVerify.success && !mergeVerify.skipped) {
    return buildResult('close-out', ctx.issueId, allSteps, start);
  }

  // 2. Move PRD + archive workspace artifacts
  const archiveSteps = await archivePlanning(ctx, opts);
  allSteps.push(...archiveSteps);

  // Hard fail on archive failure — don't destroy unarchived artifacts
  const archiveFailed = archiveSteps.some(s => !s.success && !s.skipped);
  if (archiveFailed) {
    allSteps.push(stepFailed('close-out:abort', 'Stopped — archiving failed, workspace preserved'));
    return buildResult('close-out', ctx.issueId, allSteps, start);
  }

  // 4+5. Teardown workspace + agent state
  const teardownSteps = await teardownWorkspace(ctx);
  allSteps.push(...teardownSteps);

  // 6+7. Close issue + apply label
  const closeSteps = await closeIssue(ctx, {
    tracker: opts.tracker,
    comment: 'Closed via close-out ceremony',
    applyLabel: true,
  });
  allSteps.push(...closeSteps);

  // 8. Clear review status
  const clearResult = await clearReviewStatusStep(ctx.issueId);
  allSteps.push(clearResult);

  return buildResult('close-out', ctx.issueId, allSteps, start);
}

/**
 * deepWipe() — Destructive cleanup for abandoned workspaces.
 *
 * 1. Teardown workspace (with branch deletion)
 * 2. (Optional) Reset issue to backlog/open
 * 3. Clear review status
 */
async function destructiveResetWorkflow(
  workflow: 'deep-wipe' | 'reset' | 'cancel',
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
  resetStep: (ctx: LifecycleContext) => Promise<StepResult>,
  progressLabel: string,
  progressSuccessDetail: string,
): Promise<WorkflowResult> {
  const start = Date.now();
  const allSteps: StepResult[] = [];
  const { deleteWorkspace = true, deleteBranches = true, resetIssue = true, onProgress } = opts;

  const TOTAL_STEPS = 3 + (resetIssue ? 1 : 0);
  let stepNum = 0;

  const progress = (label: string, detail: string, status: 'active' | 'complete' | 'error' = 'active') => {
    onProgress?.({ step: stepNum, total: TOTAL_STEPS, label, detail, status });
  };

  stepNum = 1;
  progress('Tearing down workspace', 'Killing agents, stopping services, removing files');
  const teardownSteps = await teardownWorkspace(ctx, {
    deleteWorkspace,
    deleteBranches,
    clearBeads: true,
    workspaceConfig: opts.workspaceConfig,
    projectName: opts.projectName,
  });
  allSteps.push(...teardownSteps);
  const teardownFailed = teardownSteps.some(s => !s.success && !s.skipped);
  progress('Tearing down workspace', teardownFailed ? 'Some steps failed' : 'Workspace torn down', teardownFailed ? 'error' : 'complete');

  stepNum = 2;
  progress('Deleting git branches', `feature/${ctx.issueId.toLowerCase()}`);
  progress('Deleting git branches', deleteBranches ? 'Branches removed' : 'Skipped', 'complete');

  if (resetIssue) {
    stepNum = 3;
    progress(progressLabel, `${ctx.issueId}`);
    const resetResult = await resetStep(ctx);
    allSteps.push(resetResult);
    progress(progressLabel, resetResult.success ? progressSuccessDetail : (resetResult.error || 'Failed'), resetResult.success ? 'complete' : 'error');
  }

  stepNum = resetIssue ? 4 : 3;
  progress('Clearing review status', 'Removing specialist state');
  const clearResult = await clearReviewStatusStep(ctx.issueId);
  allSteps.push(clearResult);
  progress('Clearing review status', 'Review status cleared', 'complete');

  return buildResult(workflow, ctx.issueId, allSteps, start);
}

export async function deepWipe(
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
): Promise<WorkflowResult> {
  return destructiveResetWorkflow(
    'deep-wipe',
    ctx,
    opts,
    resetIssueToTodo,
    'Resetting issue status',
    'Issue reset to Todo',
  );
}

export async function resetToTodo(
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
): Promise<WorkflowResult> {
  return destructiveResetWorkflow(
    'reset',
    ctx,
    opts,
    resetIssueToTodo,
    'Resetting issue status',
    'Issue reset to Todo',
  );
}

export async function cancelIssueWorkflow(
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
): Promise<WorkflowResult> {
  return destructiveResetWorkflow(
    'cancel',
    ctx,
    opts,
    resetIssueToCanceled,
    'Canceling issue',
    'Issue moved to Canceled',
  );
}

// --- Internal helpers ---

/**
 * Verify feature branch is merged into main.
 */
async function verifyBranchMerged(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-out:verify-merged';
  const issueLower = ctx.issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  try {
    // Check review-status first — the merge specialist validates before marking merged
    try {
      const { loadReviewStatuses } = await import('../review-status.js');
      const statuses = loadReviewStatuses();
      const issueKey = ctx.issueId.toUpperCase();
      if (statuses[issueKey]?.mergeStatus === 'merged') {
        return stepOk(step, ['Merge specialist confirmed merge completed']);
      }
    } catch {
      // review-status.json may not exist, continue with git checks
    }


    // Check if branch exists locally
    const { stdout: branchExists } = await execAsync(
      `git branch --list "${branchName}" 2>/dev/null || true`,
      { cwd: ctx.projectPath, encoding: 'utf-8' },
    );

    if (branchExists.trim()) {
      // Use merge-base --is-ancestor: checks if the branch tip is reachable from main
      // Note: does NOT detect squash merges — code-diff fallback handles those
      try {
        await execAsync(
          `git merge-base --is-ancestor ${branchName} main`,
          { cwd: ctx.projectPath, encoding: 'utf-8' },
        );
        return stepOk(step, ['All commits merged to main']);
      } catch {
        // --is-ancestor fails for squash merges where the branch still exists.
        // Check if the code diff (excluding planning artifacts) is empty — if so,
        // the code was squash-merged and only planning files remain on the branch.
        try {
          const { stdout: codeDiff } = await execAsync(
            `git diff main...${branchName} -- ':!.planning' ':!docs/prds' ':!.panopticon/prompts' 2>/dev/null || true`,
            { cwd: ctx.projectPath, encoding: 'utf-8' },
          );
          if (!codeDiff.trim()) {
            return stepOk(step, ['Code changes squash-merged to main (only planning artifacts remain on branch)']);
          }
        } catch {
          // diff failed — fall through to unmerged report
        }

        const { stdout: unmerged } = await execAsync(
          `git log main..${branchName} --oneline 2>/dev/null || true`,
          { cwd: ctx.projectPath, encoding: 'utf-8' },
        );
        const count = unmerged.trim() ? unmerged.trim().split('\n').length : 0;
        return stepFailed(step, `${count} unmerged commit(s) on ${branchName}. Merge before closing out.`);
      }
    }

    // Check remote
    const { stdout: remoteBranch } = await execAsync(
      `git ls-remote --heads origin "${branchName}" 2>/dev/null || true`,
      { cwd: ctx.projectPath, encoding: 'utf-8' },
    );

    if (remoteBranch.trim()) {
      await execAsync(`git fetch origin ${branchName}`, { cwd: ctx.projectPath }).catch(() => {});
      try {
        await execAsync(
          `git merge-base --is-ancestor origin/${branchName} main`,
          { cwd: ctx.projectPath, encoding: 'utf-8' },
        );
        return stepOk(step, ['Remote branch fully merged']);
      } catch {
        // Squash-merge detection for remote branch
        try {
          const { stdout: codeDiff } = await execAsync(
            `git diff main...origin/${branchName} -- ':!.planning' ':!docs/prds' ':!.panopticon/prompts' 2>/dev/null || true`,
            { cwd: ctx.projectPath, encoding: 'utf-8' },
          );
          if (!codeDiff.trim()) {
            return stepOk(step, ['Remote code changes squash-merged to main (only planning artifacts remain on branch)']);
          }
        } catch {
          // diff failed — fall through
        }

        const { stdout: remoteUnmerged } = await execAsync(
          `git log main..origin/${branchName} --oneline 2>/dev/null || true`,
          { cwd: ctx.projectPath, encoding: 'utf-8' },
        );
        const count = remoteUnmerged.trim() ? remoteUnmerged.trim().split('\n').length : 0;
        return stepFailed(step, `${count} unmerged commit(s) on remote ${branchName}.`);
      }
    }

    // No branch at all — assume squash-merged and branch deleted
    return stepOk(step, ['Branch already cleaned up (squash-merged)']);
  } catch (err) {
    return stepFailed(step, `Could not verify merge: ${(err as Error).message}`);
  }
}

/**
 * Reset issue back to open/backlog state (for destructive reset).
 */
async function resetIssueToTodo(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'reset:reset-issue';
  try {
    if (ctx.github) {
      const { owner, repo, number } = ctx.github;
      // Reopen the issue
      await execAsync(
        `gh issue reopen ${number} --repo ${owner}/${repo}`,
        { encoding: 'utf-8' },
      ).catch(() => {});  // May already be open
      // Remove lifecycle labels
      const labelsToRemove = ['in-review', 'in-progress', 'planned', 'planning', 'Review: Approved', 'Review: Failed', 'ready-for-merge'];
      for (const label of labelsToRemove) {
        await execAsync(
          `gh issue edit ${number} --repo ${owner}/${repo} --remove-label "${label}"`,
          { encoding: 'utf-8' },
        ).catch(() => {});  // Label may not exist
      }
      return stepOk(step, [`Reset GitHub issue #${number}: reopened and cleared labels`]);
    }

    // Linear: reopen to Todo
    const linearApiKey = getLinearApiKey();
    if (linearApiKey) {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: linearApiKey });
      const issueNum = extractNumber(ctx.issueId);
      const teamKey = extractPrefix(ctx.issueId);
      if (issueNum === null || teamKey === null) {
        return stepFailed(step, `Could not parse issue ID: ${ctx.issueId}`);
      }
      const results = await client.issues({
        filter: {
          number: { eq: issueNum },
          team: { key: { eq: teamKey } },
        },
        first: 1,
      });
      if (results.nodes.length > 0) {
        const issue = results.nodes[0];
        const team = await issue.team;
        if (team) {
          const states = await team.states();
          const todoState = states.nodes.find(s => s.type === 'unstarted' && s.name === 'Todo') ||
            states.nodes.find(s => s.type === 'unstarted');
          if (todoState) {
            await issue.update({ stateId: todoState.id });
          }
        }
      }
      return stepOk(step, [`Reset Linear issue ${ctx.issueId} to Todo`]);
    }

    return stepSkipped(step, ['No tracker available to reset issue']);
  } catch (err) {
    return stepFailed(step, `Failed to reset issue: ${(err as Error).message}`);
  }
}

/**
 * Clear review status for an issue.
 */
async function clearReviewStatusStep(issueId: string): Promise<StepResult> {
  const step = 'clear-review-status';
  try {
    const { clearReviewStatus } = await import('../review-status.js');
    clearReviewStatus(issueId.toUpperCase());
    return stepOk(step, ['Review status cleared']);
  } catch {
    // Fallback: direct file manipulation
    try {
      const statusFile = join(PANOPTICON_HOME, 'review-status.json');
      if (existsSync(statusFile)) {
        const data = JSON.parse(readFileSync(statusFile, 'utf-8'));
        const upperKey = issueId.toUpperCase();
        if (data[upperKey]) {
          delete data[upperKey];
          const { writeFileSync } = await import('fs');
          writeFileSync(statusFile, JSON.stringify(data, null, 2));
        }
      }
      return stepOk(step, ['Review status cleared (direct)']);
    } catch (innerErr) {
      return stepSkipped(step, [`Failed to clear review status (non-fatal): ${(innerErr as Error).message}`]);
    }
  }
}

async function resetIssueToCanceled(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'cancel:reset-issue';
  try {
    if (ctx.github) {
      const { owner, repo, number } = ctx.github;
      await execAsync(
        `gh issue edit ${number} --repo ${owner}/${repo} --add-label "wontfix"`,
        { encoding: 'utf-8' },
      ).catch(() => {});
      return stepOk(step, [`Marked GitHub issue #${number} as canceled/wontfix`]);
    }

    const linearApiKey = getLinearApiKey();
    if (linearApiKey) {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: linearApiKey });
      const issueNum = extractNumber(ctx.issueId);
      const teamKey = extractPrefix(ctx.issueId);
      if (issueNum === null || teamKey === null) {
        return stepFailed(step, `Could not parse issue ID: ${ctx.issueId}`);
      }
      const results = await client.issues({
        filter: {
          number: { eq: issueNum },
          team: { key: { eq: teamKey } },
        },
        first: 1,
      });
      if (results.nodes.length > 0) {
        const issue = results.nodes[0];
        const team = await issue.team;
        if (team) {
          const states = await team.states();
          const canceledState = states.nodes.find(s => s.type === 'canceled') ||
            states.nodes.find(s => s.name.toLowerCase() === 'canceled');
          if (canceledState) {
            await issue.update({ stateId: canceledState.id });
          }
        }
      }
      return stepOk(step, [`Reset Linear issue ${ctx.issueId} to Canceled`]);
    }

    return stepSkipped(step, ['No tracker available to cancel issue']);
  } catch (err) {
    return stepFailed(step, `Failed to cancel issue: ${(err as Error).message}`);
  }
}

