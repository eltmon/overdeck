import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listRunningAgentsSync } from '../../../lib/agents.js';
import { loadCloisterConfigSync } from '../../../lib/cloister/config.js';
import {
  assessDeaconPatrolFreshness,
  getDeaconLogs,
  loadConfig as loadDeaconConfig,
  loadState as loadDeaconState,
  type DeaconLogEntry,
  type PatrolResult,
} from '../../../lib/cloister/deacon.js';
import { generateHealthSummary, getAgentHealth, getAgentsNeedingAttention } from '../../../lib/cloister/health.js';
import { readCloisterStateFile, type CloisterStatus } from '../../../lib/cloister/service.js';
import { isCloisterSpawnsPausedSync, setCloisterSpawnsPausedSync } from '../../../lib/overdeck/control-settings.js';
import { OVERDECK_HOME } from '../../../lib/paths.js';
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
  readDeaconState?: typeof loadDeaconState;
  readDeaconConfig?: typeof loadDeaconConfig;
  readSpawnPaused?: typeof isCloisterSpawnsPausedSync;
  writeSpawnPaused?: typeof setCloisterSpawnsPausedSync;
}

export function readDurableCloisterStatus(deps: CloisterControlDeps = {}): CloisterStatus {
  const cloisterState = (deps.readCloisterStateFile ?? readCloisterStateFile)();
  const deaconState = (deps.readDeaconState ?? loadDeaconState)();
  const deaconConfig = (deps.readDeaconConfig ?? loadDeaconConfig)();
  const agentHealths = listRunningAgentsSync()
    .filter((agent) => agent.tmuxActive)
    .flatMap((agent) => {
      const runtime = getRuntimeForAgent(agent.id);
      return runtime ? [getAgentHealth(agent.id, runtime)] : [];
    });
  const patrol = assessDeaconPatrolFreshness({
    isRunning: cloisterState.running,
    lastPatrol: deaconState.lastPatrol,
    patrolIntervalMs: deaconConfig.patrolIntervalMs,
  });

  return {
    running: cloisterState.running,
    lastCheck: deaconState.lastPatrol ? new Date(deaconState.lastPatrol) : null,
    config: loadCloisterConfigSync(),
    summary: generateHealthSummary(agentHealths),
    agentsNeedingAttention: getAgentsNeedingAttention(agentHealths).map((health) => health.agentId),
    patrol: {
      ...patrol,
      loopRunning: cloisterState.running,
      patrolIntervalMs: deaconConfig.patrolIntervalMs,
    },
  };
}

export async function startDurableCloister(deps: CloisterControlDeps = {}): Promise<boolean> {
  return (deps.startDeaconChild ?? startDeaconChild)();
}

export async function stopDurableCloister(deps: CloisterControlDeps = {}): Promise<void> {
  await (deps.stopDeaconChild ?? stopDeaconChild)();
}

export function resumeDurableSpawns(deps: CloisterControlDeps = {}): void {
  (deps.writeSpawnPaused ?? setCloisterSpawnsPausedSync)(false);
}

export function areDurableSpawnsPaused(deps: CloisterControlDeps = {}): boolean {
  return (deps.readSpawnPaused ?? isCloisterSpawnsPausedSync)();
}

export function readDurableDeaconStatus(deps: CloisterControlDeps = {}) {
  const cloisterState = (deps.readCloisterStateFile ?? readCloisterStateFile)();
  const deaconState = (deps.readDeaconState ?? loadDeaconState)();
  const lastPatrol = deaconState.lastPatrolResult
    ? {
        cycle: deaconState.lastPatrolResult.cycle,
        timestamp: deaconState.lastPatrolResult.timestamp,
        actions: deaconState.lastPatrolResult.actionsToken,
        massDeathDetected: deaconState.lastPatrolResult.massDeathDetected,
      }
    : null;

  return {
    isRunning: cloisterState.running,
    pid: cloisterState.pid ?? null,
    startedAt: cloisterState.startedAt ?? null,
    config: (deps.readDeaconConfig ?? loadDeaconConfig)(),
    state: deaconState,
    lastPatrol,
  };
}

export function readDurableDeaconLogs(limit = 100): DeaconLogEntry[] {
  return getDeaconLogs(Math.min(limit, 200));
}

export function requestDurablePatrol(deps: CloisterControlDeps = {}): { accepted: true } | { accepted: false } {
  if ((deps.isChildRunning ?? isChildRunning)() === false) return { accepted: false };
  return (deps.sendPatrolNow ?? sendPatrolNow)() ? { accepted: true } : { accepted: false };
}

export function reloadDurableCloisterConfig(deps: CloisterControlDeps = {}): { accepted: true } | { accepted: false } {
  if ((deps.isChildRunning ?? isChildRunning)() === false) return { accepted: false };
  return (deps.reloadDeaconConfig ?? reloadDeaconConfig)() ? { accepted: true } : { accepted: false };
}

export function readLastPatrolResultArtifact(): PatrolResult | null {
  const path = join(OVERDECK_HOME, 'deacon', 'health-state.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { lastPatrolResult?: PatrolResult };
    return parsed.lastPatrolResult ?? null;
  } catch {
    return null;
  }
}
