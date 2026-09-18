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
 * One subtree walk ends in three states: the runtime pid, null when the
 * tree was cleanly observed to hold no harness process, or 'indeterminate'
 * when a probe exec itself failed. An unavailable probe is not evidence of
 * a dead process — callers must treat it as "not dead".
 */
export type RuntimePidProbeResult = number | null | 'indeterminate';

/**
 * ps/pgrep report a clean "no match" with exit status 1 (pid gone, no
 * children) — verified against procps-ng. Anything else (ENOENT, status 2,
 * signals) means the probe could not observe the tree.
 */
function isCleanProcessLookupMiss(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { status?: unknown; code?: unknown };
  return record.status === 1 || record.code === 1;
}

/**
 * BFS-walk a process subtree rooted at `rootPid` looking for the active agent
 * runtime. Returns the matching process's pid, null when the tree was
 * cleanly observed to hold no match, or 'indeterminate' when a probe exec
 * itself failed (an unavailable probe is not evidence of a dead process).
 *
 * pane_pid is the tmux pane's root process, which is bash for work-agent
 * launchers (`bash launcher.sh`) but can be the runtime directly for
 * specialists (`exec claude ...` / `exec pi ...`).
 */
export async function findAgentRuntimePidInSubtree(rootPid: string, harness: RuntimeName = 'claude-code'): Promise<RuntimePidProbeResult> {
  const expectedProcessNames = new Set(getHarnessBehavior(harness).processNames);
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  let probeFailed = false;
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    // A non-numeric pid is tmux garbage, not a process tree — the probe
    // cannot run here, so this is indeterminate, never confirmed absence.
    if (!/^\d+$/.test(pid)) { probeFailed = true; continue; }

    // A failed identity lookup must not prune the subtree below this pid: a
    // transient `ps` failure at the pane root would otherwise read a healthy
    // harness further down as absent. Fall through to the child lookup.
    let name: string | null = null;
    try {
      const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm=`);
      name = comm.trim();
    } catch (error) {
      // Identity unknown — the child lookup below still runs. A clean miss
      // (pid gone) is absence evidence; any other failure taints the walk.
      if (!isCleanProcessLookupMiss(error)) probeFailed = true;
    }
    if (name !== null && matchesHarnessProcess(name, expectedProcessNames, harness)) return Number.parseInt(pid, 10);

    try {
      const { stdout: kids } = await execAsync(`pgrep -P ${pid}`);
      for (const kid of kids.trim().split('\n').filter(Boolean)) {
        queue.push(kid);
      }
    } catch (error) {
      // pgrep exits non-zero when there are no children — not an error.
      // Anything else leaves the subtree below unobserved: indeterminate.
      if (!isCleanProcessLookupMiss(error)) probeFailed = true;
    }
  }
  return probeFailed ? 'indeterminate' : null;
}

/**
 * Synchronous variant of {@link findAgentRuntimePidInSubtree} for the liveness
 * oracle's `isAliveSync`. Each node is a sync `ps`/`pgrep` exec — acceptable
 * for the lifecycle classifier's per-agent calls, never for a hot loop.
 */
export function findAgentRuntimePidInSubtreeSync(rootPid: string, harness: RuntimeName = 'claude-code'): RuntimePidProbeResult {
  const expectedProcessNames = new Set(getHarnessBehavior(harness).processNames);
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  let probeFailed = false;
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    // A non-numeric pid is tmux garbage, not a process tree — the probe
    // cannot run here, so this is indeterminate, never confirmed absence.
    if (!/^\d+$/.test(pid)) { probeFailed = true; continue; }

    // Same fall-through contract as the async variant: a failed identity
    // lookup never prunes the subtree below the pid.
    let name: string | null = null;
    try {
      name = execFileSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (error) {
      // Identity unknown — the child lookup below still runs. A clean miss
      // (pid gone, status 1) is absence evidence; any other failure taints
      // the walk.
      if (!isCleanProcessLookupMiss(error)) probeFailed = true;
    }
    if (name !== null && matchesHarnessProcess(name, expectedProcessNames, harness)) return Number.parseInt(pid, 10);

    try {
      const kids = execFileSync('pgrep', ['-P', pid], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const kid of kids.trim().split('\n').filter(Boolean)) {
        queue.push(kid);
      }
    } catch (error) {
      // pgrep exits 1 when there are no children — not an error. Anything
      // else leaves the subtree below unobserved: indeterminate.
      if (!isCleanProcessLookupMiss(error)) probeFailed = true;
    }
  }
  return probeFailed ? 'indeterminate' : null;
}
