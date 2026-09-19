/**
 * Verification Runner — orchestrates the full verification gate lifecycle.
 *
 * Runs quality gates (typecheck → lint → test by default, or project-specific
 * gates from projects.yaml), updates review status, writes feedback files,
 * and notifies the work agent on failure.
 *
 * Extracted from dashboard/server to be independently testable.
 */

import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { runQualityGates, DEFAULT_GATES } from './validation.js';
import {
  readVerificationArtifact,
  verificationArtifactPath,
  writeVerificationArtifact,
} from './verification-artifact.js';
import { evaluateTestSkipGate } from './test-skip-run.js';
import { buildFinalFailureInstructions } from './verification-feedback.js';
import {
  isVerificationWorkerActive,
  markVerificationWorkerAdmissionPhase,
  runSupervisedVerification,
} from './verification-worker-supervisor.js';
import type { VerificationRunnerOptions, VerificationRunnerOutcome, WorkspaceInfo } from './verification-types.js';
import { readVerificationCycleState, type VerificationCycleState } from './verification-cycles.js';
import { postVerificationCheckRun } from './verification-check-run.js';
import { getPrFacts } from './pr-facts.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import { clearAgentPaused, getAgentStateSync, messageAgent, setAgentPaused, stopAgent } from '../agents.js';
import { findProjectByPathSync, resolveProjectFromIssueSync } from '../projects.js';
import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';
import { getXBriefACStatusSync } from '../xbrief/acceptance-criteria.js';
import { XBriefMergeConflictError } from '../xbrief/io.js';
import { isXBriefFilename } from '../xbrief/lifecycle.js';
import { checkIncompletePlanItemsPromise } from '../work/done-preflight.js';
import { capturePipelineStageForIssue } from '../telemetry/pipeline.js';
import type { TemplatePlaceholders } from '../workspace-config.js';
import { parseCompositeSnapshot, snapshotWorkspaceHeadsPromise, type HeadAnchor } from '../git-utils.js';

const execAsync = promisify(exec);

export const VERIFICATION_MAX_CYCLES = 3;
const NO_PROGRESS_REPEAT_THRESHOLD = 2;

export type { VerificationRunnerOptions, VerificationRunnerOutcome, WorkspaceInfo } from './verification-types.js';

export const MERGED_VERIFICATION_REASON =
  'The pull request already merged; pre-merge verification no longer applies.';

/**
 * PAN-3917: the forge says whether the PR merged. Nothing is stamped when it
 * has — a merged PR is the merge state, for every reader.
 */
async function skipMergedVerification(
  issueId: string,
  logPrefix: string,
): Promise<VerificationRunnerOutcome | null> {
  const facts = await getPrFacts(issueId);
  if (!facts.merged) return null;
  console.log(`[${logPrefix}] Skipping pre-merge verification for ${issueId}: ${MERGED_VERIFICATION_REASON}`);
  return { outcome: 'skipped', reason: MERGED_VERIFICATION_REASON };
}

interface SyncResult {
  repoDir: string;
  repoName: string;
  targetBranch: string;
  success: boolean;
  alreadyUpToDate?: boolean;
  hasConflicts?: boolean;
  conflictLines?: string;
  errorOutput?: string;
}

function isFinalVerificationAttempt(cycleCount: number): boolean {
  return cycleCount >= VERIFICATION_MAX_CYCLES;
}

/**
 * PAN-3917: "no progress" is read from the per-run verification artifacts at
 * the current HEAD, not from a stored cycle counter and its notes string.
 */
function shouldEscalateVerificationFailure(
  cycles: VerificationCycleState,
  failedCheck: string,
  cycleCount: number,
): boolean {
  if (isFinalVerificationAttempt(cycleCount)) return true;
  return cycleCount >= NO_PROGRESS_REPEAT_THRESHOLD && cycles.lastFailedCheck === failedCheck;
}

/**
 * Announce a verification failure the gates themselves could not record (an
 * incomplete checklist, an empty changeset). The artifact holds the gate runs;
 * this puts the state-derived failure on the activity stream, where it used to
 * go as a `stuck` flag on the review row.
 */
function announceVerificationFailure(issueId: string, failedCheck: string, summary: string): void {
  try {
    emitActivityEntrySync({
      source: 'cloister',
      level: 'warn',
      message: `Verification failed for ${issueId} at ${failedCheck}`,
      issueId,
      details: summary,
    });
  } catch { /* announcement is best-effort */ }
}

async function escalateVerificationStuck(
  issueId: string,
  failedCheck: string,
  cycleCount: number,
  summary: string,
  logPrefix: string,
): Promise<void> {
  if (await skipMergedVerification(issueId, logPrefix)) return;

  const agentId = `agent-${issueId.toLowerCase()}`;
  const reason = `needs-you: verification stuck after ${cycleCount}/${VERIFICATION_MAX_CYCLES} attempts (${failedCheck})`;

  announceVerificationFailure(issueId, failedCheck, `${reason}\n\n${summary}`);

  try {
    await Effect.runPromise(setAgentPaused(agentId, reason, true));
    await Effect.runPromise(stopAgent(agentId));
    console.log(`[${logPrefix}] Verification stuck for ${issueId} — paused ${agentId}; the pause is the operator signal`);
  } catch (err: any) {
    console.error(`[${logPrefix}] Failed to pause ${agentId} after verification stuck:`, err);
  }
}

/** Exported for focused delivery-outcome tests (PR #3874 review). */
export async function deliverVerificationFeedback(
  issueId: string,
  message: string,
  details: Record<string, unknown>,
  logPrefix: string,
): Promise<void> {
  if (await skipMergedVerification(issueId, logPrefix)) return;

  const target = await resolveIssueFeedbackTarget(issueId);
  if (await skipMergedVerification(issueId, logPrefix)) return;

  if ('agentId' in target) {
    // PAN-2668: verification feedback owes rework — a stopped-by-user agent
    // with a completed handoff is re-driven, not silently queued mail.
    // PR #3874 review: delivered:false no longer throws — escalate instead of
    // logging success, the same contract as review-verdict-feedback.
    let outcome: Awaited<ReturnType<typeof messageAgent>>;
    try {
      outcome = await messageAgent(target.agentId, message, 'internal', { owesRework: true, feedbackRedelivery: true });
    } catch (err) {
      outcome = { delivered: false, queuedToMail: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (outcome.delivered) {
      console.log(`[${logPrefix}] Sent verification feedback for ${issueId} to ${target.agentId}`);
      return;
    }
    const reason = outcome.reason ?? 'delivery was not accepted';
    console.warn(`[${logPrefix}] Could not message ${target.agentId}; verification feedback for ${issueId} not delivered: ${reason}`);
    await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
      specialist: 'verification-gate',
      ...details,
    });
    return;
  }

  await surfaceIssueFeedbackNeedsYou(issueId, target.reason, {
    specialist: 'verification-gate',
    ...details,
  });
}

async function syncSingleRepo(gitDir: string, targetBranch: string): Promise<SyncResult> {
  const repoName = basename(gitDir);
  try {
    await execAsync(`git fetch origin ${targetBranch}`, { cwd: gitDir, encoding: 'utf-8', timeout: 30000 });
    const mergeResult = await execAsync(`git merge origin/${targetBranch} --no-edit`, {
      cwd: gitDir,
      encoding: 'utf-8',
      timeout: 60000,
    });
    const mergeOut = (mergeResult.stdout || '') + (mergeResult.stderr || '');
    const alreadyUpToDate = mergeOut.includes('Already up to date') || mergeOut.includes('Already up-to-date');
    return { repoDir: gitDir, repoName, targetBranch, success: true, alreadyUpToDate };
  } catch (mergeErr: any) {
    const mergeOut = (mergeErr.stdout || '') + (mergeErr.stderr || '');
    const hasConflicts = mergeOut.includes('CONFLICT') || mergeOut.includes('Merge conflict');

    if (hasConflicts) {
      try { await execAsync('git merge --abort', { cwd: gitDir, encoding: 'utf-8' }); } catch {}
      const conflictLines = mergeOut
        .split('\n')
        .filter((line: string) => line.startsWith('CONFLICT'))
        .map((line: string) => line.replace(/^CONFLICT \([^)]+\): /, '').replace(/Merge conflict in /, ''))
        .join('\n  - ');
      return { repoDir: gitDir, repoName, targetBranch, success: false, hasConflicts: true, conflictLines };
    }

    const rawOutput = mergeOut || mergeErr.message || '(no output)';
    const errorOutput = rawOutput.length > 3000 ? rawOutput.slice(0, 3000) + '\n...(truncated)' : rawOutput;
    return { repoDir: gitDir, repoName, targetBranch, success: false, errorOutput };
  }
}

function buildSyncFailureFeedback(
  issueId: string,
  failures: SyncResult[],
  isPolyrepo: boolean,
  cycleCount: number,
): { summary: string; feedbackBody: string } {
  const hasConflicts = failures.some(f => f.hasConflicts);

  const summaryParts = failures.map(f => {
    const prefix = isPolyrepo ? `[${f.repoName}] ` : '';
    if (f.hasConflicts) {
      return `${prefix}Merge conflicts with ${f.targetBranch}:\n  - ${f.conflictLines}`;
    }
    return `${prefix}Sync with ${f.targetBranch} FAILED:\n${f.errorOutput}`;
  });
  const summary = isPolyrepo
    ? `Sync FAILED in ${failures.length} repo(s):\n\n${summaryParts.join('\n\n')}`
    : `Sync with ${failures[0].targetBranch} FAILED${hasConflicts ? ' — merge conflicts detected' : ''}:\n\n${summaryParts.join('\n\n')}`;

  const repoInstructions = isPolyrepo
    ? failures.map(f => {
        if (f.hasConflicts) {
          return `### ${f.repoName}/\n1. \`cd ${f.repoName}\`\n2. \`git fetch origin ${f.targetBranch} && git merge origin/${f.targetBranch}\`\n3. Resolve all conflicts and commit`;
        }
        return `### ${f.repoName}/\n1. \`cd ${f.repoName}\`\n2. Investigate and fix the sync failure\n3. Commit changes`;
      }).join('\n\n')
    : hasConflicts
      ? `1. Run: \`git fetch origin ${failures[0].targetBranch} && git merge origin/${failures[0].targetBranch}\`\n2. Resolve all conflicts in the listed files\n3. Run the project's build and tests to verify nothing broke\n4. Commit and push ALL changes`
      : `1. Run: \`git fetch origin ${failures[0].targetBranch}\`\n2. Run: \`git merge origin/${failures[0].targetBranch}\`\n3. If git reports conflicts, resolve them and verify the merge succeeds cleanly\n4. Run the project's build and tests to verify nothing broke\n5. Commit and push ALL changes`;

  const feedbackBody = isFinalVerificationAttempt(cycleCount)
    ? `VERIFICATION STUCK for ${issueId} (attempt ${cycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: sync-target-branch\n\n${summary}\n\n${buildFinalFailureInstructions(issueId)}`
    : `VERIFICATION FAILED for ${issueId} (attempt ${cycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: sync-target-branch\n\n${summary}\n\n## REQUIRED: ${hasConflicts ? 'Resolve merge conflicts' : 'Fix the sync failure'} BEFORE resubmitting\n\n${isPolyrepo ? 'This is a polyrepo workspace. Fix each failing repo individually:\n\n' : ''}${repoInstructions}\n\nAfter fixing:\n1. Run the project's build and tests\n2. Commit and push ALL changes\n3. ONLY THEN resubmit: pan review request ${issueId} -m "Fixed sync-target-branch"\n\nDo NOT resubmit until all repos sync cleanly and tests pass.`;

  return { summary, feedbackBody };
}

export function getSyncTargetBranch(
  workspacePath: string,
  projectConfig: ReturnType<typeof findProjectByPathSync>,
  repoName?: string,
): string {
  if (!projectConfig) return 'main';

  if (repoName) {
    const matchingRepo = projectConfig.workspace?.repos?.find(repo => repo.name === repoName);
    return (
      matchingRepo?.pr_target ||
      projectConfig.workspace?.pr_target ||
      matchingRepo?.default_branch ||
      projectConfig.workspace?.default_branch ||
      'main'
    );
  }

  const wsName = basename(workspacePath);
  const matchingRepo = projectConfig.workspace?.repos?.find(repo =>
    repo.name === wsName || basename(repo.path) === wsName
  );

  return (
    matchingRepo?.pr_target ||
    projectConfig.workspace?.pr_target ||
    matchingRepo?.default_branch ||
    projectConfig.workspace?.default_branch ||
    'main'
  );
}

/**
 * PAN-2179: detect a "plan-only" / zombie changeset — one whose only changes are
 * pipeline artifacts (.pan/, task state, xBRIEF) with no actual implementation. A work
 * agent that never received its kickoff produces exactly this. The verification
 * gate uses it to bounce the branch back instead of letting an empty "completion"
 * advance to review/merge. A legit non-code change (docs, rules under
 * sync-sources/, config) counts as content and is NOT flagged.
 */
export function changesetHasNoContent(changedFiles: readonly string[]): boolean {
  const content = changedFiles
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !f.startsWith('.pan/') && !isXBriefFilename(f));
  return content.length === 0;
}

/**
 * Return whether any actual workspace repository contains implementation
 * changes. `undefined` means at least one repo diff failed and no positive
 * evidence was found, so callers must conservatively skip the empty guard.
 */
export async function workspaceChangesetHasContent(
  issueId: string,
  workspacePath: string,
): Promise<boolean | undefined> {
  const roots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);
  let diffFailed = false;

  for (const root of roots) {
    try {
      const { stdout } = await execAsync(
        `git diff --name-only origin/${root.targetBranch}...HEAD`,
        { cwd: root.dir, encoding: 'utf-8', timeout: 15_000 },
      );
      if (!changesetHasNoContent(stdout.split('\n'))) return true;
    } catch {
      diffFailed = true;
    }
  }

  return diffFailed ? undefined : false;
}

/** The workspace's current HEAD, eight chars, or undefined when git cannot say. */
async function readWorkspaceHeadShort(workspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * FR-8: report the run as an `overdeck/verification` check run where the GitHub
 * App is installed. Non-fatal — the workspace artifact is the primary record.
 */
async function reportVerificationCheckRun(
  workspacePath: string,
  issueId: string,
  headShort: string | undefined,
  conclusion: 'success' | 'failure',
  title: string,
  summary: string,
  logPrefix: string,
): Promise<void> {
  try {
    const project = findProjectByPathSync(workspacePath);
    const repo = project?.github_repo;
    if (!repo || !repo.includes('/')) return;
    const [owner, name] = repo.split('/');
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 });
    const headSha = stdout.trim();
    if (!headSha) return;
    await postVerificationCheckRun({ owner: owner!, repo: name!, headSha, conclusion, title, summary });
  } catch (err: any) {
    console.warn(`[${logPrefix}] Could not post the verification check run for ${issueId}${headShort ? ` (${headShort})` : ''}: ${err?.message ?? err}`);
  }
}

async function runVerificationForIssuePromise(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: VerificationRunnerOptions = {},
): Promise<VerificationRunnerOutcome> {
  const mergedOutcome = await skipMergedVerification(issueId, logPrefix);
  if (mergedOutcome) return mergedOutcome;

  // PAN-3917: how many failed runs are already recorded against this exact
  // HEAD. A new commit resets the breaker by construction.
  const headShort = await readWorkspaceHeadShort(workspacePath);
  const cycles = readVerificationCycleState(workspacePath, headShort);
  const currentCycles = cycles.cycleCount;

  if (currentCycles >= VERIFICATION_MAX_CYCLES) {
    const reason = `Circuit breaker: ${currentCycles}/${VERIFICATION_MAX_CYCLES} cycles exceeded on this commit — skipping verification`;
    console.log(`[${logPrefix}] ${reason} for ${issueId}`);
    return { outcome: 'skipped', reason };
  }

  // PAN-3847 (FR-11): the run timestamp is captured once here and names the
  // immutable per-run artifact written when the run terminates.
  const runStartedAt = new Date().toISOString();
  console.log(`[${logPrefix}] Running verification gate for ${issueId} (attempt ${currentCycles + 1}/${VERIFICATION_MAX_CYCLES})`);

  try {
    const projectConfig = findProjectByPathSync(workspacePath);
    const repoRoots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);
    const isPolyrepo = repoRoots.some(root => root.isPolyrepo);

    // PAN-3906: the head a test-skip waiver is pinned to. Snapshotted BEFORE the
    // sync below, which merges `origin/<target>` in and moves HEAD — that would
    // expire a waiver the operator just recorded. The gate diff is three-dot.
    const testSkipHead = await snapshotWorkspaceHeadsPromise(issueId, workspacePath);

    // === Sync target branch ===
    if (options.syncTargetBranch !== false) {
      if (repoRoots.length === 0) {
        console.log(`[${logPrefix}] No git directories found in workspace ${workspacePath} — skipping sync`);
      } else {
        const syncResults: SyncResult[] = [];
        for (const root of repoRoots) {
          const repoName = isPolyrepo ? root.repoKey : undefined;
          const displayName = repoName || basename(workspacePath);
          console.log(`[${logPrefix}] Syncing ${root.targetBranch} into ${displayName} for ${issueId}...`);
          syncResults.push(await syncSingleRepo(root.dir, root.targetBranch));
        }

        const postSyncMergedOutcome = await skipMergedVerification(issueId, logPrefix);
        if (postSyncMergedOutcome) return postSyncMergedOutcome;

        const failures = syncResults.filter(r => !r.success);

        if (failures.length > 0) {
          const newCycleCount = currentCycles + 1;
          const failedCheck = 'sync-target-branch';
          const { summary, feedbackBody } = buildSyncFailureFeedback(issueId, failures, isPolyrepo, newCycleCount);

          announceVerificationFailure(issueId, failedCheck, summary);

          if (shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)) {
            await escalateVerificationStuck(issueId, failedCheck, newCycleCount, summary, logPrefix);
          }

          try {
            const fileResult = await Effect.runPromise(writeFeedbackFile({
              issueId,
              workspacePath,
              specialist: 'verification-gate',
              outcome: 'failed',
              summary: `Sync FAILED${isPolyrepo ? ` in ${failures.length} repo(s)` : ''} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
              markdownBody: feedbackBody,
            }));
            if (fileResult.success) {
              const hasConflicts = failures.some(f => f.hasConflicts);
              const repoList = isPolyrepo ? failures.map(f => f.repoName).join(', ') : basename(workspacePath);
              const msg = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
                ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${failedCheck}${hasConflicts ? ' — merge conflicts' : ''} in ${repoList} after repeated attempts.\n\nMUST READ: ${fileResult.filePath}\n\nFix every reported failure, commit and push the corrections, then run pan done ${issueId} -c "<summary>" to reset verification and return the latest commit to the normal pipeline.`
                : `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck}${hasConflicts ? ' — merge conflicts' : ''} in ${repoList}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, fix the sync issues, commit and push every change, then request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
              await deliverVerificationFeedback(issueId, msg, {
                failedCheck,
                feedbackPath: fileResult.filePath,
              }, logPrefix);
            }
          } catch (feedbackErr: any) {
            console.error(`[${logPrefix}] Failed to write sync-target feedback for ${issueId}:`, feedbackErr);
          }

          return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
        }

        for (const result of syncResults) {
          const displayName = isPolyrepo ? result.repoName : basename(workspacePath);
          if (result.alreadyUpToDate) {
            console.log(`[${logPrefix}] ${displayName}: Already up to date with ${result.targetBranch}`);
          } else {
            console.log(`[${logPrefix}] ${displayName}: Merged latest ${result.targetBranch}`);
          }
        }
      }
    } else {
      console.log(`[${logPrefix}] Skipping target-branch sync for ${issueId}; verifying current workspace state`);
    }

    const postSyncMergedOutcome = await skipMergedVerification(issueId, logPrefix);
    if (postSyncMergedOutcome) return postSyncMergedOutcome;

    // Load project-specific gates or fall back to defaults
    const gates =
      projectConfig?.quality_gates && Object.keys(projectConfig.quality_gates).length > 0
        ? projectConfig.quality_gates
        : DEFAULT_GATES;
    console.log(`[${logPrefix}] Project: ${projectConfig?.name || 'NOT FOUND'}, gates: [${Object.keys(gates).join(', ')}], workspace: ${workspacePath}`);

    // Build template placeholders for container name resolution
    const featureFolder = basename(workspacePath);  // e.g., 'feature-min-574'
    const featureName = featureFolder.replace(/^feature-/, '');  // e.g., 'min-574'
    const projectPath = projectConfig?.path || dirname(dirname(workspacePath));
    const domain = projectConfig?.workspace?.dns?.domain || 'localhost';
    // PAN-666: the ref a changed-file-scoped gate diffs against. The gate already
    // merged this branch into the workspace above, so `origin/<target>` is the
    // pre-PR baseline; `vitest run --changed {{CHANGED_BASE}}` then runs only the
    // tests affected by the PR and ignores pre-existing failures elsewhere.
    const changedBase = `origin/${repoRoots[0]?.targetBranch ?? getSyncTargetBranch(workspacePath, projectConfig, undefined)}`;
    const placeholders: TemplatePlaceholders = {
      FEATURE_NAME: featureName,
      FEATURE_FOLDER: featureFolder,
      BRANCH_NAME: `feature/${featureName}`,
      COMPOSE_PROJECT: `${basename(projectPath)}-${featureFolder}`,
      DOMAIN: domain,
      PROJECT_NAME: basename(projectPath),
      PROJECT_PATH: projectPath,
      PROJECTS_DIR: dirname(projectPath),
      WORKSPACE_PATH: workspacePath,
      HOME: homedir(),
      CHANGED_BASE: changedBase,
    };

    // PAN-666 (AC#3): make changed-file scoping visible so humans know pre-existing
    // failures in unmodified files were not run and may be accumulating.
    if (Object.values(gates).some(g => g.command?.includes('CHANGED_BASE'))) {
      console.log(
        `[${logPrefix}] Test gate is scoped to files changed since ${changedBase} ` +
        `(PAN-666). Pre-existing failures in files this PR did not touch are NOT run — ` +
        `they may be accumulating as tech debt on the target branch.`,
      );
    }

    // Install dependencies for monorepo workspaces.
    // Polyrepo workspaces manage deps per-repo via quality gate commands or containers.
    if (!isPolyrepo) {
      const packageManager = projectConfig?.package_manager || 'npm';
      const installCmd = packageManager === 'bun' ? 'bun install' : `${packageManager} install`;
      try {
        console.log(`[${logPrefix}] Installing dependencies: ${installCmd}`);
        await execAsync(installCmd, { cwd: workspacePath, encoding: 'utf-8', timeout: 60000 });
      } catch (installErr: any) {
        console.warn(`[${logPrefix}] Dependency install warning: ${installErr.message}`);
      }

      // Build workspace packages (e.g., @overdeck/contracts) before running gates
      const workspacePackages = (projectConfig as any)?.workspace_packages as Array<{ path: string; build_command: string }> | undefined;
      if (workspacePackages) {
        for (const pkg of workspacePackages) {
          const pkgPath = join(workspacePath, pkg.path);
          try {
            console.log(`[${logPrefix}] Building workspace package: ${pkg.path}`);
            await execAsync(pkg.build_command, { cwd: pkgPath, encoding: 'utf-8', timeout: 30000 });
          } catch (buildErr: any) {
            console.warn(`[${logPrefix}] Workspace package build warning (${pkg.path}): ${buildErr.message}`);
          }
        }
      }
    } else {
      console.log(`[${logPrefix}] Polyrepo workspace — per-repo dependencies managed by quality gates`);
    }

    // PAN-2665: write the artifact incrementally so the dashboard's Test/Lint
    // node shows gates completing live. Every write is best-effort — a failed
    // artifact write must never fail verification itself.
    const liveGateResults: import('./validation.js').QualityGateResult[] = [];
    let liveGateName: string | undefined;
    let liveGateTail = '';
    let lastTailWriteMs = 0;
    const writeLiveArtifact = () => {
      try {
        writeVerificationArtifact(workspacePath, issueId, liveGateResults, {
          currentGate: liveGateName,
          currentGateOutput: liveGateTail || undefined,
        });
      } catch { /* best-effort */ }
    };
    writeLiveArtifact();

    // PAN-3847 (FR-12): the test-skip gate runs before the quality gates — a diff
    // that adds skipped/only tests, or removes more test calls across the whole
    // diff than it adds (PAN-3906), fails verification as a required `test-skip`
    // gate without burning a full suite run. PR #3872 finding 4: a diff that
    // cannot be computed fails the gate too. Finding 6: the gate runs once per
    // repository root and violations aggregate, so a skipped test in a secondary
    // repo cannot slip past it.
    const testSkipStart = Date.now();
    const testSkip = await evaluateTestSkipGate(issueId, repoRoots, testSkipHead);

    const rawGateResults = !testSkip.failed
      ? await Effect.runPromise(runQualityGates(gates, workspacePath, 'pre_push', {
      issueId,
      isRemote: workspaceInfo.isRemote,
      vmName: workspaceInfo.vmName,
      placeholders,
      ...(options.onGateLog ? { onLog: options.onGateLog } : {}),
      onAdmissionPhase: (state) => markVerificationWorkerAdmissionPhase(issueId, state),
      onGateStart: (name) => {
        liveGateName = name;
        liveGateTail = '';
        writeLiveArtifact();
      },
      onGateOutput: (_name, chunk) => {
        // Rolling ANSI-stripped tail, flushed at most once per second so the
        // Test/Lint panel streams the running gate without hammering the disk.
        // eslint-disable-next-line no-control-regex
        liveGateTail = (liveGateTail + chunk.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')).slice(-4000);
        const now = Date.now();
        if (now - lastTailWriteMs >= 1000) {
          lastTailWriteMs = now;
          writeLiveArtifact();
        }
      },
      onGateResult: (result) => {
        liveGateResults.push(result);
        liveGateName = undefined;
        liveGateTail = '';
        writeLiveArtifact();
      },
    }))
      : [{ name: 'test-skip', passed: false, required: true, output: testSkip.evidence, durationMs: Date.now() - testSkipStart, error: testSkip.error ?? 'Diff adds skipped or only-tests or removes test cases' }];

    // PAN-3906: an operator override stays visible in the verification artifact
    // even though it let the gate pass.
    const gateResults = !testSkip.failed && testSkip.waiverApplied
      ? [{ name: 'test-skip', passed: true, required: true, output: testSkip.evidence, durationMs: Date.now() - testSkipStart }, ...rawGateResults]
      : rawGateResults;

    const postGateMergedOutcome = await skipMergedVerification(issueId, logPrefix);
    if (postGateMergedOutcome) return postGateMergedOutcome;

    const failedGate = gateResults.find(r => !r.passed && r.required !== false);

    // PAN-2461: an infra-unavailable gate (container/docker missing) is NOT a code
    // failure — it must not consume a verification attempt or pause the agent.
    // Trigger stack recovery and leave verification pending for the next cycle.
    if (failedGate?.infraUnavailable) {
      // Finalize the live artifact so the Test/Lint node doesn't stay stuck at
      // "running" — the infra gate's error explains what could not run.
      try {
        writeVerificationArtifact(workspacePath, issueId, gateResults);
      } catch { /* best-effort */ }
      console.warn(`[${logPrefix}] Gate "${failedGate.name}" could not run for ${issueId}: ${failedGate.error} — triggering workspace stack rebuild, attempt NOT counted (${currentCycles}/${VERIFICATION_MAX_CYCLES} used)`);
      announceVerificationFailure(
        issueId,
        failedGate.name,
        `Verification deferred: ${failedGate.error}. Workspace stack rebuild triggered; verification re-runs on the next cycle.`,
      );
      try {
        const { rebuildWorkspaceStack } = await import('../workspace/rebuild-stack.js');
        const rebuildResult = await Effect.runPromise(rebuildWorkspaceStack(issueId, {
          onProgress: (m) => console.log(`[${logPrefix}] ${issueId} stack rebuild: ${m}`),
        }));
        if (!rebuildResult.success) {
          console.warn(`[${logPrefix}] Stack rebuild for ${issueId} failed: ${rebuildResult.error}`);
        }
      } catch (err) {
        console.warn(`[${logPrefix}] Could not settle stack rebuild for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { outcome: 'failed', failedCheck: failedGate.name, cycleCount: currentCycles, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    // Durable terminal record of this gate run, surfaced by the issue tree's
    // Test/Lint node (replaces the incremental 'running' writes above).
    // PAN-3847 (FR-11): also written to an immutable per-run file named by run
    // time and head, so feedback references a path later runs cannot overwrite.
    let head8: string | undefined;
    try {
      const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 });
      head8 = stdout.trim() || undefined;
    } catch { /* non-fatal — fall back to the latest-only write */ }
    let runArtifactPath: string | undefined;
    try {
      const finalArtifact = writeVerificationArtifact(workspacePath, issueId, gateResults, {
        ranAt: runStartedAt,
        ...(head8 ? { head8 } : {}),
      });
      runArtifactPath = finalArtifact.path;
    } catch (artifactErr: any) {
      console.warn(`[${logPrefix}] Could not write verification artifact for ${issueId}: ${artifactErr.message}`);
    }

    if (failedGate) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = failedGate.name;
      const fullOutputPath = runArtifactPath ?? verificationArtifactPath(workspacePath);
      const summary = `Verification FAILED at ${failedCheck} (${failedGate.durationMs}ms).\n\nFull gate output: ${fullOutputPath}`;

      announceVerificationFailure(issueId, failedCheck, summary);
      await reportVerificationCheckRun(workspacePath, issueId, headShort, 'failure', `verification failed at ${failedCheck}`, summary, logPrefix);

      const shouldEscalate = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount);

      if (shouldEscalate) {
        await escalateVerificationStuck(issueId, failedCheck, newCycleCount, summary, logPrefix);
      }

      const feedbackBody = shouldEscalate
        ? `VERIFICATION STUCK for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n${buildFinalFailureInstructions(issueId)}`
        : `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix the failing check, push, and request a new review\n\n1. Read the complete gate output at \`${fullOutputPath}\` carefully\n2. Fix the code causing the failure\n3. Run the failing check locally to verify it passes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task. Because verification already ran once (a PR exists), the skill will push your branch and run \`pan review request ${issueId} -m "Fixed ${failedCheck}"\` for you. NEVER curl \`/api/review/...\` or any dashboard endpoint — \`pan review request\` is the only supported re-entry point.\n\nThe command can run for several minutes. A yielded exec result or background-terminal notice means it is still running, not that it succeeded. Poll the same terminal until it exits, inspect the real exit code, then confirm \`pan show ${issueId}\` or \`pan review pending\` shows the issue re-entered review. Do NOT stop between steps or after pushing; stop only after exit code 0 and the observed pipeline state change.`;

      try {
        const fileResult = await Effect.runPromise(writeFeedbackFile({
          issueId,
          workspacePath,
          specialist: 'verification-gate',
          outcome: 'failed',
          summary: `Verification FAILED at ${failedCheck} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
          markdownBody: feedbackBody,
        }));
        if (fileResult.success) {
          const msg = shouldEscalate
            ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${failedCheck} after repeated attempts.\n\nMUST READ: ${fileResult.filePath}\n\nFix every reported failure, commit and push the corrections, then run pan done ${issueId} -c "<summary>" to reset verification and return the latest commit to the normal pipeline.`
            : `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, fix the failing check, commit every change, and invoke /rebase-and-submit. The skill will push and request a new review with pan review request. If the exec yields to a background terminal, poll that same terminal until it exits; then require exit code 0 and confirm pan show ${issueId} or pan review pending shows re-entry before declaring success.`;
          await deliverVerificationFeedback(issueId, msg, {
            failedCheck,
            feedbackPath: fileResult.filePath,
          }, logPrefix);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    // xBRIEF AC gate: check all acceptance criteria are completed (runs after quality gates)
    // Wrap in try-catch to detect merge conflict markers in the xBRIEF document and send
    // actionable feedback rather than falling through to a generic infrastructure error.
    let acStatus: ReturnType<typeof getXBriefACStatusSync>;
    try {
      acStatus = getXBriefACStatusSync(workspacePath);
    } catch (xbriefErr: any) {
      if (xbriefErr instanceof XBriefMergeConflictError) {
        const newCycleCount = currentCycles + 1;
        const failedCheck = 'vbrief-conflicts';
        const summary = `xBRIEF spec has unresolved git merge conflict markers. Resolve all conflict markers in the spec file and commit before resubmitting.`;
        announceVerificationFailure(issueId, failedCheck, summary);
        if (shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)) {
          await escalateVerificationStuck(issueId, failedCheck, newCycleCount, summary, logPrefix);
        }
        const feedbackBody = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
          ? `VERIFICATION STUCK for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n${buildFinalFailureInstructions(issueId)}`
          : `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix merge conflicts in xBRIEF spec BEFORE resubmitting\n\n1. Open the xBRIEF spec (on main in .pan/specs/)\n2. Find and resolve all <<<<<<< HEAD / ======= / >>>>>>> conflict markers\n3. Ensure the file is valid JSON (only keep ONE version of each conflicted block)\n4. Commit the fixed file on main\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Resolved spec merge conflict"\n\nDo NOT resubmit until the spec parses cleanly.`;
        try {
          const fileResult = await Effect.runPromise(writeFeedbackFile({
            issueId,
            workspacePath,
            specialist: 'verification-gate',
            outcome: 'failed',
            summary: `xBRIEF plan has merge conflicts (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
            markdownBody: feedbackBody,
          }));
          if (fileResult.success) {
            const msg = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
              ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${failedCheck} after repeated attempts.\n\nMUST READ: ${fileResult.filePath}\n\nFix every reported failure, commit and push the corrections, then run pan done ${issueId} -c "<summary>" to reset verification and return the latest commit to the normal pipeline.`
              : `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — the xBRIEF document has merge conflict markers.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, resolve the merge conflict markers, commit and push the fix, then request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
            await deliverVerificationFeedback(issueId, msg, {
              failedCheck,
              feedbackPath: fileResult.filePath,
            }, logPrefix);
          }
        } catch (feedbackErr: any) {
          console.error(`[${logPrefix}] Failed to write xBRIEF conflict feedback for ${issueId}:`, feedbackErr);
        }
        return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
      }
      throw xbriefErr;
    }
    if (acStatus && !acStatus.allCompleted) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = 'vbrief-ac';
      const incompleteList = acStatus.items
        .filter(i => i.pending > 0)
        .map(i => {
          const pendingAC = i.criteria
            .filter(ac => ac.status !== 'completed' && ac.status !== 'cancelled')
            .map(ac => `  - [ ] ${ac.title}`)
            .join('\n');
          return `### ${i.itemTitle} (${i.pending}/${i.total} incomplete)\n${pendingAC}`;
        })
        .join('\n\n');
      const summary = `Acceptance criteria check FAILED — ${acStatus.totalPending}/${acStatus.totalCount} AC incomplete:\n\n${incompleteList}`;

      announceVerificationFailure(issueId, failedCheck, summary);
      if (shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)) {
        await escalateVerificationStuck(issueId, failedCheck, newCycleCount, summary, logPrefix);
      }

      const feedbackBody = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
        ? `VERIFICATION STUCK for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n${buildFinalFailureInstructions(issueId)}`
        : `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Complete all acceptance criteria BEFORE resubmitting\n\n1. Review the incomplete AC above\n2. Implement the missing requirements and write tests\n3. Close every completed task with \`pan task close\` — the canonical writer publishes the close and AC statuses sync automatically; never hand-edit spec files\n4. Commit and push ALL changes\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Completed acceptance criteria"\n\nDo NOT resubmit until all AC are completed.`;

      try {
        const fileResult = await Effect.runPromise(writeFeedbackFile({
          issueId,
          workspacePath,
          specialist: 'verification-gate',
          outcome: 'failed',
          summary: `AC check FAILED — ${acStatus.totalPending}/${acStatus.totalCount} incomplete (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
          markdownBody: feedbackBody,
        }));
        if (fileResult.success) {
          const msg = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
            ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${failedCheck} after repeated attempts.\n\nMUST READ: ${fileResult.filePath}\n\nFix every reported failure, commit and push the corrections, then run pan done ${issueId} -c "<summary>" to reset verification and return the latest commit to the normal pipeline.`
            : `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — ${acStatus.totalPending} AC incomplete.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, complete all pending acceptance criteria, commit and push every change, then request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
          await deliverVerificationFeedback(issueId, msg, {
            failedCheck,
            feedbackPath: fileResult.filePath,
          }, logPrefix);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write AC verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    const taskBlockers = options.skipPlanChecklist
      ? []
      : await checkIncompletePlanItemsPromise(workspacePath, issueId);
    const postChecklistMergedOutcome = await skipMergedVerification(issueId, logPrefix);
    if (postChecklistMergedOutcome) return postChecklistMergedOutcome;

    if (taskBlockers.length > 0) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = 'incomplete-plan-items';
      const itemIds = taskBlockers
        .map((line) => line.match(/^\s+-\s+(\S+)/)?.[1])
        .filter((id): id is string => Boolean(id));
      const summary = `Checklist completion check FAILED — ${itemIds.length} incomplete item(s) remain:\n\n${taskBlockers.join('\n')}`;

      announceVerificationFailure(issueId, failedCheck, summary);
      if (shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)) {
        await escalateVerificationStuck(issueId, failedCheck, newCycleCount, summary, logPrefix);
      }

      const feedbackBody = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
        ? `VERIFICATION STUCK for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n${buildFinalFailureInstructions(issueId)}`
        : `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\nComplete each listed item with \`pan task done ${issueId} <item>\` after committing and pushing its implementation, then resubmit the review request.`;

      try {
        const fileResult = await Effect.runPromise(writeFeedbackFile({
          issueId,
          workspacePath,
          specialist: 'verification-gate',
          outcome: 'failed',
          summary: `Checklist completion check FAILED — ${itemIds.length} incomplete item(s) remain (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
          markdownBody: feedbackBody,
        }));
        if (fileResult.success) {
          const msg = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
            ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${failedCheck} after repeated attempts.\n\nMUST READ: ${fileResult.filePath}\n\nFix every reported failure, commit and push the corrections, then run pan done ${issueId} -c "<summary>" to reset verification and return the latest commit to the normal pipeline.`
            : `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — ${itemIds.length} incomplete item(s) remain.\n\nMUST READ: ${fileResult.filePath}\n\nRead the file, complete every listed item with pan task after committing and pushing, then request a new review with pan review request.`;
          await deliverVerificationFeedback(issueId, msg, {
            failedCheck,
            feedbackPath: fileResult.filePath,
          }, logPrefix);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write open-task verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    // PAN-2179: reject a plan-only / zombie changeset before it can reach
    // review/merge. A work agent that never got its kickoff (or did nothing)
    // leaves a branch whose only changes are pipeline artifacts (.pan/xBRIEF task state);
    // lint/test/build and the AC gate all pass trivially on no code, so without
    // this guard the empty "completion" silently advances. Bounce it back.
    const changesetHasContent = await workspaceChangesetHasContent(issueId, workspacePath);
    const postDiffMergedOutcome = await skipMergedVerification(issueId, logPrefix);
    if (postDiffMergedOutcome) return postDiffMergedOutcome;

    if (changesetHasContent === false) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = 'empty-changeset';
      const comparedTargets = repoRoots.map(root => `${root.repoKey}:origin/${root.targetBranch}`).join(', ');
      const summary = `Branch has no implementation — only pipeline artifacts (.pan/xBRIEF task state) changed across workspace repos vs ${comparedTargets}. The work agent produced no code (likely a kickoff-delivery zombie — PAN-2179).`;
      announceVerificationFailure(issueId, failedCheck, summary);
      if (shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)) {
        await escalateVerificationStuck(issueId, failedCheck, newCycleCount, summary, logPrefix);
      }
      try {
        const msg = shouldEscalateVerificationFailure(cycles, failedCheck, newCycleCount)
          ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${failedCheck} after ${newCycleCount}/${VERIFICATION_MAX_CYCLES} attempts — branch still has no implementation.\n\n${buildFinalFailureInstructions(issueId)}`
          : `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — your branch contains NO code (only .pan/xBRIEF task state changed across ${comparedTargets}).\n\nYou must actually implement the issue: read the plan (.pan/spec.vbrief.json + the issue body), write and commit the code, push, then run pan review request. Do NOT stop at the prompt — keep working until pan review request completes.`;
        await deliverVerificationFeedback(issueId, msg, {
          failedCheck,
          changedBase: comparedTargets,
        }, logPrefix);
        console.error(`[${logPrefix}] VERIFICATION FAILED for ${issueId}: empty-changeset (no content files across ${comparedTargets})`);
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to send empty-changeset feedback for ${issueId}:`, feedbackErr);
      }
      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }
    if (changesetHasContent === undefined) {
      console.warn(`[${logPrefix}] empty-changeset guard skipped (one or more repo diffs failed)`);
    }

    // Snapshot HEAD at verification pass time — compared with reviewedAtCommit
    // after review to skip redundant test-agent when no code changed.
    // PAN-2948: polyrepo-aware — the wrapper repo's HEAD never changes, so
    // snapshotting it would make this comparison report "no drift" forever.
    let lastVerifiedCommit: HeadAnchor | undefined;
    try {
      const { snapshotWorkspaceHeadsPromise } = await import('../git-utils.js');
      lastVerifiedCommit = await snapshotWorkspaceHeadsPromise(issueId, workspacePath);
    } catch { /* non-fatal — skip optimization if we can't get HEAD */ }

    const prePassMergedOutcome = await skipMergedVerification(issueId, logPrefix);
    if (prePassMergedOutcome) return prePassMergedOutcome;

    await reportVerificationCheckRun(workspacePath, issueId, headShort, 'success', 'verification gate passed', 'Every required gate passed (changed-file scope).', logPrefix);
    // PAN-3847 (FR-10), re-pointed by PAN-3917: a verification pass lifts the
    // pause escalateVerificationStuck set. There is no stuck flag left to clear
    // — the pause IS the state, and the gate that set it clears it.
    const stuckAgentId = `agent-${issueId.toLowerCase()}`;
    const agentState = getAgentStateSync(stuckAgentId);
    if (agentState?.pausedReason?.startsWith('needs-you: verification stuck')) {
      try {
        await Effect.runPromise(clearAgentPaused(stuckAgentId));
        console.log(`[${logPrefix}] Lifted verification-stuck pause for ${stuckAgentId}`);
      } catch (err: any) {
        console.error(`[${logPrefix}] Failed to lift verification-stuck pause for ${stuckAgentId}: ${err?.message ?? err}`);
      }
    }
    void capturePipelineStageForIssue(issueId, 'verification_passed');
    console.log(`[${logPrefix}] Verification passed for ${issueId}${lastVerifiedCommit ? ` (HEAD=${lastVerifiedCommit.slice(0, 8)})` : ''} — proceeding to review-agent`);

    // Post overdeck/test=success for branch protection's required context
    // (Decision 7). PAN-3847: the stamp binds to the anchor snapshotted at pass
    // time (the primary repo's sha for a composite polyrepo anchor), and the
    // description says changed-file scope so nobody reads it as a full-suite
    // proof. Non-fatal on failure.
    void (async () => {
      try {
        const project = findProjectByPathSync(workspacePath);
        const repo = project?.github_repo;
        if (!repo || !repo.includes('/')) return;
        const [owner, name] = repo.split('/');
        const { postOverdeckTestsStatus } = await import('../github-app.js');
        const stampSha = (() => {
          if (!lastVerifiedCommit) return undefined;
          const composite = parseCompositeSnapshot(lastVerifiedCommit);
          if (composite.size === 0) return lastVerifiedCommit as string;
          const primary = repoRoots[0]?.repoKey;
          return (primary && composite.get(primary)) ?? [...composite.values()][0];
        })();
        await postOverdeckTestsStatus(workspacePath, owner!, name!, 'success', 'Verification gate passed (changed-file scope)', stampSha);
      } catch (err: any) {
        console.warn(`[${logPrefix}] Failed to post overdeck/tests status: ${err.message}`);
      }
    })();
    return { outcome: 'passed' };

  } catch (verifyErr: any) {
    const errorMergedOutcome = await skipMergedVerification(issueId, logPrefix);
    if (errorMergedOutcome) return errorMergedOutcome;

    announceVerificationFailure(issueId, 'infrastructure', `Verification infrastructure error: ${verifyErr.message}`);
    console.error(`[${logPrefix}] Verification infrastructure error for ${issueId}:`, verifyErr);
    return { outcome: 'error', message: verifyErr.message };
  }
}

// ─── PAN-1249: additive Effect variant ────────────────────────────────────────

/**
 * Effect-typed variant of {@link runVerificationForIssue}.
 *
 * Always succeeds — the legacy Promise already collapses every failure mode
 * into a discriminated `VerificationRunnerOutcome` union (`{ outcome: 'error' }`),
 * so the Effect error channel stays empty.
 */
export function runVerificationForIssue(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: VerificationRunnerOptions = {},
): Effect.Effect<VerificationRunnerOutcome> {
  return process.env.OVERDECK_VERIFICATION_WORKER === '1'
    ? runVerificationForIssueInProcess(issueId, workspacePath, workspaceInfo, logPrefix, options)
    : Effect.promise(() => runSupervisedVerification(issueId, workspacePath, workspaceInfo, logPrefix, options));
}

export function runVerificationForIssueInProcess(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: VerificationRunnerOptions = {},
): Effect.Effect<VerificationRunnerOutcome> {
  return Effect.promise(() => runVerificationForIssuePromise(issueId, workspacePath, workspaceInfo, logPrefix, options));
}
