import { execFile } from 'node:child_process';
import { rename } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';
import { ensureRegisteredSlotWorktree } from '../agents/registered-slot-spawn.js';
import type { SlotReconcileResult } from '../agents/slot-reconcile.js';
import type { XBriefDocument } from '../xbrief/types.js';
import { releaseBlockedSwarmSlot } from './deacon-swarm-record.js';
import type { ArchivedBlockedSlot, CoordinateSwarmSlotsDeps } from './deacon-swarm-types.js';

const execFileAsync = promisify(execFile);

export async function prepareReleasedSwarmSlot(
  issueId: string,
  workspacePath: string,
  slotIndex: number,
  itemId: string,
  branch: string,
): Promise<void> {
  await ensureRegisteredSlotWorktree(issueId, workspacePath, {
    agentId: `agent-${issueId.toLowerCase()}-slot-${slotIndex}`,
    branch,
    workspace: `${workspacePath}-slot-${slotIndex}`,
    slotIndex,
    slotItemId: itemId,
  });
}

export async function defaultIsSlotBranchPushed(
  workspacePath: string,
  issueId: string,
  branch: string,
): Promise<boolean> {
  const slotIndex = branch.match(/-slot-(\d+)(?:-attempt-\d+)?$/)?.[1];
  if (!slotIndex) return false;
  const roots = resolveWorkspaceRepoRootsSync(issueId, `${workspacePath}-slot-${slotIndex}`);
  if (roots.length === 0 || roots.some(root => root.degradedPolyrepo)) return false;
  try {
    const durable = await Promise.all(roots.map(async root => {
      await refreshDurableSlotRef(root.dir, branch);
      return true;
    }));
    return durable.every(Boolean);
  } catch {
    return false;
  }
}

export async function releaseBlockedSlots(
  issueId: string,
  workspacePath: string,
  doc: XBriefDocument,
  reconciled: SlotReconcileResult,
  deps: Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'isPaneDead' | 'isSlotWorktreeClean'>
    & Partial<Pick<CoordinateSwarmSlotsDeps, 'isSlotBranchPushed' | 'archiveBlockedSlot' | 'prepareReleasedSlot'>>,
): Promise<string[]> {
  const actions: string[] = [];
  const blockedItemIds = new Set(doc.plan.items.filter(item => item.status === 'blocked').map(item => item.id));
  if (blockedItemIds.size === 0) return actions;

  const sessionNames = new Set(await deps.listSessionNames());
  for (const slot of reconciled.inFlight.filter(candidate => blockedItemIds.has(candidate.itemId))) {
    const agentId = slot.agentId ?? `agent-${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    if (sessionNames.has(agentId) && !(await deps.isPaneDead(agentId))) continue;
    if (!slot.branch) {
      actions.push(`[swarm] needs-you ${issueId}: blocked slot ${slot.slotIndex} has no branch; preserving assignment`);
      continue;
    }
    const clean = await deps.isSlotWorktreeClean(`${workspacePath}-slot-${slot.slotIndex}`).catch(() => false);
    const pushed = await (deps.isSlotBranchPushed ?? defaultIsSlotBranchPushed)(
      workspacePath,
      issueId,
      slot.branch,
    ).catch(() => false);
    if (!clean || !pushed) {
      const reason = !clean ? 'uncommitted work' : 'unpushed or unverifiable work';
      actions.push(`[swarm] needs-you ${issueId}: blocked slot ${slot.slotIndex} has ${reason}; preserving assignment`);
      continue;
    }
    const archived = await (deps.archiveBlockedSlot ?? archiveBlockedSwarmSlot)(
      issueId,
      workspacePath,
      slot.slotIndex,
      slot.branch,
    );
    await releaseBlockedSwarmSlot(workspacePath, issueId, slot.slotIndex, slot.itemId, slot.branch, archived);
    await (deps.prepareReleasedSlot ?? prepareReleasedSwarmSlot)(
      issueId,
      workspacePath,
      slot.slotIndex,
      slot.itemId,
      archived.replacementBranch,
    );
    actions.push(`[swarm] released blocked slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: archived as ${archived.archivedBranch} and prepared ${archived.replacementBranch}`);
  }
  reconciled.inFlight = reconciled.inFlight.filter(slot => !blockedItemIds.has(slot.itemId));
  return actions;
}

/** Preserve a blocked attempt and provision a unique branch identity for slot reuse. */
export async function archiveBlockedSwarmSlot(
  issueId: string,
  workspacePath: string,
  slotIndex: number,
  branch: string,
  now = new Date(),
): Promise<ArchivedBlockedSlot> {
  const releasedAt = now.toISOString();
  const suffix = releasedAt.replace(/[-:.TZ]/g, '');
  const slotWorkspace = `${workspacePath}-slot-${slotIndex}`;
  const archivedWorktree = `${slotWorkspace}-blocked-${suffix}`;
  const archivedBranch = `${branch}-blocked-${suffix}`;
  const replacementBranch = `feature/${issueId.toLowerCase()}-slot-${slotIndex}-attempt-${suffix}`;
  const slotRoots = resolveWorkspaceRepoRootsSync(issueId, slotWorkspace);
  const baseRoots = new Map(resolveWorkspaceRepoRootsSync(issueId, workspacePath)
    .map(root => [root.repoKey, root]));

  if (slotRoots.length === 0 || slotRoots.some(root => root.degradedPolyrepo)) {
    throw new Error(`Cannot archive blocked slot ${slotIndex}: repository roots are unavailable.`);
  }

  // Copy the freshly queried remote tip to an attempt-specific archive. The
  // original local and remote refs remain untouched; replacement work uses a
  // new branch identity.
  for (const root of slotRoots) {
    const remoteRef = await refreshDurableSlotRef(root.dir, branch);
    await execFileAsync('git', [
      'push',
      'origin',
      `${remoteRef}:refs/heads/${archivedBranch}`,
    ], { cwd: root.dir });
  }

  await rename(slotWorkspace, archivedWorktree);
  for (const root of slotRoots) {
    const baseRoot = baseRoots.get(root.repoKey);
    if (!baseRoot) throw new Error(`Cannot archive blocked slot ${slotIndex}: missing base repository ${root.repoKey}.`);
    const nestedPath = relative(slotWorkspace, root.dir);
    const archivedRoot = nestedPath ? resolve(archivedWorktree, nestedPath) : archivedWorktree;
    await execFileAsync('git', ['worktree', 'repair', archivedRoot], { cwd: baseRoot.dir });
    await execFileAsync('git', ['branch', archivedBranch, branch], { cwd: baseRoot.dir });
    await execFileAsync('git', ['switch', archivedBranch], { cwd: archivedRoot });
  }

  return { archivedBranch, archivedWorktree, replacementBranch, releasedAt };
}

async function refreshDurableSlotRef(workspace: string, branch: string): Promise<string> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  await execFileAsync('git', [
    'fetch',
    '--no-tags',
    'origin',
    `+refs/heads/${branch}:${remoteRef}`,
  ], { cwd: workspace });
  await execFileAsync('git', [
    'merge-base',
    '--is-ancestor',
    `refs/heads/${branch}`,
    remoteRef,
  ], { cwd: workspace });
  return remoteRef;
}
