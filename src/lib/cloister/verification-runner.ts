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
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { promisify } from 'util';
import { Effect } from 'effect';
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import { runQualityGates, DEFAULT_GATES } from './validation.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { messageAgent } from '../agents.js';
import { findProjectByPathSync } from '../projects.js';
import { getVBriefACStatusSync } from '../vbrief/beads.js';
import { VBriefMergeConflictError } from '../vbrief/io.js';
import type { TemplatePlaceholders } from '../workspace-config.js';

const execAsync = promisify(exec);

export const VERIFICATION_MAX_CYCLES = 10;

export type VerificationRunnerOutcome =
  | { outcome: 'passed' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; failedCheck: string; cycleCount: number; maxCycles: number }
  | { outcome: 'error'; message: string };

export interface WorkspaceInfo {
  isRemote: boolean;
  vmName?: string;
}

export interface VerificationRunnerOptions {
  syncTargetBranch?: boolean;
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

async function resolveGitDirs(
  workspacePath: string,
  projectConfig: ReturnType<typeof findProjectByPathSync>,
): Promise<{ gitDirs: string[]; isPolyrepo: boolean }> {
  const isPolyrepoConfig = projectConfig?.workspace?.type === 'polyrepo';

  if (!isPolyrepoConfig && existsSync(join(workspacePath, '.git'))) {
    return { gitDirs: [workspacePath], isPolyrepo: false };
  }

  const gitDirs: string[] = [];
  try {
    const entries = await readdir(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(workspacePath, entry.name, '.git'))) {
        gitDirs.push(join(workspacePath, entry.name));
      }
    }
  } catch {}

  if (gitDirs.length > 0) {
    return { gitDirs, isPolyrepo: true };
  }

  if (existsSync(join(workspacePath, '.git'))) {
    return { gitDirs: [workspacePath], isPolyrepo: false };
  }

  return { gitDirs: [], isPolyrepo: false };
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

  const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${cycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: sync-target-branch\n\n${summary}\n\n## REQUIRED: ${hasConflicts ? 'Resolve merge conflicts' : 'Fix the sync failure'} BEFORE resubmitting\n\n${isPolyrepo ? 'This is a polyrepo workspace. Fix each failing repo individually:\n\n' : ''}${repoInstructions}\n\nAfter fixing:\n1. Run the project's build and tests\n2. Commit and push ALL changes\n3. ONLY THEN resubmit: pan review request ${issueId} -m "Fixed sync-target-branch"\n\nDo NOT resubmit until all repos sync cleanly and tests pass.`;

  return { summary, feedbackBody };
}

function getSyncTargetBranch(
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
}async function runVerificationForIssuePromise(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: VerificationRunnerOptions = {},
): Promise<VerificationRunnerOutcome> {
  const currentCycles = getReviewStatusSync(issueId)?.verificationCycleCount ?? 0;

  if (currentCycles >= VERIFICATION_MAX_CYCLES) {
    const reason = `Circuit breaker: ${currentCycles}/${VERIFICATION_MAX_CYCLES} cycles exceeded — skipping verification`;
    console.log(`[${logPrefix}] ${reason} for ${issueId}`);
    setReviewStatusSync(issueId, { verificationStatus: 'skipped' });
    return { outcome: 'skipped', reason };
  }

  setReviewStatusSync(issueId, { verificationStatus: 'running' });
  console.log(`[${logPrefix}] Running verification gate for ${issueId} (attempt ${currentCycles + 1}/${VERIFICATION_MAX_CYCLES})`);

  try {
    const projectConfig = findProjectByPathSync(workspacePath);
    const { gitDirs, isPolyrepo } = await resolveGitDirs(workspacePath, projectConfig);

    // === Sync target branch ===
    if (options.syncTargetBranch !== false) {
      if (gitDirs.length === 0) {
        console.log(`[${logPrefix}] No git directories found in workspace ${workspacePath} — skipping sync`);
      } else {
        const syncResults: SyncResult[] = [];
        for (const gitDir of gitDirs) {
          const repoName = isPolyrepo ? basename(gitDir) : undefined;
          const targetBranch = getSyncTargetBranch(workspacePath, projectConfig, repoName);
          const displayName = repoName || basename(workspacePath);
          console.log(`[${logPrefix}] Syncing ${targetBranch} into ${displayName} for ${issueId}...`);
          syncResults.push(await syncSingleRepo(gitDir, targetBranch));
        }

        const failures = syncResults.filter(r => !r.success);

        if (failures.length > 0) {
          const newCycleCount = currentCycles + 1;
          const failedCheck = 'sync-target-branch';
          const { summary, feedbackBody } = buildSyncFailureFeedback(issueId, failures, isPolyrepo, newCycleCount);

          setReviewStatusSync(issueId, {
            reviewStatus: 'pending',
            verificationStatus: 'failed',
            verificationNotes: summary,
            verificationCycleCount: newCycleCount,
            verificationMaxCycles: VERIFICATION_MAX_CYCLES,
          });

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
              const agentId = `agent-${issueId.toLowerCase()}`;
              const hasConflicts = failures.some(f => f.hasConflicts);
              const repoList = isPolyrepo ? failures.map(f => f.repoName).join(', ') : basename(workspacePath);
              const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck}${hasConflicts ? ' — merge conflicts' : ''} in ${repoList}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, fix the sync issues, commit and push every change, then request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
              await messageAgent(agentId, msg);
              console.log(`[${logPrefix}] Sync failed for ${issueId} — sent feedback to ${agentId}`);
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
    };

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

      // Build workspace packages (e.g., @panctl/contracts) before running gates
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

    const gateResults = await Effect.runPromise(runQualityGates(gates, workspacePath, 'pre_push', {
      isRemote: workspaceInfo.isRemote,
      vmName: workspaceInfo.vmName,
      placeholders,
    }));

    const failedGate = gateResults.find(r => !r.passed && r.required !== false);

    if (failedGate) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = failedGate.name;
      const rawOutput = failedGate.output || failedGate.error || '(no output)';
      const truncatedOutput =
        rawOutput.length > 3000 ? rawOutput.slice(0, 3000) + '\n...(truncated)' : rawOutput;
      const summary = `Verification FAILED at ${failedCheck} (${failedGate.durationMs}ms):\n\n${truncatedOutput}`;

      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        verificationStatus: 'failed',
        verificationNotes: summary,
        verificationCycleCount: newCycleCount,
        verificationMaxCycles: VERIFICATION_MAX_CYCLES,
      });

      const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix the failing check, push, and request a new review\n\n1. Read the error output above carefully\n2. Fix the code causing the failure\n3. Run the failing check locally to verify it passes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task. Because verification already ran once (a PR exists), the skill will push your branch and run \`pan review request ${issueId} -m "Fixed ${failedCheck}"\` for you. NEVER curl \`/api/review/...\` or any dashboard endpoint — \`pan review request\` is the only supported re-entry point.\n\nDo NOT stop between steps. Do NOT stop after pushing. Do NOT stop until \`pan review request\` has completed successfully.`;

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
          const agentId = `agent-${issueId.toLowerCase()}`;
          const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, fix the failing check, commit every change, and invoke /rebase-and-submit. The skill will push and request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
          await messageAgent(agentId, msg);
          console.log(`[${logPrefix}] Verification failed for ${issueId} — sent feedback to ${agentId}`);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    // vBRIEF AC gate: check all acceptance criteria are completed (runs after quality gates)
    // Wrap in try-catch to detect merge conflict markers in plan.vbrief.json and send
    // actionable feedback rather than falling through to a generic infrastructure error.
    let acStatus: ReturnType<typeof getVBriefACStatusSync>;
    try {
      acStatus = getVBriefACStatusSync(workspacePath);
    } catch (vbriefErr: any) {
      if (vbriefErr instanceof VBriefMergeConflictError) {
        const newCycleCount = currentCycles + 1;
        const failedCheck = 'vbrief-conflicts';
        const summary = `vBRIEF spec has unresolved git merge conflict markers. Resolve all conflict markers in the spec file and commit before resubmitting.`;
        setReviewStatusSync(issueId, {
          reviewStatus: 'pending',
          verificationStatus: 'failed',
          verificationNotes: summary,
          verificationCycleCount: newCycleCount,
          verificationMaxCycles: VERIFICATION_MAX_CYCLES,
        });
        const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix merge conflicts in vBRIEF spec BEFORE resubmitting\n\n1. Open the vBRIEF spec (on main in .pan/specs/)\n2. Find and resolve all <<<<<<< HEAD / ======= / >>>>>>> conflict markers\n3. Ensure the file is valid JSON (only keep ONE version of each conflicted block)\n4. Commit the fixed file on main\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Resolved spec merge conflict"\n\nDo NOT resubmit until the spec parses cleanly.`;
        try {
          const fileResult = await Effect.runPromise(writeFeedbackFile({
            issueId,
            workspacePath,
            specialist: 'verification-gate',
            outcome: 'failed',
            summary: `vBRIEF plan has merge conflicts (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
            markdownBody: feedbackBody,
          }));
          if (fileResult.success) {
            const agentId = `agent-${issueId.toLowerCase()}`;
            const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — plan.vbrief.json has merge conflict markers.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, resolve the merge conflict markers, commit and push the fix, then request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
            await messageAgent(agentId, msg);
            console.log(`[${logPrefix}] vBRIEF conflict detected for ${issueId} — sent feedback to ${agentId}`);
          }
        } catch (feedbackErr: any) {
          console.error(`[${logPrefix}] Failed to write vBRIEF conflict feedback for ${issueId}:`, feedbackErr);
        }
        return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
      }
      throw vbriefErr;
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

      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        verificationStatus: 'failed',
        verificationNotes: summary,
        verificationCycleCount: newCycleCount,
        verificationMaxCycles: VERIFICATION_MAX_CYCLES,
      });

      const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Complete all acceptance criteria BEFORE resubmitting\n\n1. Review the incomplete AC above\n2. Implement the missing requirements and write tests\n3. Update plan.vbrief.json subItem statuses to 'completed'\n4. Commit and push ALL changes\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Completed acceptance criteria"\n\nDo NOT resubmit until all AC are completed.`;

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
          const agentId = `agent-${issueId.toLowerCase()}`;
          const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — ${acStatus.totalPending} AC incomplete.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, complete all pending acceptance criteria, commit and push every change, then request a new review with pan review request. Do NOT stop at the prompt — keep working until pan review request completes successfully.`;
          await messageAgent(agentId, msg);
          console.log(`[${logPrefix}] AC verification failed for ${issueId} — sent feedback to ${agentId}`);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write AC verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    // Snapshot HEAD at verification pass time — compared with reviewedAtCommit
    // after review to skip redundant test-agent when no code changed.
    let lastVerifiedCommit: string | undefined;
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 });
      lastVerifiedCommit = stdout.trim();
    } catch { /* non-fatal — skip optimization if we can't get HEAD */ }

    setReviewStatusSync(issueId, {
      verificationStatus: 'passed',
      verificationNotes: undefined,
      ...(lastVerifiedCommit ? { lastVerifiedCommit } : {}),
    });
    console.log(`[${logPrefix}] Verification passed for ${issueId}${lastVerifiedCommit ? ` (HEAD=${lastVerifiedCommit.slice(0, 8)})` : ''} — proceeding to review-agent`);

    // Post panopticon/tests=success so the GitHub CI test job can self-skip
    // its redundant vitest run on this exact commit. Non-fatal on failure.
    void (async () => {
      try {
        const project = findProjectByPathSync(workspacePath);
        const repo = project?.github_repo;
        if (!repo || !repo.includes('/')) return;
        const [owner, name] = repo.split('/');
        const { postPanopticonTestsStatus } = await import('../github-app.js');
        await postPanopticonTestsStatus(workspacePath, owner!, name!, 'success', 'Verification gate passed');
      } catch (err: any) {
        console.warn(`[${logPrefix}] Failed to post panopticon/tests status: ${err.message}`);
      }
    })();
    return { outcome: 'passed' };

  } catch (verifyErr: any) {
    setReviewStatusSync(issueId, {
      reviewStatus: 'pending',
      verificationStatus: 'failed',
      verificationNotes: `Verification infrastructure error: ${verifyErr.message}`,
    });
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
  return Effect.promise(() => runVerificationForIssuePromise(issueId, workspacePath, workspaceInfo, logPrefix, options));
}
