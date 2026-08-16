import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Effect } from 'effect';
import type { ReconciledSlotItem } from '../agents/slot-reconcile.js';
import { getAgentStateSync } from '../agents/agent-state.js';
import { stopAgent } from '../agents/termination.js';
import {
  resolveSlotWorkspaceWorktreesSync,
  resolveWorkspaceRepoRootsSync,
  type NestedSlotWorktree,
  type SlotWorkspaceWorktrees,
  type WorkspaceRepoRoot,
} from '../project-repos.js';
import type { CoordinateSwarmSlotsDeps } from './deacon-swarm-types.js';

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

export interface MergedSlotGcResult {
  actions: string[];
  /**
   * Merged-status slots that were NOT fully cleaned up this pass (PAN-3695).
   * Their items read as completed in the plan overlay, but the nested work is
   * not yet integrated and pushed — downstream dispatch and finalization must
   * be gated on this set.
   */
  uncleared: ReconciledSlotItem[];
}

export async function gcMergedSlots(
  issueId: string,
  workspacePath: string,
  slots: ReconciledSlotItem[],
  deps: Parameters<typeof gcMergedSlotsWithStatus>[3],
): Promise<string[]> {
  return (await gcMergedSlotsWithStatus(issueId, workspacePath, slots, deps)).actions;
}

export async function gcMergedSlotsWithStatus(
  issueId: string,
  workspacePath: string,
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment' | 'listSessionNames'> & {
    slotWorktreeExists?: (path: string) => boolean;
    getAgentLastActivity?: (agentId: string) => string | undefined;
    stopSlotAgent?: (agentId: string) => Promise<void>;
    listSlotWorkspaceWorktrees?: (issueId: string, slotWorkspace: string) => SlotWorkspaceWorktrees;
    listFeatureWorkspaceRepoRoots?: (issueId: string, workspacePath: string) => WorkspaceRepoRoot[];
    removeDirectory?: (path: string) => Promise<void>;
  },
): Promise<MergedSlotGcResult> {
  const actions: string[] = [];
  const uncleared: ReconciledSlotItem[] = [];
  // A freshly dispatched slot branch points at the feature branch HEAD, so
  // `--merged HEAD` classifies it as merged before the agent's first commit.
  // Without a liveness guard, gc destroys the worktree/branch/assignment under
  // the live agent and the item redispatches at the next index.
  const sessionNames = new Set(await deps.listSessionNames());
  const worktreeExists = deps.slotWorktreeExists ?? existsSync;

  for (const slot of slots) {
    if (slot.status !== 'merged') continue;

    const agentId = slot.agentId ?? `agent-${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    // PAN-3695: decide liveness up front, but reap the agent only AFTER every
    // nested branch is merged, ancestry-verified, and the workspace removed.
    // Reaping first stranded unmerged nested work with no agent left to answer
    // for it (MIN-888 slot 4).
    let reapAction: string | null = null;
    if (sessionNames.has(agentId)) {
      const completionProven = slot.mergedVia === 'completed-status';
      const lastActivity = (deps.getAgentLastActivity ?? (id => getAgentStateSync(id)?.lastActivity))(agentId);
      const idleFor = lastActivity ? Date.now() - Date.parse(lastActivity) : 0;
      if (!completionProven && (!Number.isFinite(idleFor) || idleFor < MERGED_LIVE_SLOT_IDLE_MS)) {
        actions.push(`[swarm] gc skipped slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: agent session alive`);
        uncleared.push(slot);
        continue;
      }
      reapAction = completionProven
        ? `[swarm] gc reaped merged agent ${agentId}`
        : `[swarm] gc reaped idle merged agent ${agentId}`;
    }

    const slotWorkspace = `${workspacePath}-slot-${slot.slotIndex}`;
    const slotBranch = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    if (worktreeExists(slotWorkspace)) {
      const removed = await removeSlotWorkspace(issueId, workspacePath, slotWorkspace, slotBranch, slot, deps, actions);
      if (!removed) {
        uncleared.push(slot);
        continue;
      }
    }
    // Polyrepo wrapper repos hold no local slot branch (PAN-3695): an absent
    // outer branch is an idempotent success once every nested branch has
    // verified ancestry, not a delete failure that wedges the slot forever.
    const branchExists = await slotBranchExists(deps.runGitCommand, workspacePath, slotBranch);
    if (branchExists === null) {
      actions.push(`[swarm] gc deferred slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: branch state of ${slotBranch} could not be determined`);
      uncleared.push(slot);
      continue;
    }
    if (branchExists) {
      try {
        await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, workspacePath);
      } catch (error) {
        actions.push(`[swarm] gc deferred slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: branch delete failed: ${error instanceof Error ? error.message : String(error)}`);
        uncleared.push(slot);
        continue;
      }
    }
    await deps.clearSlotAssignment(workspacePath, issueId, slot.slotIndex, slot.itemId);
    if (reapAction) {
      try {
        await (deps.stopSlotAgent ?? (id => Effect.runPromise(stopAgent(id))))(agentId);
        actions.push(reapAction);
      } catch (error) {
        actions.push(`[swarm] could not reap merged agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    actions.push(`[swarm] gc slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}`);
  }

  return { actions, uncleared };
}

/**
 * Whether the outer workspace has a local `slotBranch`, or null when that
 * cannot be determined. `git branch --list` exits 0 with empty output for an
 * absent branch, so a throw is always an indeterminate state, never "absent".
 */
async function slotBranchExists(
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
  workspacePath: string,
  slotBranch: string,
): Promise<boolean | null> {
  try {
    const result = await runGitCommand(`git branch --list ${JSON.stringify(slotBranch)}`, workspacePath) as { stdout?: unknown };
    return String(result?.stdout ?? '').trim().length > 0;
  } catch {
    return null;
  }
}

type SlotRemovalDeps = Pick<CoordinateSwarmSlotsDeps, 'runGitCommand'> & {
  listSlotWorkspaceWorktrees?: (issueId: string, slotWorkspace: string) => SlotWorkspaceWorktrees;
  listFeatureWorkspaceRepoRoots?: (issueId: string, workspacePath: string) => WorkspaceRepoRoot[];
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
 * Never discards unmerged or locally-modified nested work. PAN-3695: a slot
 * that reached merged status with unmerged nested branches is INTEGRATED here,
 * not just deferred — each unmerged nested slot branch is merged through the
 * canonical nested merge path (`git merge --no-ff` into the per-repo base
 * feature-workspace checkout, same as verifyAndMergeSlot) and ancestry is
 * re-verified repo by repo before any removal. A repo whose merge is pending
 * or failed defers the whole slot with an actionable repo-specific reason;
 * successful per-repo merges are preserved and the next pass retries the rest.
 * Uncommitted nested changes still defer the slot untouched.
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

  // ── Integration (PAN-3695): merge unmerged nested slot branches through the
  // canonical nested merge path before any removal. A merged-status slot whose
  // nested work was never merged must be merged by the coordinator here —
  // mergeReadySlots only consumes ready-to-merge slots, so a GC-only deferral
  // is terminal and strands the work (MIN-888 slot 4). These merges mutate the
  // per-repo BASE feature checkouts, never the slot workspace being removed.
  if (nested.length > 0) {
    const mergeFailures = await mergeNestedSlotBranches(issueId, workspacePath, slotBranch, nested, deps);
    if (mergeFailures.length > 0) {
      return defer(`nested merge incomplete: ${mergeFailures.join('; ')}`);
    }
  }

  // ── Preflight (read-only): no mutations below this line until every check
  // for every nested repo and the aggregate root has passed. ──

  for (const worktree of nested) {
    const blocked = await nestedWorktreeDirtyReason(deps.runGitCommand, worktree);
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
 * Shared with `pan swarm reset` (PAN-3713), which must distinguish an
 * already-unregistered nested worktree (the desired postcondition) from a
 * genuine removal failure.
 */
export async function isRegisteredWorktree(
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
 * Merge every nested slot branch that still has commits its per-repo feature
 * branch lacks, through the canonical nested merge path (PAN-3695): the merge
 * runs in the repo's base feature-workspace checkout, then ancestry is
 * re-verified by re-counting `featureBranch..slotBranch` — a merge command
 * exiting 0 is not proof the slot head landed — and the parent feature branch
 * is pushed to origin so the work actually leaves the machine. A dirty base
 * checkout refuses the merge, and a missing or degraded base checkout fails
 * the repo outright — without it, remote durability cannot be verified, even
 * when the local feature branch already contains the slot head. Every repo is
 * attempted even after a sibling fails, so successful merges are preserved and
 * only the failed repos are retried on the next pass. Returns the per-repo
 * failure reasons; an empty list means every nested repo's slot branch is an
 * ancestor of its pushed feature branch.
 */
async function mergeNestedSlotBranches(
  issueId: string,
  workspacePath: string,
  slotBranch: string,
  nested: NestedSlotWorktree[],
  deps: SlotRemovalDeps,
): Promise<string[]> {
  const failures: string[] = [];
  const baseRoots = new Map(
    (deps.listFeatureWorkspaceRepoRoots ?? resolveWorkspaceRepoRootsSync)(issueId, workspacePath)
      .map(root => [root.repoKey, root]),
  );
  for (const worktree of nested) {
    const ahead = await countCommitsAhead(deps.runGitCommand, worktree.parentRepo, worktree.featureBranch, slotBranch);
    if (ahead === null) {
      failures.push(`${worktree.repoKey}: merge state of ${slotBranch} against ${worktree.featureBranch} could not be determined`);
      continue;
    }
    const baseRoot = baseRoots.get(worktree.repoKey);
    // Remote durability must be verified for every nested repo before cleanup —
    // a missing or degraded base checkout makes that impossible, even when the
    // local feature branch already contains the slot head (PAN-3695 review).
    if (!baseRoot || baseRoot.degradedPolyrepo) {
      failures.push(ahead > 0
        ? `${worktree.repoKey}: no base feature-workspace checkout for ${worktree.featureBranch} — cannot merge ${slotBranch} (${ahead} unmerged commit(s))`
        : `${worktree.repoKey}: no base feature-workspace checkout for ${worktree.featureBranch} — cannot verify and push remote durability`);
      continue;
    }
    if (ahead > 0) {
      // Never merge into a dirty base checkout: tracked local changes there are
      // someone's uncommitted work on the parent feature branch.
      const baseDirty = await baseCheckoutDirtyReason(deps.runGitCommand, worktree, baseRoot, slotBranch);
      if (baseDirty) {
        failures.push(baseDirty);
        continue;
      }
      try {
        await deps.runGitCommand(`git merge --no-ff ${JSON.stringify(slotBranch)}`, baseRoot.dir);
      } catch (error) {
        await deps.runGitCommand('git merge --abort', baseRoot.dir).catch(() => {});
        failures.push(`${worktree.repoKey}: ${slotBranch} did not merge cleanly into ${worktree.featureBranch}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const remaining = await countCommitsAhead(deps.runGitCommand, worktree.parentRepo, worktree.featureBranch, slotBranch);
      if (remaining !== 0) {
        failures.push(`${worktree.repoKey}: ancestry verification failed — ${slotBranch} still has ${remaining ?? 'an unknown number of'} commit(s) not in ${worktree.featureBranch} after merge`);
        continue;
      }
    }
    // Push the parent feature branch so the merged nested work actually lands
    // on the remote — a local-only merge is invisible to the outer pipeline
    // (MIN-888 needed manual pushes). This also retries a push that failed on
    // an earlier pass: the local merge is already an ancestor, but the
    // origin..feature count still shows the unpushed commits.
    const unpushed = await countCommitsAhead(deps.runGitCommand, baseRoot.dir, `origin/${worktree.featureBranch}`, worktree.featureBranch);
    if (ahead > 0 || unpushed === null || unpushed > 0) {
      try {
        await deps.runGitCommand(`git push origin ${JSON.stringify(worktree.featureBranch)}`, baseRoot.dir);
      } catch (error) {
        failures.push(`${worktree.repoKey}: merged ${slotBranch} into ${worktree.featureBranch} but push to origin failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
  }
  return failures;
}

/**
 * Why a base feature-workspace checkout must not receive a merge right now, or
 * null when it is clean. Tracked local modifications block the merge (git would
 * refuse or, worse, entangle someone's uncommitted work); untracked files do
 * not, so they are ignored here.
 */
async function baseCheckoutDirtyReason(
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
  worktree: NestedSlotWorktree,
  baseRoot: WorkspaceRepoRoot,
  slotBranch: string,
): Promise<string | null> {
  try {
    const status = await runGitCommand('git status --porcelain --untracked-files=no', baseRoot.dir) as { stdout?: unknown };
    if (String(status?.stdout ?? '').trim().length > 0) {
      return `${worktree.repoKey}: base feature checkout of ${worktree.featureBranch} has uncommitted changes — refusing to merge ${slotBranch}`;
    }
  } catch {
    return `${worktree.repoKey}: base feature checkout state of ${worktree.featureBranch} could not be determined — refusing to merge ${slotBranch}`;
  }
  return null;
}

/**
 * Why a nested slot worktree must be preserved, or null when it is safe to
 * remove. Any tracked change or non-ignored untracked file blocks removal
 * (ignored build artifacts do not). Merge state is handled separately by
 * mergeNestedSlotBranches before this runs.
 */
async function nestedWorktreeDirtyReason(
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
  worktree: NestedSlotWorktree,
): Promise<string | null> {
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
