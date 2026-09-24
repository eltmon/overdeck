import { resolveSlotWorkspaceWorktrees, type NestedSlotWorktree } from '../project-repos.js';
import { listSlotAssignments as listDurableSlotAssignments, type SlotReconcileResult } from './swarm-slot-reconcile.js';
import { detachAndRemoveSlotWorkspace, type SlotRemovalDeps } from './deacon-swarm-gc.js';
import type { CoordinateSwarmSlotsDeps } from './deacon-swarm-types.js';

type OrphanGcDeps = Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'listSessionNames' | 'listSlotAssignments'>
  & Omit<SlotRemovalDeps, 'runGitCommand'>;

/**
 * Reconcile GC for truly-orphaned slots (PAN-2214, completes PAN-2213(c)).
 *
 * An orphan is a slot index with an on-disk worktree or a local slot branch but
 * no slotAssignments entry and no live agent tmux session. Zero-commit-ahead
 * orphans are removed; orphans with unmerged commits are only reported so the
 * operator can push them via `pan swarm reset` — never deleted.
 *
 * A polyrepo slot workspace is an aggregate directory whose nested sub-repo
 * checkouts are worktrees of DIFFERENT parent repositories (PAN-3689). Its
 * nested work is checked repo by repo against each per-repo feature branch —
 * unknown merge state preserves the slot — and removal goes through the same
 * nested-detach door as merged-slot GC (PAN-3686), which preserves tracked
 * changes and non-ignored untracked files. Removal failures are reported,
 * never thrown, so one wedged slot cannot abort the sweep.
 */
export async function gcOrphanedSlots(
  issueId: string,
  workspacePath: string,
  reconciled: SlotReconcileResult,
  deps: OrphanGcDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const issueLower = issueId.toLowerCase();

  const worktreeSlotIndexes = await listSlotWorktreeIndexes(workspacePath, deps.runGitCommand);
  const branchesBySlot = new Map(reconciled.branches.map(branch => [branch.slotIndex, branch.branch]));
  const candidateSlotIndexes = [...new Set([...worktreeSlotIndexes, ...branchesBySlot.keys()])].sort((a, b) => a - b);
  if (candidateSlotIndexes.length === 0) return actions;

  const ownedSlotIndexes = new Set([
    ...(deps.listSlotAssignments ?? listDurableSlotAssignments)(issueId, workspacePath).map(assignment => assignment.slotIndex),
    ...reconciled.merged.map(slot => slot.slotIndex),
    ...reconciled.inFlight.map(slot => slot.slotIndex),
  ]);
  const sessionNames = new Set(await deps.listSessionNames());

  for (const slotIndex of candidateSlotIndexes) {
    if (ownedSlotIndexes.has(slotIndex)) continue;
    if (sessionNames.has(`agent-${issueLower}-slot-${slotIndex}`)) continue;

    const branch = branchesBySlot.get(slotIndex);
    const aheadCount = branch ? await countCommitsAhead(workspacePath, 'HEAD', branch, deps.runGitCommand) : 0;
    if (aheadCount === null || aheadCount > 0) {
      actions.push(
        `[swarm] orphan slot ${slotIndex} for ${issueId} preserved: ${branch} has `
        + `${aheadCount ?? 'an unknown number of'} unmerged commit(s) — run \`pan swarm reset ${issueId}\` `
        + 'to push it to origin before cleanup',
      );
      continue;
    }

    const slotWorkspace = `${workspacePath}-slot-${slotIndex}`;
    const slotBranch = branch ?? `feature/${issueLower}-slot-${slotIndex}`;
    const layout = (deps.listSlotWorkspaceWorktrees ?? resolveSlotWorkspaceWorktrees)(issueId, slotWorkspace);
    const nestedUnmerged = await nestedUnmergedReason(layout.nested, slotBranch, deps.runGitCommand);
    if (nestedUnmerged) {
      actions.push(
        `[swarm] orphan slot ${slotIndex} for ${issueId} preserved: ${nestedUnmerged} — run \`pan swarm reset ${issueId}\` `
        + 'to push it to origin before cleanup',
      );
      continue;
    }

    if (layout.nested.length > 0 || worktreeSlotIndexes.has(slotIndex)) {
      const failure = await detachAndRemoveSlotWorkspace(
        issueId,
        workspacePath,
        slotWorkspace,
        slotBranch,
        layout,
        deps,
        note => actions.push(`[swarm] gc-orphan note slot ${slotIndex} for ${issueId}: ${note}`),
      );
      if (failure) {
        actions.push(`[swarm] gc-orphan deferred slot ${slotIndex} for ${issueId}: ${failure}`);
        continue;
      }
    }
    if (branch) {
      try {
        await deps.runGitCommand(`git branch -D ${JSON.stringify(branch)}`, workspacePath);
      } catch (error) {
        actions.push(`[swarm] gc-orphan deferred slot ${slotIndex} for ${issueId}: branch delete failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    actions.push(`[swarm] gc-orphan slot ${slotIndex} for ${issueId}`);
  }

  return actions;
}

async function listSlotWorktreeIndexes(
  workspacePath: string,
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
): Promise<Set<number>> {
  const indexes = new Set<number>();
  try {
    const result = await runGitCommand('git worktree list --porcelain', workspacePath) as { stdout?: unknown };
    const pattern = new RegExp(`^worktree ${escapeRegExp(workspacePath)}-slot-(\\d+)$`);
    for (const line of String(result?.stdout ?? '').split('\n')) {
      const match = pattern.exec(line.trim());
      if (match) indexes.add(Number(match[1]));
    }
  } catch {
    // Worktree enumeration failed — fall back to branch-derived candidates only.
  }
  return indexes;
}

/**
 * Why a polyrepo orphan's nested work must be preserved, or null when every
 * nested checkout — and the slot branch in its owning parent repo — is already
 * an ancestor of that repo's feature branch. Unknown merge state preserves.
 */
async function nestedUnmergedReason(
  nested: NestedSlotWorktree[],
  slotBranch: string,
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
): Promise<string | null> {
  for (const worktree of nested) {
    const checkoutAhead = await countCommitsAhead(worktree.dir, worktree.featureBranch, 'HEAD', runGitCommand);
    if (checkoutAhead === null || checkoutAhead > 0) {
      return `${worktree.repoKey}: nested checkout has ${checkoutAhead ?? 'an unknown number of'} commit(s) not in ${worktree.featureBranch}`;
    }
    const branchExists = await localBranchExists(worktree.parentRepo, slotBranch, runGitCommand);
    if (branchExists === null) {
      return `${worktree.repoKey}: state of nested branch ${slotBranch} could not be determined`;
    }
    if (!branchExists) continue;
    const branchAhead = await countCommitsAhead(worktree.parentRepo, worktree.featureBranch, slotBranch, runGitCommand);
    if (branchAhead === null || branchAhead > 0) {
      return `${worktree.repoKey}: nested branch ${slotBranch} has ${branchAhead ?? 'an unknown number of'} commit(s) not in ${worktree.featureBranch}`;
    }
  }
  return null;
}

async function localBranchExists(
  repoDir: string,
  branch: string,
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
): Promise<boolean | null> {
  try {
    const result = await runGitCommand(`git branch --list ${JSON.stringify(branch)}`, repoDir) as { stdout?: unknown };
    return String(result?.stdout ?? '').trim().length > 0;
  } catch {
    return null;
  }
}

/**
 * `base..head` commit count, or null when it cannot be determined. Only a
 * digits-only payload proves the count: `Number('') === 0` would misread an
 * empty answer as "safely merged".
 */
async function countCommitsAhead(
  repoDir: string,
  base: string,
  head: string,
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
): Promise<number | null> {
  const ref = (name: string) => (name === 'HEAD' ? name : JSON.stringify(name));
  try {
    const result = await runGitCommand(`git rev-list --count ${ref(base)}..${ref(head)}`, repoDir) as { stdout?: unknown };
    const stdout = String(result?.stdout ?? '').trim();
    return /^\d+$/.test(stdout) ? Number(stdout) : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
