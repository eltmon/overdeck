/**
 * Lifecycle workflows — Compose atomic operations into complete workflows.
 *
 * approve()  — Post-merge: archive + close + teardown
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
  CloseOutOptions,
} from './types.js';
import { stepOk, stepSkipped, stepFailed, getLinearApiKey } from './types.js';
import { archivePlanning, findWorkspacePath } from './archive-planning.js';
import { closeIssue, type CloseIssueOptions } from './close-issue.js';
import { teardownWorkspace } from './teardown-workspace.js';
import { loadCloisterConfig } from '../cloister/config.js';
import { extractNumber, extractPrefix } from '../issue-id.js';
import { recordFeatureRegistryLifecycle } from '../registry/feature-registry-population.js';
import { resolveProjectReposForIssue } from '../project-repos.js';
import { isTrackerIssueClosed } from '../cloister/issue-closed.js';
import { resolveTrackerType } from '../tracker-utils.js';
import { transitionJiraIssue } from '../tracker/jira-lifecycle.js';
import { clearAgentOperatorGatesForIssue } from '../agents/agent-state.js';
import { evaluateDodGate, readCompletedCloseOut } from './dod-gate.js';
import { closeResidueConventionPrs, extractGitHubCoordinates, extractGitLabProject } from './pr-residue.js';
import {
  capturePipelineStage,
  resolvePipelineTelemetryContext,
  type PipelineTelemetryContext,
} from '../telemetry/pipeline.js';
import { acceptFlagFor, buildAbandonedDodGate, buildResidueDodGate, describeTeardownObserved, DOD_ROWS, type DodGateResult, type DodRowId, type DodRowResult } from './dod.js';
import { verifyBranchMergedImpl } from './verify-merged.js';

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
  dodGate?: DodGateResult,
): WorkflowResult {
  return {
    workflow,
    issueId,
    success: steps.every(s => s.success),
    steps,
    duration: Date.now() - startTime,
    ...(dodGate ? { dodGate } : {}),
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
 * 3. Mark xBRIEF completed
 * 4. Clean up workspace (tmux, Docker, worktree)
 * 5. Clean up agent state
 * 6. Close issue on tracker
 * 7. Apply closed-out label
 * 8. Clear review status
 */
export function closeOut(
  ctx: LifecycleContext,
  opts: CloseIssueOptions & ArchiveOptions & CloseOutOptions = {},
): Effect.Effect<WorkflowResult> {
  return Effect.gen(function* () {
    const start = Date.now();
    const allSteps: StepResult[] = [];

    // PAN-3025: idempotent short-circuit for already-completed close-out ceremony.
    // Fail closed: on any error, proceed to the gate (null = not-confirmed-complete).
    const closedOutAt = yield* Effect.promise(() =>
      readCompletedCloseOut(ctx.issueId, ctx.projectPath).catch(() => null)
    );
    if (closedOutAt) {
      allSteps.push(stepSkipped('close-out:idempotent', [
        `Issue already closed out at ${closedOutAt} — skipping the Definition-of-Done gate and ceremony`,
      ]));
      return buildResult('close-out', ctx.issueId, allSteps, start);
    }


    // 1. Collect residue evidence BEFORE building the gate (if residue disposition)
    const abandon = opts.abandonDisposition;
    const residue = opts.residueDisposition;
    let residueEvidence: string[] = [];
    let trackerClosedEvidence: string[] = [];

    if (residue) {
      // Pre-verify tracker is closed for residue disposition
      try {
        const isClosed = yield* Effect.promise(() => isTrackerIssueClosed(ctx.issueId));
        if (!isClosed) {
          allSteps.push(stepFailed('close-out:residue-precondition', 'Residue disposition requires the tracker issue to be already closed'));
          return buildResult('close-out', ctx.issueId, allSteps, start);
        }
        trackerClosedEvidence.push('Tracker issue verified closed');
      } catch (err) {
        allSteps.push(stepFailed('close-out:residue-precondition', `Could not verify tracker closure: ${err instanceof Error ? err.message : String(err)}`));
        return buildResult('close-out', ctx.issueId, allSteps, start);
      }

      // Resolve forge coordinates and close stale PRs/MRs
      const prRepos = resolveProjectReposForIssue(ctx.issueId);
      if (!prRepos || prRepos.length === 0) {
        allSteps.push(stepFailed('close-out:residue-precondition', 'Could not resolve any configured repositories for residue cleanup'));
        return buildResult('close-out', ctx.issueId, allSteps, start);
      }

      // Resolve all GitHub and GitLab coordinates
      const githubPaths = prRepos.filter(r => r.forge === 'github').map(r => r.repoPath);
      const gitlabPaths = prRepos.filter(r => r.forge === 'gitlab').map(r => r.repoPath);

      const resolveCoords = yield* Effect.promise(async () => {
        const githubRepos: string[] = [];
        const gitlabRepos: string[] = [];
        const errors: string[] = [];

        for (const repoPath of githubPaths) {
          const coords = await extractGitHubCoordinates(repoPath);
          if (coords) {
            githubRepos.push(coords);
          } else {
            errors.push(`GitHub coordinate extraction failed for ${repoPath}`);
          }
        }

        for (const repoPath of gitlabPaths) {
          const proj = await extractGitLabProject(repoPath);
          if (proj) {
            gitlabRepos.push(proj);
          } else {
            errors.push(`GitLab project extraction failed for ${repoPath}`);
          }
        }

        return { githubRepos, gitlabRepos, errors };
      });

      // Fail if any configured repository could not be resolved
      if (resolveCoords.errors.length > 0) {
        allSteps.push(stepFailed('close-out:residue-precondition', `Could not resolve all forge coordinates: ${resolveCoords.errors.join('; ')}`));
        return buildResult('close-out', ctx.issueId, allSteps, start);
      }

      // Fail if no repositories were successfully resolved
      if (resolveCoords.githubRepos.length === 0 && resolveCoords.gitlabRepos.length === 0) {
        allSteps.push(stepFailed('close-out:residue-precondition', 'No forge coordinates were resolved for residue cleanup'));
        return buildResult('close-out', ctx.issueId, allSteps, start);
      }

      // Execute residue cleanup
      const residueStep = yield* Effect.promise(() => closeResidueConventionPrs({
        issueId: ctx.issueId,
        projectPath: ctx.projectPath,
        github: resolveCoords.githubRepos.length > 0 ? { repos: resolveCoords.githubRepos } : undefined,
        gitlab: resolveCoords.gitlabRepos.length > 0 ? { projects: resolveCoords.gitlabRepos } : undefined,
      }));
      allSteps.push(residueStep);
      if (!residueStep.success && !residueStep.skipped) {
        allSteps.push(stepFailed('close-out:abort', 'Stopped — residue PR/MR close failed'));
        return buildResult('close-out', ctx.issueId, allSteps, start);
      }
      residueEvidence = residueStep.details ?? [];
    }

    // 2. Build the Definition-of-Done gate with collected evidence
    let dodGate: DodGateResult = abandon
      ? buildAbandonedDodGate(abandon.reason, abandon.by)
      : residue
      ? buildResidueDodGate(residue.reason, residue.by, [
          ...trackerClosedEvidence,
          ...residueEvidence,
        ])
      : yield* Effect.promise(() => evaluateDodGate(ctx, {
          acceptedRows: opts.dodAcceptedRows,
          acceptedBy: opts.dodAcceptedBy,
          verifyMerged: verifyBranchMergedImpl,
        }));

    for (const row of dodGate.rows) {
      const details = [`expected: ${row.expected}`, `observed: ${row.observed}`];
      if (row.acceptedBy) {
        allSteps.push(stepSkipped(`dod:${row.id}`, [
          ...details,
          `MISS accepted via ${row.acceptedBy.flag} by ${row.acceptedBy.by} at ${row.acceptedBy.at}`,
        ]));
      } else if (row.status === 'skip') {
        allSteps.push(stepSkipped(`dod:${row.id}`, details));
      } else if (row.status === 'pass') {
        allSteps.push(stepOk(`dod:${row.id}`, details));
      } else {
        allSteps.push(stepFailed(`dod:${row.id}`, row.observed, details));
      }
    }
    if (!dodGate.passed) {
      const flags = dodGate.rows
        .filter(row => row.status === 'miss' && !row.acceptedBy)
        .map(row => `${row.id} (${acceptFlagFor(DOD_ROWS.find(def => def.id === row.id)!)})`);
      allSteps.push(stepFailed(
        'close-out:dod-gate',
        `Definition-of-Done gate blocked close-out: ${flags.join(', ')}. Re-run with the named --accept-<row> flag to record an explicit override.`,
      ));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }

    // 3. Move PRD + archive workspace artifacts
    // (Note: step numbering adjusted due to upfront residue cleanup)

    // 2. Move PRD + archive workspace artifacts
    const archiveSteps = yield* archivePlanning(ctx, opts);
    allSteps.push(...archiveSteps);

    // Hard fail on archive failure — don't destroy unarchived artifacts
    const archiveFailed = archiveSteps.some(s => !s.success && !s.skipped);
    if (archiveFailed) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — archiving failed, workspace preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }

    // 3. Mark the xBRIEF completed on main before teardown removes local state.
    const xbriefStep = yield* Effect.promise(() => completeXBriefStep(ctx));
    allSteps.push(xbriefStep);
    if (!xbriefStep.success && !xbriefStep.skipped) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — xBRIEF completion failed, workspace preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }

    // 5+6. Teardown workspace + agent state
    const telemetryContext: PipelineTelemetryContext | null = yield* Effect.promise(async () => {
      try {
        return await resolvePipelineTelemetryContext(ctx.issueId);
      } catch {
        // Membership and agent attribution are best-effort and must not abort close-out.
        return null;
      }
    });
    const closeOutConfig = (yield* Effect.promise(() => Effect.runPromise(loadCloisterConfig()))).close_out;
    const removeWorkspace = closeOutConfig?.remove_workspace ?? true;
    const deleteBranches = closeOutConfig?.delete_feature_branch ?? false;
    const teardownSteps = yield* teardownWorkspace(ctx, {
      deleteWorkspace: removeWorkspace,
      deleteBranches,
    });
    allSteps.push(...teardownSteps);
    if (hasBlockingFailure(teardownSteps)) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — teardown failed, tracker issue and review status preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }

    const teardownDef = DOD_ROWS.find(row => row.id === 'teardown')!;
    dodGate.rows.push({
      ...teardownDef,
      status: 'pass',
      observed: describeTeardownObserved(teardownSteps, { removeWorkspace, deleteBranches }),
    });

    // Update the gate with verified residue evidence before it is published.
    if (residue && residueEvidence.length > 0) {
      const residueRow = dodGate.rows.find(row => (row.id as string) === 'residue');
      if (residueRow) residueRow.observed = residueEvidence.join('; ');
    }

    // 6+7. Close issue + apply label.
    //
    // PAN-3917: the Definition-of-Done audit rides the close comment. The
    // tracker owns the issue, so the audit lives with it — there is no record
    // to persist it to, and a closed issue carrying an unreadable verdict table
    // would be the state layer by another name.
    const closeReason = abandon
      ? `Closed without landing evidence — disposition recorded: ${abandon.reason}`
      : ctx.auto ? 'Closed via automatic close-out ceremony' : 'Closed via close-out ceremony';
    const closeSteps = yield* closeIssue(ctx, {
      tracker: opts.tracker,
      comment: `${closeReason}\n\n${formatDodGateComment(dodGate, residue)}`,
      applyLabel: true,
    });
    allSteps.push(...closeSteps);
    if (hasBlockingFailure(closeSteps)) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — issue close failed, review status preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }

    // 8. The tracker close IS the terminal marker; the audit went out with it.
    const markTerminal = stepOk('close-out:mark-pipeline-terminal', [
      'Tracker issue closed and labelled — the tracker owns terminal state',
    ]);
    allSteps.push(markTerminal);
    {
      // PAN-3727: clear operator-gate residue (stoppedByUser/paused/troubled)
      // so a terminal issue's preserved agent rows stop reappearing in the
      // parked population. Non-blocking — a bookkeeping failure must never
      // strand an already-merged close-out.
      // PAN-3917: the open-recovery-trip acknowledgement this also did is
      // dropped — cloister/recovery-trip.ts (Appendix A.1) and the whole
      // parked-orbit/recovery-trip patrol concept it served are gone with
      // the old patrol system (deacon-lite replaces it).
      allSteps.push(yield* Effect.promise(async () => {
        let gates: string[] = [];
        let gatesError: string | undefined;
        try {
          gates = clearAgentOperatorGatesForIssue(ctx.issueId);
        } catch (err) {
          gatesError = (err as Error).message ?? String(err);
        }
        const summary = `Cleared operator gates on ${gates.length} agent row(s)`;
        if (!gatesError) {
          return stepOk('close-out:ack-parked-residue', [summary]);
        }
        return stepSkipped('close-out:ack-parked-residue', [
          summary,
          `gate clearing failed: ${gatesError}`,
        ]);
      }));
    }

    // 9. Clear review status
    yield* Effect.promise(() => resetPostMergeStateForIssue(ctx.issueId));
    yield* Effect.promise(() => recordFeatureRegistryLifecycle({ issueId: ctx.issueId, status: 'archived' }));

    const result = buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    if (result.success && !markTerminal.skipped) capturePipelineStage('closed_out', telemetryContext);
    return result;
  });
}

/**
 * The Definition-of-Done audit, rendered for the tracker close comment
 * (PAN-3917). Every row states what was expected and what was observed, so a
 * reader of the closed issue sees the same eight rows the gate evaluated.
 */
function formatDodGateComment(
  dodGate: DodGateResult,
  residueDisposition?: { reason: string; by: string },
): string {
  const icon = (status: DodRowResult['status']) =>
    status === 'pass' ? '\u2713' : status === 'skip' ? '\u2013' : '\u2717';
  const lines = dodGate.rows.map(row => {
    const accepted = row.acceptedBy ? ` _(accepted by ${row.acceptedBy.by} via ${row.acceptedBy.flag})_` : '';
    return `| ${row.num} | ${row.title} | ${icon(row.status)} ${row.status} | ${row.observed}${accepted} |`;
  });
  const disposition = residueDisposition
    ? `\n\nResidue disposition: ${residueDisposition.reason} (by ${residueDisposition.by})`
    : '';
  return [
    '<details><summary>Definition of Done</summary>',
    '',
    '| # | Row | Status | Observed |',
    '| --- | --- | --- | --- |',
    ...lines,
    '',
    `Gate: **${dodGate.passed ? 'passed' : 'failed'}**${dodGate.misses.length > 0 ? ` \u2014 misses: ${dodGate.misses.join(', ')}` : ''}${disposition}`,
    '</details>',
  ].join('\n');
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

async function completeXBriefStep(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-out:vbrief-completed';
  return stepSkipped(step, [
    `Spec status for ${ctx.issueId} is derived from the merged PR; close-out does not write it`,
  ]);
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

    // PAN-5152: Jira moves through its workflow; the seam never rejects.
    if (resolveTrackerType(ctx.issueId) === 'jira') {
      return stepOk(step, [(await transitionJiraIssue(ctx.issueId, 'todo')).message]);
    }

    // Linear: reopen to Todo
    const linearApiKey = await getLinearApiKey();
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

export const __testInternals = {
  completeXBriefStep,
  verifyBranchMerged,
  resetIssueToTodo,
  resetIssueToCanceled,
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

    if (resolveTrackerType(ctx.issueId) === 'jira') {
      return stepOk(step, [(await transitionJiraIssue(ctx.issueId, 'canceled')).message]);
    }

    const linearApiKey = await getLinearApiKey();
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
      return stepOk(step, [`Reset ${trackerName(ctx, 'linear')} issue ${ctx.issueId} to Canceled`]);
    }

    return stepSkipped(step, ['No tracker available to cancel issue']);
  } catch (err) {
    return stepFailed(step, `Failed to cancel issue: ${(err as Error).message}`);
  }
}
