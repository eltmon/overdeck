import { existsSync } from 'node:fs';
import type { ReconciledSlotItem } from '../agents/slot-reconcile.js';
import type { CoordinateSwarmSlotsDeps } from './deacon-swarm.js';

export async function gcMergedSlots(
  issueId: string,
  workspacePath: string,
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment' | 'listSessionNames'>
    & Partial<Pick<CoordinateSwarmSlotsDeps, 'slotWorktreeExists'>>,
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
      actions.push(`[swarm] gc skipped slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: agent session alive`);
      continue;
    }

    const slotWorkspace = `${workspacePath}-slot-${slot.slotIndex}`;
    const slotBranch = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    if (worktreeExists(slotWorkspace)) {
      try {
        await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`, workspacePath);
      } catch (error) {
        actions.push(`[swarm] gc deferred slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: worktree remove failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    try {
      await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, workspacePath);
    } catch (error) {
      actions.push(`[swarm] gc deferred slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: branch delete failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    deps.clearSlotAssignment(workspacePath, issueId, slot.slotIndex, slot.itemId);
    actions.push(`[swarm] gc slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}`);
  }

  return actions;
}
