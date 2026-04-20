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

import {
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
  healthTimeout?: string;
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

function resolveBundledServerPath(): string {
  return join(process.cwd(), 'dist', 'dashboard', 'server.js');
}

function spawnDashboardDetached(config: PlatformConfig): void {
  const serverPath = resolveBundledServerPath();
  if (!existsSync(serverPath)) {
    throw new StageError({
      stage: 'dashboard',
      reason: `Dashboard bundle not found at ${serverPath}. Run \`npm run build\`.`,
    });
  }
  const child = spawn(resolveNode22(), [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      DASHBOARD_PORT: String(config.dashboardPort),
      PANOPTICON_MODE: 'production',
    },
  });
  child.unref();
}

export async function restartCommand(options: RestartOptions): Promise<void> {
  const scope = resolveScope(options);
  const config = readPlatformConfig();
  const healthTimeoutMs = options.healthTimeout
    ? parseInt(options.healthTimeout, 10)
    : undefined;

  console.log(chalk.bold(`Restarting Panopticon (${scope})...\n`));

  try {
    switch (scope) {
      case 'dashboard': {
        await restartDashboard(config, () => spawnDashboardDetached(config), {
          healthTimeoutMs,
        });
        console.log(chalk.green('✓ Dashboard restarted and healthy'));
        console.log(chalk.dim('  CLIProxy, Traefik, and TLDR were left running.'));
        break;
      }
      case 'cliproxy': {
        const cliproxy = await import('../../lib/cliproxy.js');
        await restartCliproxy(cliproxy);
        console.log(chalk.green('✓ CLIProxy restarted'));
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
        await runFullRestart(config, { healthTimeoutMs });
        break;
      }
    }
  } catch (err) {
    if (err instanceof StageError) {
      console.error(chalk.red(`✗ [${err.failure.stage}] ${err.failure.reason}`));
      console.error(
        chalk.dim(
          '  Other components were left in their prior state. ' +
            'Run `pan status` to inspect, or `pan restart --full` to rebuild the stack.',
        ),
      );
    } else {
      console.error(chalk.red('✗ Restart failed:'), (err as Error)?.message || err);
    }
    process.exit(1);
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
  opts: { healthTimeoutMs?: number },
): Promise<void> {
  const projectRoot = process.cwd();
  const venvPath = join(projectRoot, '.venv');
  const tldrAvailable = existsSync(venvPath);

  // ── Stop phase ──
  // Dashboard first so it doesn't spam errors while sidecars die.
  await stopDashboard(config);

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

  spawnDashboardDetached(config);
  await waitForDashboardHealth(config.dashboardApiPort, {
    timeoutMs: opts.healthTimeoutMs,
  });

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
