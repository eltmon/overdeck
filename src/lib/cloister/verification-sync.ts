/**
 * Verification sync helpers: the feedback a failed target-branch sync sends to
 * the work agent, and the branch a workspace syncs against. Extracted from
 * verification-runner.ts (PAN-4590) so the runner stays under its line cap.
 */

import { basename } from 'path';
import { buildFinalFailureInstructions } from './verification-feedback.js';
import { isFinalVerificationAttempt, VERIFICATION_MAX_CYCLES } from './verification-escalation.js';
import type { SyncResult } from './workspace-pr-head-sync.js';
import type { findProjectByPath } from '../projects.js';

export function buildSyncFailureFeedback(
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
  projectConfig: ReturnType<typeof findProjectByPath>,
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
