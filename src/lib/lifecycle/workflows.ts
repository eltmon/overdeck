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
import { extractNumberSync, extractPrefixSync } from '../issue-id.js';
import { recordFeatureRegistryLifecycle } from '../registry/feature-registry-population.js';
import { getForgeAdapter } from '../forge.js';
import { resolveProjectReposForIssueSync } from '../project-repos.js';
import {
  getProjectConfigFromWorkspacePath,
  markRecordPipelineClosedOutSync,
  markRecordPipelineResidueClosedOutSync,
  writeCloseOutDodGate,
} from '../pan-dir/record.js';
import { pruneStoppedAgentsForIssue } from '../cloister/agent-gc.js';
import { isTrackerIssueClosed } from '../cloister/issue-closed.js';
import { acknowledgeAllOpenRecoveryTrips } from '../cloister/recovery-trip.js';
import { clearAgentOperatorGatesForIssueSync } from '../agents/agent-state.js';
import { evaluateDodGate, readCompletedCloseOut } from './dod-gate.js';
import { closeResidueConventionPrs, extractGitHubCoordinates, extractGitLabProject } from './residue.js';
import {
  capturePipelineStage,
  resolvePipelineTelemetryContext,
  type PipelineTelemetryContext,
} from '../telemetry/pipeline.js';
import { acceptFlagFor, BRANCH_ABSENT_MERGE_ERROR, buildAbandonedDodGate, buildResidueDodGate, DOD_ROWS, type DodGateResult, type DodRowId } from './dod.js';

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
 * 3. Mark xBRIEF completed
 * 4. Clean up workspace (tmux, TLDR, Docker, worktree)
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

    // Recover UAT-promotion evidence before the gate reads the verification verdict.
    const uatEvidenceStep = yield* Effect.promise(async () => {
      try {
        const { healUatPromotionVerification } = await import('../cloister/uat-promote-verification.js');
        const evidence = await healUatPromotionVerification(ctx.issueId);
        if (!evidence) {
          return stepSkipped('dod:uat-promotion-evidence', ['No missing UAT-promotion verification evidence found']);
        }
        return stepOk('dod:uat-promotion-evidence', [
          `Recorded verification from ${evidence.generation}`,
          ...(evidence.mergeSha ? [`Promoted to main at ${evidence.mergeSha.slice(0, 9)}`] : []),
        ]);
      } catch (err) {
        return stepSkipped('dod:uat-promotion-evidence', [
          `Evidence recovery unavailable: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
    });
    allSteps.push(uatEvidenceStep);

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
      const prRepos = resolveProjectReposForIssueSync(ctx.issueId);
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
    const teardownSteps = yield* teardownWorkspace(ctx, {
      deleteWorkspace: closeOutConfig?.remove_workspace ?? false,
      deleteBranches: closeOutConfig?.delete_feature_branch ?? false,
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
      observed: teardownSteps.flatMap(step => step.details ?? []).join('; ') || 'close-out teardown completed',
    });

    // 6+7. Close issue + apply label
    const closeSteps = yield* closeIssue(ctx, {
      tracker: opts.tracker,
      comment: abandon
        ? `Closed without landing evidence — disposition recorded: ${abandon.reason}`
        : ctx.auto ? 'Closed via automatic close-out ceremony' : 'Closed via close-out ceremony',
      applyLabel: true,
    });
    allSteps.push(...closeSteps);
    if (hasBlockingFailure(closeSteps)) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — issue close failed, review status preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }

    // 8. Mark durable pipeline terminal before clearing the DB cache.
    const markTerminal = yield* markPipelineClosedOutStep(ctx, residue);
    allSteps.push(markTerminal);

    // Update gate with verified residue evidence before recording if a residue row exists
    if (residue && residueEvidence.length > 0) {
      const residueRow = dodGate.rows.find(row => (row.id as string) === 'residue');
      if (residueRow) {
        residueRow.observed = residueEvidence.join('; ');
      }
    }

    const recordDodGate = yield* recordDodGateStep(ctx, dodGate, abandon, residue);
    allSteps.push(recordDodGate);
    if (!recordDodGate.success) {
      allSteps.push(stepFailed('close-out:abort', 'Stopped — Definition-of-Done audit could not be persisted; review status preserved'));
      return buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    }
    if (markTerminal.success) {
      const pruned = yield* Effect.promise(() => pruneStoppedAgentsForIssue(ctx.issueId));
      allSteps.push(pruned.preserved.length > 0
        ? stepSkipped('close-out:prune-agent-rows', [`Preserved live agents or terminal rows with retained transcripts: ${pruned.preserved.join(', ')}`])
        : stepOk('close-out:prune-agent-rows', [`Pruned ${pruned.removed.length} stopped agent row(s)`]));

      // PAN-3727: acknowledge open recovery trips and clear operator-gate
      // residue (stoppedByUser/paused/troubled) so a terminal issue's
      // preserved agent rows and record stop reappearing in the parked
      // population. The two doors are independent residue — run and catch
      // each separately (review finding) so a trip-ack failure can never
      // suppress gate clearing, or vice versa. Non-blocking overall — a
      // bookkeeping failure must never strand an already-merged close-out.
      allSteps.push(yield* Effect.promise(async () => {
        let trips = 0;
        let tripsError: string | undefined;
        try {
          trips = await acknowledgeAllOpenRecoveryTrips(ctx.issueId);
        } catch (err) {
          tripsError = (err as Error).message ?? String(err);
        }
        let gates: string[] = [];
        let gatesError: string | undefined;
        try {
          gates = clearAgentOperatorGatesForIssueSync(ctx.issueId);
        } catch (err) {
          gatesError = (err as Error).message ?? String(err);
        }
        const summary = `Acked ${trips} open trip(s); cleared operator gates on ${gates.length} agent row(s)`;
        if (!tripsError && !gatesError) {
          return stepOk('close-out:ack-parked-residue', [summary]);
        }
        return stepSkipped('close-out:ack-parked-residue', [
          summary,
          ...(tripsError ? [`trip acknowledgement failed: ${tripsError}`] : []),
          ...(gatesError ? [`gate clearing failed: ${gatesError}`] : []),
        ]);
      }));
    }

    // 9. Clear review status
    const clearResult = yield* clearReviewStatusStep(ctx.issueId);
    allSteps.push(clearResult);

    yield* Effect.promise(() => resetPostMergeStateForIssue(ctx.issueId));
    yield* Effect.promise(() => recordFeatureRegistryLifecycle({ issueId: ctx.issueId, status: 'archived' }));

    const result = buildResult('close-out', ctx.issueId, allSteps, start, dodGate);
    if (result.success && !markTerminal.skipped) capturePipelineStage('closed_out', telemetryContext);
    return result;
  });
}

function markPipelineClosedOutStep(ctx: LifecycleContext, residue?: { reason: string; by: string }): Effect.Effect<StepResult> {
  const step = 'close-out:mark-pipeline-terminal';
  return Effect.try({
    try: () => {
      const project = getProjectConfigFromWorkspacePath(ctx.projectPath);
      if (residue) {
        markRecordPipelineResidueClosedOutSync(project, ctx.issueId.toUpperCase());
      } else {
        markRecordPipelineClosedOutSync(project, ctx.issueId.toUpperCase());
      }
      return stepOk(step, ['Marked durable pipeline journal closed-out']);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped(step, [`Pipeline terminal marker failed (non-fatal): ${(err as Error).message ?? String(err)}`])),
    ),
  );
}

function recordDodGateStep(ctx: LifecycleContext, dodGate: DodGateResult, abandonDisposition?: { reason: string; by: string }, residueDisposition?: { reason: string; by: string }): Effect.Effect<StepResult> {
  const step = 'close-out:record-dod-gate';
  return Effect.tryPromise({
    try: async () => {
      const project = getProjectConfigFromWorkspacePath(ctx.projectPath);
      await writeCloseOutDodGate(project, ctx.issueId.toUpperCase(), {
        evaluatedAt: new Date().toISOString(),
        rows: dodGate.rows,
        accepted: dodGate.accepted,
        ...(abandonDisposition ? { disposition: abandonDisposition } : {}),
        ...(residueDisposition ? { disposition: residueDisposition } : {}),
      });
      return stepOk(step, ['Recorded Definition-of-Done gate with 8 rows']);
    },
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed(step, `Definition-of-Done gate record failed: ${(err as Error).message ?? String(err)}`)),
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

async function completeXBriefStep(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-out:vbrief-completed';
  try {
    const { transitionXBriefOnMain } = await import('../xbrief/lifecycle-io.js');
    const result = await Effect.runPromise(transitionXBriefOnMain(
      ctx.projectPath,
      ctx.issueId,
      'completed',
      'completed',
      `scope: complete ${ctx.issueId.toUpperCase()} xBRIEF`,
    ));
    const details = [
      result.moved ? 'Updated xBRIEF lifecycle to completed' : 'xBRIEF lifecycle already completed',
      result.statusUpdated ? 'Updated plan.status to completed' : 'plan.status already completed',
    ];
    if (result.committed) details.push('Committed xBRIEF completion on main');
    return stepOk(step, details);
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause ?? err;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('No xBRIEF found')) {
      return stepSkipped(step, [`No xBRIEF found for ${ctx.issueId}`]);
    }
    return stepFailed(step, `xBRIEF completion failed: ${message}`);
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

export interface MergeVerificationRoot { repoKey: string; dir: string; sourceBranch: string; targetBranch: string; forge: 'github' | 'gitlab' }

async function verifyRootConventionBranches(ctx: LifecycleContext, root: MergeVerificationRoot, issueLower: string): Promise<StepResult | null> {
  const featureResult = await verifyConventionBranchMerged(ctx, root);
  if (featureResult?.success) return featureResult;

  const strikeResult = await verifyConventionBranchMerged(ctx, { ...root, sourceBranch: `strike/${issueLower}` });
  if (strikeResult?.success && !strikeResult.skipped) {
    return stepOk('close-out:verify-merged', [
      ...(strikeResult.details ?? []),
      `Superseded ${root.sourceBranch} residual: ${featureResult?.error ?? BRANCH_ABSENT_MERGE_ERROR}`,
    ]);
  }
  return featureResult;
}

export async function verifyBranchMergedImpl(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-out:verify-merged';
  const issueLower = ctx.issueId.toLowerCase();
  const defaultRoot: MergeVerificationRoot = { repoKey: issueLower, dir: ctx.projectPath, sourceBranch: `feature/${issueLower}`, targetBranch: 'main', forge: 'github' };

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

    const resolvedRoots = resolveProjectReposForIssueSync(ctx.issueId)
      ?.filter((repo) => repo.required)
      .map((repo): MergeVerificationRoot => ({
        repoKey: repo.repoKey,
        dir: repo.repoPath,
        sourceBranch: repo.sourceBranch,
        targetBranch: repo.targetBranch,
        forge: repo.forge,
      }));
    const roots = resolvedRoots?.length ? resolvedRoots : [defaultRoot];
    if (roots.length === 1) {
      return await verifyRootConventionBranches(ctx, roots[0], issueLower)
        ?? stepFailed(step, BRANCH_ABSENT_MERGE_ERROR);
    }

    const results = await Promise.all(roots.map(async (root) => ({
      root,
      result: await verifyRootConventionBranches(ctx, root, issueLower),
    })));
    const failures = results.filter(({ result }) => result && !result.success);
    if (failures.length > 0) {
      return stepFailed(step, failures.map(({ root, result }) => `${root.repoKey}: ${result?.error}`).join('; '));
    }
    const successes = results.filter(({ result }) => result?.success);
    if (successes.length > 0) {
      return stepOk(step, successes.flatMap(({ root, result }) =>
        (result?.details ?? []).map((detail) => `${root.repoKey}: ${detail}`)));
    }
    return stepFailed(step, BRANCH_ABSENT_MERGE_ERROR);
  } catch (err) {
    return stepFailed(step, `Could not verify merge: ${(err as Error).message}`);
  }
}

interface GitLabMergeLookupCache {
  attempted: boolean;
  headSha?: string;
  artifact?: { id?: string; url?: string } | null;
}

interface GitLabMergeMatch {
  result: StepResult;
  reused: boolean;
}

export async function verifyConventionBranchMerged(ctx: LifecycleContext, root: MergeVerificationRoot): Promise<StepResult | null> {
  const step = 'close-out:verify-merged';
  const gitlabLookup: GitLabMergeLookupCache = { attempted: false };
  const { stdout: branchExists } = await execAsync(
    `git branch --list "${root.sourceBranch}" 2>/dev/null || true`,
    { cwd: root.dir, encoding: 'utf-8' },
  );

  if (branchExists.trim()) {
    // Use merge-base --is-ancestor: checks if the branch tip is reachable from main
    try {
      await execAsync(
        `git merge-base --is-ancestor ${root.sourceBranch} ${root.targetBranch}`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, gitlabLookup);
      if (remoteCheck && !remoteCheck.success) return remoteCheck;
      return stepOk(step, ['All commits merged to main', ...(remoteCheck?.details ?? [])]);
    } catch {
      // --is-ancestor fails for squash merges where the branch still exists.
      const gitlabMerged = await verifySquashMergedMrByBranch(root, root.sourceBranch, gitlabLookup);
      if (gitlabMerged) {
        const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, gitlabLookup);
        if (remoteCheck && !remoteCheck.success) return remoteCheck;
        return stepOk(step, [...(gitlabMerged.result.details ?? []), ...(remoteCheck?.details ?? [])]);
      }

      try {
        const { stdout: codeDiff } = await execAsync(
          `git diff ${root.targetBranch}...${root.sourceBranch} -- ':!.planning' ':!docs/prds' ':!.overdeck/prompts' 2>/dev/null || true`,
          { cwd: root.dir, encoding: 'utf-8' },
        );
        if (!codeDiff.trim()) {
          const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, gitlabLookup);
          if (remoteCheck && !remoteCheck.success) return remoteCheck;
          return stepOk(step, [
            'Code changes squash-merged to main (only planning artifacts remain on branch)',
            ...(remoteCheck?.details ?? []),
          ]);
        }
      } catch {
        // diff failed — fall through to unmerged report
      }

      const githubMerged = root.forge === 'github'
        ? await verifySquashMergedPrByBranch(ctx, root, root.sourceBranch)
        : null;
      if (githubMerged?.success) {
        const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, gitlabLookup);
        if (remoteCheck && !remoteCheck.success) return remoteCheck;
        return stepOk(step, [
          ...(githubMerged.details ?? []),
          ...(remoteCheck?.details ?? []),
        ]);
      }
      if (githubMerged) return githubMerged;

      const { stdout: unmerged } = await execAsync(
        `git log ${root.targetBranch}..${root.sourceBranch} --oneline 2>/dev/null || true`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      const count = unmerged.trim() ? unmerged.trim().split('\n').length : 0;

      if (ctx.github && root.forge === 'github') {
        try {
          const { stdout: issueState } = await execAsync(
            `gh issue view ${ctx.github.number} --repo ${ctx.github.owner}/${ctx.github.repo} --json state --jq '.state'`,
            { cwd: root.dir, encoding: 'utf-8' },
          );
          if (issueState.trim().toUpperCase() === 'CLOSED') {
            return stepSkipped(step, [`Issue already closed on GitHub; ${count} unmerged commit(s) remain on ${root.sourceBranch}`]);
          }
        } catch {
          // gh check failed — fall through to hard fail
        }
      }

      return stepFailed(step, `${count} unmerged commit(s) on ${root.sourceBranch}. Merge before closing out.`);
    }
  }

  // Check remote
  const { stdout: remoteBranch } = await execAsync(
    `git ls-remote --heads origin "${root.sourceBranch}" 2>/dev/null || true`,
    { cwd: root.dir, encoding: 'utf-8' },
  );

  if (remoteBranch.trim()) {
    await execAsync(`git fetch origin ${root.sourceBranch}`, { cwd: root.dir }).catch(() => {});
    const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, gitlabLookup);
    if (remoteCheck) return remoteCheck;
  }

  return null;
}

async function verifySquashMergedMrByBranch(
  root: MergeVerificationRoot,
  branchRef: string,
  lookup: GitLabMergeLookupCache,
): Promise<GitLabMergeMatch | null> {
  if (root.forge !== 'gitlab') return null;
  try {
    const { stdout } = await execAsync(`git rev-parse ${branchRef} 2>/dev/null`, { cwd: root.dir, encoding: 'utf-8' });
    const headSha = stdout.trim();
    if (!headSha) return null;
    const reused = lookup.attempted;
    if (!reused) {
      lookup.attempted = true;
      lookup.headSha = headSha;
      lookup.artifact = await getForgeAdapter('gitlab').findMergedArtifact({
        sourceBranch: root.sourceBranch,
        targetBranch: root.targetBranch,
        headSha,
        cwd: root.dir,
      });
    }
    if (!lookup.artifact || lookup.headSha !== headSha) return null;
    const label = lookup.artifact.id ? `MR !${lookup.artifact.id}` : 'GitLab MR';
    const url = lookup.artifact.url ? ` (${lookup.artifact.url})` : '';
    return {
      result: stepOk('close-out:verify-merged', [`${label} is merged and ${branchRef} matches the merged MR head${url}`]),
      reused,
    };
  } catch {
    return null;
  }
}

type GitHubMergedPr = {
  number?: number;
  mergedAt?: string | null;
  headRefOid?: string | null;
  url?: string | null;
};

async function verifyRemoteBranchIfPresent(
  ctx: LifecycleContext,
  root: MergeVerificationRoot,
  gitlabLookup: GitLabMergeLookupCache,
): Promise<StepResult | null> {
  const step = 'close-out:verify-merged';
  const remoteRef = `origin/${root.sourceBranch}`;

  const { stdout: remoteBranch } = await execAsync(
    `git ls-remote --heads origin "${root.sourceBranch}" 2>/dev/null || true`,
    { cwd: root.dir, encoding: 'utf-8' },
  );
  if (!remoteBranch.trim()) return null;

  await execAsync(`git fetch origin ${root.sourceBranch}`, { cwd: root.dir }).catch(() => {});

  try {
    await execAsync(
      `git merge-base --is-ancestor ${remoteRef} ${root.targetBranch}`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    return stepOk(step, ['Remote branch fully merged']);
  } catch {
    // Squash-merge detection for remote branch
    try {
      const { stdout: codeDiff } = await execAsync(
        `git diff ${root.targetBranch}...${remoteRef} -- ':!.planning' ':!docs/prds' ':!.overdeck/prompts' 2>/dev/null || true`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      if (!codeDiff.trim()) {
        return stepOk(step, ['Remote code changes squash-merged to main (only planning artifacts remain on branch)']);
      }
    } catch {
      // diff failed — fall through
    }

    const gitlabMerged = await verifySquashMergedMrByBranch(root, remoteRef, gitlabLookup);
    if (gitlabMerged) {
      return gitlabMerged.reused
        ? stepOk(step, [`Remote ${remoteRef} matches the merged MR head`])
        : gitlabMerged.result;
    }

    const githubMerged = root.forge === 'github'
      ? await verifySquashMergedPrByBranch(ctx, root, remoteRef)
      : null;
    if (githubMerged) return githubMerged;

    const { stdout: remoteUnmerged } = await execAsync(
      `git log ${root.targetBranch}..${remoteRef} --oneline 2>/dev/null || true`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    const count = remoteUnmerged.trim() ? remoteUnmerged.trim().split('\n').length : 0;

    if (ctx.github && root.forge === 'github') {
      try {
        const { stdout: issueState } = await execAsync(
          `gh issue view ${ctx.github.number} --repo ${ctx.github.owner}/${ctx.github.repo} --json state --jq '.state'`,
          { cwd: root.dir, encoding: 'utf-8' },
        );
        if (issueState.trim().toUpperCase() === 'CLOSED') {
          return stepSkipped(step, [`Issue already closed on GitHub; ${count} unmerged commit(s) remain on remote ${root.sourceBranch}`]);
        }
      } catch {
        // gh check failed — fall through to hard fail
      }
    }

    return stepFailed(step, `${count} unmerged commit(s) on remote ${root.sourceBranch}.`);
  }
}

async function verifySquashMergedPrByBranch(
  ctx: LifecycleContext,
  root: MergeVerificationRoot,
  branchRef: string,
): Promise<StepResult | null> {
  if (!ctx.github) return null;

  const step = 'close-out:verify-merged';
  const { owner, repo } = ctx.github;
  const remoteTargetRef = `origin/${root.targetBranch}`;

  try {
    const { stdout: prJson } = await execAsync(
      `gh pr list --repo ${owner}/${repo} --state merged --head ${JSON.stringify(root.sourceBranch)} --json number,mergedAt,headRefOid,url`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    const prs = JSON.parse(prJson) as GitHubMergedPr[];
    const mergedPr = prs
      .filter((pr) => (
        typeof pr.mergedAt === 'string'
        && pr.mergedAt.length > 0
        && typeof pr.headRefOid === 'string'
        && pr.headRefOid.length > 0
      ))
      .sort((a, b) => Date.parse(String(b.mergedAt)) - Date.parse(String(a.mergedAt)))[0];
    if (!mergedPr?.headRefOid) return null;

    const { stdout: tipShaRaw } = await execAsync(
      `git rev-parse ${branchRef} 2>/dev/null`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    const tipSha = tipShaRaw.trim();
    if (!tipSha) return null;

    if (tipSha === mergedPr.headRefOid) {
      const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'GitHub PR';
      return stepOk(step, [`${prLabel} is squash-merged and ${branchRef} matches the merged PR head`]);
    }

    // A workspace may merge a newer target branch after its PR head was pushed.
    // Ignore those merge commits and allow close-out when every post-PR commit
    // is already on the configured remote target; only branch-unique work is unsafe.
    let commitsNotOnTarget: string[] | null = null;
    try {
      const { stdout: commitsRaw } = await execAsync(
        `git log --no-merges --format=%H ${mergedPr.headRefOid}..${tipSha}`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      const commits = commitsRaw.split('\n').map((sha) => sha.trim()).filter(Boolean);
      const unmerged: string[] = [];
      for (const commit of commits) {
        try {
          await execAsync(
            `git merge-base --is-ancestor ${commit} ${remoteTargetRef}`,
            { cwd: root.dir, encoding: 'utf-8' },
          );
        } catch {
          unmerged.push(commit);
        }
      }
      if (unmerged.length === 0) {
        const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'GitHub PR';
        return stepOk(step, [
          `${prLabel} is squash-merged; all ${commits.length} post-PR non-merge commit(s) on ${branchRef} are already on ${remoteTargetRef}`,
        ]);
      }

      commitsNotOnTarget = unmerged;
    } catch { /* containment check failure falls through to the state-plane policy */ }

    // PAN-2406 / state-plane policy rule 3: commits after the merged head that
    // touch ONLY legacy state-plane paths under .pan/ are pipeline exhaust —
    // e.g. 'chore: record merge status' — and must not block close-out.
    try {
      const { stdout: deltaRaw } = await execAsync(
        `git diff --name-only ${mergedPr.headRefOid}..${tipSha}`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      let deltaFiles = deltaRaw.split('\n').map((f) => f.trim()).filter(Boolean);
      let statePlaneOnly = deltaFiles.length > 0 && deltaFiles.every((f) =>
        f.startsWith('.pan/'));
      if (!statePlaneOnly) {
        // Branch may have merged its target INTO itself after the PR merged —
        // the two-dot delta then contains target-branch files. Judge only changes
        // UNIQUE to the branch (three-dot vs the remote target): if those are
        // state-plane-only, everything real is already on the target.
        const { stdout: uniqueRaw } = await execAsync(
          `git diff --name-only ${remoteTargetRef}...${tipSha}`,
          { cwd: root.dir, encoding: 'utf-8' },
        );
        deltaFiles = uniqueRaw.split('\n').map((f) => f.trim()).filter(Boolean);
        statePlaneOnly = deltaFiles.every((f) =>
          f.startsWith('.pan/'));
      }
      if (statePlaneOnly) {
        const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'GitHub PR';
        return stepOk(step, [
          `${prLabel} is squash-merged; ${branchRef} is ahead only by state-plane commits (${deltaFiles.length} file(s): .pan) — accepted per state-plane policy`,
        ]);
      }
    } catch { /* diff failure falls through to the strict rejection below */ }

    const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'merged GitHub PR';
    if (commitsNotOnTarget) {
      return stepFailed(step, `${branchRef} has ${commitsNotOnTarget.length} commit(s) after merged ${prLabel} that are not on ${remoteTargetRef}: ${commitsNotOnTarget.join(', ')}`);
    }
    return stepFailed(step, `${branchRef} does not match the head commit of merged ${prLabel}; inspect before closing out.`);
  } catch {
    return null;
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
  completeXBriefStep,
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
