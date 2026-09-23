import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { isBranchMerged } from '../close-out.js';
import { AGENTS_DIR } from '../paths.js';
import { killSession, listSessionNames } from '../tmux.js';
import { teardownWorkspaceDockerByNamePromise } from '../workspace-manager/docker.js';
import { pruneAgentStateDir } from '../agents/state-dir-removal.js';
import { reapWorkerWorktrees } from '../workspaces/worker-worktrees.js';

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

  // PAN-3947: on a Herdr host the issue's agents live in panes stamped with its
  // `issue` token, not in named tmux sessions. No-op on a tmux host.
  try {
    const { closeIssuePanes } = await import('../terminal-backends/launch.js');
    for (const agentName of await closeIssuePanes(issueId)) {
      actions.push(`closed Herdr pane ${agentName}`);
    }
  } catch {
    // Backend unavailable — nothing more to close.
  }

  // Remove Docker stack by name, independent of whether the workspace dir still
  // exists — and independent of the merged check below. Containers and networks
  // are disposable runtime state (rebuildWorkspaceStack no-ops for terminal
  // issues), so tearing them down for a closed issue destroys no work, while
  // leaked `_devnet` networks eventually exhaust Docker's address pools.
  try {
    const teardownResult = await teardownWorkspaceDockerByNamePromise(issueLower);
    if (teardownResult.networkRemoved) {
      actions.push(`removed Docker stack for feature-${issueLower}`);
    } else {
      actions.push(`Docker network for feature-${issueLower} still present`);
    }
  } catch (err) {
    actions.push(`Docker teardown failed for ${issueId}: ${(err as Error).message}`);
  }

  // Destructive disk/branch cleanup stays gated on the merged check: a closed
  // but genuinely unmerged branch may hold work worth recovering.
  const merged = await isBranchMerged(branchName, projectPath);
  if (merged.status === 'unmerged') {
    actions.push(`skipped disk reap for ${issueId} — branch unmerged`);
    return actions;
  }

  // PAN-3920: registered workers' `.swarm/worker-<n>` worktrees and their
  // `<feature>-worker-<n>` branches go with the issue.
  try {
    actions.push(...await reapWorkerWorktrees(projectPath, issueId, { deleteBranches: 'all' }));
  } catch {
    // Git unavailable — the workspace removal below still runs.
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
      const result = await pruneAgentStateDir(agentDir);
      actions.push(`pruned agent state ${agentDirName} (${result.removed.length} regenerable entr${result.removed.length === 1 ? 'y' : 'ies'} removed)`);
    } catch {
      // Already gone or inaccessible.
    }
  }

  return actions;
}
