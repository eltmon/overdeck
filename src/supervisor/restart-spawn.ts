import { Effect } from 'effect';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { acquireRestartLock, readRestartLockHolder, type RestartLockHandle } from '../lib/restart-lock.js';
import type { SpawnRestartResult } from './watchdog.js';

const WATCHDOG_RESTART_HEALTH_TIMEOUT_MS = 120_000;
const CHILD_OUTPUT_LIMIT = 16_384;

type LogFn = (msg: string) => void | Promise<void>;

interface SupervisorRestartSpawnerOptions {
  panBinary: string;
  panArgsPrefix?: string[];
  log: LogFn;
  env?: NodeJS.ProcessEnv;
  acquireRestartLockFn?: typeof acquireRestartLock;
  readRestartLockHolderFn?: typeof readRestartLockHolder;
  spawnFn?: typeof spawn;
}

export interface SpawnSupervisorRestartOptions {
  restartLockHeld?: boolean;
  bootId?: string | null;
}

export function buildSupervisorRestartArgs(): string[] {
  return [
    'restart',
    '--dashboard',
    '--health-timeout',
    String(WATCHDOG_RESTART_HEALTH_TIMEOUT_MS),
  ];
}

export function resolveBundledPanInvocation(moduleUrl = import.meta.url): { panBinary: string; panArgsPrefix: string[] } {
  return {
    panBinary: process.execPath,
    panArgsPrefix: [resolve(dirname(fileURLToPath(moduleUrl)), '../cli/index.js')],
  };
}

function appendCapped(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  if (next.length <= CHILD_OUTPUT_LIMIT) return next;
  return next.slice(next.length - CHILD_OUTPUT_LIMIT);
}

async function logChildOutput(log: LogFn, stdout: string, stderr: string): Promise<void> {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();
  if (trimmedStdout) {
    await log(`pan restart --dashboard stdout:\n${trimmedStdout}`);
  }
  if (trimmedStderr) {
    await log(`pan restart --dashboard stderr:\n${trimmedStderr}`);
  }
}

export function createSupervisorRestartSpawner(options: SupervisorRestartSpawnerOptions) {
  const acquireRestartLockImpl = options.acquireRestartLockFn ?? acquireRestartLock;
  const readRestartLockHolderImpl = options.readRestartLockHolderFn ?? readRestartLockHolder;
  const spawnImpl = options.spawnFn ?? spawn;

  const heldRestartMessage = async (): Promise<string> => {
    const holder = await Effect.runPromise(readRestartLockHolderImpl());
    const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
    return `restart in progress (${heldBy})`;
  };

  return async function spawnRestart(spawnOptions: SpawnSupervisorRestartOptions = {}): Promise<SpawnRestartResult> {
    let lock: RestartLockHandle | null = null;
    if (!spawnOptions.restartLockHeld) {
      lock = await Effect.runPromise(acquireRestartLockImpl('supervisor restart'));
      if (!lock) return { pid: null, error: await heldRestartMessage() };
    }

    const release = async () => {
      const current = lock;
      if (!current) return;
      lock = null;
      await current.release();
    };

    try {
      let stdout = '';
      let stderr = '';
      const child = spawnImpl(options.panBinary, [...(options.panArgsPrefix ?? []), ...buildSupervisorRestartArgs()], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...(options.env ?? process.env),
          OVERDECK_RESTART_LOCK_HELD: '1',
          OVERDECK_SKIP_SUPERVISOR_CYCLE: '1',
          ...(spawnOptions.bootId ? { OVERDECK_BOOT_ID: spawnOptions.bootId } : {}),
        },
      });

      const childWithOutput = child as ChildProcess;
      childWithOutput.stdout?.on('data', (chunk: Buffer | string) => {
        stdout = appendCapped(stdout, chunk);
      });
      childWithOutput.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = appendCapped(stderr, chunk);
      });

      let settled = false;
      let spawnErrorMessage: string | null = null;
      const done = new Promise<void>((resolve, reject) => {
        childWithOutput.once('error', (err) => {
          void (async () => {
            if (settled) return;
            settled = true;
            spawnErrorMessage = err.message;
            await options.log(`spawn error: ${err.message}`);
            await release();
            reject(err);
          })();
        });
        childWithOutput.once('close', (code, signal) => {
          void (async () => {
            if (settled) return;
            settled = true;
            await release();
            if (code === 0) {
              resolve();
              return;
            }
            await logChildOutput(options.log, stdout, stderr);
            reject(new Error(`pan restart --dashboard exited ${code ?? `via signal ${signal ?? 'unknown'}`}`));
          })();
        });
      });
      done.catch(() => {});

      await new Promise((resolve) => setImmediate(resolve));
      if (spawnErrorMessage) return { pid: null, error: spawnErrorMessage };
      childWithOutput.unref();
      return { pid: childWithOutput.pid ?? null, error: null, done };
    } catch (err) {
      await release();
      const msg = err instanceof Error ? err.message : String(err);
      return { pid: null, error: msg };
    }
  };
}
