/**
 * Remote Workspace CLI Commands
 *
 * pan remote <command>
 *
 * Commands for managing remote workspaces on exe.dev VMs.
 */

import { Command } from 'commander';
import { statusCommand } from './status.js';
import { initCommand } from './init.js';
import { resourcesCommand } from './resources.js';
import { setupCommand } from './setup.js';

export function registerRemoteCommands(program: Command): void {
  const remote = program
    .command('remote')
    .description('Remote workspace management (exe.dev)');

  // pan remote status
  remote
    .command('status')
    .description('Show exe.dev connection and VM status')
    .option('--json', 'Output in JSON format')
    .action(statusCommand);

  // pan remote init
  remote
    .command('init')
    .description('Initialize shared infrastructure VM (postgres, redis, traefik)')
    .option('--name <name>', 'Infrastructure VM name', 'pan-infra')
    .action(initCommand);

  // pan remote resources
  remote
    .command('resources')
    .description('Show RAM/disk usage across VMs')
    .option('--json', 'Output in JSON format')
    .action(resourcesCommand);

  // pan remote setup
  remote
    .command('setup')
    .description('Setup exe.dev integration (install CLI, configure SSH)')
    .action(setupCommand);
}
