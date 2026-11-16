/**
 * `pan down`: stop smee, the supervisor, the dashboard, review sessions,
 * Traefik and CLIProxy. Agents and conversations keep running.
 *
 * Moved out of `src/cli/index.ts` (PAN-5342) so `pan shutdown --finish` can run
 * the same teardown. Traefik stops through an async `docker compose down`.
 */

import chalk from 'chalk';

export interface DownOptions {
  skipTraefik?: boolean;
}

export async function downCommand(options: DownOptions): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { join } = await import('node:path');
  const { readFileSync, existsSync } = await import('node:fs');
  const { parse } = await import('@iarna/toml');
  const execFileAsync = promisify(execFile);

  console.log(chalk.bold('Stopping Overdeck...\n'));

  // Stop smee-client webhook relay
  try {
    const { stopSmeeProcess } = await import('../../lib/smee.js');
    console.log(chalk.dim('Stopping smee-client webhook relay...'));
    stopSmeeProcess();
    console.log(chalk.green('✓ smee-client stopped'));
  } catch {
    console.log(chalk.dim('  smee-client not running'));
  }

  // Stop the supervisor sidecar
  try {
    const { stopSupervisorProcess, isSupervisorRunning } = await import('../../lib/supervisor.js');
    const { stopSupervisorUnitIfActive } = await import('../../lib/systemd.js');
    if (await stopSupervisorUnitIfActive()) {
      console.log(chalk.dim('Stopping supervisor sidecar...'));
      console.log(chalk.green('✓ Supervisor unit stopped'));
    } else if (isSupervisorRunning()) {
      console.log(chalk.dim('Stopping supervisor sidecar...'));
      stopSupervisorProcess();
      console.log(chalk.green('✓ Supervisor stopped'));
    }
  } catch {
    // non-fatal
  }

  // Read config for ports and Traefik settings
  const configFile = join(process.env.HOME || '', '.overdeck', 'config.toml');
  let traefikEnabled = false;
  let dashboardPort = 3010;
  let dashboardApiPort = 3011;

  if (existsSync(configFile)) {
    try {
      const configContent = readFileSync(configFile, 'utf-8');
      const config = parse(configContent) as { traefik?: { enabled?: unknown }; dashboard?: { port?: number; api_port?: number } };
      traefikEnabled = config.traefik?.enabled === true;
      dashboardPort = config.dashboard?.port || 3010;
      dashboardApiPort = config.dashboard?.api_port || 3011;
    } catch {
      // Ignore config read errors
    }
  }

  // Stop dashboard — SIGTERM first, escalate to SIGKILL only if it refuses to exit.
  // Uses the shared lifecycle helper so `pan down` and `pan restart --dashboard`
  // have identical teardown semantics.
  console.log(chalk.dim('Stopping dashboard...'));
  try {
    const { stopDashboard, readPlatformConfig } = await import('../../lib/platform-lifecycle.js');
    const platformConfig = readPlatformConfig();
    // Respect whatever ports this block already parsed out of config.toml.
    await stopDashboard({ ...platformConfig, dashboardPort, dashboardApiPort });
    console.log(chalk.green('✓ Dashboard stopped'));
  } catch {
    console.log(chalk.dim('  No dashboard processes found'));
  }

  // Kill review coordinator and reviewer sessions so they don't survive
  // dashboard restart and block new review dispatch (PAN-931).
  console.log(chalk.dim('Stopping review sessions...'));
  try {
    const { killAllReviewSessions } = await import('../../lib/cloister/review-agent.js');
    const { killed, failed } = await killAllReviewSessions();
    if (killed.length > 0) {
      console.log(chalk.green(`✓ Stopped ${killed.length} review session(s)`));
    }
    if (failed.length > 0) {
      console.log(chalk.yellow(`⚠ Failed to stop ${failed.length} review session(s): ${failed.join(', ')}`));
    }
    if (killed.length === 0 && failed.length === 0) {
      console.log(chalk.dim('  No review sessions running'));
    }
  } catch {
    console.log(chalk.dim('  Review session cleanup skipped'));
  }

  // Stop Traefik if enabled
  if (traefikEnabled && !options.skipTraefik) {
    const traefikDir = join(process.env.HOME || '', '.overdeck', 'traefik');
    if (existsSync(traefikDir)) {
      console.log(chalk.dim('Stopping Traefik...'));
      try {
        await execFileAsync('docker', ['compose', 'down'], { cwd: traefikDir, timeout: 60_000 });
        console.log(chalk.green('✓ Traefik stopped'));
      } catch {
        console.log(chalk.yellow('⚠ Failed to stop Traefik'));
      }
    }
  }

  // Stop CLIProxyAPI sidecar
  try {
    const { stopCliproxy, isCliproxyRunning } = await import('../../lib/cliproxy.js');
    if (await isCliproxyRunning()) {
      console.log(chalk.dim('Stopping CLIProxyAPI sidecar...'));
      await stopCliproxy();
      console.log(chalk.green('✓ CLIProxyAPI stopped'));
    }
  } catch {
    // Non-fatal — cliproxy may not be installed/running
  }

  console.log('');
}
