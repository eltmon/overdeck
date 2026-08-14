import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { createActiveSlice } from '../xbrief/dag.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';
import type { RegisteredSlotSpawn } from './spawn-prep.js';

const execAsync = promisify(exec);

export function buildRegisteredSlotPrompt(
  issueId: string,
  baseWorkspace: string,
  slot: RegisteredSlotSpawn,
  extraPrompt?: string,
): string {
  const doc = readWorkspacePlanSync(baseWorkspace);
  if (!doc) {
    throw new Error(
      `Registered slot spawn for ${issueId} requires a readable xBRIEF plan in ${baseWorkspace}.`,
    );
  }

  const slice = createActiveSlice(doc, {
    issueId: issueId.toUpperCase(),
    itemId: slot.slotItemId,
    currentItemIds: [slot.slotItemId],
  });
  const lines = [
    `# Registered Slot Assignment: ${slot.slotItemId}`,
    '',
    `Issue: ${issueId}`,
    `Slot: ${slot.slotIndex}`,
    `Agent: ${slot.agentId}`,
    `Branch: ${slot.branch}`,
    `Workspace: ${slot.workspace}`,
    '',
    'You are a registered slot work agent. Implement only the target xBRIEF item below, keep changes scoped to that item, and do not merge this slot branch yourself.',
    '',
    slice.prompt,
  ];
  const trimmedExtra = extraPrompt?.trim();
  if (trimmedExtra) lines.push('', '## Additional Foreman Instructions', trimmedExtra);
  return lines.join('\n');
}

export async function ensureRegisteredSlotWorktree(issueId: string, baseWorkspace: string, slot: RegisteredSlotSpawn): Promise<void> {
  const repoRoots = resolveWorkspaceRepoRootsSync(issueId, baseWorkspace);
  const polyrepoRoots = repoRoots.filter(root => root.isPolyrepo);
  if (polyrepoRoots.length > 0) {
    const expected = polyrepoRoots.map(root => ({
      ...root,
      target: `${slot.workspace}/${root.dir.slice(baseWorkspace.length + 1).split('/')[0]}`,
    }));
    if (existsSync(slot.workspace)) {
      const missing = expected.filter(root => !existsSync(`${root.target}/.git`));
      if (missing.length === 0) {
        const branches = await Promise.all(expected.map(async root => {
          try {
            return (await execAsync('git branch --show-current', { cwd: root.target })).stdout.trim();
          } catch {
            return '';
          }
        }));
        if (branches.every(branch => branch === slot.branch)) return;
      }
      throw new Error(`Registered polyrepo slot workspace is incomplete at ${slot.workspace}; run pan swarm reset before dispatching it.`);
    }
    await mkdir(slot.workspace, { recursive: true });
    try {
      for (const root of expected) {
        const branchExists = await gitBranchExists(root.dir, slot.branch);
        const command = branchExists
          ? `git worktree add ${JSON.stringify(root.target)} ${JSON.stringify(slot.branch)}`
          : `git worktree add -b ${JSON.stringify(slot.branch)} ${JSON.stringify(root.target)} ${JSON.stringify(root.sourceBranch)}`;
        await execAsync(command, { cwd: root.dir });
      }
    } catch (error) {
      throw new Error(`Could not create isolated polyrepo slot workspace ${slot.workspace}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  if (existsSync(slot.workspace)) {
    let branch = '';
    try {
      branch = (await execAsync('git branch --show-current', { cwd: slot.workspace })).stdout.trim();
    } catch { /* handled by the stale-workspace error below */ }
    if (branch === slot.branch) return;
    throw new Error(`Registered slot workspace is incomplete at ${slot.workspace}; run pan swarm reset before dispatching it.`);
  }
  await mkdir(dirname(slot.workspace), { recursive: true });
  const branchExists = await gitBranchExists(baseWorkspace, slot.branch);
  if (branchExists && !(await gitRefsEqual(baseWorkspace, slot.branch, repoRoots[0].sourceBranch))) {
    throw new Error(`Registered slot branch ${slot.branch} is not at ${repoRoots[0].sourceBranch}; refusing to reuse stale work.`);
  }
  const target = JSON.stringify(slot.workspace);
  const branch = JSON.stringify(slot.branch);
  const command = branchExists
    ? `git worktree add ${target} ${branch}`
    : `git worktree add -b ${branch} ${target} ${JSON.stringify(repoRoots[0].sourceBranch)}`;
  await execAsync(command, { cwd: baseWorkspace });
}

async function gitBranchExists(workspace: string, branch: string): Promise<boolean> {
  try {
    await execAsync(`git show-ref --verify --quiet ${JSON.stringify(`refs/heads/${branch}`)}`, { cwd: workspace });
    return true;
  } catch {
    return false;
  }
}

async function gitRefsEqual(workspace: string, left: string, right: string): Promise<boolean> {
  try {
    const [leftResult, rightResult] = await Promise.all([
      execAsync(`git rev-parse ${JSON.stringify(left)}`, { cwd: workspace }),
      execAsync(`git rev-parse ${JSON.stringify(right)}`, { cwd: workspace }),
    ]);
    return leftResult.stdout.trim() === rightResult.stdout.trim();
  } catch {
    return false;
  }
}
