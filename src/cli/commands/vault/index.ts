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
    .option('--passphrase-file <path>', 'Also enable passphrase unlock with the passphrase in this file')
    .option('--generate-passphrase', 'Also enable passphrase unlock with a generated 6-word passphrase, printed once')
    .option('--no-passphrase', 'Do not offer passphrase unlock')
    .action(lazyAction(() => import('./setup.js'), 'setupCommand'));

  vault
    .command('join <git-url>')
    .description('Join an existing vault from another machine with the vault passphrase or the recovery phrase')
    .option('--phrase-file <path>', 'Read the 24-word recovery phrase from a file instead of prompting')
    .option('--passphrase-file <path>', 'Read the vault passphrase from a file instead of prompting')
    .action(lazyAction(() => import('./join.js'), 'joinCommand'));

  const passphrase = vault
    .command('passphrase')
    .description('Turn passphrase unlock for new machines on (set) or off (remove); the vault key never changes');
  passphrase
    .command('set')
    .description('Wrap the vault key under a passphrase so a new machine can join without the recovery phrase')
    .option('--passphrase-file <path>', 'Read the passphrase from a file instead of prompting')
    .option('--generate', 'Generate a 6-word passphrase and print it once')
    .action(lazyAction(() => import('./passphrase.js'), 'passphraseSetCommand'));
  passphrase
    .command('remove')
    .description('Delete the passphrase unlock object; joining then needs the recovery phrase')
    .action(lazyAction(() => import('./passphrase.js'), 'passphraseRemoveCommand'));

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

  vault
    .command('resume <id>')
    .description('Continue a saved conversation here: <id> or <id>@<version>; adopts it and launches the harness')
    .option('--cwd <dir>', 'Working directory to resume in (default: the saved cwd)')
    .option('--no-launch', 'Print the launch command instead of running it')
    .option('--on-drift <choice>', 'When the cwd state differs from the saved state: continue | note | cancel')
    .option('--no-code', 'Do not apply the saved code snapshot; only continue the conversation')
    .option('--worktree <dir>', 'Apply the code snapshot into a new git worktree at <dir> instead of the target checkout')
    .action(lazyAction(() => import('./resume.js'), 'resumeCommand'));

  vault
    .command('exclude [path]')
    .description('Exclude conversations by cwd path, git origin or session id; an excluded saved record becomes a tombstone')
    .option('--origin <url>', 'Exclude conversations whose git origin is this URL')
    .option('--session <id>', 'Exclude one session by native session id or vault id')
    .action(lazyAction(() => import('./exclude.js'), 'excludeCommand'));

  vault
    .command('include [path]')
    .description('Remove an exclusion added with pan vault exclude')
    .option('--origin <url>', 'Include conversations whose git origin is this URL again')
    .option('--session <id>', 'Include one session again')
    .action(lazyAction(() => import('./exclude.js'), 'includeCommand'));

  vault
    .command('allow-secret <id-or-path> [line]')
    .description('Allow one blocked transcript line, or the blocked code lines of one file, for that record only')
    .option('--file <path>', 'Allow the blocked lines of this file in the code snapshot (path relative to the repository root)')
    .action(lazyAction(() => import('./allow-secret.js'), 'allowSecretCommand'));

  vault
    .command('evict')
    .description('Review the pending-deletion batch (default) or act on it; nothing is deleted without --confirm')
    .option('--review', 'Scan and print the batch with its fingerprint (default)')
    .option('--confirm <fingerprint>', 'Delete the reviewed files if the batch still matches this fingerprint')
    .option('--decline <vaultId>', 'Remove an entry from the batch and do not offer it again')
    .option('--reoffer <vaultId>', 'Allow a declined entry to be offered again')
    .option('--clear', 'Empty the batch without deleting or declining anything')
    .action(lazyAction(() => import('./evict.js'), 'evictCommand'));

  vault
    .command('restore <id>')
    .description('Rebuild an evicted transcript byte for byte at its original path')
    .option('--to <path>', 'Write the rebuilt file here instead of the recorded path')
    .action(lazyAction(() => import('./restore.js'), 'restoreCommand'));
}
