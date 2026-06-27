import { Effect } from 'effect';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { statSync } from 'fs';
import { acquireRestartLock, readRestartLockHolder } from '../../lib/restart-lock.js';
import { readPlatformConfigSync, restartDashboard, StageError } from '../../lib/platform-lifecycle.js';
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

function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

/**
 * Install dependencies before building. A merge/rebase that adds a runtime dep
 * (e.g. chokidar from PAN-1395) leaves node_modules behind package.json: the
 * build still succeeds (the bundler externalizes the dep) but the freshly built
 * server boot-crashes with ERR_MODULE_NOT_FOUND, taking the dashboard down.
 * `bun install` is idempotent and ~instant on a warm cache, so running it
 * unconditionally before every reload makes "apply my merged changes" safe.
 */
function runBunInstall(): Promise<number> {
  return runCommand('bun', ['install']);
}

function runBuild(): Promise<number> {
  return runCommand('npm', ['run', 'build']);
}

async function recordReloadStatus(startedAt: number, success: boolean, error?: string): Promise<void> {
  await Effect.runPromise(writeRestartStatus({
    ts: new Date().toISOString(),
    trigger: 'pan reload',
    success,
    error,
    durationMs: Date.now() - startedAt,
    attempts: 1,
    pid: process.pid,
    initiator: process.env.OVERDECK_AGENT_ID,
    issueId: process.env.OVERDECK_ISSUE_ID,
  }));
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

  const lock = await Effect.runPromise(acquireRestartLock('pan reload'));
  if (!lock) {
    const holder = await Effect.runPromise(readRestartLockHolder());
    const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
    const error = `restart in progress (${heldBy})`;
    console.error(chalk.yellow(error));
    await recordReloadStatus(startedAt, false, error);
    process.exitCode = 2;
    return;
  }

  try {
    // PAN-1662: when a `pan dev` session owns the dashboard, don't refuse — signal
    // it (SIGUSR2) to rebuild the server bundle and hot-restart the API child in
    // place. This applies merged/edited server code without tearing down the
    // interactive dev session or hijacking it into detached production mode. The
    // frontend recovers via its graceful reconnect (PAN-1580). This is also the
    // path the flywheel uses to apply its own merged server changes.
    {
      const { readDevSupervisorMarker } = await import('../../lib/dev-supervisor.js');
      const dev = readDevSupervisorMarker();
      if (dev) {
        try {
          process.kill(dev.pid, 'SIGUSR2');
          console.log(chalk.green(`✓ Signaled pan dev (pid ${dev.pid}) to rebuild + hot-restart the dashboard server in place.`));
          console.log(chalk.dim('  Watch the pan dev terminal for "✓ Dashboard server reloaded".'));
          await recordReloadStatus(startedAt, true, undefined);
        } catch (err: any) {
          const msg = `Failed to signal pan dev (pid ${dev.pid}): ${err.message}`;
          console.error(chalk.red(msg));
          await recordReloadStatus(startedAt, false, msg);
          process.exitCode = 2;
        }
        return;
      }
    }

    const config = readPlatformConfigSync();
    if (!options.skipBuild) {
      // Install first so a merge/rebase that added a runtime dep can't produce a
      // server bundle that boot-crashes on a missing package (see runBunInstall).
      const installExit = await runBunInstall();
      if (installExit !== 0) {
        const error = 'bun install failed — old dashboard left running';
        console.error(chalk.red(error));
        await recordReloadStatus(startedAt, false, error);
        process.exitCode = 1;
        return;
      }

      const beforeMtime = dashboardBundleMtimeMs();
      const exitCode = await runBuild();
      if (exitCode !== 0) {
        const error = 'Build failed — old dashboard left running';
        console.error(chalk.red(error));
        await recordReloadStatus(startedAt, false, error);
        process.exitCode = 1;
        return;
      }

      const afterMtime = dashboardBundleMtimeMs();
      if (afterMtime <= beforeMtime) {
        const error = `Build did not refresh ${resolveBundledServerPath()} — old dashboard left running`;
        console.error(chalk.red(error));
        await recordReloadStatus(startedAt, false, error);
        process.exitCode = 1;
        return;
      }
    }

    await Effect.runPromise(restartDashboard(config, () => spawnDashboardDetached(config, { deacon: options.deacon }), {
      healthTimeoutMs,
    }));
    await recordReloadStatus(startedAt, true);
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
    await recordReloadStatus(startedAt, false, message);
    process.exitCode = 1;
  } finally {
    await lock.release();
  }
}
