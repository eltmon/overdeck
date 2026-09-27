/**
 * Cloister CLI Commands
 *
 * pan cloister <command>
 */

import { Command } from 'commander';
import { lazyAction } from '../../lazy-action.js';

export function registerCloisterCommands(program: Command): void {
  const cloister = program
    .command('cloister')
    .description('Cloister agent watchdog commands');

  // pan cloister status
  cloister
    .command('status')
    .description('Show Cloister service status and agent health')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./status.js'), 'statusCommand'));

  // pan cloister start
  cloister
    .command('start')
    .description('Start Cloister monitoring service')
    .action(lazyAction(() => import('./start.js'), 'startCommand'));

  // pan cloister stop
  cloister
    .command('stop')
    .description('Stop Cloister monitoring (agents continue running)')
    .action(lazyAction(() => import('./stop.js'), 'stopCommand'));

  // pan cloister emergency-stop
  cloister
    .command('emergency-stop')
    .description('Emergency stop - kill ALL agents immediately')
    .action(async () => (await import('./stop.js')).stopCommand({ emergency: true }));
}
