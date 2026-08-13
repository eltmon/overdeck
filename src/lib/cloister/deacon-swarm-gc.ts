import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Effect } from 'effect';
import type { ReconciledSlotItem } from '../agents/slot-reconcile.js';
import { getAgentStateSync } from '../agents/agent-state.js';
import { stopAgent } from '../agents/termination.js';
import {
  resolveSlotWorkspaceWorktreesSync,
  type NestedSlotWorktree,
  type SlotWorkspaceWorktrees,
} from '../project-repos.js';
import type { CoordinateSwarmSlotsDeps } from './deacon-swarm.js';

const MERGED_LIVE_SLOT_IDLE_MS = 30 * 60 * 1000;

export async function reapMergedSlotAgent(
  issueId: string,
  slot: Pick<ReconciledSlotItem, 'slotIndex' | 'agentId'>,
  stopSlotAgent: (agentId: string) => Promise<void> = id => Effect.runPromise(stopAgent(id)),
): Promise<string> {
  const agentId = slot.agentId ?? `agent-${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
  try {
    await stopSlotAgent(agentId);
    return `[swarm] reaped merged agent ${agentId}`;
  } catch (err) {
    return `[swarm] could not reap merged agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function gcMergedSlots(
  issueId: string,
  workspacePath: string,
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment' | 'listSessionNames'> & {
    slotWorktreeExists?: (path: string) => boolean;
    getAgentLastActivity?: (agentId: string) => string | undefined;
    stopSlotAgent?: (agentId: string) => Promise<void>;
    listSlotWorkspaceWorktrees?: (issueId: string, slotWorkspace: string) => SlotWorkspaceWorktrees;
    removeDirectory?: (path: string) => Promise<void>;
  },
): Promise<string[]> {
  const actions: string[] = [];
  // A freshly dispatched slot branch points at the feature branch HEAD, so
  // `--merged HEAD` classifies it as merged before the agent's first commit.
  // Without a liveness guard, gc destroys the worktree/branch/assignment under
  // the live agent and the item redispatches at the next index.
  const sessionNames = new Set(await deps.listSessionNames());
  const worktreeExists = deps.slotWorktreeExists ?? existsSync;

  for (const slot of slots) {
    if (slot.status !== 'merged') continue;

    const agentId = slot.agentId ?? `agent-${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    if (sessionNames.has(agentId)) {
      const completionProven = slot.mergedVia === 'completed-status';
      const lastActivity = (deps.getAgentLastActivity ?? (id => getAgentStateSync(id)?.lastActivity))(agentId);
      const idleFor = lastActivity ? Date.now() - Date.parse(lastActivity) : 0;
      if (!completionProven && (!Number.isFinite(idleFor) || idleFor < MERGED_LIVE_SLOT_IDLE_MS)) {
        actions.push(`[swarm] gc skipped slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: agent session alive`);
        continue;
      }
      await (deps.stopSlotAgent ?? (id => Effect.runPromise(stopAgent(id))))(agentId);
      actions.push(completionProven
        ? `[swarm] gc reaped merged agent ${agentId}`
        : `[swarm] gc reaped idle merged agent ${agentId}`);
    }

    const slotWorkspace = `${workspacePath}-slot-${slot.slotIndex}`;
    const slotBranch = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    if (worktreeExists(slotWorkspace)) {
      const removed = await removeSlotWorkspace(issueId, workspacePath, slotWorkspace, slotBranch, slot, deps, actions);
      if (!removed) continue;
    }
    try {
      await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, workspacePath);
    } catch (error) {
      actions.push(`[swarm] gc deferred slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: branch delete failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    await deps.clearSlotAssignment(workspacePath, issueId, slot.slotIndex, slot.itemId);
    actions.push(`[swarm] gc slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}`);
  }

  return actions;
}

type SlotRemovalDeps = Pick<CoordinateSwarmSlotsDeps, 'runGitCommand'> & {
  listSlotWorkspaceWorktrees?: (issueId: string, slotWorkspace: string) => SlotWorkspaceWorktrees;
  removeDirectory?: (path: string) => Promise<void>;
};

/**
 * Remove a merged slot's workspace (PAN-3686). A polyrepo slot workspace is an
 * aggregate directory whose registered git worktrees are the nested sub-repo
 * checkouts (<slot>/fe, <slot>/api, …), each owned by a different parent
 * repository. Git cannot remove the aggregate root while nested worktrees
 * live inside it ("Directory not empty"), so every nested worktree is
 * detached through the workspace abstraction first, in its owning parent
 * repo. Never discards unmerged or locally-modified nested work: an unsafe
 * nested worktree defers the whole slot with the reason recorded. Returns
 * true when the slot workspace is gone and GC may proceed to branch cleanup.
 */
async function removeSlotWorkspace(
  issueId: string,
  workspacePath: string,
  slotWorkspace: string,
  slotBranch: string,
  slot: Pick<ReconciledSlotItem, 'slotIndex' | 'itemId'>,
  deps: SlotRemovalDeps,
  actions: string[],
): Promise<boolean> {
  const defer = (reason: string): false => {
    actions.push(`[swarm] gc deferred slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: ${reason}`);
    return false;
  };

  const { isPolyrepo, nested } = (deps.listSlotWorkspaceWorktrees ?? resolveSlotWorkspaceWorktreesSync)(issueId, slotWorkspace);

  for (const worktree of nested) {
    const blocked = await nestedWorktreePreservationReason(deps.runGitCommand, worktree, slotBranch);
    if (blocked) return defer(`preserving nested work: ${blocked}`);
  }

  for (const worktree of nested) {
    try {
      await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(worktree.dir)}`, worktree.parentRepo);
    } catch (error) {
      return defer(`nested worktree remove failed in ${worktree.repoKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, worktree.parentRepo);
    } catch (error) {
      // The worktree is already detached; a leftover merged branch is cosmetic.
      actions.push(`[swarm] gc note slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: nested branch ${slotBranch} delete failed in ${worktree.repoKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`, workspacePath);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Some polyrepo layouts register only the nested paths; the aggregate
    // root is then a plain directory git rightfully refuses to remove.
    if (isPolyrepo && /is not a working tree/.test(message)) {
      try {
        await (deps.removeDirectory ?? (path => rm(path, { recursive: true, force: true })))(slotWorkspace);
        return true;
      } catch (rmError) {
        return defer(`aggregate directory remove failed: ${rmError instanceof Error ? rmError.message : String(rmError)}`);
      }
    }
    return defer(`worktree remove failed: ${message}`);
  }
}

/**
 * Why a nested slot worktree must be preserved, or null when it is safe to
 * remove. Safe means: the nested slot branch has zero commits the per-repo
 * feature branch lacks, and the checkout has no tracked local modifications
 * (untracked build artifacts do not block removal).
 */
async function nestedWorktreePreservationReason(
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
  worktree: NestedSlotWorktree,
  slotBranch: string,
): Promise<string | null> {
  const ahead = await countCommitsAhead(runGitCommand, worktree.parentRepo, worktree.featureBranch, slotBranch);
  if (ahead === null) {
    return `${worktree.repoKey}: merge state of ${slotBranch} against ${worktree.featureBranch} could not be determined`;
  }
  if (ahead > 0) {
    return `${worktree.repoKey}: ${slotBranch} has ${ahead} unmerged commit(s) not in ${worktree.featureBranch}`;
  }
  try {
    const status = await runGitCommand('git status --porcelain --untracked-files=no', worktree.dir) as { stdout?: unknown };
    if (String(status?.stdout ?? '').trim().length > 0) {
      return `${worktree.repoKey}: worktree has uncommitted tracked changes`;
    }
  } catch {
    return `${worktree.repoKey}: worktree status could not be determined`;
  }
  return null;
}

async function countCommitsAhead(
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
  parentRepo: string,
  featureBranch: string,
  slotBranch: string,
): Promise<number | null> {
  try {
    const result = await runGitCommand(
      `git rev-list --count ${JSON.stringify(featureBranch)}..${JSON.stringify(slotBranch)}`,
      parentRepo,
    ) as { stdout?: unknown };
    const count = Number(String(result?.stdout ?? '').trim());
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}
