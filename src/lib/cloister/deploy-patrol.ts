import { open, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { getBuildInfo } from '../deploy/build-info.js';
import { getDeployBlockReason } from '../deploy/deploy-window.js';
import { computeBuildStaleness, type BuildStaleness } from '../deploy/staleness.js';
import { OVERDECK_HOME } from '../paths.js';
import { loadCloisterConfigSync, type DeployConfig } from './config.js';

const OBSERVATION_INTERVAL_MS = 30 * 60 * 1000;
const DEPLOY_SPAWN_COOLDOWN_MS = 10 * 60 * 1000;

interface DeployPatrolState {
  lastObservedBehind: number | null;
  lastObservationAt: number;
  lastDeferralReason: string | null;
  lastDeferralAt: number;
  lastDeploySpawnAt: number;
  unknownObserved: boolean;
}

const state: DeployPatrolState = {
  lastObservedBehind: null,
  lastObservationAt: 0,
  lastDeferralReason: null,
  lastDeferralAt: 0,
  lastDeploySpawnAt: 0,
  unknownObserved: false,
};

type EmitEntry = typeof emitActivityEntrySync;
type EmitTts = typeof emitActivityTtsSync;

export interface DeployPatrolContext {
  readonly repoRoot: string;
  readonly config: DeployConfig;
  readonly computeStaleness?: () => Promise<BuildStaleness>;
  readonly getBlockReason?: () => Promise<string | null>;
  readonly spawnReload?: (request: ReloadRequest) => Promise<void>;
  readonly emitEntry?: EmitEntry;
  readonly emitTts?: EmitTts;
  readonly now?: () => number;
}

export interface ReloadRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly detached: true;
}

function shortSha(sha: string | null): string {
  return sha?.slice(0, 8) || 'unknown';
}

export async function waitForChildSpawn(
  child: Pick<ChildProcess, 'once' | 'removeListener' | 'unref'>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      cleanup();
      child.unref();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
    };

    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function spawnDetachedReload(request: ReloadRequest, now: number): Promise<void> {
  const logsDir = join(OVERDECK_HOME, 'logs');
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    join(OVERDECK_HOME, 'dashboard-restarting.json'),
    JSON.stringify({ reason: 'auto-deploy', trigger: 'deacon', timestamp: now }, null, 2),
    'utf8',
  );

  const log = await open(join(logsDir, 'auto-deploy.log'), 'a');
  try {
    const child = spawn(
      request.command,
      [...request.args],
      {
        cwd: request.cwd,
        detached: request.detached,
        stdio: ['ignore', log.fd, log.fd],
      },
    );
    await waitForChildSpawn(child);
  } finally {
    await log.close();
  }
}

function clearState(): void {
  state.lastObservedBehind = null;
  state.lastObservationAt = 0;
  state.lastDeferralReason = null;
  state.lastDeferralAt = 0;
  state.lastDeploySpawnAt = 0;
  state.unknownObserved = false;
}

export async function runDeployPatrol(context: DeployPatrolContext): Promise<void> {
  const now = (context.now ?? Date.now)();
  const emitEntry = context.emitEntry ?? emitActivityEntrySync;
  const emitTts = context.emitTts ?? emitActivityTtsSync;
  const staleness = await (context.computeStaleness ?? (() => computeBuildStaleness({
    repoRoot: context.repoRoot,
    buildCommit: getBuildInfo().buildCommit,
  })))();

  if (staleness.status === 'unknown') {
    if (!state.unknownObserved) {
      emitEntry({
        source: 'deploy-script',
        level: 'warn',
        message: `Automatic deployment cannot compare the running build with origin/main: ${staleness.reason ?? 'build staleness is unknown'}`,
      });
      state.unknownObserved = true;
    }
    return;
  }

  if (staleness.status === 'fresh') {
    clearState();
    return;
  }

  state.unknownObserved = false;
  const behind = staleness.behindBuildInputs ?? 0;
  if (
    state.lastObservedBehind !== behind ||
    now - state.lastObservationAt >= OBSERVATION_INTERVAL_MS
  ) {
    emitEntry({
      source: 'deploy-script',
      level: 'warn',
      message: `The running build ${shortSha(staleness.buildCommit)} is ${behind} build-input commit(s) behind origin/main ${shortSha(staleness.originMainSha)}. ${context.config.auto_deploy ? 'Automatic deployment will start after the merge debounce and safety checks clear.' : 'Automatic deployment is disabled, so operator action is required.'}`,
    });
    state.lastObservedBehind = behind;
    state.lastObservationAt = now;
  }

  if (!context.config.auto_deploy) return;
  if (
    staleness.originMainLastCommitAt !== null &&
    now - staleness.originMainLastCommitAt < context.config.debounce_minutes * 60 * 1000
  ) return;
  if (state.lastDeploySpawnAt > 0 && now - state.lastDeploySpawnAt < DEPLOY_SPAWN_COOLDOWN_MS) return;

  const blockReason = await (context.getBlockReason ?? getDeployBlockReason)();
  if (blockReason) {
    if (
      state.lastDeferralReason !== blockReason ||
      now - state.lastDeferralAt >= OBSERVATION_INTERVAL_MS
    ) {
      emitEntry({
        source: 'deploy-script',
        level: 'warn',
        message: blockReason,
      });
      state.lastDeferralReason = blockReason;
      state.lastDeferralAt = now;
    }
    return;
  }

  const reloadRequest: ReloadRequest = {
    command: process.execPath,
    args: [join(context.repoRoot, 'dist/cli/index.js'), 'reload', '--health-timeout', '120000'],
    cwd: context.repoRoot,
    detached: true,
  };
  await (context.spawnReload ?? ((request) => spawnDetachedReload(request, now)))(reloadRequest);
  state.lastDeploySpawnAt = now;
  state.lastDeferralReason = null;
  state.lastDeferralAt = 0;
  emitEntry({
    source: 'deploy-script',
    level: 'info',
    message: `Automatic deployment started for origin/main ${shortSha(staleness.originMainSha)}; the dashboard will rebuild and restart with a 120-second health timeout.`,
  });
  emitTts({
    utterance: 'Automatic dashboard deployment started.',
    priority: 2,
    source: 'deploy-script',
    eventType: 'auto_deploy_started',
  });
}

export function _resetDeployPatrolForTests(): void {
  clearState();
}

export async function runScheduledDeployPatrol(): Promise<void> {
  try {
    await runDeployPatrol({
      repoRoot: process.cwd(),
      config: loadCloisterConfigSync().deploy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[deacon] Automatic deploy patrol failed: ${message}`);
  }
}
