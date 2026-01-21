/**
 * pan cloister start command
 *
 * Start Cloister monitoring service.
 */

import chalk from 'chalk';
import { getCloisterService } from '../../../lib/cloister/service.js';

export async function startCommand(): Promise<void> {
  const service = getCloisterService();

  if (service.isRunning()) {
    console.log(chalk.yellow('⚠️  Cloister is already running'));
    return;
  }

  service.start();
  console.log(chalk.green('✓ Cloister started'));
  console.log(chalk.dim('  Monitoring all running agents...'));
}
