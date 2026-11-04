/**
 * Register `pan tell` (moved out of src/cli/index.ts in PAN-4650 WI-16, so the
 * CLI entry point shrinks as the verb grows `--message-id` and remote targets).
 */
import type { Command } from 'commander';

import { lazyAction } from '../lazy-action.js';

export function registerTellCommand(program: Command): void {
  program
    .command('tell <id> <message>')
    .description('Send message to running agent, or to a linked machine\'s conversation as @<machine>/<conv>')
    .option('--force', 'Deliver even to a critic or verifier lane that already filed its verdict')
    .option('--steer', 'Interrupt the running turn and send now (Claude Code send-now; Ctrl+X Ctrl+S)')
    .option('--when-limit-resets', 'Queue the message on the server; it sends when the conversation\'s usage limit resets (conversations only)')
    .option('--message-id <id>', 'Idempotency key: a repeat with the same id is delivered once')
    .action(lazyAction(() => import('./tell.js'), 'tellCommand'));
}
