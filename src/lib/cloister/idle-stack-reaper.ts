import { exec } from 'child_process';
import { promisify } from 'util';

import { Effect } from 'effect';

import { emitActivityEntrySync } from '../activity-logger.js';
import { listSessionNames } from '../tmux.js';

const execAsync = promisify(exec);

/**
 * Idle workspace-stack reaper (PAN-1817).
 *
 * Every Overdeck workspace brings up a 3-container stack: `dev` (the VS Code
 * attach target), `frontend` (Vite), and `server` (a full dashboard). The agent
 * itself runs on the HOST tmux server, not inside any of these containers — the
 * `server`/`frontend` pair is only a development-time read/UI peer for that one
 * workspace. They accumulate: nothing stops them when an agent is killed,
 * paused, or crashes, so dozens of idle stacks pile up (98 workspaces / 58
 * containers observed), wasting RAM + CPU and leaking Docker networks toward the
 * "all predefined address pools fully subnetted" wall.
 *
 * This patrol stops the `server`+`frontend` UI containers of any workspace whose
 * agent has been idle — no running agent and no live tmux session for the issue —
 * for the grace window. It is deliberately light-touch and fully reversible:
 *
 *  - It only `docker stop`s the two UI containers. It NEVER touches the `dev`
 *    container, the worktree, the feature branch, agent state, beads, or tmux.
 *  - The agent runs on host tmux, so stopping its UI peer cannot interrupt work,
 *    a review, or a resume. Worst case a human reloads a per-workspace dashboard
 *    URL and it's gone until the workspace is next spawned.
 *  - Named volumes (node_modules cache) survive, so re-spawning is cheap.
 *
 * The companion structural fix is the polling gate in IssueDataService: peer
 * dashboards (OVERDECK_DISABLE_DEACON=1) no longer poll the trackers at all, so
 * an un-reaped stack does no quota harm. This reaper is the resource-hygiene half.
 */

/** Idle duration before a workspace's UI stack is reaped. */
const GRACE_MS = 10 * 60 * 1000; // 10 minutes

/** `overdeck-feature-<issue>-server-1` / `-frontend-1`. */
const UI_CONTAINER_RE = /^overdeck-feature-([a-z0-9]+-\d+)-(server|frontend)-1$/i;

/**
 * issueLower -> epoch ms first observed idle. Module-level so the grace clock
 * survives across patrol cycles within the deacon process. Tolerates transient
 * stops (a normal stop→start restart clears before the grace elapses).
 */
const firstIdleAt = new Map<string, number>();

/** Test-only: reset the in-memory grace clock between cases. */
export function __resetIdleStackReaperState(): void {
  firstIdleAt.clear();
}

function issueLowerFromAgentId(agentId: string): string | null {
  const match = agentId.match(/^agent-([a-z0-9]+-\d+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * PAN-1908: clear the idle-stack grace clock for an issue when its agent
 * lifecycle changes (started / stopped). The patrol safety net still reaps
 * stacks whose clock has elapsed, but events drive the reset.
 */
export function handleAgentLifecycleEventForIdleStack(agentId: string): void {
  const issueLower = issueLowerFromAgentId(agentId);
  if (issueLower) {
    firstIdleAt.delete(issueLower);
  }
}

export function resetIdleStackGraceClock(issueLower: string): void {
  firstIdleAt.delete(issueLower);
}

export interface IdleStackReaperDeps {
  /** Names of currently-running docker containers. */
  listContainerNames: () => Promise<string[]>;
  /** Live tmux session names (host `overdeck` socket). */
  listSessions: () => Promise<readonly string[]>;
  /** Stop the given containers (light, reversible). */
  stopContainers: (names: string[]) => Promise<void>;
  /** Current epoch ms (injectable for tests). */
  now: () => number;
  /** Idle grace window in ms. */
  graceMs: number;
}

function defaultDeps(): IdleStackReaperDeps {
  return {
    listContainerNames: async () => {
      const { stdout } = await execAsync(`docker ps --format '{{.Names}}'`, { timeout: 15000 });
      return stdout.split('\n').map(s => s.trim()).filter(Boolean);
    },
    listSessions: () => Effect.runPromise(listSessionNames()),
    stopContainers: async (names) => {
      if (names.length === 0) return;
      await execAsync(`docker stop ${names.map(n => `"${n}"`).join(' ')}`, { timeout: 60000 });
    },
    now: () => Date.now(),
    graceMs: GRACE_MS,
  };
}

export async function reconcileIdleWorkspaceStacks(
  deps: Partial<IdleStackReaperDeps> = {},
): Promise<string[]> {
  // Operator kill-switch.
  if (process.env.OVERDECK_DISABLE_STACK_REAPER === '1') return [];

  const d = { ...defaultDeps(), ...deps };
  const actions: string[] = [];

  let containerNames: string[];
  try {
    containerNames = await d.listContainerNames();
  } catch {
    return actions; // docker not reachable — skip this cycle
  }

  // Group the server/frontend UI containers by issue.
  const byIssue = new Map<string, string[]>();
  for (const name of containerNames) {
    const m = name.match(UI_CONTAINER_RE);
    if (!m) continue;
    const issueLower = m[1].toLowerCase();
    const arr = byIssue.get(issueLower) ?? [];
    arr.push(name);
    byIssue.set(issueLower, arr);
  }

  // Forget grace clocks for issues whose UI containers are already gone.
  for (const issue of [...firstIdleAt.keys()]) {
    if (!byIssue.has(issue)) firstIdleAt.delete(issue);
  }
  if (byIssue.size === 0) return actions;

  const sessions = await d.listSessions().catch(() => [] as readonly string[]);
  // Any tmux session for the issue (agent / review / test / inspect / strike)
  // means the workspace is in use — its name embeds the lowercased issue id.
  const sessionBlob = sessions.join('\n').toLowerCase();
  const nowMs = d.now();

  for (const [issueLower, names] of byIssue) {
    if (sessionBlob.includes(issueLower)) {
      firstIdleAt.delete(issueLower); // active — reset the clock
      continue;
    }

    const since = firstIdleAt.get(issueLower);
    if (since === undefined) {
      firstIdleAt.set(issueLower, nowMs); // start the grace clock
      continue;
    }
    if (nowMs - since < d.graceMs) continue; // still within grace

    try {
      await d.stopContainers(names);
      firstIdleAt.delete(issueLower);
      const issueId = issueLower.toUpperCase();
      const idleMin = Math.round((nowMs - since) / 60000);
      const action = `Reaped idle workspace UI stack for ${issueId} — stopped ${names.length} container(s) after ${idleMin}m idle (no agent, no tmux)`;
      actions.push(action);
      console.log(`[deacon] ${action}`);
      emitActivityEntrySync({
        source: 'cloister',
        level: 'info',
        issueId,
        message: `[deacon] reaped idle workspace UI stack for ${issueId} — server+frontend stopped (PAN-1817)`,
      });
    } catch (err: any) {
      console.warn(`[deacon] idle-stack reaper: failed to stop ${issueLower} UI containers: ${err?.message ?? err}`);
    }
  }

  return actions;
}
