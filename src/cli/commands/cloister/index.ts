/**
 * Cloister CLI Commands
 *
 * pan cloister <command>
 */

import { Command } from 'commander';
import { statusCommand } from './status.js';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { brakeCommand } from './brake.js';
import { freezeCommand, unfreezeCommand } from './freeze.js';

export function registerCloisterCommands(program: Command): void {
  const cloister = program
    .command('cloister')
    .description('Cloister agent watchdog commands');

  // pan cloister status
  cloister
    .command('status')
    .description('Show Cloister service status and agent health')
    .option('--json', 'Output in JSON format')
    .action(statusCommand);

  // pan cloister start
  cloister
    .command('start')
    .description('Start Cloister monitoring service')
    .action(startCommand);

  // pan cloister stop
  cloister
    .command('stop')
    .description('Stop Cloister monitoring (agents continue running)')
    .action(stopCommand);

  // pan cloister emergency-stop
  cloister
    .command('emergency-stop')
    .description('Emergency stop - kill ALL agents immediately')
    .action(() => stopCommand({ emergency: true }));

  // pan cloister brake
  cloister
    .command('brake')
    .description('Emergency brake - trim running work agents down to the concurrency cap (idle-first, resumable)')
    .option('--json', 'Output in JSON format')
    .action(brakeCommand);

  // pan cloister freeze
  cloister
    .command('freeze')
    .description('Globally pause the Deacon (patrols run but skip all actions); running agents unaffected')
    .action(freezeCommand);

  // pan cloister unfreeze
  cloister
    .command('unfreeze')
    .description('Resume the Deacon from a global pause')
    .action(unfreezeCommand);
}
