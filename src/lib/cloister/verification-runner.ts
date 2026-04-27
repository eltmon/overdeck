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
import { getReviewStatus, setReviewStatus } from '../review-status.js';
import { runQualityGates, DEFAULT_GATES } from './validation.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { messageAgent } from '../agents.js';
import { findProjectByPath } from '../projects.js';
import { getVBriefACStatus } from '../vbrief/beads.js';
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

function getSyncTargetBranch(
  workspacePath: string,
  projectConfig: ReturnType<typeof findProjectByPath>
): string {
  if (!projectConfig) return 'main';

  const repoName = basename(workspacePath);
  const matchingRepo = projectConfig.workspace?.repos?.find(repo =>
    repo.name === repoName || basename(repo.path) === repoName
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
 * Run the full verification gate for an issue.
 *
 * Loads quality gates from projects.yaml for the workspace's project, falling
 * back to DEFAULT_GATES (typecheck, lint, test) when no config exists.
 * Handles circuit breaking, status updates, feedback writing, and agent messaging.
 * Returns a discriminated union so callers need no try/catch.
 */
export async function runVerificationForIssue(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: VerificationRunnerOptions = {},
): Promise<VerificationRunnerOutcome> {
  const currentCycles = getReviewStatus(issueId)?.verificationCycleCount ?? 0;

  if (currentCycles >= VERIFICATION_MAX_CYCLES) {
    const reason = `Circuit breaker: ${currentCycles}/${VERIFICATION_MAX_CYCLES} cycles exceeded — skipping verification`;
    console.log(`[${logPrefix}] ${reason} for ${issueId}`);
    setReviewStatus(issueId, { verificationStatus: 'skipped' });
    return { outcome: 'skipped', reason };
  }

  setReviewStatus(issueId, { verificationStatus: 'running' });
  console.log(`[${logPrefix}] Running verification gate for ${issueId} (attempt ${currentCycles + 1}/${VERIFICATION_MAX_CYCLES})`);

  try {
    const projectConfig = findProjectByPath(workspacePath);
    const syncTargetBranch = getSyncTargetBranch(workspacePath, projectConfig);

    if (options.syncTargetBranch !== false) {
      try {
        console.log(`[${logPrefix}] Syncing ${syncTargetBranch} into workspace for ${issueId}...`);
        await execAsync(`git fetch origin ${syncTargetBranch}`, { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 });
        const mergeResult = await execAsync(`git merge origin/${syncTargetBranch} --no-edit`, {
          cwd: workspacePath,
          encoding: 'utf-8',
          timeout: 60000,
        });
        const mergeOut = (mergeResult.stdout || '') + (mergeResult.stderr || '');
        if (mergeOut.includes('Already up to date') || mergeOut.includes('Already up-to-date')) {
          console.log(`[${logPrefix}] Already up to date with ${syncTargetBranch}`);
        } else {
          console.log(`[${logPrefix}] Merged latest ${syncTargetBranch} into workspace`);
        }
      } catch (mergeErr: any) {
        const mergeOut = (mergeErr.stdout || '') + (mergeErr.stderr || '');
        const hasConflicts = mergeOut.includes('CONFLICT') || mergeOut.includes('Merge conflict');

        if (hasConflicts) {
          // Abort the merge so the workspace is in a clean state for the agent
          try { await execAsync('git merge --abort', { cwd: workspacePath, encoding: 'utf-8' }); } catch {}

          // Extract conflicting file names from git output
          const conflictLines = mergeOut
            .split('\n')
            .filter((line: string) => line.startsWith('CONFLICT'))
            .map((line: string) => line.replace(/^CONFLICT \([^)]+\): /, '').replace(/Merge conflict in /, ''))
            .join('\n  - ');

          const newCycleCount = currentCycles + 1;
          const failedCheck = 'sync-target-branch';
          const summary = `Sync with ${syncTargetBranch} FAILED — merge conflicts detected:\n  - ${conflictLines}`;

          setReviewStatus(issueId, {
            reviewStatus: 'pending',
            verificationStatus: 'failed',
            verificationNotes: summary,
            verificationCycleCount: newCycleCount,
            verificationMaxCycles: VERIFICATION_MAX_CYCLES,
          });

          const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Resolve merge conflicts with ${syncTargetBranch} BEFORE resubmitting\n\nThe target branch advanced since you started working. Your branch has merge conflicts that must be resolved.\n\n1. Run: git fetch origin ${syncTargetBranch} && git merge origin/${syncTargetBranch}\n2. Resolve all conflicts in the listed files\n3. Run the project's build and tests to verify nothing broke\n4. Commit and push ALL changes\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Resolved ${syncTargetBranch} conflicts"\n\nDo NOT resubmit until all conflicts are resolved and tests pass.`;

          try {
            const fileResult = await writeFeedbackFile({
              issueId,
              workspacePath,
              specialist: 'verification-gate',
              outcome: 'failed',
              summary: `Sync with ${syncTargetBranch} FAILED — merge conflicts (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
              markdownBody: feedbackBody,
            });
            if (fileResult.success) {
              const agentId = `agent-${issueId.toLowerCase()}`;
              const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — merge conflicts with ${syncTargetBranch}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix the merge conflicts and re-run verification. Do NOT stop at the prompt — keep working until verification passes.`;
              await messageAgent(agentId, msg);
              console.log(`[${logPrefix}] Sync-target failed for ${issueId} — sent conflict feedback to ${agentId}`);
            }
          } catch (feedbackErr: any) {
            console.error(`[${logPrefix}] Failed to write sync-target feedback for ${issueId}:`, feedbackErr);
          }

          return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
        }

        const newCycleCount = currentCycles + 1;
        const failedCheck = 'sync-target-branch';
        const rawOutput = mergeOut || mergeErr.message || '(no output)';
        const truncatedOutput =
          rawOutput.length > 3000 ? rawOutput.slice(0, 3000) + '\n...(truncated)' : rawOutput;
        const summary = `Sync with ${syncTargetBranch} FAILED:\n\n${truncatedOutput}`;

        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          verificationStatus: 'failed',
          verificationNotes: summary,
          verificationCycleCount: newCycleCount,
          verificationMaxCycles: VERIFICATION_MAX_CYCLES,
        });

        const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix the ${syncTargetBranch} sync failure BEFORE resubmitting\n\nThe verification gate could not sync the latest ${syncTargetBranch} into your workspace.\n\n1. Read the error output above carefully\n2. Run: git fetch origin ${syncTargetBranch}\n3. Run: git merge origin/${syncTargetBranch}\n4. If git reports conflicts, resolve them and verify the merge succeeds cleanly\n5. Run the project's build and tests to verify nothing broke\n6. Commit and push ALL changes\n7. ONLY THEN resubmit: pan review request ${issueId} -m "Fixed ${failedCheck}"\n\nDo NOT resubmit until your branch syncs cleanly with ${syncTargetBranch} and tests pass.`;

        try {
          const fileResult = await writeFeedbackFile({
            issueId,
            workspacePath,
            specialist: 'verification-gate',
            outcome: 'failed',
            summary: `Sync with ${syncTargetBranch} FAILED (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
            markdownBody: feedbackBody,
          });
          if (fileResult.success) {
            const agentId = `agent-${issueId.toLowerCase()}`;
            const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — could not sync ${syncTargetBranch}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix the sync failure and re-run verification. Do NOT stop at the prompt — keep working until verification passes.`;
            await messageAgent(agentId, msg);
            console.log(`[${logPrefix}] Sync-target failed for ${issueId} — sent sync failure feedback to ${agentId}`);
          }
        } catch (feedbackErr: any) {
          console.error(`[${logPrefix}] Failed to write sync-target feedback for ${issueId}:`, feedbackErr);
        }

        return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
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

    // Ensure dependencies are installed and workspace packages are built.
    // Worktrees need their own node_modules (not symlinked from main repo)
    // so that local workspace packages like @panctl/contracts resolve
    // to the worktree's version, not the main repo's stale build.
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

    const gateResults = await runQualityGates(gates, workspacePath, 'pre_push', {
      isRemote: workspaceInfo.isRemote,
      vmName: workspaceInfo.vmName,
      placeholders,
    });

    const failedGate = gateResults.find(r => !r.passed && r.required !== false);

    if (failedGate) {
      const newCycleCount = currentCycles + 1;
      const failedCheck = failedGate.name;
      const rawOutput = failedGate.output || failedGate.error || '(no output)';
      const truncatedOutput =
        rawOutput.length > 3000 ? rawOutput.slice(0, 3000) + '\n...(truncated)' : rawOutput;
      const summary = `Verification FAILED at ${failedCheck} (${failedGate.durationMs}ms):\n\n${truncatedOutput}`;

      setReviewStatus(issueId, {
        reviewStatus: 'pending',
        verificationStatus: 'failed',
        verificationNotes: summary,
        verificationCycleCount: newCycleCount,
        verificationMaxCycles: VERIFICATION_MAX_CYCLES,
      });

      const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill\n\n1. Read the error output above carefully\n2. Fix the code causing the failure\n3. Run the failing check locally to verify it passes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task. Because verification already ran once (a PR exists), the skill will run \`pan review request ${issueId} -m "Fixed ${failedCheck}"\` for you. NEVER curl \`/api/review/...\` or any dashboard endpoint — \`pan review request\` is the only supported re-entry point.\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until \`pan review request\` has completed successfully.`;

      try {
        const fileResult = await writeFeedbackFile({
          issueId,
          workspacePath,
          specialist: 'verification-gate',
          outcome: 'failed',
          summary: `Verification FAILED at ${failedCheck} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
          markdownBody: feedbackBody,
        });
        if (fileResult.success) {
          const agentId = `agent-${issueId.toLowerCase()}`;
          const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix the failing check and re-run verification. Do NOT stop at the prompt — keep working until verification passes.`;
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
    let acStatus: ReturnType<typeof getVBriefACStatus>;
    try {
      acStatus = getVBriefACStatus(workspacePath);
    } catch (vbriefErr: any) {
      if (vbriefErr instanceof VBriefMergeConflictError) {
        const newCycleCount = currentCycles + 1;
        const failedCheck = 'vbrief-conflicts';
        const summary = `plan.vbrief.json has unresolved git merge conflict markers. Resolve all conflict markers in .planning/plan.vbrief.json and commit before resubmitting.`;
        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          verificationStatus: 'failed',
          verificationNotes: summary,
          verificationCycleCount: newCycleCount,
          verificationMaxCycles: VERIFICATION_MAX_CYCLES,
        });
        const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Fix merge conflicts in plan.vbrief.json BEFORE resubmitting\n\n1. Open .planning/plan.vbrief.json\n2. Find and resolve all <<<<<<< HEAD / ======= / >>>>>>> conflict markers\n3. Ensure the file is valid JSON (only keep ONE version of each conflicted block)\n4. Commit the fixed file\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Resolved plan.vbrief.json merge conflict"\n\nDo NOT resubmit until plan.vbrief.json parses cleanly.`;
        try {
          const fileResult = await writeFeedbackFile({
            issueId,
            workspacePath,
            specialist: 'verification-gate',
            outcome: 'failed',
            summary: `vBRIEF plan has merge conflicts (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
            markdownBody: feedbackBody,
          });
          if (fileResult.success) {
            const agentId = `agent-${issueId.toLowerCase()}`;
            const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — plan.vbrief.json has merge conflict markers.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then resolve the merge conflict markers and re-run verification. Do NOT stop at the prompt — keep working until verification passes.`;
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

      setReviewStatus(issueId, {
        reviewStatus: 'pending',
        verificationStatus: 'failed',
        verificationNotes: summary,
        verificationCycleCount: newCycleCount,
        verificationMaxCycles: VERIFICATION_MAX_CYCLES,
      });

      const feedbackBody = `VERIFICATION FAILED for ${issueId} (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES}):\n\nFailed check: ${failedCheck}\n\n${summary}\n\n## REQUIRED: Complete all acceptance criteria BEFORE resubmitting\n\n1. Review the incomplete AC above\n2. Implement the missing requirements and write tests\n3. Update plan.vbrief.json subItem statuses to 'completed'\n4. Commit and push ALL changes\n5. ONLY THEN resubmit: pan review request ${issueId} -m "Completed acceptance criteria"\n\nDo NOT resubmit until all AC are completed.`;

      try {
        const fileResult = await writeFeedbackFile({
          issueId,
          workspacePath,
          specialist: 'verification-gate',
          outcome: 'failed',
          summary: `AC check FAILED — ${acStatus.totalPending}/${acStatus.totalCount} incomplete (attempt ${newCycleCount}/${VERIFICATION_MAX_CYCLES})`,
          markdownBody: feedbackBody,
        });
        if (fileResult.success) {
          const agentId = `agent-${issueId.toLowerCase()}`;
          const msg = `VERIFICATION FAILED for ${issueId}.\nFailed check: ${failedCheck} — ${acStatus.totalPending} AC incomplete.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then complete all pending acceptance criteria and re-run verification. Do NOT stop at the prompt — keep working until verification passes.`;
          await messageAgent(agentId, msg);
          console.log(`[${logPrefix}] AC verification failed for ${issueId} — sent feedback to ${agentId}`);
        }
      } catch (feedbackErr: any) {
        console.error(`[${logPrefix}] Failed to write AC verification feedback for ${issueId}:`, feedbackErr);
      }

      return { outcome: 'failed', failedCheck, cycleCount: newCycleCount, maxCycles: VERIFICATION_MAX_CYCLES };
    }

    setReviewStatus(issueId, { verificationStatus: 'passed', verificationNotes: undefined });
    console.log(`[${logPrefix}] Verification passed for ${issueId} — proceeding to review-agent`);
    return { outcome: 'passed' };

  } catch (verifyErr: any) {
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      verificationStatus: 'failed',
      verificationNotes: `Verification infrastructure error: ${verifyErr.message}`,
    });
    console.error(`[${logPrefix}] Verification infrastructure error for ${issueId}:`, verifyErr);
    return { outcome: 'error', message: verifyErr.message };
  }
}
