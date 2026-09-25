/**
 * Remote Workspace CLI Commands
 *
 * pan remote <command>
 *
 * Commands for managing remote workspaces on Fly.io machines.
 */

import { Command } from 'commander';
import { lazyAction } from '../../lazy-action.js';

export function registerRemoteCommands(program: Command): void {
  const remote = program
    .command('remote')
    .description('Remote workspace management (Fly.io)');

  // pan remote status
  remote
    .command('status')
    .description('Show Fly.io connection and machine status')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./status.js'), 'statusCommand'));

  // pan remote init
  remote
    .command('init')
    .description('Initialize Fly.io app for workspace machines')
    .option('--app <app>', 'Fly app name', 'pan-workspaces')
    .option('--org <org>', 'Fly org slug', 'personal')
    .option('--region <region>', 'Default region', 'iad')
    .action(lazyAction(() => import('./init.js'), 'initCommand'));

  // pan remote resources
  remote
    .command('resources')
    .description('Show RAM/disk usage across VMs')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./resources.js'), 'resourcesCommand'));

  // pan remote setup
  remote
    .command('setup')
    .description('Setup Fly.io integration (install flyctl, configure auth)')
    .action(lazyAction(() => import('./setup.js'), 'setupCommand'));

  // pan remote reap
  remote
    .command('reap')
    .description('Hand completed remote agents (PAN_REMOTE_DONE) to the review pipeline and stop their machines')
    .option('--issue <id>', 'Target a single issue instead of scanning all remote agents')
    .option('--dry-run', 'Report what would be reaped without acting')
    .action(lazyAction(() => import('./reap.js'), 'reapCommand'));
}
