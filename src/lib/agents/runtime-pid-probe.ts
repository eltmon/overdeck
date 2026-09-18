/**
 * Process-subtree probes for harness identity (PAN-3849).
 *
 * Identity is established by walking the pane's REAL process tree (`ps`/
 * `pgrep` on actual pids rooted at `#{pane_pid}`), never by substring matching
 * on `pgrep -f` — a substring pattern self-matches the probing process and
 * reports a dead agent alive. Kept in its own small module so the liveness
 * oracle (agents/liveness.ts) and its tests can mock this exact boundary.
 */
import { exec, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';

const execAsync = promisify(exec);

function matchesHarnessProcess(name: string, expectedProcessNames: ReadonlySet<string>, harness: RuntimeName): boolean {
  return expectedProcessNames.has(name) || (harness === 'muse' && name.startsWith('muse-bin-'));
}

/**
 * BFS-walk a process subtree rooted at `rootPid` looking for the active agent
 * runtime. Returns the matching process's pid, null if the tree exists but no
 * match, null on any error.
 *
 * pane_pid is the tmux pane's root process, which is bash for work-agent
 * launchers (`bash launcher.sh`) but can be the runtime directly for
 * specialists (`exec claude ...` / `exec pi ...`).
 */
export async function findAgentRuntimePidInSubtree(rootPid: string, harness: RuntimeName = 'claude-code'): Promise<number | null> {
  const expectedProcessNames = new Set(getHarnessBehavior(harness).processNames);
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid) || !/^\d+$/.test(pid)) continue;
    seen.add(pid);

    // A failed identity lookup must not prune the subtree below this pid: a
    // transient `ps` failure at the pane root would otherwise read a healthy
    // harness further down as absent. Fall through to the child lookup.
    let name: string | null = null;
    try {
      const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm=`);
      name = comm.trim();
    } catch {
      // Identity unknown — the child lookup below still runs.
    }
    if (name !== null && matchesHarnessProcess(name, expectedProcessNames, harness)) return Number.parseInt(pid, 10);

    try {
      const { stdout: kids } = await execAsync(`pgrep -P ${pid}`);
      for (const kid of kids.trim().split('\n').filter(Boolean)) {
        queue.push(kid);
      }
    } catch {
      // pgrep exits non-zero when there are no children — not an error.
    }
  }
  return null;
}

/**
 * Synchronous variant of {@link findAgentRuntimePidInSubtree} for the liveness
 * oracle's `isAliveSync`. Each node is a sync `ps`/`pgrep` exec — acceptable
 * for the lifecycle classifier's per-agent calls, never for a hot loop.
 */
export function findAgentRuntimePidInSubtreeSync(rootPid: string, harness: RuntimeName = 'claude-code'): number | null {
  const expectedProcessNames = new Set(getHarnessBehavior(harness).processNames);
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid) || !/^\d+$/.test(pid)) continue;
    seen.add(pid);

    // Same fall-through contract as the async variant: a failed identity
    // lookup never prunes the subtree below the pid.
    let name: string | null = null;
    try {
      name = execFileSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      // Identity unknown — the child lookup below still runs.
    }
    if (name !== null && matchesHarnessProcess(name, expectedProcessNames, harness)) return Number.parseInt(pid, 10);

    try {
      const kids = execFileSync('pgrep', ['-P', pid], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const kid of kids.trim().split('\n').filter(Boolean)) {
        queue.push(kid);
      }
    } catch {
      // pgrep exits non-zero when there are no children — not an error.
    }
  }
  return null;
}
