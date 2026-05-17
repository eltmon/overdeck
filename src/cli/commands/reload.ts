import chalk from 'chalk';
import { spawn } from 'child_process';
import { statSync } from 'fs';
import { acquireRestartLock, readRestartLockHolder } from '../../lib/restart-lock.js';
import { readPlatformConfig, restartDashboard, StageError } from '../../lib/platform-lifecycle.js';
import { writeRestartStatus } from '../../lib/restart-status.js';
import { resolveBundledServerPath, spawnDashboardDetached } from './restart.js';

export interface ReloadOptions {
  skipBuild?: boolean;
  healthTimeout?: string;
  deacon?: boolean;
}

class UsageError extends Error {}

function parseHealthTimeout(value: string | undefined): number {
  if (!value) return 30_000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new UsageError(`--health-timeout must be a positive integer, got ${value}`);
  }
  return parsed;
}

function dashboardBundleMtimeMs(): number {
  try {
    return statSync(resolveBundledServerPath()).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

function runBuild(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

function recordReloadStatus(startedAt: number, success: boolean, error?: string): void {
  writeRestartStatus({
    ts: new Date().toISOString(),
    trigger: 'pan reload',
    success,
    error,
    durationMs: Date.now() - startedAt,
    attempts: 1,
  });
}

export async function reloadCommand(options: ReloadOptions): Promise<void> {
  const startedAt = Date.now();
  let healthTimeoutMs: number;
  try {
    healthTimeoutMs = parseHealthTimeout(options.healthTimeout);
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exitCode = 2;
    return;
  }

  const lock = acquireRestartLock('pan reload');
  if (!lock) {
    const holder = readRestartLockHolder();
    const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
    const error = `restart in progress (${heldBy})`;
    console.error(chalk.yellow(error));
    recordReloadStatus(startedAt, false, error);
    process.exitCode = 2;
    return;
  }

  const config = readPlatformConfig();
  const disableDeacon = options.deacon === false;

  try {
    if (!options.skipBuild) {
      const beforeMtime = dashboardBundleMtimeMs();
      const exitCode = await runBuild();
      if (exitCode !== 0) {
        const error = 'Build failed — old dashboard left running';
        console.error(chalk.red(error));
        recordReloadStatus(startedAt, false, error);
        process.exitCode = 1;
        return;
      }

      const afterMtime = dashboardBundleMtimeMs();
      if (afterMtime <= beforeMtime) {
        const error = `Build did not refresh ${resolveBundledServerPath()} — old dashboard left running`;
        console.error(chalk.red(error));
        recordReloadStatus(startedAt, false, error);
        process.exitCode = 1;
        return;
      }
    }

    await restartDashboard(config, () => spawnDashboardDetached(config, { disableDeacon }), {
      healthTimeoutMs,
    });
    recordReloadStatus(startedAt, true);
    console.log(chalk.green('✓ Dashboard reloaded and healthy'));
  } catch (error) {
    const message = error instanceof StageError
      ? `[${error.failure.stage}] ${error.failure.reason}`
      : (error as Error)?.message || String(error);
    if (error instanceof StageError) {
      console.error(chalk.red(`✗ ${message}`));
    } else {
      console.error(chalk.red('✗ Reload failed:'), message);
    }
    recordReloadStatus(startedAt, false, message);
    process.exitCode = 1;
  } finally {
    lock.release();
  }
}
