import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { emitActivityEntrySync } from '../../../lib/activity-logger.js';
import { readCloisterStateFile } from '../../../lib/cloister/service.js';

export interface DeaconSupervisorDeps {
  fork?: typeof fork;
  readState?: typeof readCloisterStateFile;
  emitActivity?: typeof emitActivityEntrySync;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  killPid?: (pid: number, signal: NodeJS.Signals | 0) => void;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
  restartWindowMs?: number;
  restartDelayMs?: number;
  maxRestarts?: number;
  shutdownGraceMs?: number;
}

export interface DeaconSupervisor {
  startDeaconChild(): Promise<boolean>;
  stopDeaconChild(): Promise<void>;
  sendPatrolNow(): boolean;
  isChildRunning(): boolean;
}

const DEFAULT_RESTART_WINDOW_MS = 60_000;
const DEFAULT_RESTART_DELAY_MS = 1_000;
const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultDeaconScriptPath(): string {
  return resolve(import.meta.dirname, 'deacon.js');
}

function internalDashboardUrl(env: NodeJS.ProcessEnv): string {
  const port = Number.parseInt(env.API_PORT ?? env.PORT ?? '3011', 10);
  return env.OVERDECK_INTERNAL_DASHBOARD_URL ?? `http://127.0.0.1:${port}`;
}

function buildChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...source,
    OVERDECK_INTERNAL_DASHBOARD_URL: internalDashboardUrl(source),
  };
  delete childEnv.OVERDECK_DISABLE_DEACON;
  return childEnv;
}

export function createDeaconSupervisor(deps: DeaconSupervisorDeps = {}): DeaconSupervisor {
  const forkImpl = deps.fork ?? fork;
  const readState = deps.readState ?? readCloisterStateFile;
  const emitActivity = deps.emitActivity ?? emitActivityEntrySync;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimeout ?? setTimeout;
  const clearTimer = deps.clearTimeout ?? clearTimeout;
  const killPid = deps.killPid ?? ((pid, signal) => process.kill(pid, signal));
  const sourceEnv = deps.env ?? process.env;
  const restartWindowMs = deps.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
  const restartDelayMs = deps.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
  const maxRestarts = deps.maxRestarts ?? parsePositiveInt(sourceEnv.OVERDECK_SUPERVISOR_MAX_RESTARTS, DEFAULT_MAX_RESTARTS);
  const shutdownGraceMs = deps.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const scriptPath = deps.scriptPath ?? defaultDeaconScriptPath();

  let child: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimestamps: number[] = [];

  function pruneRestartWindow(): void {
    const cutoff = now() - restartWindowMs;
    restartTimestamps = restartTimestamps.filter((ts) => ts >= cutoff);
  }

  function liveForeignPid(): number | null {
    const state = readState();
    if (!state.running || !state.pid) return null;
    if (child?.pid === state.pid) return null;
    return state.pid;
  }

  function emit(level: 'info' | 'warn' | 'error', message: string, details?: string): void {
    emitActivity({ source: 'supervisor', level, message, details });
  }

  function clearRestartTimer(): void {
    if (!restartTimer) return;
    clearTimer(restartTimer);
    restartTimer = null;
  }

  function spawnChild(): boolean {
    const foreignPid = liveForeignPid();
    if (foreignPid !== null) {
      const message = `Deacon child not started: live Cloister pid ${foreignPid} already holds the single-deacon lock`;
      console.warn(`[deacon-supervisor] ${message}`);
      emit('warn', message);
      return false;
    }

    const next = forkImpl(scriptPath, [], {
      env: buildChildEnv(sourceEnv),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child = next;
    console.log(`[deacon-supervisor] Started deacon child pid=${next.pid ?? 'unknown'}`);
    emit('info', `Deacon child started${next.pid ? ` (pid ${next.pid})` : ''}`);

    next.once('exit', (code, signal) => {
      if (child === next) child = null;
      if (stopping) return;
      pruneRestartWindow();
      if (restartTimestamps.length >= maxRestarts) {
        const details = `last exit code=${code ?? 'null'} signal=${signal ?? 'null'}`;
        const message = `Deacon child gave up after ${maxRestarts} restart attempt(s) in ${Math.round(restartWindowMs / 1000)}s`;
        console.error(`[deacon-supervisor] ${message}; ${details}`);
        emit('error', message, details);
        return;
      }
      restartTimestamps.push(now());
      const attempt = restartTimestamps.length;
      console.warn(`[deacon-supervisor] Deacon child exited (code=${code ?? 'null'} signal=${signal ?? 'null'}); restarting attempt ${attempt}/${maxRestarts}`);
      emit('warn', `Deacon child exited; restarting attempt ${attempt}/${maxRestarts}`);
      restartTimer = setTimer(() => {
        restartTimer = null;
        spawnChild();
      }, restartDelayMs);
      restartTimer.unref?.();
    });

    return true;
  }

  return {
    async startDeaconChild(): Promise<boolean> {
      if (child && !child.killed) return true;
      stopping = false;
      clearRestartTimer();
      return spawnChild();
    },

    async stopDeaconChild(): Promise<void> {
      clearRestartTimer();
      const current = child;
      if (!current) return;
      stopping = true;
      await new Promise<void>((resolveStop) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (killTimer) clearTimer(killTimer);
          if (child === current) child = null;
          resolveStop();
        };
        const killTimer = setTimer(() => {
          if (!settled && current.pid) {
            try {
              killPid(current.pid, 'SIGKILL');
            } catch {
              // Process already exited.
            }
          }
        }, shutdownGraceMs);
        killTimer.unref?.();
        current.once('exit', finish);
        if (current.pid) {
          try {
            killPid(current.pid, 'SIGTERM');
          } catch {
            finish();
          }
        } else {
          finish();
        }
      });
    },

    sendPatrolNow(): boolean {
      if (!child || !child.connected) return false;
      child.send?.({ type: 'patrol' });
      return true;
    },

    isChildRunning(): boolean {
      return child !== null && !child.killed;
    },
  };
}

const defaultSupervisor = createDeaconSupervisor();

export const startDeaconChild = defaultSupervisor.startDeaconChild;
export const stopDeaconChild = defaultSupervisor.stopDeaconChild;
export const sendPatrolNow = defaultSupervisor.sendPatrolNow;
export const isChildRunning = defaultSupervisor.isChildRunning;
