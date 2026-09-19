/**
 * Swarm worktree GC on its own schedule (PAN-3917 FR-11).
 *
 * `gcOrphanedSlots` removes the worktree and local branch of a slot index that
 * has no assignment and no live agent — disk hygiene, and the only half of the
 * old `swarmJanitorPass` that is hygiene rather than pipeline machinery (the
 * rest of that pass spawns foremen and sends stall events). It kept running on
 * the deacon's 60s patrol before the cut; `hygiene-scheduler.ts` runs this at
 * the same cadence now.
 *
 * Liveness comes from the SELECTED terminal backend's inventory, not a tmux
 * census: under Herdr a live slot agent has no tmux session, and GC must never
 * delete the worktree of an agent that is still working in it. An unreadable
 * inventory makes the whole sweep skip.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { findSpecByIssue } from '../pan-dir/specs.js';
import { listLiveAgentIds } from '../terminal-backends/inventory.js';
import { listFeatureWorkspaces } from './deacon-workspaces.js';
import { gcOrphanedSlots } from './deacon-swarm-orphan-gc.js';
import { listSlotAssignments, reconcileSlotState } from './swarm-slot-reconcile.js';

const execAsync = promisify(exec);

export async function sweepOrphanedSwarmSlots(): Promise<string[]> {
  const liveAgentIds = await listLiveAgentIds();
  if (liveAgentIds === null) return [];

  const deps = {
    runGitCommand: (command: string, cwd: string) => execAsync(command, { cwd }),
    listSessionNames: async () => [...liveAgentIds],
    listSlotAssignments,
  };

  const actions: string[] = [];
  for (const workspace of listFeatureWorkspaces({ includeSlotWorkspaces: false })) {
    const issueId = workspace.issueId.toUpperCase();
    try {
      const spec = await Effect.runPromise(findSpecByIssue(workspace.projectPath, issueId));
      if (!spec) continue;
      const reconciled = await reconcileSlotState(issueId, workspace.workspacePath, spec.document);
      actions.push(...await gcOrphanedSlots(issueId, workspace.workspacePath, reconciled, deps));
    } catch (err) {
      actions.push(`[swarm] orphan GC for ${issueId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return actions;
}
