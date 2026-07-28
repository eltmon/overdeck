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

/**
 * Idle duration before a workspace's FULL stack is reaped (all services except
 * the dev attach target). The 10-minute UI tier only matches the overdeck
 * project's own server/frontend naming, so other projects' stacks (postgres,
 * redis, api/JVM, vite) lived forever — 35 myn-feature containers were resident
 * for agents stopped 17h+, and that idle RSS feeds the memory-governor pressure
 * that forces scheduler yields (MIN-858/MIN-891 yielded under it, 2026-07-25).
 */
const FULL_STACK_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * `<prefix->feature-<issue>-server-1` / `-frontend-1` — prefix-agnostic
 * (PAN-3049) so a `myn-feature-*` UI container is matched the same as the
 * `overdeck-feature-*` default, since the compose project name comes from
 * whatever the workspace declares (see composeProjectNameForWorkspace).
 */
const UI_CONTAINER_RE = /^(?:[a-z0-9]+-)?feature-([a-z0-9]+-\d+)-(server|frontend)-1$/i;

/** Compose project names end in `feature-<issue>` by construction (stack-health). */
const FEATURE_PROJECT_RE = /(?:^|[-_])feature-([a-z0-9]+-\d+)$/i;

/** Never stop the `dev` container — it is the operator's VS Code attach target. */
const DEV_CONTAINER_RE = /-dev-1$/i;

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

export interface ComposeContainerRef {
  name: string;
  composeProject?: string;
}

export interface IdleStackReaperDeps {
  /** Names of currently-running docker containers. */
  listContainerNames: () => Promise<string[]>;
  /** Running containers with their compose-project label (full-stack tier). */
  listComposeContainers: () => Promise<ComposeContainerRef[]>;
  /** Live tmux session names (host `overdeck` socket). */
  listSessions: () => Promise<readonly string[]>;
  /** Stop the given containers (light, reversible). */
  stopContainers: (names: string[]) => Promise<void>;
  /** Current epoch ms (injectable for tests). */
  now: () => number;
  /** Idle grace window in ms. */
  graceMs: number;
  /** Idle grace window for the full-stack tier in ms. */
  fullStackGraceMs: number;
}

function defaultDeps(): IdleStackReaperDeps {
  return {
    listContainerNames: async () => {
      const { stdout } = await execAsync(`docker ps --format '{{.Names}}'`, { timeout: 15000 });
      return stdout.split('\n').map(s => s.trim()).filter(Boolean);
    },
    listComposeContainers: async () => {
      const { stdout } = await execAsync(`docker ps --format '{{.Names}}\t{{json .Labels}}'`, { timeout: 15000 });
      const out: ComposeContainerRef[] = [];
      for (const line of stdout.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab <= 0) continue;
        const name = line.slice(0, tab).trim();
        if (!name) continue;
        try {
          const labels = JSON.parse(line.slice(tab + 1)) as Record<string, string>;
          out.push({ name, composeProject: labels['com.docker.compose.project'] });
        } catch {
          out.push({ name });
        }
      }
      return out;
    },
    listSessions: () => Effect.runPromise(listSessionNames()),
    stopContainers: async (names) => {
      if (names.length === 0) return;
      await execAsync(`docker stop ${names.map(n => `"${n}"`).join(' ')}`, { timeout: 60000 });
    },
    now: () => Date.now(),
    graceMs: GRACE_MS,
    fullStackGraceMs: FULL_STACK_GRACE_MS,
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
  // (`full:` keys belong to the full-stack tier below — they track compose
  // projects, not UI containers, and must not be pruned here.)
  for (const issue of [...firstIdleAt.keys()]) {
    if (issue.startsWith('full:')) continue;
    if (!byIssue.has(issue)) firstIdleAt.delete(issue);
  }

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

  // Full-stack tier: any compose project ending in `feature-<issue>`, idle past
  // the full grace window → stop every running service except the dev attach
  // target. Label-scoped (project-agnostic), so non-overdeck projects' stacks
  // are reaped too. docker stop keeps named volumes; the spawn path rebuilds
  // and agents restart services on demand.
  let composeContainers: ComposeContainerRef[] = [];
  try {
    composeContainers = await d.listComposeContainers();
  } catch {
    composeContainers = []; // docker not reachable for labels — skip the tier
  }

  const byProject = new Map<string, { issueLower: string; names: string[] }>();
  for (const c of composeContainers) {
    if (!c.composeProject) continue;
    const m = c.composeProject.match(FEATURE_PROJECT_RE);
    if (!m) continue;
    const entry = byProject.get(c.composeProject) ?? { issueLower: m[1].toLowerCase(), names: [] };
    entry.names.push(c.name);
    byProject.set(c.composeProject, entry);
  }

  // Forget full-tier grace clocks for projects that vanished entirely.
  for (const key of [...firstIdleAt.keys()]) {
    if (!key.startsWith('full:')) continue;
    if (!byProject.has(key.slice(5))) firstIdleAt.delete(key);
  }

  for (const [project, { issueLower, names }] of byProject) {
    const clockKey = `full:${project}`;
    if (sessionBlob.includes(issueLower)) {
      firstIdleAt.delete(clockKey); // active — reset the clock
      continue;
    }

    const since = firstIdleAt.get(clockKey);
    if (since === undefined) {
      firstIdleAt.set(clockKey, nowMs); // start the grace clock
      continue;
    }
    if (nowMs - since < d.fullStackGraceMs) continue; // still within grace

    const targets = names.filter((n) => !DEV_CONTAINER_RE.test(n));
    if (targets.length === 0) {
      firstIdleAt.delete(clockKey);
      continue; // only the dev container is left — nothing to reap
    }

    try {
      await d.stopContainers(targets);
      firstIdleAt.delete(clockKey);
      const issueId = issueLower.toUpperCase();
      const idleMin = Math.round((nowMs - since) / 60000);
      const action = `Reaped idle workspace stack for ${issueId} — stopped ${targets.length}/${names.length} container(s) in ${project} after ${idleMin}m idle (no agent, no tmux)`;
      actions.push(action);
      console.log(`[deacon] ${action}`);
      emitActivityEntrySync({
        source: 'cloister',
        level: 'info',
        issueId,
        message: `[deacon] reaped idle workspace stack for ${issueId} — ${targets.length} container(s) stopped, dev attach target preserved`,
      });
    } catch (err: any) {
      console.warn(`[deacon] idle-stack reaper: failed to stop ${project} containers: ${err?.message ?? err}`);
    }
  }

  return actions;
}
