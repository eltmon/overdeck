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
 * repo.
 *
 * Cleanup is atomic in intent: a read-only preflight proves every nested repo
 * safe AND removable, and decides the aggregate root's removal route, before
 * the first mutation. Discovering an unsafe or unremovable nested checkout
 * after an earlier one was already detached is the Tier-1 partial-cleanup
 * defect the preflight exists to prevent (PAN-3686 post-deploy review). Any
 * preflight failure defers the whole slot with zero removals.
 *
 * Never discards unmerged or locally-modified nested work: an unsafe nested
 * worktree defers the whole slot with the reason recorded. Returns true when
 * the slot workspace is gone and GC may proceed to branch cleanup.
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

  // ── Preflight (read-only): no mutations below this line until every check
  // for every nested repo and the aggregate root has passed. ──

  for (const worktree of nested) {
    const blocked = await nestedWorktreePreservationReason(deps.runGitCommand, worktree, slotBranch);
    if (blocked) return defer(`preserving nested work: ${blocked}`);
  }

  // Each nested checkout must be a registered worktree of its owning parent
  // repo. The registration is what `git worktree remove` needs to succeed;
  // checking it up front keeps a mid-loop failure from leaving the slot half
  // detached. Nested gitdirs live in their owning parent repos, never under
  // the aggregate, so this lookup does not depend on aggregate metadata that
  // an earlier partial removal may have invalidated.
  for (const worktree of nested) {
    const registered = await isRegisteredWorktree(deps.runGitCommand, worktree.parentRepo, worktree.dir);
    if (registered === null) {
      return defer(`${worktree.repoKey}: worktree registration in parent repo could not be determined`);
    }
    if (!registered) {
      return defer(`${worktree.repoKey}: nested worktree is not registered in its parent repo (an earlier partial cleanup may have detached it); run pan swarm reset ${issueId}`);
    }
  }

  // Decide the aggregate root's removal route up front: a registered working
  // tree is removed through git; an unregistered plain directory (polyrepo
  // layouts that register only the nested paths, or a registration lost to an
  // earlier partial cleanup) is removed as a directory after nested detach.
  const aggregateRegistered = await isRegisteredWorktree(deps.runGitCommand, workspacePath, slotWorkspace);
  if (aggregateRegistered === null) {
    return defer('aggregate worktree registration could not be determined');
  }

  // ── Mutation: preflight proved every nested worktree safe and removable. ──

  const detached: string[] = [];
  for (const worktree of nested) {
    try {
      await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(worktree.dir)}`, worktree.parentRepo);
      detached.push(worktree.repoKey);
    } catch (error) {
      // A failure here escaped preflight (I/O race, lock); report which nested
      // worktrees were already detached so the partial state is on record.
      const partial = detached.length > 0 ? ` (already detached: ${detached.join(', ')})` : '';
      return defer(`nested worktree remove failed in ${worktree.repoKey}${partial}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, worktree.parentRepo);
    } catch (error) {
      // The worktree is already detached; a leftover merged branch is cosmetic.
      actions.push(`[swarm] gc note slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: nested branch ${slotBranch} delete failed in ${worktree.repoKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!aggregateRegistered && isPolyrepo) {
    try {
      await (deps.removeDirectory ?? (path => rm(path, { recursive: true, force: true })))(slotWorkspace);
      return true;
    } catch (rmError) {
      return defer(`aggregate directory remove failed: ${rmError instanceof Error ? rmError.message : String(rmError)}`);
    }
  }

  try {
    await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`, workspacePath);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The registration vanished between preflight and removal (or preflight
    // was bypassed): the aggregate root is a plain directory git rightfully
    // refuses to remove.
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
 * Whether `worktreeDir` is a registered worktree of the repository at
 * `repoDir`, or null when the registration state cannot be determined. The
 * porcelain list always names at least the repository's own main worktree, so
 * a response with no `worktree` lines is an anomaly, not proof of "absent".
 */
async function isRegisteredWorktree(
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
  repoDir: string,
  worktreeDir: string,
): Promise<boolean | null> {
  try {
    const result = await runGitCommand('git worktree list --porcelain', repoDir) as { stdout?: unknown };
    const paths = String(result?.stdout ?? '')
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length).trim());
    if (paths.length === 0) return null;
    return paths.includes(worktreeDir);
  } catch {
    return null;
  }
}

/**
 * Why a nested slot worktree must be preserved, or null when it is safe to
 * remove. Safe means: the nested slot branch has zero commits the per-repo
 * feature branch lacks, and the checkout has no local modifications — any
 * tracked change or non-ignored untracked file blocks removal (ignored
 * build artifacts do not).
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
    const status = await runGitCommand('git status --porcelain --untracked-files=all', worktree.dir) as { stdout?: unknown };
    if (String(status?.stdout ?? '').trim().length > 0) {
      return `${worktree.repoKey}: worktree has uncommitted changes`;
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
    const stdout = String(result?.stdout ?? '').trim();
    // An empty or non-numeric stdout is not evidence of "zero commits ahead" —
    // Number('') === 0 would misread it as safely merged. Only a digits-only
    // payload proves the count.
    if (!/^\d+$/.test(stdout)) return null;
    return Number(stdout);
  } catch {
    return null;
  }
}
