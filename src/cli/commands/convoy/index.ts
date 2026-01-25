import { Command } from 'commander';
import { startCommand } from './start.js';
import { statusCommand } from './status.js';
import { listCommand } from './list.js';
import { stopCommand } from './stop.js';

export function registerConvoyCommands(program: Command): void {
  const convoy = program
    .command('convoy')
    .description('Multi-agent convoy orchestration');

  convoy
    .command('start <template>')
    .description('Start a new convoy')
    .option('--files <pattern>', 'File pattern (e.g., "src/**/*.ts")')
    .option('--pr-url <url>', 'Pull request URL')
    .option('--issue-id <id>', 'Issue ID')
    .option('--project-path <path>', 'Project path (defaults to cwd)')
    .action(startCommand);

  convoy
    .command('status [convoy-id]')
    .description('Show convoy status (current convoy if no ID specified)')
    .option('--json', 'Output as JSON')
    .action(statusCommand);

  convoy
    .command('list')
    .description('List all convoys')
    .option('--status <status>', 'Filter by status (running|completed|failed|partial)')
    .option('--json', 'Output as JSON')
    .action(listCommand);

  convoy
    .command('stop <convoy-id>')
    .description('Stop a running convoy')
    .option('--force', 'Skip confirmation')
    .action(stopCommand);
}

// Re-export individual commands
export { startCommand } from './start.js';
export { statusCommand } from './status.js';
export { listCommand } from './list.js';
export { stopCommand } from './stop.js';
