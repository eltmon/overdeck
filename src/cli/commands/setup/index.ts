import { Command } from 'commander';
import { setupHooksCommand } from './hooks.js';

/**
 * Register all setup subcommands
 */
export function registerSetupCommands(program: Command): void {
  const setup = program
    .command('setup')
    .description('Setup and configure Panopticon components');

  setup
    .command('hooks')
    .description('Configure Claude Code hooks for heartbeat tracking')
    .action(setupHooksCommand);
}
