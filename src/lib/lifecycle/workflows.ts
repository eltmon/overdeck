/**
 * Lifecycle workflows — Compose atomic operations into complete workflows.
 *
 * approve()  — Post-merge: archive + close + teardown + compact-beads
 * close()    — Simple close: close-issue + teardown
 * closeOut() — Full ceremony: verify-merged + archive + teardown + close + label + clear-status
 * deepWipe() — Destructive: teardown(deleteBranches) + delete agent state + reset issue
 */

import { existsSync } from 'fs';
import { copyFile, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { OVERDECK_HOME } from '../paths.js';
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
import { loadCloisterConfig } from '../cloister/config.js';
import { extractNumberSync, extractPrefixSync } from '../issue-id.js';
import { recordFeatureRegistryLifecycle } from '../registry/feature-registry-population.js';
import { getProjectConfigFromWorkspacePath, markRecordPipelineClosedOutSync } from '../pan-dir/record.js';

const execAsync = promisify(exec);

function trackerName(ctx: LifecycleContext, fallback: string): string {
  const name = ctx.tracker?.name ?? fallback;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

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

function hasBlockingFailure(steps: StepResult[]): boolean {
  return steps.some(s => !s.success && !s.skipped);
}

/**
 * approve() — Post-merge lifecycle.
 */
export function approve(
  ctx: LifecycleContext,
  opts: ApproveOptions & CloseIssueOptions & ArchiveOptions = {},
): Effect.Effect<WorkflowResult> {
  return Effect.gen(function* () {
    const start = Date.now();
    const allSteps: StepResult[] = [];

    // 1. Archive planning
    const archiveSteps = yield* archivePlanning(ctx, opts);
    allSteps.push(...archiveSteps);

    // If archive failed, stop — don't destroy unarchived artifacts
    const archiveFailed = archiveSteps.some(s => !s.success && !s.skipped);
    if (archiveFailed) {
      allSteps.push(stepFailed('approve:abort', 'Stopped — archiving failed, workspace preserved'));
      return buildResult('approve', ctx.issueId, allSteps, start);
    }

    // 2. Close issue
    const closeSteps = yield* closeIssue(ctx, {
      tracker: opts.tracker,
      comment: 'Merged to main via Overdeck lifecycle',
      applyLabel: true,
    });
    allSteps.push(...closeSteps);

    // 3. Teardown workspace (delete branches — merge is complete)
    const teardownSteps = yield* teardownWorkspace(ctx, { deleteBranches: true });
    allSteps.push(...teardownSteps);

    // 4. Compact beads (non-blocking — failure doesn't affect workflow success)
    if (!opts.skipBeadsCompaction) {
      const beadsResult = yield* compactBeads(ctx);
      allSteps.push(beadsResult);
    }

    // 5. Clear review status
    const clearResult = yield* clearReviewStatusStep(ctx.issueId);
    allSteps.push(clearResult);

    return buildResult('approve', ctx.issueId, allSteps, start);
  });
}

/**
 * close() — Simple issue close with teardown.
 */
export function close(
  ctx: LifecycleContext,
  opts: CloseIssueOptions = {},
): Effect.Effect<WorkflowResult> {
  return Effect.gen(function* () {
    const start = Date.now();
    const allSteps: StepResult[] = [];

    // 1. Close issue
    const closeSteps = yield* closeIssue(ctx, {
      tracker: opts.tracker,
      reason: opts.reason,
      applyLabel: false,
    });
    allSteps.push(...closeSteps);

    // 2. Teardown workspace
    const teardownSteps = yield* teardownWorkspace(ctx);
    allSteps.push(...teardownSteps);

    // 3. Clear review status
    const clearResult = yield* clearReviewStatusStep(ctx.issueId);
    allSteps.push(clearResult);

    return buildResult('close', ctx.issueId, allSteps, start);
  });
}

/**
 * closeOut() — Full close-out ceremony.
 *
 * This is the human-gated verification and cleanup workflow.
 * Replaces the monolithic executeCloseOut() function.
 *
 * 1. Verify branch merged (hard fail if not — must pass before any cleanup)
 * 2. Move PRD + archive workspace artifacts (hard fail if archiving fails)
 * 3. Mark vBRIEF completed
 * 4. Clean up workspace (tmux, TLDR, Docker, worktree)
 * 5. Clean up agent state
 * 6. Close issue on tracker
 * 7. Apply closed-out label
 * 8. Clear review status
 */
export function closeOut(
  ctx: LifecycleContext,
  opts: CloseIssueOptions & ArchiveOptions = {},
): Effect.Effect<WorkflowResult> {
  return Effect.gen(function* () {
    const start = Date.now();
    const allSteps: StepResult[] = [];

    // 1. Verify branch merged (hard fail — must pass before we archive or clean up)
    const mergeVerify = yield* verifyBranchMerged(ctx);
    allSteps.push(mergeVerify);
    if (!mergeVerify.success && !mergeVerify.skipped) {
      return buildResult('close-out', ctx.issueId, allSteps, start);
    }

    // 2. Move PRD + archive workspace artifacts
    const archiveSteps = yield* archivePlanning(ctx, opts);
    allSteps.push(...archiveSteps);

    // Hard fail on archive failure — don't destroy unarchived artifacts
    const archiveFailed = archiveSteps.some(s => !s.success && !s.skipped);
    if (archiveFailed) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — archiving failed, workspace preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start);
    }

    // 3. Mark the vBRIEF completed on main before teardown removes local state.
    const vbriefStep = yield* Effect.promise(() => completeVBriefStep(ctx));
    allSteps.push(vbriefStep);
    if (!vbriefStep.success && !vbriefStep.skipped) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — vBRIEF completion failed, workspace preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start);
    }

    // 4+5. Teardown workspace + agent state
    const closeOutConfig = (yield* Effect.promise(() => Effect.runPromise(loadCloisterConfig()))).close_out;
    const teardownSteps = yield* teardownWorkspace(ctx, {
      deleteWorkspace: closeOutConfig?.remove_workspace ?? false,
      deleteBranches: closeOutConfig?.delete_feature_branch ?? false,
    });
    allSteps.push(...teardownSteps);
    if (hasBlockingFailure(teardownSteps)) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — teardown failed, tracker issue and review status preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start);
    }

    // 6+7. Close issue + apply label
    const closeSteps = yield* closeIssue(ctx, {
      tracker: opts.tracker,
      comment: ctx.auto ? 'Closed via automatic close-out ceremony' : 'Closed via close-out ceremony',
      applyLabel: true,
    });
    allSteps.push(...closeSteps);
    if (hasBlockingFailure(closeSteps)) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — issue close failed, review status preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start);
    }

    // 8. Mark durable pipeline terminal before clearing the DB cache.
    const markTerminal = yield* markPipelineClosedOutStep(ctx);
    allSteps.push(markTerminal);

    // 9. Clear review status
    const clearResult = yield* clearReviewStatusStep(ctx.issueId);
    allSteps.push(clearResult);

    yield* Effect.promise(() => resetPostMergeStateForIssue(ctx.issueId));
    yield* Effect.promise(() => recordFeatureRegistryLifecycle({ issueId: ctx.issueId, status: 'archived' }));

    return buildResult('close-out', ctx.issueId, allSteps, start);
  });
}

function markPipelineClosedOutStep(ctx: LifecycleContext): Effect.Effect<StepResult> {
  const step = 'close-out:mark-pipeline-terminal';
  return Effect.try({
    try: () => {
      const project = getProjectConfigFromWorkspacePath(ctx.projectPath);
      markRecordPipelineClosedOutSync(project, ctx.issueId.toUpperCase());
      return stepOk(step, ['Marked durable pipeline journal closed-out']);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped(step, [`Pipeline terminal marker failed (non-fatal): ${(err as Error).message ?? String(err)}`])),
    ),
  );
}

/**
 * deepWipe() — Destructive cleanup for abandoned workspaces.
 */
function destructiveResetWorkflow(
  workflow: 'deep-wipe' | 'reset' | 'cancel',
  ctx: LifecycleContext,
  opts: DeepWipeOptions,
  resetStep: (ctx: LifecycleContext) => Effect.Effect<StepResult>,
  progressLabel: string,
  progressSuccessDetail: string,
): Effect.Effect<WorkflowResult> {
  return Effect.gen(function* () {
    const start = Date.now();
    const allSteps: StepResult[] = [];
    const { deleteWorkspace = true, deleteBranches = true, resetIssue = true, onProgress } = opts;
    const resetContext = opts.tracker ? { ...ctx, tracker: opts.tracker } : ctx;

    const TOTAL_STEPS = 3 + (resetIssue ? 1 : 0);
    let stepNum = 0;

    const progress = (label: string, detail: string, status: 'active' | 'complete' | 'error' = 'active') => {
      onProgress?.({ step: stepNum, total: TOTAL_STEPS, label, detail, status });
    };

    stepNum = 1;

    // Preserve PRD before workspace teardown so it survives reset/cancel.
    const issueLower = ctx.issueId.toLowerCase();
    const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);
    if (workspacePath && existsSync(workspacePath)) {
      const prdPath = join(workspacePath, '.pan', 'prd.md');
      if (existsSync(prdPath)) {
        yield* Effect.tryPromise({
          try: async () => {
            const activeDir = join(ctx.projectPath, 'docs', 'prds', 'active', issueLower);
            const { mkdir } = await import('fs/promises');
            await mkdir(activeDir, { recursive: true });
            await copyFile(prdPath, join(activeDir, 'prd.md'));
          },
          catch: () => null,
        }).pipe(Effect.catch(() => Effect.void));
      }
    }

    progress('Tearing down workspace', 'Killing agents, stopping services, removing files');
    const teardownSteps = yield* teardownWorkspace(ctx, {
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
      const resetResult = yield* resetStep(resetContext);
      allSteps.push(resetResult);
      progress(progressLabel, resetResult.success ? progressSuccessDetail : (resetResult.error || 'Failed'), resetResult.success ? 'complete' : 'error');
    }

    stepNum = resetIssue ? 4 : 3;
    progress('Clearing review status', 'Removing specialist state');
    const clearResult = yield* clearReviewStatusStep(ctx.issueId);
    allSteps.push(clearResult);
    progress('Clearing review status', 'Review status cleared', 'complete');

    return buildResult(workflow, ctx.issueId, allSteps, start);
  });
}

export function deepWipe(
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
): Effect.Effect<WorkflowResult> {
  return destructiveResetWorkflow(
    'deep-wipe',
    ctx,
    opts,
    resetIssueToTodo,
    'Resetting issue status',
    'Issue reset to Todo',
  );
}

export function resetToTodo(
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
): Effect.Effect<WorkflowResult> {
  return destructiveResetWorkflow(
    'reset',
    ctx,
    opts,
    resetIssueToTodo,
    'Resetting issue status',
    'Issue reset to Todo',
  );
}

export function cancelIssueWorkflow(
  ctx: LifecycleContext,
  opts: DeepWipeOptions = {},
): Effect.Effect<WorkflowResult> {
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

async function completeVBriefStep(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-out:vbrief-completed';
  try {
    const { transitionVBriefOnMain } = await import('../vbrief/lifecycle-io.js');
    const result = await Effect.runPromise(transitionVBriefOnMain(
      ctx.projectPath,
      ctx.issueId,
      'completed',
      'completed',
      `scope: complete ${ctx.issueId.toUpperCase()} vBRIEF`,
    ));
    const details = [
      result.moved ? 'Updated vBRIEF lifecycle to completed' : 'vBRIEF lifecycle already completed',
      result.statusUpdated ? 'Updated plan.status to completed' : 'plan.status already completed',
    ];
    if (result.committed) details.push('Committed vBRIEF completion on main');
    return stepOk(step, details);
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause ?? err;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('No vBRIEF found')) {
      return stepSkipped(step, [`No vBRIEF found for ${ctx.issueId}`]);
    }
    return stepFailed(step, `vBRIEF completion failed: ${message}`);
  }
}

/**
 * Verify feature branch is merged into main.
 */
function verifyBranchMerged(ctx: LifecycleContext): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => verifyBranchMergedImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('close-out:verify-merged', `Could not verify merge: ${(err as Error).message}`)),
    ),
  );
}

async function verifyBranchMergedImpl(ctx: LifecycleContext): Promise<StepResult> {
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
      try {
        await execAsync(
          `git merge-base --is-ancestor ${branchName} main`,
          { cwd: ctx.projectPath, encoding: 'utf-8' },
        );
        return stepOk(step, ['All commits merged to main']);
      } catch {
        // --is-ancestor fails for squash merges where the branch still exists.
        try {
          const { stdout: codeDiff } = await execAsync(
            `git diff main...${branchName} -- ':!.planning' ':!docs/prds' ':!.overdeck/prompts' 2>/dev/null || true`,
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

        if (ctx.github) {
          try {
            const { stdout: issueState } = await execAsync(
              `gh issue view ${ctx.github.number} --repo ${ctx.github.owner}/${ctx.github.repo} --json state --jq '.state'`,
              { cwd: ctx.projectPath, encoding: 'utf-8' },
            );
            if (issueState.trim().toUpperCase() === 'CLOSED') {
              return stepSkipped(step, [`Issue already closed on GitHub; ${count} unmerged commit(s) remain on ${branchName}`]);
            }
          } catch {
            // gh check failed — fall through to hard fail
          }
        }

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
            `git diff main...origin/${branchName} -- ':!.planning' ':!docs/prds' ':!.overdeck/prompts' 2>/dev/null || true`,
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

        if (ctx.github) {
          try {
            const { stdout: issueState } = await execAsync(
              `gh issue view ${ctx.github.number} --repo ${ctx.github.owner}/${ctx.github.repo} --json state --jq '.state'`,
              { cwd: ctx.projectPath, encoding: 'utf-8' },
            );
            if (issueState.trim().toUpperCase() === 'CLOSED') {
              return stepSkipped(step, [`Issue already closed on GitHub; ${count} unmerged commit(s) remain on remote ${branchName}`]);
            }
          } catch {
            // gh check failed — fall through to hard fail
          }
        }

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
function resetIssueToTodo(ctx: LifecycleContext): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => resetIssueToTodoImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('reset:reset-issue', `Failed to reset issue: ${(err as Error).message}`)),
    ),
  );
}

async function resetIssueToTodoImpl(ctx: LifecycleContext): Promise<StepResult> {
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
    const linearApiKey = await getLinearApiKey();
    if (linearApiKey) {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: linearApiKey });
      const issueNum = extractNumberSync(ctx.issueId);
      const teamKey = extractPrefixSync(ctx.issueId);
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
      return stepOk(step, [`Reset ${trackerName(ctx, 'linear')} issue ${ctx.issueId} to Todo`]);
    }

    return stepSkipped(step, ['No tracker available to reset issue']);
  } catch (err) {
    return stepFailed(step, `Failed to reset issue: ${(err as Error).message}`);
  }
}

/**
 * Clear review status for an issue.
 */
async function resetPostMergeStateForIssue(issueId: string): Promise<void> {
  try {
    const { resetPostMergeState } = await import('../cloister/merge-agent.js');
    resetPostMergeState(issueId);
    resetPostMergeState(issueId.toUpperCase());
  } catch {
    return;
  }
}

function clearReviewStatusStep(issueId: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => clearReviewStatusStepImpl(issueId),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('clear-review-status', [`Failed to clear review status (non-fatal): ${(err as Error).message}`])),
    ),
  );
}

async function clearReviewStatusStepImpl(issueId: string): Promise<StepResult> {
  const step = 'clear-review-status';
  try {
    const { clearReviewStatus } = await import('../review-status.js');
    clearReviewStatus(issueId.toUpperCase());
    return stepOk(step, ['Review status cleared']);
  } catch {
    // Fallback: direct file manipulation
    try {
      const statusFile = join(OVERDECK_HOME, 'review-status.json');
      if (existsSync(statusFile)) {
        const data = JSON.parse(await readFile(statusFile, 'utf-8'));
        const upperKey = issueId.toUpperCase();
        if (data[upperKey]) {
          delete data[upperKey];
          await writeFile(statusFile, JSON.stringify(data, null, 2));
        }
      }
      return stepOk(step, ['Review status cleared (direct)']);
    } catch (innerErr) {
      return stepSkipped(step, [`Failed to clear review status (non-fatal): ${(innerErr as Error).message}`]);
    }
  }
}

export const __testInternals = {
  completeVBriefStep,
  verifyBranchMerged,
};

function resetIssueToCanceled(ctx: LifecycleContext): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => resetIssueToCanceledImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('cancel:reset-issue', `Failed to cancel issue: ${(err as Error).message}`)),
    ),
  );
}

async function resetIssueToCanceledImpl(ctx: LifecycleContext): Promise<StepResult> {
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

    const linearApiKey = await getLinearApiKey();
    if (linearApiKey) {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: linearApiKey });
      const issueNum = extractNumberSync(ctx.issueId);
      const teamKey = extractPrefixSync(ctx.issueId);
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
      return stepOk(step, [`Reset ${trackerName(ctx, 'linear')} issue ${ctx.issueId} to Canceled`]);
    }

    return stepSkipped(step, ['No tracker available to cancel issue']);
  } catch (err) {
    return stepFailed(step, `Failed to cancel issue: ${(err as Error).message}`);
  }
}
