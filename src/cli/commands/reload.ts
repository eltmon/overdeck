import { Effect } from 'effect';
import chalk from 'chalk';
import { statSync } from 'fs';
import { resolve } from 'path';
import { buildDashboardFromOriginMain, runGitAsync } from '../../lib/deploy/build-from-origin.js';
import { acquireRestartLock, readRestartLockHolder } from '../../lib/restart-lock.js';
import { readPlatformConfigSync, restartDashboard, StageError, parseHealthTimeoutMs } from '../../lib/platform-lifecycle.js';
import { writeRestartStatus } from '../../lib/restart-status.js';
import { agentRestartBlockReason } from '../../lib/deploy/agent-restart-gate.js';
import {
  refuseNonPrimaryDashboardCwd,
  resolveBundledServerPath,
  resolvePrimaryDashboardIdentity,
  spawnDashboardDetached,
} from './restart.js';

export interface ReloadOptions {
  skipBuild?: boolean;
  healthTimeout?: string;
  deacon?: boolean;
  force?: boolean;
}

class UsageError extends Error {}

function parseHealthTimeout(value: string | undefined): number {
  try {
    return parseHealthTimeoutMs(value, 30_000);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

function dashboardBundleMtimeMs(): number {
  try {
    return statSync(resolveBundledServerPath()).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function resolvePrimaryRepoRoot(cwd: string): Promise<string> {
  const repoRoot = (await runGitAsync(['rev-parse', '--show-toplevel'], cwd)).stdout.trim();
  if (!repoRoot) {
    throw new Error(`Could not resolve git repository root from ${cwd}`);
  }
  const workspaceMatch = repoRoot.match(/^(.+)\/workspaces\/feature-[^/]+$/);
  return workspaceMatch?.[1] ?? repoRoot;
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

  if (refuseNonPrimaryDashboardCwd(process.cwd(), 'reload')) return;

  const restartInitiator = process.env.OVERDECK_AGENT_ID;
  if (restartInitiator) {
    const restartBlock = await agentRestartBlockReason({
      initiator: restartInitiator,
      force: options.force === true,
    });
    if (restartBlock) {
      console.error(restartBlock);
      process.exitCode = 1;
      return;
    }
    console.log(chalk.yellow(
      '  This agent-issued restart will disconnect every live conversation and terminal until clients reconnect.',
    ));
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
        } catch (err: any) {
          const msg = `Failed to signal pan dev (pid ${dev.pid}): ${err.message}`;
          console.error(chalk.red(msg));
          await recordReloadStatus(startedAt, false, msg);
          process.exitCode = 2;
          return;
        }
        console.log(chalk.green(`✓ Signaled pan dev (pid ${dev.pid}) to rebuild + hot-restart the dashboard server in place.`));
        console.log(chalk.dim('  Watch the pan dev terminal for "✓ Dashboard server reloaded".'));
        try {
          await recordReloadStatus(startedAt, true, undefined);
        } catch (err: any) {
          const msg = `Reload signaled, but failed to record reload status: ${err.message}`;
          console.error(chalk.red(msg));
          process.exitCode = 2;
          return;
        }
        return;
      }
    }

    const config = readPlatformConfigSync();
    let repoRoot = process.cwd();
    if (!options.skipBuild) {
      const beforeMtime = dashboardBundleMtimeMs();
      try {
        repoRoot = await resolvePrimaryRepoRoot(process.cwd());
        await buildDashboardFromOriginMain(repoRoot);
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        const reloadError = message.includes('old dashboard left running')
          ? message
          : `${message} — old dashboard left running`;
        console.error(chalk.red(reloadError));
        await recordReloadStatus(startedAt, false, reloadError);
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
      expectedIdentity: resolvePrimaryDashboardIdentity(),
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
