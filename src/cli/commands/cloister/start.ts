/**
 * pan cloister start command
 *
 * Start Cloister monitoring service.
 */

import chalk from 'chalk';
import { cloisterApi } from './api.js';

export async function startCommand(): Promise<void> {
  const status = await cloisterApi<{ running: boolean }>('/api/cloister/status');
  if (status.running) {
    console.log(chalk.yellow('⚠️  Cloister is already running'));
    return;
  }

  await cloisterApi('/api/cloister/start', { method: 'POST' });
  console.log(chalk.green('✓ Cloister started'));
  console.log(chalk.dim('  Monitoring all running agents...'));
}
