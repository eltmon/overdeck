import { Effect } from 'effect';
import chalk from 'chalk';
import { statSync } from 'fs';
import { resolve } from 'path';
import {
  activateDashboardDeployment,
  buildDashboardFromOriginMain,
  dashboardDeploymentRoots,
  liveDashboardDeploymentRoots,
  removeDashboardDeployment,
  runGitAsync,
  selectDashboardDeploymentRoot,
  sweepDashboardDeployments,
  type DashboardDeployment,
  type DashboardDeploymentActivation,
} from '../../lib/deploy/build-from-origin.js';
import {
  readActiveDashboardBundleSync,
  writeActiveDashboardBundle,
} from '../../lib/deploy/active-dashboard-bundle.js';
import { repointGlobalCliToDeployment } from '../../lib/deploy/global-cli-link.js';
import { supervisorDeploymentFailure } from '../../lib/channels/pty-supervisor-locate.js';
import { dashboardServerBootFailure } from '../../lib/deploy/dashboard-bundle-integrity.js';
import { acquireRestartLock, readRestartLockHolder } from '../../lib/restart-lock.js';
import {
  leavesDashboardRunning,
  parseHealthTimeoutMs,
  readPlatformConfigSync,
  restartDashboard,
  StageError,
  type DashboardRestartResult,
} from '../../lib/platform-lifecycle.js';
import { writeRestartStatus, type RestartPhase } from '../../lib/restart-status.js';
import { agentRestartBlockReason } from '../../lib/deploy/agent-restart-gate.js';
import { restartGateRequesterId, waitForRestartApproval } from '../../lib/restart-gate-client.js';
import {
  refuseNonPrimaryDashboardCwd,
  resolveBundledServerPath,
  spawnDashboardDetached,
} from './restart.js';

/**
 * Repoint the global `pan` link at the just-activated generation and narrate
 * the outcome. Returns an error string when the repoint (or its verification)
 * failed — the caller decides whether that fails the reload. `absent` and
 * `foreign` are healthy no-ops: no global link, or an operator-managed
 * install we must not clobber.
 */
async function reportCliRepoint(deployRoot: string): Promise<string | null> {
  const result = await repointGlobalCliToDeployment(deployRoot);
  switch (result.status) {
    case 'repointed':
      console.log(chalk.dim(`  global pan CLI → ${result.target}`));
      return null;
    case 'already-current':
    case 'absent':
      return null;
    case 'foreign':
      console.log(chalk.dim(`  global pan CLI left untouched (${result.target ?? 'real install'})`));
      return null;
    case 'error': {
      const message = `global pan CLI repoint failed — CLI still runs the previous generation (PAN-3538): ${result.message}`;
      console.error(chalk.red(`✗ ${message}`));
      return message;
    }
  }
}

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

function dashboardBundleMtimeMs(bundlePath = resolveBundledServerPath()): number {
  try {
    return statSync(bundlePath).mtimeMs;
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

async function recordReloadStatus(
  startedAt: number,
  success: boolean,
  error?: string,
  phase: RestartPhase = success ? 'healthy' : 'failed',
): Promise<void> {
  await Effect.runPromise(writeRestartStatus({
    ts: new Date().toISOString(),
    trigger: 'pan reload',
    success,
    phase,
    error,
    durationMs: Date.now() - startedAt,
    attempts: 1,
    pid: process.pid,
    initiator: process.env.OVERDECK_RESTART_INITIATOR ?? process.env.OVERDECK_AGENT_ID,
    issueId: process.env.OVERDECK_ISSUE_ID,
  }));
}

export async function reloadCommand(options: ReloadOptions): Promise<void> {
  let startedAt = Date.now();
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
    let deployment: DashboardDeployment | null = null;
    let activation: DashboardDeploymentActivation | null = null;
    const previousBundle = readActiveDashboardBundleSync();
    if (!options.skipBuild) {
      try {
        repoRoot = await resolvePrimaryRepoRoot(process.cwd());
        const generationRoots = dashboardDeploymentRoots();
        await sweepDashboardDeployments(repoRoot, [
          ...generationRoots,
          ...(previousBundle ? [previousBundle.deployRoot] : []),
        ]);
        const liveRoots = await liveDashboardDeploymentRoots();
        const recordedRoot = previousBundle?.deployRoot ?? null;
        const hardRoots = liveRoots.filter((entry) => entry.hard);
        if (recordedRoot && hardRoots.length > 0
          && !hardRoots.some((entry) => resolve(entry.root) === resolve(recordedRoot))) {
          console.warn(chalk.yellow(
            `Active-deployment record says ${recordedRoot} but the dashboard runs from ${hardRoots.map((entry) => entry.root).join(', ')} — trusting the live processes (PAN-3329).`,
          ));
        }
        const nextDeployRoot = selectDashboardDeploymentRoot(recordedRoot, liveRoots);
        const targetOccupants = liveRoots.find((entry) => resolve(entry.root) === resolve(nextDeployRoot));
        if (targetOccupants) {
          console.warn(chalk.yellow(
            `Deploy target ${nextDeployRoot} still hosts stray processes (they keep running on in-memory modules): ${targetOccupants.processes.map((proc) => `pid ${proc.pid} ${proc.entrypoint}`).join(', ')}`,
          ));
        }
        deployment = await buildDashboardFromOriginMain(repoRoot, {
          deploymentRoot: () => nextDeployRoot,
        });
        const deployedMtime = dashboardBundleMtimeMs(deployment.serverPath);
        if (deployedMtime <= 0) {
          throw new Error(`Build did not create ${deployment.serverPath}`);
        }
        // A deployment that cannot run the PTY supervisor cannot spawn a
        // conversation or a Claude Code agent, yet it serves HTTP happily — so
        // the ordinary health check stays green while a core operator surface
        // is dead (PAN-3172). Fail before any traffic moves onto it.
        const supervisorFailure = supervisorDeploymentFailure(deployment.deployRoot);
        if (supervisorFailure) throw new Error(supervisorFailure);
        // The same trap one layer down: the server bundle's own externals have
        // to resolve from the generation, or the switchover hands traffic to a
        // deployment that dies on ERR_MODULE_NOT_FOUND at boot (PAN-3264).
        const serverBootFailure = dashboardServerBootFailure(deployment.serverPath);
        if (serverBootFailure) throw new Error(serverBootFailure);
        await writeActiveDashboardBundle({ repoRoot, ...deployment });
        try {
          activation = await activateDashboardDeployment(repoRoot, deployment);
        } catch (error) {
          await writeActiveDashboardBundle(previousBundle).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (deployment) {
          await removeDashboardDeployment(repoRoot, deployment.deployRoot);
        }
        const message = (error as Error)?.message || String(error);
        const reloadError = message.includes('old dashboard left running')
          ? message
          : `${message} — old dashboard left running`;
        console.error(chalk.red(reloadError));
        await recordReloadStatus(startedAt, false, reloadError);
        process.exitCode = 1;
        return;
      }
    }

    // Everything above is ungated: a build changes nothing the operator can see.
    // The restart below is voluntary, so it waits for the operator's approval
    // first (PAN-3729) and may find that an approved restart already happened.
    const gate = await waitForRestartApproval({
      requesterId: restartGateRequesterId('reload'),
      kind: 'reload',
      reason: 'pan reload — put the freshly built dashboard live',
    });
    if (!gate.proceed) {
      // Same disposition as a restart that left the old dashboard running: the
      // build is good and stays the recorded active deployment, so whichever
      // server is running now (or next boots) runs it. Nothing is rolled back,
      // and no restart status is recorded — the requester that actually
      // restarted recorded its own.
      await activation?.commit();
      if (deployment) {
        const repointError = await reportCliRepoint(deployment.deployRoot);
        if (repointError) {
          await recordReloadStatus(startedAt, false, repointError);
          process.exitCode = 1;
          return;
        }
        await sweepDashboardDeployments(repoRoot, dashboardDeploymentRoots()).catch(() => undefined);
      }
      console.log(chalk.green('✓ Reload complete — another approved restart already replaced the dashboard, so this one restarted nothing'));
      console.log(chalk.dim(`  ${gate.detail}; this build is the recorded active deployment.`));
      return;
    }
    // The approval wait is unbounded, so the pre-wait clock would report a
    // reload that "took" as long as the operator was away from the dashboard.
    startedAt = Date.now();

    let restartResult: DashboardRestartResult;
    try {
      await lock.refresh();
      // This durable entry must land before restartDashboard sends SIGTERM. If
      // persistence fails, abort while the old dashboard is still running.
      await recordReloadStatus(startedAt, false, undefined, 'stopping');
      restartResult = await Effect.runPromise(restartDashboard(config, () => spawnDashboardDetached(config, {
        deacon: options.deacon,
        serverPath: deployment?.serverPath,
        repoRoot,
      }), {
        healthTimeoutMs,
        expectedIdentity: { repoRoot, mode: 'primary' },
      }));
    } catch (error) {
      if (deployment) {
        if (leavesDashboardRunning(error)) {
          await activation?.commit();
          await reportCliRepoint(deployment.deployRoot);
          await sweepDashboardDeployments(repoRoot, dashboardDeploymentRoots()).catch(() => undefined);
        } else {
          await writeActiveDashboardBundle(previousBundle).catch(() => undefined);
          await activation?.rollback();
          await removeDashboardDeployment(repoRoot, deployment.deployRoot);
          await sweepDashboardDeployments(repoRoot, [
            ...dashboardDeploymentRoots(),
            ...(previousBundle ? [previousBundle.deployRoot] : []),
          ]).catch(() => undefined);
        }
      }
      throw error;
    }

    await activation?.commit();
    if (deployment) {
      // PAN-3538: the deploy contract includes the CLI — a healthy new server
      // with a stale global `pan` means every spawn still runs the previous
      // build, so a failed repoint fails the reload loudly.
      const repointError = await reportCliRepoint(deployment.deployRoot);
      if (repointError) {
        await recordReloadStatus(startedAt, false, repointError);
        process.exitCode = 1;
        return;
      }
      await sweepDashboardDeployments(repoRoot, dashboardDeploymentRoots()).catch(() => undefined);
    }
    await recordReloadStatus(startedAt, true);
    console.log(chalk.green(restartResult.ownershipVerified
      ? '✓ Dashboard reloaded and healthy'
      : '✓ Dashboard reloaded and healthy — ownership unverified: could not resolve the spawned server pid'));
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
