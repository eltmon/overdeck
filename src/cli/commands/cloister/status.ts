/**
 * pan cloister status command
 *
 * Display Cloister service status and agent health summary.
 */

import chalk from 'chalk';
import { getCloisterService } from '../../../lib/cloister/service.js';
import { getHealthEmoji, getHealthLabel } from '../../../lib/cloister/health.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const service = getCloisterService();
  const status = service.getStatus();

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(chalk.bold('\n🔔 Cloister Agent Watchdog\n'));

  // Service status
  const patrolStatus = status.patrol?.status;
  const runningStatus =
    patrolStatus === 'running'
      ? chalk.green('Running')
      : patrolStatus === 'starting'
        ? chalk.yellow('Starting')
        : patrolStatus === 'stale'
          ? chalk.red('Stale')
          : status.running
            ? chalk.yellow('Starting')
            : chalk.red('Stopped');
  console.log(`Status: ${runningStatus}`);

  if (status.patrol) {
    if (status.patrol.status === 'stale') {
      const age = status.patrol.secondsSinceLastPatrol;
      const ageLabel = age === null ? 'unknown age' : `${age}s ago`;
      console.log(`Patrol heartbeat: ${chalk.red('stale')} (last patrol ${ageLabel}; expected within ${status.patrol.staleAfterSeconds}s)`);
    } else if (status.patrol.lastPatrol) {
      const age = status.patrol.secondsSinceLastPatrol;
      const ageLabel = age === null ? 'unknown age' : `${age}s ago`;
      console.log(`Patrol heartbeat: ${ageLabel}`);
    } else if (status.patrol.status === 'starting') {
      console.log(`Patrol heartbeat: ${chalk.yellow('waiting for first patrol')}`);
    }
  }

  if (status.lastCheck) {
    const lastCheck = new Date(status.lastCheck);
    const timeSince = Math.floor((Date.now() - lastCheck.getTime()) / 1000);
    console.log(`Last check: ${timeSince}s ago`);
  }

  console.log('');

  // Agent summary
  console.log(chalk.bold('Agent Health Summary:'));
  console.log(`  🟢 Active:  ${chalk.green(status.summary.active)}`);
  console.log(`  🟡 Stale:   ${chalk.yellow(status.summary.stale)}`);
  console.log(`  🟠 Warning: ${chalk.hex('#FFA500')(status.summary.warning)}`);
  console.log(`  🔴 Stuck:   ${chalk.red(status.summary.stuck)}`);
  console.log(`  Total:      ${status.summary.total}`);

  console.log('');

  // Agents needing attention
  if (status.agentsNeedingAttention.length > 0) {
    console.log(chalk.bold('⚠️  Agents Needing Attention:'));
    for (const agentId of status.agentsNeedingAttention) {
      const health = service.getAgentHealth(agentId);
      if (health) {
        const emoji = getHealthEmoji(health.state);
        const label = getHealthLabel(health.state);
        const color = health.state === 'warning' ? chalk.hex('#FFA500') : chalk.red;
        console.log(`  ${emoji} ${color(agentId)} - ${label}`);
      }
    }
    console.log('');
  }

  // Configuration
  console.log(chalk.bold('Configuration:'));
  console.log(`  Auto-start: ${status.config.startup.auto_start ? 'enabled' : 'disabled'}`);
  console.log(`  Thresholds: stale=${status.config.thresholds.stale}m, warning=${status.config.thresholds.warning}m, stuck=${status.config.thresholds.stuck}m`);
  console.log(`  Auto-actions:`);
  console.log(`    - Poke on warning: ${status.config.auto_actions.poke_on_warning ? 'enabled' : 'disabled'}`);
  console.log(`    - Kill on stuck:   ${status.config.auto_actions.kill_on_stuck ? chalk.red('enabled') : 'disabled'}`);

  // GitHub App status (PAN-536)
  try {
    const { getAppStatus } = await import('../../../lib/github-app.js');
    const appStatus = getAppStatus();
    console.log('');
    console.log(chalk.bold('GitHub App:'));
    if (appStatus.configured) {
      console.log(`  ${chalk.green('✓')} panopticon-agent (App ID: ${appStatus.appId})`);
      console.log(`  Mode: ${chalk.green('App')} — agents push as panopticon-agent[bot]`);
    } else {
      console.log(`  ${chalk.yellow('⚠')} Not configured — agents push as your SSH identity`);
      console.log(`  ${chalk.dim('  Run: node scripts/create-github-app.mjs')}`);
    }
  } catch { /* non-fatal */ }

  console.log('');
}
