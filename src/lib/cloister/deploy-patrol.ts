import { open, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { getBuildInfo } from '../deploy/build-info.js';
import {
  clearPendingDeploy,
  markPendingDeployEscalated,
  readPendingDeploy,
  recordDeployIntent,
  type PendingDeploy,
} from '../deploy/deploy-queue.js';
import {
  getDeployWindowAssessment,
  type DeployWindowAssessment,
} from '../deploy/deploy-window.js';
import { computeBuildStaleness, type BuildStaleness } from '../deploy/staleness.js';
import { OVERDECK_HOME } from '../paths.js';
import { loadCloisterConfigSync, type DeployConfig } from './config.js';

const OBSERVATION_INTERVAL_MS = 30 * 60 * 1000;
const DEPLOY_SPAWN_COOLDOWN_MS = 10 * 60 * 1000;
const DEPLOY_PATROL_INITIATOR = 'deploy-patrol';
const CI_WORKFLOW_FILE = 'ci.yml';
const CI_RUN_FIELDS = 'databaseId,status,conclusion,headSha,attempt,createdAt';
const SYSTEMD_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface DeployPatrolState {
  lastObservedBehind: number | null;
  lastObservationAt: number;
  lastDeferralReason: string | null;
  lastDeferralAt: number;
  lastDeploySpawnAt: number;
  lastEscalationReason: string | null;
  lastEscalationAt: number;
  unknownObserved: boolean;
}

const state: DeployPatrolState = {
  lastObservedBehind: null,
  lastObservationAt: 0,
  lastDeferralReason: null,
  lastDeferralAt: 0,
  lastDeploySpawnAt: 0,
  lastEscalationReason: null,
  lastEscalationAt: 0,
  unknownObserved: false,
};

type EmitEntry = typeof emitActivityEntrySync;
type EmitTts = typeof emitActivityTtsSync;

export interface DeployCiState {
  readonly status: 'green' | 'pending' | 'red' | 'unknown';
  readonly reason?: string;
}

interface DeployCiRun {
  readonly databaseId: number;
  readonly status: string;
  readonly conclusion: string | null;
  readonly headSha: string;
  readonly attempt: number;
  readonly createdAt: string;
}

export interface DeployPatrolContext {
  readonly repoRoot: string;
  readonly config: DeployConfig;
  readonly computeStaleness?: () => Promise<BuildStaleness>;
  readonly getCiState?: (sha: string) => Promise<DeployCiState>;
  readonly getWindowAssessment?: () => Promise<DeployWindowAssessment>;
  readonly readQueue?: typeof readPendingDeploy;
  readonly clearQueue?: typeof clearPendingDeploy;
  readonly recordIntent?: typeof recordDeployIntent;
  readonly markQueueEscalated?: typeof markPendingDeployEscalated;
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
  readonly initiator: string;
}

function reloadEnvironment(request: ReloadRequest, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, OVERDECK_AGENT_ID: request.initiator };
}

function execGh(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', [...args], { cwd, encoding: 'utf8', timeout: 30_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export async function getDeployCiState(
  repoRoot: string,
  sha: string,
  runGh: (args: readonly string[], cwd: string) => Promise<string> = execGh,
): Promise<DeployCiState> {
  try {
    const runs = JSON.parse(await runGh([
      'run', 'list',
      '--branch', 'main',
      '--commit', sha,
      '--workflow', CI_WORKFLOW_FILE,
      '--limit', '10',
      '--json', CI_RUN_FIELDS,
    ], repoRoot)) as DeployCiRun[];
    const run = runs.find((candidate) => candidate.headSha === sha);
    const tip = shortSha(sha);

    if (!run) {
      return {
        status: 'pending',
        reason: `Automatic deployment deferred because CI has not started for origin/main ${tip}.`,
      };
    }
    if (run.status !== 'completed') {
      return {
        status: 'pending',
        reason: `Automatic deployment deferred because CI is ${run.status} for origin/main ${tip}.`,
      };
    }
    if (run.conclusion !== 'success') {
      return {
        status: 'red',
        reason: `Automatic deployment blocked because CI concluded ${run.conclusion || 'without a result'} for origin/main ${tip}.`,
      };
    }
    return { status: 'green' };
  } catch (error) {
    return {
      status: 'unknown',
      reason: `Automatic deployment deferred because CI status for origin/main ${shortSha(sha)} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function buildSystemdReloadArgs(
  request: ReloadRequest,
  now: number,
  logPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const setenvArgs = Object.entries(reloadEnvironment(request, env))
    .filter(([name, value]) => value !== undefined && SYSTEMD_ENV_NAME_RE.test(name))
    .flatMap(([name, value]) => ['--setenv', `${name}=${value}`]);

  return [
    '--user', '--unit', `overdeck-auto-deploy-${now}`,
    '--collect', '--quiet',
    '--property=Restart=on-failure',
    '--property=RestartSec=10s',
    '--property=StartLimitBurst=2',
    '--property=StartLimitIntervalSec=300s',
    `--property=StandardOutput=append:${logPath}`,
    `--property=StandardError=append:${logPath}`,
    `--property=WorkingDirectory=${request.cwd}`,
    ...setenvArgs,
    request.command,
    ...request.args,
  ];
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

async function waitForChildExit(child: ChildProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function spawnDetachedReload(request: ReloadRequest, now: number): Promise<void> {
  const logsDir = join(OVERDECK_HOME, 'logs');
  const logPath = join(logsDir, 'auto-deploy.log');
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    join(OVERDECK_HOME, 'dashboard-restarting.json'),
    JSON.stringify({ reason: 'auto-deploy', trigger: 'deacon', timestamp: now }, null, 2),
    'utf8',
  );

  const log = await open(logPath, 'a');
  try {
    if (process.platform === 'linux') {
      let systemdFailure: string | null = null;
      try {
        const launcher = spawn(
          'systemd-run',
          buildSystemdReloadArgs(request, now, logPath),
          {
            cwd: request.cwd,
            stdio: ['ignore', log.fd, log.fd],
          },
        );
        const exitCode = await waitForChildExit(launcher);
        if (exitCode === 0) return;
        systemdFailure = `systemd-run exited ${exitCode}`;
      } catch (error) {
        systemdFailure = error instanceof Error ? error.message : String(error);
      }
      await log.appendFile(
        `[auto-deploy] WARNING: ${systemdFailure}; falling back to an unsupervised detached reload.\n`,
        'utf8',
      );
    }

    const child = spawn(
      request.command,
      [...request.args],
      {
        cwd: request.cwd,
        detached: request.detached,
        env: reloadEnvironment(request, process.env),
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
  state.lastEscalationReason = null;
  state.lastEscalationAt = 0;
  state.unknownObserved = false;
}

function emitDeferral(reason: string, now: number, emitEntry: EmitEntry): void {
  if (
    state.lastDeferralReason === reason &&
    now - state.lastDeferralAt < OBSERVATION_INTERVAL_MS
  ) return;

  emitEntry({
    source: 'deploy-script',
    level: 'warn',
    message: reason,
  });
  state.lastDeferralReason = reason;
  state.lastDeferralAt = now;
}

async function escalateOverdueQueue(
  queuedDeploy: PendingDeploy | null,
  blockReason: string,
  context: DeployPatrolContext,
  now: number,
  emitEntry: EmitEntry,
  emitTts: EmitTts,
): Promise<void> {
  if (
    !queuedDeploy
    || queuedDeploy.escalated
    || now - Date.parse(queuedDeploy.requestedAt) <= context.config.queue_deadline_minutes * 60_000
  ) return;

  const ageMinutes = Math.floor((now - Date.parse(queuedDeploy.requestedAt)) / 60_000);
  const message = `Queued dashboard deploy has waited ${ageMinutes} minutes; current block: ${blockReason}`;
  if (
    state.lastEscalationReason !== blockReason
    || now - state.lastEscalationAt >= OBSERVATION_INTERVAL_MS
  ) {
    emitEntry({ source: 'deploy-script', level: 'error', message });
    emitTts({
      utterance: `Dashboard deploy has been queued for ${ageMinutes} minutes and needs attention.`,
      priority: 1,
      source: 'deploy-script',
      eventType: 'deploy_queue_stuck',
    });
    state.lastEscalationReason = blockReason;
    state.lastEscalationAt = now;
  }

  await (context.markQueueEscalated ?? markPendingDeployEscalated)();
}

export async function runDeployPatrol(context: DeployPatrolContext): Promise<void> {
  const now = (context.now ?? Date.now)();
  const emitEntry = context.emitEntry ?? emitActivityEntrySync;
  const emitTts = context.emitTts ?? emitActivityTtsSync;
  const staleness = await (context.computeStaleness ?? (() => computeBuildStaleness({
    repoRoot: context.repoRoot,
    buildCommit: getBuildInfo().buildCommit,
  })))();
  const queuedDeploy = await (context.readQueue ?? readPendingDeploy)();

  if (staleness.status === 'unknown') {
    const reason = `Automatic deployment cannot compare the running build with origin/main: ${staleness.reason ?? 'build staleness is unknown'}`;
    if (!state.unknownObserved) {
      emitEntry({
        source: 'deploy-script',
        level: 'warn',
        message: reason,
      });
      state.unknownObserved = true;
    }
    await escalateOverdueQueue(queuedDeploy, reason, context, now, emitEntry, emitTts);
    return;
  }

  if (staleness.status === 'fresh') {
    clearState();
    await (context.clearQueue ?? clearPendingDeploy)();
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
      message: `The running build ${shortSha(staleness.buildCommit)} is ${behind} build-input commit(s) behind origin/main ${shortSha(staleness.originMainSha)}. ${context.config.auto_deploy || queuedDeploy ? 'Automatic deployment will start after the merge debounce and safety checks clear.' : 'Automatic deployment is disabled, so operator action is required.'}`,
    });
    state.lastObservedBehind = behind;
    state.lastObservationAt = now;
  }

  if (!context.config.auto_deploy && !queuedDeploy) return;
  if (
    staleness.originMainLastBuildInputCommitAt !== null
    && now - staleness.originMainLastBuildInputCommitAt < context.config.debounce_minutes * 60 * 1000
  ) {
    const reason = 'Automatic deployment deferred because the merge debounce has not elapsed.';
    await escalateOverdueQueue(queuedDeploy, reason, context, now, emitEntry, emitTts);
    return;
  }
  if (state.lastDeploySpawnAt > 0 && now - state.lastDeploySpawnAt < DEPLOY_SPAWN_COOLDOWN_MS) {
    const reason = 'Automatic deployment deferred because a recent deploy is still inside the spawn cooldown.';
    await escalateOverdueQueue(queuedDeploy, reason, context, now, emitEntry, emitTts);
    return;
  }

  if (!staleness.originMainSha) {
    const reason = 'Automatic deployment deferred because the origin/main commit is unknown.';
    emitDeferral(reason, now, emitEntry);
    await escalateOverdueQueue(queuedDeploy, reason, context, now, emitEntry, emitTts);
    return;
  }
  const ciState = await (context.getCiState ?? ((sha) => getDeployCiState(context.repoRoot, sha)))(staleness.originMainSha);
  if (ciState.status !== 'green') {
    const reason = ciState.reason
      ?? `Automatic deployment deferred because CI is ${ciState.status} for origin/main ${shortSha(staleness.originMainSha)}.`;
    emitDeferral(reason, now, emitEntry);
    await escalateOverdueQueue(queuedDeploy, reason, context, now, emitEntry, emitTts);
    return;
  }

  const assessment = await (context.getWindowAssessment ?? getDeployWindowAssessment)();
  if (assessment.reason) {
    emitDeferral(assessment.reason, now, emitEntry);
    if (context.config.auto_deploy) {
      await (context.recordIntent ?? recordDeployIntent)({
        requestedBy: DEPLOY_PATROL_INITIATOR,
        reason: assessment.reason,
        blockedBy: [],
      });
    }
    await escalateOverdueQueue(
      queuedDeploy,
      assessment.reason,
      context,
      now,
      emitEntry,
      emitTts,
    );
    return;
  }

  const reloadRequest: ReloadRequest = {
    command: process.execPath,
    args: [join(context.repoRoot, 'dist/cli/index.js'), 'reload', '--health-timeout', '120000'],
    cwd: context.repoRoot,
    detached: true,
    initiator: DEPLOY_PATROL_INITIATOR,
  };
  await (context.spawnReload ?? ((request) => spawnDetachedReload(request, now)))(reloadRequest);
  state.lastDeploySpawnAt = now;
  state.lastDeferralReason = null;
  state.lastDeferralAt = 0;
  emitEntry({
    source: 'deploy-script',
    level: 'info',
    message: `Automatic deployment started for origin/main ${shortSha(staleness.originMainSha)}; the dashboard will rebuild and restart with a 120-second health timeout.${queuedDeploy ? ` This was a queued deploy requested by ${queuedDeploy.requestedBy.join(', ')}.` : ''}`,
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
