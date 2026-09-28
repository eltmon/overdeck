/**
 * pan vault <verb> — Session Vault (PAN-2609).
 *
 * Versioned, encrypted, off-machine storage and cross-machine resume for
 * agent conversations. Every verb is a lazyAction import so the group costs
 * nothing until invoked (P-13), and `pan vault` sends no telemetry (P-12).
 */
import { Command } from 'commander';
import { lazyAction } from '../../lazy-action.js';

export function registerVaultCommands(program: Command): void {
  const vault = program
    .command('vault')
    .description('Session Vault: encrypted off-machine storage and cross-machine resume for agent conversations');

  vault
    .command('setup <git-url>')
    .description('Enable the vault against your own git remote and print the recovery phrase once')
    .option('--hooks', 'Also register the Claude Code Stop hook that saves after each turn')
    .action(lazyAction(() => import('./setup.js'), 'setupCommand'));

  vault
    .command('join <git-url>')
    .description('Join an existing vault from another machine with the recovery phrase')
    .option('--phrase-file <path>', 'Read the 24-word recovery phrase from a file instead of prompting')
    .action(lazyAction(() => import('./join.js'), 'joinCommand'));

  vault
    .command('status')
    .description('Show backend, this machine, owned records, last sync and the machine list')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./status.js'), 'statusCommand'));
}
