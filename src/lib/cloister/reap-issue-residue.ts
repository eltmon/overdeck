import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { isBranchMerged } from '../close-out.js';
import { AGENTS_DIR } from '../paths.js';
import { killSession, listSessionNames } from '../tmux.js';

const execAsync = promisify(exec);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function reapIssueResidue(projectPath: string, issueId: string): Promise<string[]> {
  const actions: string[] = [];
  const issueLower = issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  try {
    const sessions = await Effect.runPromise(listSessionNames());
    const exactSessions = new Set([
      `agent-${issueLower}`,
      `test-${issueLower}`,
      `merge-${issueLower}`,
    ]);
    const reviewRegex = new RegExp(`^review-${escapeRegex(issueLower)}-\\d+`);
    for (const session of sessions) {
      if (!exactSessions.has(session) && !reviewRegex.test(session)) continue;
      try {
        await Effect.runPromise(killSession(session));
        actions.push(`killed tmux session ${session}`);
      } catch {
        // Session may already be gone.
      }
    }
  } catch {
    // tmux server may not be running.
  }

  const merged = await isBranchMerged(branchName, projectPath);
  if (merged.status === 'unmerged') {
    actions.push(`skipped reap for ${issueId} — branch unmerged`);
    return actions;
  }

  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  if (existsSync(workspacePath)) {
    try {
      await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectPath });
      actions.push(`removed workspace ${workspacePath}`);
    } catch {
      try {
        rmSync(workspacePath, { recursive: true, force: true });
        actions.push(`removed workspace ${workspacePath}`);
      } catch {
        // Already gone or inaccessible.
      }
    }
  }

  try {
    await execAsync(`git branch -D "${branchName}"`, { cwd: projectPath });
    actions.push(`deleted local branch ${branchName}`);
  } catch {
    // Branch may not exist locally.
  }

  try {
    await execAsync(`git push origin --delete "${branchName}"`, { cwd: projectPath });
    actions.push(`deleted remote branch ${branchName}`);
  } catch {
    // Branch may not exist remotely.
  }

  for (const agentDirName of [`agent-${issueLower}`, `planning-${issueLower}`]) {
    const agentDir = join(AGENTS_DIR, agentDirName);
    if (!existsSync(agentDir)) continue;
    try {
      rmSync(agentDir, { recursive: true, force: true });
      actions.push(`removed agent state ${agentDirName}`);
    } catch {
      // Already gone or inaccessible.
    }
  }

  return actions;
}
