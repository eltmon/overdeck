/**
 * pan cloister stop command
 *
 * Stop Cloister monitoring service (agents continue running).
 */

import chalk from 'chalk';
import { getCloisterService } from '../../../lib/cloister/service.js';

interface StopOptions {
  emergency?: boolean;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  const service = getCloisterService();

  if (!service.isRunning() && !options.emergency) {
    console.log(chalk.yellow('⚠️  Cloister is not running'));
    return;
  }

  if (options.emergency) {
    // Emergency stop - kill all agents
    console.log(chalk.red.bold('🚨 EMERGENCY STOP - Killing all agents'));
    console.log(chalk.dim('   This will terminate all running agent sessions'));

    const killedAgents = service.emergencyStop();

    console.log('');
    console.log(chalk.green(`✓ Killed ${killedAgents.length} agent(s):`));
    for (const agentId of killedAgents) {
      console.log(chalk.dim(`  - ${agentId}`));
    }
  } else {
    // Normal stop - just stop monitoring
    service.stop();
    console.log(chalk.green('✓ Cloister stopped'));
    console.log(chalk.dim('  Agents are still running'));
  }
}
