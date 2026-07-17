import { Effect } from 'effect';
import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { promises as fs, statSync } from 'fs';
import { acquireRestartLock, readRestartLockHolder } from '../../lib/restart-lock.js';
import { readPlatformConfigSync, restartDashboard, StageError } from '../../lib/platform-lifecycle.js';
import { writeRestartStatus } from '../../lib/restart-status.js';
import { agentRestartBlockReason } from '../../lib/deploy/agent-restart-gate.js';
import {
  refuseNonPrimaryDashboardCwd,
  resolveBundledServerPath,
  spawnDashboardDetached,
} from './restart.js';

export interface ReloadOptions {
  skipBuild?: boolean;
  healthTimeout?: string;
  deacon?: boolean;
  force?: boolean;
}

class UsageError extends Error {}

const execAsync = promisify(exec);

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runGitAsync(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${args.map(shellQuote).join(' ')}`, {
    cwd,
    encoding: 'utf8',
  });
}

async function runGitExit(args: string[], cwd: string): Promise<number> {
  try {
    await runGitAsync(args, cwd);
    return 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
    if (typeof code === 'number') return code;
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

function runCommand(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      cwd,
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
function runBunInstall(cwd: string): Promise<number> {
  return runCommand('bun', ['install'], cwd);
}

function runBuild(cwd: string): Promise<number> {
  return runCommand('npm', ['run', 'build'], cwd);
}

async function runInstallAndBuild(cwd: string): Promise<void> {
  const installExit = await runBunInstall(cwd);
  if (installExit !== 0) {
    throw new Error(`bun install failed in ${cwd} — old dashboard left running`);
  }

  const exitCode = await runBuild(cwd);
  if (exitCode !== 0) {
    throw new Error(`Build failed in ${cwd} — old dashboard left running`);
  }
}

async function swapBuiltDist(repoRoot: string, buildWorktree: string): Promise<void> {
  const incomingDist = join(repoRoot, 'dist.incoming');
  const currentDist = join(repoRoot, 'dist');
  const oldDist = join(repoRoot, `dist.old.${process.pid}`);

  await fs.rm(incomingDist, { recursive: true, force: true });
  await fs.cp(join(buildWorktree, 'dist'), incomingDist, { recursive: true });
  await fs.rm(oldDist, { recursive: true, force: true });

  let movedOldDist = false;
  try {
    await fs.rename(currentDist, oldDist);
    movedOldDist = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await fs.rename(incomingDist, currentDist);
  } catch (error) {
    if (movedOldDist) {
      await fs.rename(oldDist, currentDist).catch(() => undefined);
    }
    throw error;
  }

  await fs.rm(oldDist, { recursive: true, force: true });
}

async function buildFromOriginMain(repoRoot: string): Promise<void> {
  await runGitAsync(['fetch', 'origin', 'main'], repoRoot);

  const ancestorExit = await runGitExit(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], repoRoot);
  if (ancestorExit === 0) {
    await runInstallAndBuild(repoRoot);
    return;
  }
  if (ancestorExit !== 1) {
    throw new Error(`git merge-base --is-ancestor origin/main HEAD exited ${ancestorExit}`);
  }

  const originMainSha = (await runGitAsync(['rev-parse', '--short', 'origin/main'], repoRoot)).stdout.trim();
  const buildWorktree = join(dirname(repoRoot), `.pan-reload-build-${process.pid}`);

  console.warn(chalk.yellow(`origin/main (${originMainSha}) is not contained in this worktree HEAD; building from a detached origin/main worktree.`));
  try {
    await runGitAsync(['worktree', 'add', '--detach', buildWorktree, 'origin/main'], repoRoot);
    await runInstallAndBuild(buildWorktree);
    await swapBuiltDist(repoRoot, buildWorktree);
    console.log(chalk.green(`✓ Built dashboard from origin/main ${originMainSha}`));
  } finally {
    await runGitAsync(['worktree', 'remove', '--force', buildWorktree], repoRoot).catch(() => undefined);
    await fs.rm(buildWorktree, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(join(repoRoot, 'dist.incoming'), { recursive: true, force: true }).catch(() => undefined);
  }
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
        await buildFromOriginMain(repoRoot);
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
      expectedIdentity: { repoRoot, mode: 'primary' },
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
