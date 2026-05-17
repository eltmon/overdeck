/**
 * `pan restart` — scoped restart with explicit dependency isolation.
 *
 * Scopes:
 *   pan restart                    (default: --dashboard)
 *   pan restart --dashboard        Restart only the dashboard. Leaves CLIProxy,
 *                                  Traefik, and TLDR untouched. This is the
 *                                  fix for the "restart killed my CLIProxy"
 *                                  failure mode.
 *   pan restart --cliproxy         Restart only CLIProxy.
 *   pan restart --traefik          Restart only Traefik.
 *   pan restart --full             Stop and restart the whole stack.
 *
 * Each stage is health-gated. On failure, the command exits non-zero with a
 * `[stage] reason` message. A failed dashboard restart leaves shared sidecars
 * (CLIProxy, Traefik) running — recovery beats coupling.
 */

import chalk from 'chalk';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

import { acquireRestartLock, readRestartLockHolder, type RestartLockHandle } from '../../lib/restart-lock.js';
import { writeRestartStatus } from '../../lib/restart-status.js';

import {
  openDashboardLogStdio,
  readPlatformConfig,
  restartDashboard,
  restartCliproxy,
  restartTraefik,
  startTraefik,
  stopTraefik,
  StageError,
  waitForDashboardHealth,
  stopDashboard,
  type PlatformConfig,
} from '../../lib/platform-lifecycle.js';

export interface RestartOptions {
  dashboard?: boolean;
  cliproxy?: boolean;
  traefik?: boolean;
  full?: boolean;
  force?: boolean;
  healthTimeout?: string;
  deacon?: boolean;
}

function resolveScope(options: RestartOptions): 'dashboard' | 'cliproxy' | 'traefik' | 'full' {
  const flags = [
    options.dashboard && 'dashboard',
    options.cliproxy && 'cliproxy',
    options.traefik && 'traefik',
    options.full && 'full',
  ].filter(Boolean) as string[];
  if (flags.length > 1) {
    console.error(chalk.red(`Error: --${flags.join(' and --')} are mutually exclusive`));
    process.exit(2);
  }
  return (flags[0] as any) || 'dashboard';
}

function resolveNode22(): string {
  const nvmNode = '/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node';
  if (existsSync(nvmNode)) return nvmNode;
  return 'node';
}

export function resolveBundledServerPath(): string {
  // After tsdown bundles the CLI, this code runs inside `dist/cli/index.js`,
  // so `__dirname` is `dist/cli` and the sibling dashboard bundle sits at
  // `dist/dashboard/server.js` — one `..` up, not two. The old two-up form
  // was written assuming the unbundled `dist/cli/commands/restart.js` layout
  // and resolved to `<project>/dashboard/server.js`, which never exists.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, '..', 'dashboard', 'server.js');
}

export function spawnDashboardDetached(config: PlatformConfig, opts?: { disableDeacon?: boolean }): void {
  const serverPath = resolveBundledServerPath();
  if (!existsSync(serverPath)) {
    throw new StageError({
      stage: 'dashboard',
      reason: `Dashboard bundle not found at ${serverPath}. Run \`npm run build\`.`,
    });
  }
  const child = spawn(resolveNode22(), [serverPath], {
    detached: true,
    stdio: openDashboardLogStdio(),
    env: {
      ...process.env,
      DASHBOARD_PORT: String(config.dashboardPort),
      API_PORT: String(config.dashboardApiPort),
      PORT: String(config.dashboardApiPort),
      PANOPTICON_MODE: 'production',
      ...(opts?.disableDeacon ? { PANOPTICON_DISABLE_DEACON: '1' } : {}),
    },
  });
  child.unref();
}

function recordRestartStatus(startedAt: number, success: boolean, error?: string): void {
  writeRestartStatus({
    ts: new Date().toISOString(),
    trigger: 'pan restart',
    success,
    error,
    durationMs: Date.now() - startedAt,
    attempts: 1,
  });
}

function reportHeldRestartLock(startedAt: number): void {
  const holder = readRestartLockHolder();
  const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
  const error = `restart in progress (${heldBy})`;
  console.error(chalk.yellow(error));
  recordRestartStatus(startedAt, false, error);
  process.exitCode = 2;
}

export async function restartCommand(options: RestartOptions): Promise<void> {
  const startedAt = Date.now();
  const scope = resolveScope(options);
  const config = readPlatformConfig();
  const healthTimeoutMs = options.healthTimeout
    ? parseInt(options.healthTimeout, 10)
    : undefined;

  const disableDeacon = options.deacon === false;
  if (disableDeacon) {
    console.log(chalk.yellow('  Deacon auto-start disabled for this restart (--no-deacon)'));
  }

  console.log(chalk.bold(`Restarting Panopticon (${scope})...\n`));

  const lockInherited = process.env.PANOPTICON_RESTART_LOCK_HELD === '1';
  const needsRestartLock = (scope === 'dashboard' || scope === 'full') && !lockInherited;
  let restartLock: RestartLockHandle | null = null;
  if (needsRestartLock) {
    restartLock = acquireRestartLock('pan restart');
    if (!restartLock) {
      reportHeldRestartLock(startedAt);
      return;
    }
  }

  try {
    switch (scope) {
      case 'dashboard': {
        if (process.env.PANOPTICON_SKIP_SUPERVISOR_CYCLE !== '1') {
          try {
            const { stopSupervisorProcess, startSupervisorProcess } = await import('../../lib/supervisor.js');
            stopSupervisorProcess();
            startSupervisorProcess();
          } catch { /* non-fatal */ }
        }

        await restartDashboard(config, () => spawnDashboardDetached(config, { disableDeacon }), {
          healthTimeoutMs,
        });
        recordRestartStatus(startedAt, true);
        console.log(chalk.green('✓ Dashboard restarted and healthy'));
        console.log(chalk.dim('  CLIProxy, Traefik, and TLDR were left running.'));
        break;
      }
      case 'cliproxy': {
        const cliproxy = await import('../../lib/cliproxy.js');
        await restartCliproxy(cliproxy, { force: options.force === true });
        if (options.force) {
          console.log(chalk.green('✓ CLIProxy reinstalled at pinned version and restarted'));
        } else {
          console.log(chalk.green('✓ CLIProxy restarted'));
        }
        console.log(chalk.dim('  Dashboard and Traefik were left running.'));
        break;
      }
      case 'traefik': {
        await restartTraefik(config);
        console.log(chalk.green('✓ Traefik restarted'));
        console.log(chalk.dim('  Dashboard and CLIProxy were left running.'));
        break;
      }
      case 'full': {
        await runFullRestart(config, { healthTimeoutMs, disableDeacon });
        break;
      }
    }
  } catch (err) {
    const message = err instanceof StageError
      ? `[${err.failure.stage}] ${err.failure.reason}`
      : (err as Error)?.message || String(err);
    if (scope === 'dashboard') {
      recordRestartStatus(startedAt, false, message);
    }
    if (err instanceof StageError) {
      console.error(chalk.red(`✗ ${message}`));
      console.error(
        chalk.dim(
          '  Other components were left in their prior state. ' +
            'Run `pan status` to inspect, or `pan restart --full` to rebuild the stack.',
        ),
      );
    } else {
      console.error(chalk.red('✗ Restart failed:'), message);
    }
    process.exit(1);
  } finally {
    restartLock?.release();
  }
}

/**
 * Full restart: stop everything, then start everything. Uses the same shared
 * lifecycle primitives so the health-gating is identical to scoped restarts.
 *
 * Covers the same four components that `pan down` + `pan up` cover — dashboard,
 * CLIProxy, Traefik, TLDR — so `pan restart --full` is a true stack rebuild.
 */
async function runFullRestart(
  config: PlatformConfig,
  opts: { healthTimeoutMs?: number; disableDeacon?: boolean },
): Promise<void> {
  const projectRoot = process.cwd();
  const venvPath = join(projectRoot, '.venv');
  const tldrAvailable = existsSync(venvPath);

  // ── Stop phase ──
  // Dashboard first so it doesn't spam errors while sidecars die.
  await stopDashboard(config);

  try {
    const { stopSupervisorProcess } = await import('../../lib/supervisor.js');
    stopSupervisorProcess();
  } catch {
    // non-fatal
  }

  if (tldrAvailable) {
    try {
      const { getTldrDaemonService } = await import('../../lib/tldr-daemon.js');
      await getTldrDaemonService(projectRoot, venvPath).stop();
    } catch {
      // non-fatal — daemon may already be down
    }
  }

  if (config.traefikEnabled) {
    await stopTraefik(config);
  }

  // ── Start phase ──
  // Traefik first so routes exist before anything binds; CLIProxy before
  // dashboard so GPT-backed agents have their router from t=0; TLDR last
  // because it's non-critical and shouldn't block the dashboard coming up.
  if (config.traefikEnabled) {
    await startTraefik(config);
  }

  // restartCliproxy handles stop-sleep-start-verify in one shot.
  const cliproxy = await import('../../lib/cliproxy.js');
  await restartCliproxy(cliproxy);

  spawnDashboardDetached(config, { disableDeacon: opts.disableDeacon });
  await waitForDashboardHealth(config.dashboardApiPort, {
    timeoutMs: opts.healthTimeoutMs,
  });

  try {
    const { startSupervisorProcess } = await import('../../lib/supervisor.js');
    startSupervisorProcess();
  } catch {
    // non-fatal
  }

  if (tldrAvailable) {
    try {
      const { getTldrDaemonService } = await import('../../lib/tldr-daemon.js');
      await getTldrDaemonService(projectRoot, venvPath).start(true);
    } catch {
      // non-fatal — dashboard is already healthy; TLDR just won't be available
    }
  }

  console.log(chalk.green('✓ Full stack restarted and healthy'));
}
