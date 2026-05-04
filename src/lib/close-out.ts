/**
 * Close-Out Ceremony — Human-gated verification and cleanup after merge.
 *
 * Verifies PRD is preserved, branch is merged, then archives workspace
 * artifacts, cleans up agent state, closes the issue on the tracker,
 * and applies a `closed-out` label.
 */

import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  PANOPTICON_HOME,
  ARCHIVES_DIR,
  AGENTS_DIR,
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from './paths.js';
import { findPrdAtStatus, canonicalPrdSubdir } from './prd-locations.js';
import { killSessionAsync, sessionExists, listSessionNamesAsync } from './tmux.js';
import { loadReviewStatuses } from './review-status.js';
import { getLinearApiKey } from './lifecycle/types.js';
import { extractNumber, extractPrefix, normalizeIssueId } from './issue-id.js';

const execAsync = promisify(exec);

/**
 * Check if a feature branch has been merged into main.
 *
 * Uses `git merge-base --is-ancestor` for regular merges, plus a
 * code-diff fallback to detect squash merges where the branch still exists.
 * Also checks review-status.json as authoritative — the merge specialist
 * validates the merge before setting mergeStatus to 'merged'.
 */
async function isBranchMerged(
  branchName: string,
  projectPath: string,
): Promise<{ status: 'merged' | 'unmerged' | 'no-branch'; message: string }> {
  // Check review-status first — the merge specialist validates before marking merged
  try {
    const issueId = branchName.replace('feature/', '').toUpperCase();
    const statuses = loadReviewStatuses();
    if (statuses[issueId]?.mergeStatus === 'merged') {
      return { status: 'merged', message: 'Merge specialist confirmed merge completed' };
    }
  } catch {
    // review-status.json may not exist, continue with git checks
  }

  // Check if branch exists locally
  const { stdout: branchExists } = await execAsync(
    `git branch --list "${branchName}" 2>/dev/null || true`,
    { cwd: projectPath, encoding: 'utf-8' },
  );

  if (branchExists.trim()) {
    // Use merge-base --is-ancestor: checks if the branch tip is reachable from main
    // This works for regular merges, squash merges, and cherry-picks
    try {
      await execAsync(
        `git merge-base --is-ancestor ${branchName} main`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      return { status: 'merged', message: 'All commits merged to main' };
    } catch {
      // --is-ancestor fails for squash merges where the branch still exists.
      // Check if the code diff (excluding planning artifacts) is empty — if so,
      // the code was squash-merged and only planning files remain on the branch.
      try {
        const { stdout: codeDiff } = await execAsync(
          `git diff main...${branchName} -- ':!.planning' ':!docs/prds' ':!.panopticon/prompts' 2>/dev/null || true`,
          { cwd: projectPath, encoding: 'utf-8' },
        );
        if (!codeDiff.trim()) {
          return { status: 'merged', message: 'Code changes squash-merged to main (only planning artifacts remain on branch)' };
        }
      } catch {
        // diff failed — fall through to unmerged report
      }

      const { stdout: unmerged } = await execAsync(
        `git log main..${branchName} --oneline 2>/dev/null || true`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      const count = unmerged.trim() ? unmerged.trim().split('\n').length : 0;
      return {
        status: 'unmerged',
        message: `${count} unmerged commit(s) on ${branchName}. Merge before closing out.`,
      };
    }
  }

  // Check remote
  const { stdout: remoteBranch } = await execAsync(
    `git ls-remote --heads origin "${branchName}" 2>/dev/null || true`,
    { cwd: projectPath, encoding: 'utf-8' },
  );

  if (remoteBranch.trim()) {
    await execAsync(`git fetch origin ${branchName}`, { cwd: projectPath }).catch(() => {});
    try {
      await execAsync(
        `git merge-base --is-ancestor origin/${branchName} main`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      return { status: 'merged', message: 'Remote branch fully merged' };
    } catch {
      // Squash-merge detection for remote branch
      try {
        const { stdout: codeDiff } = await execAsync(
          `git diff main...origin/${branchName} -- ':!.planning' ':!docs/prds' ':!.panopticon/prompts' 2>/dev/null || true`,
          { cwd: projectPath, encoding: 'utf-8' },
        );
        if (!codeDiff.trim()) {
          return { status: 'merged', message: 'Remote code changes squash-merged to main (only planning artifacts remain on branch)' };
        }
      } catch {
        // diff failed — fall through
      }

      const { stdout: remoteUnmerged } = await execAsync(
        `git log main..origin/${branchName} --oneline 2>/dev/null || true`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      const count = remoteUnmerged.trim() ? remoteUnmerged.trim().split('\n').length : 0;
      return {
        status: 'unmerged',
        message: `${count} unmerged commit(s) on remote ${branchName}.`,
      };
    }
  }

  // No branch at all — assume squash-merged and branch deleted
  return { status: 'no-branch', message: 'Branch already cleaned up (squash-merged)' };
}


export interface CloseOutStep {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
}

export interface CloseOutResult {
  success: boolean;
  issueId: string;
  steps: CloseOutStep[];
  error?: string;
}

export interface CloseOutContext {
  issueId: string;
  projectPath: string;
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
}

const CLOSED_OUT_LABEL = 'closed-out';
const CLOSED_OUT_COLOR = '1d4ed8';

/**
 * Execute the full close-out ceremony for a merged issue.
 */
export async function executeCloseOut(ctx: CloseOutContext): Promise<CloseOutResult> {
  const steps: CloseOutStep[] = [];
  const issueLower = ctx.issueId.toLowerCase();

  // Step 1: Verify PRD preserved.
  // Tolerates all four legacy formats (subdir/flat × lowercase/uppercase) via findPrdAtStatus.
  try {
    if (findPrdAtStatus(ctx.projectPath, ctx.issueId, 'completed')) {
      steps.push({ name: 'Verify PRD preserved', status: 'passed', message: 'PRD in completed/' });
    } else {
      const source = findPrdAtStatus(ctx.projectPath, ctx.issueId, 'active');
      if (!source) {
        steps.push({ name: 'Verify PRD preserved', status: 'skipped', message: 'No PRD found (may not have had one)' });
      } else {
        const completedSubdir = canonicalPrdSubdir(ctx.projectPath, ctx.issueId, 'completed');
        const completedFlat = join(
          ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
          PROJECT_PRDS_COMPLETED_SUBDIR, `${issueLower}-plan.md`,
        );
        const dest = source.format === 'subdir' ? completedSubdir : completedFlat;
        const destParent = dirname(dest);
        if (!existsSync(destParent)) {
          mkdirSync(destParent, { recursive: true });
        }
        try {
          await execAsync(`git mv "${source.path}" "${dest}"`, { cwd: ctx.projectPath });
          await execAsync(`git commit -m "Move ${ctx.issueId} PRD to completed (close-out)"`, { cwd: ctx.projectPath });
          await execAsync(`git push`, { cwd: ctx.projectPath });
          steps.push({ name: 'Verify PRD preserved', status: 'passed', message: 'Moved PRD from active/ to completed/' });
        } catch {
          try {
            cpSync(source.path, dest, { recursive: true });
            if (existsSync(dest)) {
              steps.push({ name: 'Verify PRD preserved', status: 'passed', message: 'Copied PRD to completed/ (git mv failed, plain copy succeeded)' });
            } else {
              steps.push({ name: 'Verify PRD preserved', status: 'failed', message: 'PRD copy appeared to succeed but file not found at destination' });
              return { success: false, issueId: ctx.issueId, steps, error: 'PRD preservation failed — file not at destination after copy' };
            }
          } catch (cpErr) {
            steps.push({ name: 'Verify PRD preserved', status: 'failed', message: `Failed to copy PRD: ${(cpErr as Error).message}` });
            return { success: false, issueId: ctx.issueId, steps, error: 'PRD preservation failed — both git mv and copy failed' };
          }
        }
      }
    }
  } catch (err) {
    steps.push({ name: 'Verify PRD preserved', status: 'skipped', message: `Warning: ${(err as Error).message}` });
  }

  // Step 2: Verify branch merged (hard fail)
  try {
    const branchName = `feature/${issueLower}`;
    const merged = await isBranchMerged(branchName, ctx.projectPath);

    if (merged.status === 'merged') {
      steps.push({ name: 'Verify branch merged', status: 'passed', message: merged.message });
    } else if (merged.status === 'no-branch') {
      steps.push({ name: 'Verify branch merged', status: 'passed', message: merged.message });
    } else {
      steps.push({
        name: 'Verify branch merged',
        status: 'failed',
        message: merged.message,
      });
      return { success: false, issueId: ctx.issueId, steps, error: merged.message };
    }
  } catch (err) {
    steps.push({
      name: 'Verify branch merged',
      status: 'failed',
      message: `Could not verify merge: ${(err as Error).message}`,
    });
    return { success: false, issueId: ctx.issueId, steps, error: 'Could not verify branch merge status' };
  }

  // Step 3: Archive workspace artifacts
  try {
    const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);

    if (workspacePath && existsSync(workspacePath)) {
      // If a previous archive exists, rotate it to a versioned name to prevent overwrite
      let archiveDir = join(ARCHIVES_DIR, issueLower);
      if (existsSync(archiveDir)) {
        let version = 1;
        while (existsSync(`${archiveDir}.${version}`)) {
          version++;
        }
        const rotatedDir = `${archiveDir}.${version}`;
        cpSync(archiveDir, rotatedDir, { recursive: true });
        rmSync(archiveDir, { recursive: true, force: true });
        steps.push({ name: 'Rotate previous archive', status: 'passed', message: `Previous archive preserved at ${rotatedDir}` });
      }

      mkdirSync(archiveDir, { recursive: true });

      // Archive .planning/feedback/
      const feedbackDir = join(workspacePath, '.planning', 'feedback');
      if (existsSync(feedbackDir)) {
        cpSync(feedbackDir, join(archiveDir, 'feedback'), { recursive: true });
      }

      // Archive the scope vBRIEF's continue file. We don't know which lifecycle
      // dir holds the active vBRIEF without project context, so we walk the
      // workspace's `.planning/` (where the agent staged a copy during planning)
      // and any sibling `vbrief/active/` dir found by walking up. We also
      // copy any continue-*.vbrief.json discovered in `.planning/`.
      const planningRoot = join(workspacePath, '.planning');
      if (existsSync(planningRoot)) {
        try {
          const { readdirSync } = await import('fs');
          for (const entry of readdirSync(planningRoot)) {
            if (entry.startsWith('continue-') && entry.endsWith('.vbrief.json')) {
              cpSync(join(planningRoot, entry), join(archiveDir, entry));
            }
          }
        } catch {
          // Best-effort archive — don't fail close-out if planning dir is unreadable.
        }
      }

      // Archive beads/
      const beadsDir = join(workspacePath, '.planning', 'beads');
      if (existsSync(beadsDir)) {
        cpSync(beadsDir, join(archiveDir, 'beads'), { recursive: true });
      }

      // Archive PRD.md (workspace copy — the docs/prds/ copy is canonical,
      // but this preserves the workspace-specific version with any agent annotations)
      const prdMd = join(workspacePath, '.planning', 'PRD.md');
      if (existsSync(prdMd)) {
        cpSync(prdMd, join(archiveDir, 'PRD.md'));
      }

      steps.push({ name: 'Archive workspace artifacts', status: 'passed', message: `Archived to ${archiveDir}` });
    } else {
      steps.push({ name: 'Archive workspace artifacts', status: 'skipped', message: 'No workspace found to archive' });
    }
  } catch (err) {
    // Archive failure should block workspace deletion — we'd rather leave the
    // workspace intact than destroy unarchived artifacts
    steps.push({ name: 'Archive workspace artifacts', status: 'failed', message: `Failed to archive: ${(err as Error).message}` });
    return { success: false, issueId: ctx.issueId, steps, error: 'Cannot proceed with cleanup — archiving failed' };
  }

  // Step 4: Clean up workspace
  try {
    const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);
    const agentSession = `agent-${issueLower}`;
    let cleaned = false;

    // Kill tmux sessions for this issue
    const exactPatterns = [agentSession, `test-${issueLower}`, `merge-${issueLower}`];
    for (const session of exactPatterns) {
      if (sessionExists(session)) {
        try {
          await killSessionAsync(session);
          cleaned = true;
        } catch { /* session may already be dead */ }
      }
    }

    // Review sessions use timestamped names: review-<issue>-<timestamp>-<role>
    try {
      const allSessions = await listSessionNamesAsync();
      const reviewRegex = new RegExp(`^review-${issueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+`);
      const reviewSessions = allSessions.filter(s => reviewRegex.test(s));
      for (const session of reviewSessions) {
        try {
          await killSessionAsync(session);
          cleaned = true;
        } catch { /* session may already be dead */ }
      }
    } catch { /* tmux server may not be running */ }

    // Stop Docker containers
    if (workspacePath && existsSync(workspacePath)) {
      try {
        const { stopWorkspaceDocker } = await import('./workspace-manager.js');
        const projectName = extractPrefix(ctx.issueId)?.toLowerCase() ?? ctx.issueId.toLowerCase();
        await stopWorkspaceDocker(workspacePath, projectName, issueLower);
        cleaned = true;
      } catch { /* Docker may not be running */ }

      // Remove git worktree
      try {
        await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: ctx.projectPath });
        cleaned = true;
      } catch {
        // Try direct removal if worktree remove fails
        try {
          rmSync(workspacePath, { recursive: true, force: true });
          cleaned = true;
        } catch { /* Already gone */ }
      }
    }

    // Delete local and remote feature branches (safe — we verified merge in step 2)
    const branchName = `feature/${issueLower}`;
    try {
      await execAsync(`git branch -D "${branchName}"`, { cwd: ctx.projectPath });
      cleaned = true;
    } catch { /* Branch may not exist locally */ }
    try {
      await execAsync(`git push origin --delete "${branchName}"`, { cwd: ctx.projectPath });
      cleaned = true;
    } catch { /* Branch may not exist on remote */ }

    steps.push({
      name: 'Clean up workspace',
      status: cleaned ? 'passed' : 'skipped',
      message: cleaned ? 'Workspace cleaned up' : 'No workspace to clean up',
    });
  } catch (err) {
    steps.push({ name: 'Clean up workspace', status: 'skipped', message: `Warning: ${(err as Error).message}` });
  }

  // Step 5: Clean up agent state
  try {
    let cleaned = false;
    const agentDir = join(AGENTS_DIR, `agent-${issueLower}`);
    const planningDir = join(AGENTS_DIR, `planning-${issueLower}`);

    if (existsSync(agentDir)) {
      rmSync(agentDir, { recursive: true, force: true });
      cleaned = true;
    }
    if (existsSync(planningDir)) {
      rmSync(planningDir, { recursive: true, force: true });
      cleaned = true;
    }

    steps.push({
      name: 'Clean up agent state',
      status: cleaned ? 'passed' : 'skipped',
      message: cleaned ? 'Agent state directories removed' : 'No agent state to clean up',
    });
  } catch (err) {
    steps.push({ name: 'Clean up agent state', status: 'skipped', message: `Warning: ${(err as Error).message}` });
  }

  // Step 6: Close issue on tracker (hard fail)
  try {
    if (ctx.isGitHub && ctx.owner && ctx.repo && ctx.number) {
      await execAsync(
        `gh issue close ${ctx.number} --repo ${ctx.owner}/${ctx.repo} --comment "Closed via close-out ceremony"`,
        { encoding: 'utf-8' }
      );
      steps.push({ name: 'Close issue on tracker', status: 'passed', message: `GitHub issue #${ctx.number} closed` });
    } else {
      // Linear issue
      const linearApiKey = getLinearApiKey();
      if (!linearApiKey) {
        steps.push({ name: 'Close issue on tracker', status: 'failed', message: 'LINEAR_API_KEY not configured' });
        return { success: false, issueId: ctx.issueId, steps, error: 'LINEAR_API_KEY not configured' };
      }

      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: linearApiKey });

      // Find the issue by identifier using issues filter (searchIssues returns
      // IssueSearchResult which lacks .update(); client.issue() needs the UUID)
      const issueNumber = extractNumber(ctx.issueId);
      const issuePrefix = extractPrefix(ctx.issueId);
      if (issueNumber === null || issuePrefix === null) {
        steps.push({ name: 'Close issue on tracker', status: 'failed', message: `Could not parse issue ID: ${ctx.issueId}` });
        return { success: false, issueId: ctx.issueId, steps, error: `Could not parse issue ID: ${ctx.issueId}` };
      }
      const results = await client.issues({
        filter: {
          number: { eq: issueNumber },
          team: { key: { eq: issuePrefix } },
        },
        first: 1,
      });
      if (results.nodes.length === 0) {
        steps.push({ name: 'Close issue on tracker', status: 'failed', message: `Issue ${ctx.issueId} not found in Linear` });
        return { success: false, issueId: ctx.issueId, steps, error: `Issue ${ctx.issueId} not found in Linear` };
      }

      const issue = results.nodes[0];
      const team = await issue.team;
      if (team) {
        const states = await team.states();
        const doneState = states.nodes.find(s => s.name === 'Done') ||
          states.nodes.find(s => s.type === 'completed');
        if (doneState) {
          await issue.update({ stateId: doneState.id });
        }
      }

      steps.push({ name: 'Close issue on tracker', status: 'passed', message: `Linear issue ${ctx.issueId} moved to Done` });
    }
  } catch (err) {
    steps.push({
      name: 'Close issue on tracker',
      status: 'failed',
      message: `Failed to close: ${(err as Error).message}`,
    });
    return { success: false, issueId: ctx.issueId, steps, error: `Failed to close issue: ${(err as Error).message}` };
  }

  // Step 7: Apply closed-out label
  try {
    if (ctx.isGitHub && ctx.owner && ctx.repo && ctx.number) {
      // Ensure the label exists
      await execAsync(
        `gh label create "${CLOSED_OUT_LABEL}" --repo ${ctx.owner}/${ctx.repo} --color "${CLOSED_OUT_COLOR}" --description "Verified and closed out" --force 2>/dev/null || true`,
        { encoding: 'utf-8' }
      );
      // Add the label
      await execAsync(
        `gh issue edit ${ctx.number} --repo ${ctx.owner}/${ctx.repo} --add-label "${CLOSED_OUT_LABEL}"`,
        { encoding: 'utf-8' }
      );
      // Remove workflow labels and migration label
      for (const label of ['in-progress', 'in-review', 'needs-close-out']) {
        await execAsync(
          `gh issue edit ${ctx.number} --repo ${ctx.owner}/${ctx.repo} --remove-label "${label}" 2>/dev/null || true`,
          { encoding: 'utf-8' }
        );
      }
      steps.push({ name: 'Apply closed-out label', status: 'passed', message: `Added '${CLOSED_OUT_LABEL}' label` });
    } else {
      // Linear: add label if possible
      try {
        const linearApiKey = getLinearApiKey();
        if (linearApiKey) {
          const { LinearClient } = await import('@linear/sdk');
          const client = new LinearClient({ apiKey: linearApiKey });
          const issueNum = extractNumber(ctx.issueId);
          const teamKey = extractPrefix(ctx.issueId);
          if (issueNum !== null && teamKey !== null) {
            const results = await client.issues({
              filter: {
                number: { eq: issueNum },
                team: { key: { eq: teamKey } },
              },
              first: 1,
            });
            if (results.nodes.length > 0) {
              const issue = results.nodes[0];
              // Find or create the closed-out label
              const labels = await client.issueLabels({ filter: { name: { eq: CLOSED_OUT_LABEL } } });
              let labelId: string;
              if (labels.nodes.length > 0) {
                labelId = labels.nodes[0].id;
              } else {
                const created = await client.createIssueLabel({ name: CLOSED_OUT_LABEL, color: `#${CLOSED_OUT_COLOR}` });
                const createdLabel = await created.issueLabel;
                labelId = createdLabel ? createdLabel.id : '';
              }
              if (labelId) {
                const existingLabels = await issue.labels();
                const labelIds = existingLabels.nodes.map(l => l.id);
                if (!labelIds.includes(labelId)) {
                  labelIds.push(labelId);
                  await issue.update({ labelIds });
                }
              }
            }
          }
        }
      } catch { /* Non-fatal for Linear */ }
      steps.push({ name: 'Apply closed-out label', status: 'passed', message: 'Label applied' });
    }
  } catch (err) {
    steps.push({ name: 'Apply closed-out label', status: 'skipped', message: `Warning: ${(err as Error).message}` });
  }

  // Step 8: Clear review status
  try {
    // Dynamically import to avoid circular dependency with server
    const { clearReviewStatus } = await import('./review-status.js');
    clearReviewStatus(ctx.issueId.toUpperCase());
    steps.push({ name: 'Clear review status', status: 'passed', message: 'Review status cleared' });
  } catch {
    // review-status module may not be available in CLI context
    // Try cleaning the file directly
    try {
      const statusFile = join(PANOPTICON_HOME, 'review-status.json');
      if (existsSync(statusFile)) {
        const data = JSON.parse(readFileSync(statusFile, 'utf-8'));
        const upperKey = ctx.issueId.toUpperCase();
        if (data[upperKey]) {
          delete data[upperKey];
          const { writeFileSync } = await import('fs');
          writeFileSync(statusFile, JSON.stringify(data, null, 2));
        }
      }
      steps.push({ name: 'Clear review status', status: 'passed', message: 'Review status cleared (direct)' });
    } catch (innerErr) {
      steps.push({ name: 'Clear review status', status: 'skipped', message: `Warning: ${(innerErr as Error).message}` });
    }
  }

  return { success: true, issueId: ctx.issueId, steps };
}

/**
 * Find the workspace path for an issue.
 */
function findWorkspacePath(projectPath: string, issueLower: string): string | null {
  const workspacePath = join(projectPath, 'workspaces', issueLower);
  if (existsSync(workspacePath)) return workspacePath;

  // Try worktree-based path
  const worktreePath = join(projectPath, '.worktrees', issueLower);
  if (existsSync(worktreePath)) return worktreePath;

  // Try feature branch naming convention
  const featurePath = join(dirname(projectPath), `feature-${issueLower}`);
  if (existsSync(featurePath)) return featurePath;

  return null;
}

