import { listSlotAssignments as listDurableSlotAssignments, type SlotReconcileResult } from '../agents/slot-reconcile.js';
import type { CoordinateSwarmSlotsDeps } from './deacon-swarm.js';

type OrphanGcDeps = Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'listSessionNames' | 'listSlotAssignments'>;

/**
 * Reconcile GC for truly-orphaned slots (PAN-2214, completes PAN-2213(c)).
 *
 * An orphan is a slot index with an on-disk worktree or a local slot branch but
 * no slotAssignments entry and no live agent tmux session. Zero-commit-ahead
 * orphans are removed; orphans with unmerged commits are only reported so the
 * operator can push them via `pan swarm reset` — never deleted.
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
    const aheadCount = branch ? await countCommitsAhead(workspacePath, branch, deps.runGitCommand) : 0;
    if (aheadCount === null || aheadCount > 0) {
      actions.push(
        `[swarm] orphan slot ${slotIndex} for ${issueId} preserved: ${branch} has `
        + `${aheadCount ?? 'an unknown number of'} unmerged commit(s) — run \`pan swarm reset ${issueId}\` `
        + 'to push it to origin before cleanup',
      );
      continue;
    }

    if (worktreeSlotIndexes.has(slotIndex)) {
      await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(`${workspacePath}-slot-${slotIndex}`)}`, workspacePath);
    }
    if (branch) {
      await deps.runGitCommand(`git branch -D ${JSON.stringify(branch)}`, workspacePath);
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

async function countCommitsAhead(
  workspacePath: string,
  branch: string,
  runGitCommand: CoordinateSwarmSlotsDeps['runGitCommand'],
): Promise<number | null> {
  try {
    const result = await runGitCommand(`git rev-list --count HEAD..${JSON.stringify(branch)}`, workspacePath) as { stdout?: unknown };
    const count = Number(String(result?.stdout ?? '').trim());
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
