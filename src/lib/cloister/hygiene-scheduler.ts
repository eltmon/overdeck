/**
 * Host-hygiene scheduler (PAN-3917 W4, FR-11).
 *
 * The routines here are pure host/process/disk hygiene — they never read or
 * write pipeline status. Each runs on its own plain `setInterval` at the
 * cadence `deacon.ts` used to give it, independent of the deacon-lite patrol
 * loop and of each other. No shared patrol result, no heartbeat file.
 * It also keeps remote (Fly) VMs alive and authenticated without touching pipeline status.
 */
import { patrolDockerBridgePool } from './bridge-pool-patrol.js';
import { reconcileIdleWorkspaceStacks } from './idle-stack-reaper.js';
import { patrolDiskPressure } from './disk-pressure-patrol.js';
import { patrolMemoryPressure } from './memory-pressure-patrol.js';
import { reapOrphanedDashboardServers } from './orphan-dashboard-server-reaper.js';
import { reapLeftoverPlaywrightBrowsers } from './playwright-mcp-reaper.js';
import { reapHerdrResiduePanes } from './herdr-residue-reaper.js';
import { sweepTranscriptRetention } from './transcript-retention.js';
import { sweepAgentTmpDirs } from './agent-tmp-sweep.js';
import { reapMergedStrikeWorkspaces } from './strike-workspace-reaper.js';
import { reconcileMergedIssueDocker } from './merged-docker-reconcile.js';
import { sweepOrphanedSwarmSlots } from './swarm-orphan-sweep.js';
import { refreshHostHeartbeatForEphemeralVms } from '../remote/remote-agents.js';
import { refreshClaudeCredentialsForActiveRemoteAgents } from '../remote/remote-credential-refresh.js';
import { heartbeatFlyMachines, sweepFlyMachines, syncFlyCodexAuth } from '../remote/fly-machine-loops.js';
import { loadCloisterConfigSync } from './config.js';

// Cadences carried over verbatim from deacon.ts's runPatrol/startDeacon (see
// PAN-1053 bridge pool, PAN-1817 idle stacks, PAN-1882 strike workspaces —
// all four cycles; PAN-1625 dashboard-server reaper, PAN-1706 playwright
// reaper — both ~10 minutes; the agent-state janitor cadence that gated
// transcript retention — hourly; MEMORY_PATROL_INTERVAL_MS for resource
// pressure — 15s).
const BRIDGE_POOL_INTERVAL_MS = 60_000;
const IDLE_STACK_INTERVAL_MS = 60_000;
const STRIKE_WORKSPACE_INTERVAL_MS = 60_000;
const ORPHAN_DASHBOARD_SERVER_INTERVAL_MS = 10 * 60_000;
const PLAYWRIGHT_REAPER_INTERVAL_MS = 10 * 60_000;
const HERDR_RESIDUE_INTERVAL_MS = 10 * 60_000;
const TRANSCRIPT_RETENTION_INTERVAL_MS = 60 * 60_000;
const AGENT_TMP_SWEEP_INTERVAL_MS = 60 * 60_000; // PAN-4998: hourly, like transcript retention
const RESOURCE_PRESSURE_INTERVAL_MS = 15_000;
// Both carried over from deacon.ts's 60s runScheduledPatrol cadence: the
// merged-issue Docker half of the closed-issue reaper (PAN-3917 FR-11) and the
// swarm orphan-slot GC that swarmJanitorPass ran on every patrol (PAN-2214).
const MERGED_DOCKER_INTERVAL_MS = 60_000;
const SWARM_ORPHAN_GC_INTERVAL_MS = 60_000;
// PAN-4295: both ran on deacon.ts's 60s patrol before the Cut. The heartbeat
// must stay well under the VM watchdog's 300s stale threshold, and neither
// may sit behind the deacon freeze — a frozen deacon would otherwise let
// every ephemeral watchdog stop its machine.
const REMOTE_HEARTBEAT_INTERVAL_MS = 60_000;
const REMOTE_CREDENTIAL_REFRESH_INTERVAL_MS = 60_000;

function runAndLog(name: string, fn: () => Promise<string[]>): void {
  void fn()
    .then((actions) => {
      for (const action of actions) console.log(`[hygiene-scheduler] ${name}: ${action}`);
    })
    .catch((err) => {
      console.error(`[hygiene-scheduler] ${name} failed:`, err);
    });
}

// sweepTranscriptRetention itself no-ops on an unset/invalid transcriptDays.
async function runTranscriptRetention(): Promise<string[]> {
  return sweepTranscriptRetention({ transcriptDays: loadCloisterConfigSync().retention?.transcript_days });
}

/**
 * Wrap a routine so a tick that fires while its previous pass is still running is
 * skipped. A Codex sign-in sync pass reads each VM in turn with no request timeout,
 * so it can outlast its 60 s interval; two passes deciding from different sign-in
 * snapshots could push and pull against each other (PAN-4296).
 */
function singleFlight(fn: () => Promise<string[]>): () => Promise<string[]> {
  let running = false;
  return async () => {
    if (running) return ['skipped: the previous pass is still running'];
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  };
}

let intervals: ReturnType<typeof setInterval>[] = [];

export function startHygieneScheduler(): void {
  if (intervals.length > 0) return;

  const routines: Array<[name: string, fn: () => Promise<string[]>, intervalMs: number]> = [
    ['patrolDockerBridgePool', patrolDockerBridgePool, BRIDGE_POOL_INTERVAL_MS],
    ['reconcileIdleWorkspaceStacks', reconcileIdleWorkspaceStacks, IDLE_STACK_INTERVAL_MS],
    ['reapMergedStrikeWorkspaces', reapMergedStrikeWorkspaces, STRIKE_WORKSPACE_INTERVAL_MS],
    ['reconcileMergedIssueDocker', reconcileMergedIssueDocker, MERGED_DOCKER_INTERVAL_MS],
    ['sweepOrphanedSwarmSlots', sweepOrphanedSwarmSlots, SWARM_ORPHAN_GC_INTERVAL_MS],
    ['refreshHostHeartbeatForEphemeralVms', () => refreshHostHeartbeatForEphemeralVms(), REMOTE_HEARTBEAT_INTERVAL_MS],
    ['refreshClaudeCredentialsForActiveRemoteAgents', () => refreshClaudeCredentialsForActiveRemoteAgents(), REMOTE_CREDENTIAL_REFRESH_INTERVAL_MS],
    // PAN-4652: Fly machines (linked, running pan serve) get the same heartbeat, outside the freeze for the same reason.
    ['heartbeatFlyMachines', () => heartbeatFlyMachines(), REMOTE_HEARTBEAT_INTERVAL_MS],
    ['sweepFlyMachines', () => sweepFlyMachines(), REMOTE_HEARTBEAT_INTERVAL_MS],
    // PAN-4296: Codex sign-in sync, outside the freeze too: a VM refresh must reach home
    // before home's own next refresh, or one side's refresh token is burned. One pass at a time.
    ['syncFlyCodexAuth', singleFlight(() => syncFlyCodexAuth()), REMOTE_HEARTBEAT_INTERVAL_MS],
    ['reapOrphanedDashboardServers', reapOrphanedDashboardServers, ORPHAN_DASHBOARD_SERVER_INTERVAL_MS],
    ['reapLeftoverPlaywrightBrowsers', reapLeftoverPlaywrightBrowsers, PLAYWRIGHT_REAPER_INTERVAL_MS],
    ['reapHerdrResiduePanes', reapHerdrResiduePanes, HERDR_RESIDUE_INTERVAL_MS],
    ['sweepTranscriptRetention', runTranscriptRetention, TRANSCRIPT_RETENTION_INTERVAL_MS],
    ['sweepAgentTmpDirs', () => sweepAgentTmpDirs(), AGENT_TMP_SWEEP_INTERVAL_MS],
    ['patrolDiskPressure', patrolDiskPressure, RESOURCE_PRESSURE_INTERVAL_MS],
    ['patrolMemoryPressure', patrolMemoryPressure, RESOURCE_PRESSURE_INTERVAL_MS],
  ];

  for (const [name, fn, intervalMs] of routines) {
    runAndLog(name, fn); // run once at startup, same as deacon.ts's startup patrol
    const handle = setInterval(() => runAndLog(name, fn), intervalMs);
    handle.unref?.();
    intervals.push(handle);
  }
}

export function stopHygieneScheduler(): void {
  for (const handle of intervals) clearInterval(handle);
  intervals = [];
}

/** Test seam: no production caller; tests use it to set up or observe module state (PAN-3958 CH-8). */
export function isHygieneSchedulerRunning(): boolean {
  return intervals.length > 0;
}
