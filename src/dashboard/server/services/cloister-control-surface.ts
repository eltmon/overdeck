import { Effect } from 'effect';
import { listRunningAgents } from '../../../lib/agents.js';
import { loadCloisterConfigSync } from '../../../lib/cloister/config.js';
import { getDeaconLiteStatus, type DeaconLiteStatus } from '../../../lib/cloister/deacon-lite.js';
import { generateHealthSummary, getAgentHealth, getAgentsNeedingAttention } from '../../../lib/cloister/health.js';
import { readCloisterStateFile, type CloisterStatus } from '../../../lib/cloister/service.js';
import { isCloisterSpawnsPaused, setCloisterSpawnsPaused } from '../../../lib/overdeck/control-settings.js';
import { getRuntimeForAgent } from '../../../lib/runtimes/index.js';
import {
  isChildRunning,
  reloadDeaconConfig,
  sendPatrolNow,
  startDeaconChild,
  stopDeaconChild,
} from './deacon-supervisor.js';

export interface CloisterControlDeps {
  readCloisterStateFile?: typeof readCloisterStateFile;
  startDeaconChild?: typeof startDeaconChild;
  stopDeaconChild?: typeof stopDeaconChild;
  sendPatrolNow?: typeof sendPatrolNow;
  reloadDeaconConfig?: typeof reloadDeaconConfig;
  isChildRunning?: typeof isChildRunning;
  readDeaconLiteStatus?: typeof getDeaconLiteStatus;
  readSpawnPaused?: typeof isCloisterSpawnsPaused;
  writeSpawnPaused?: typeof setCloisterSpawnsPaused;
}

/**
 * PAN-3917 W4: deacon-lite keeps no heartbeat file and no patrol-result
 * aggregation, so status here is derived from its in-memory
 * running/lastRunAt/lastRunError only — never from a stored artifact.
 */
export async function readDurableCloisterStatus(deps: CloisterControlDeps = {}): Promise<CloisterStatus> {
  const cloisterState = (deps.readCloisterStateFile ?? readCloisterStateFile)();
  const deaconLite = (deps.readDeaconLiteStatus ?? getDeaconLiteStatus)();
  const agentHealths = (await Effect.runPromise(listRunningAgents()))
    .filter((agent) => agent.tmuxActive)
    .flatMap((agent) => {
      const runtime = getRuntimeForAgent(agent.id);
      return runtime ? [getAgentHealth(agent.id, runtime)] : [];
    });

  return {
    running: cloisterState.running,
    lastCheck: deaconLite.lastRunAt ? new Date(deaconLite.lastRunAt) : null,
    config: loadCloisterConfigSync(),
    summary: generateHealthSummary(agentHealths),
    agentsNeedingAttention: getAgentsNeedingAttention(agentHealths).map((health) => health.agentId),
    patrol: deaconLite,
  };
}

export async function startDurableCloister(deps: CloisterControlDeps = {}): Promise<boolean> {
  return (deps.startDeaconChild ?? startDeaconChild)();
}

export async function stopDurableCloister(deps: CloisterControlDeps = {}): Promise<void> {
  await (deps.stopDeaconChild ?? stopDeaconChild)();
}

export function resumeDurableSpawns(deps: CloisterControlDeps = {}): void {
  (deps.writeSpawnPaused ?? setCloisterSpawnsPaused)(false);
}

export function areDurableSpawnsPaused(deps: CloisterControlDeps = {}): boolean {
  return (deps.readSpawnPaused ?? isCloisterSpawnsPaused)();
}

export function readDurableDeaconStatus(deps: CloisterControlDeps = {}): {
  isRunning: boolean;
  pid: number | null;
  startedAt: string | null;
  deaconLite: DeaconLiteStatus;
} {
  const cloisterState = (deps.readCloisterStateFile ?? readCloisterStateFile)();
  const deaconLite = (deps.readDeaconLiteStatus ?? getDeaconLiteStatus)();
  return {
    isRunning: cloisterState.running,
    pid: cloisterState.pid ?? null,
    startedAt: cloisterState.startedAt ?? null,
    deaconLite,
  };
}

/** Deacon-lite keeps no log ring — always empty (PAN-3917 W4: no patrol-result aggregation). */
export function readDurableDeaconLogs(_limit = 100): [] {
  return [];
}

export function requestDurablePatrol(deps: CloisterControlDeps = {}): { accepted: true } | { accepted: false } {
  if ((deps.isChildRunning ?? isChildRunning)() === false) return { accepted: false };
  return (deps.sendPatrolNow ?? sendPatrolNow)() ? { accepted: true } : { accepted: false };
}

export function reloadDurableCloisterConfig(deps: CloisterControlDeps = {}): { accepted: true } | { accepted: false } {
  if ((deps.isChildRunning ?? isChildRunning)() === false) return { accepted: false };
  return (deps.reloadDeaconConfig ?? reloadDeaconConfig)() ? { accepted: true } : { accepted: false };
}
