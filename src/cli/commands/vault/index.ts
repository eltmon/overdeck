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

  vault
    .command('save [session-id-or-path]')
    .description('Settle one transcript (by session id or path) or many into the vault')
    .option('--all', 'Settle every discovered transcript')
    .option('--since <date>', 'With --all: only transcripts modified on or after this date')
    .option('--harness <harness>', 'With --all: only this harness (claude-code, codex, ...)')
    .option('--hook', 'Claude Code Stop-hook mode: read {session_id, transcript_path} JSON from stdin, print nothing, exit 0')
    .action(lazyAction(() => import('./save.js'), 'saveCommand'));

  vault
    .command('sync')
    .description('Settle owned transcripts that grew, register this machine and refresh the list')
    .action(lazyAction(() => import('./sync.js'), 'syncCommand'));

  vault
    .command('list')
    .description('List saved conversations from the local cache (never contacts the backend)')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./list.js'), 'listCommand'));

  vault
    .command('show <id>')
    .description('Print a saved conversation read-only with its versions')
    .option('--json', 'Output in JSON format')
    .action(lazyAction(() => import('./show.js'), 'showCommand'));
}
