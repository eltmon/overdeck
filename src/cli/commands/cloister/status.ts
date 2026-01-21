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
  const runningStatus = status.running ? chalk.green('Running') : chalk.red('Stopped');
  console.log(`Status: ${runningStatus}`);

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

  console.log('');
}
