/**
 * pan share / pan join — Shared Sessions from the terminal (PRD PAN-4480).
 * Lazy actions only, like `pan account` (src/cli/commands/account/index.ts).
 */
import { Command } from 'commander';
import { lazyAction, type ActionKeys } from '../../lazy-action.js';

/** Commander passes `(...positionals, options, command)`; drop the trailing Command. */
function sharingAction<M, K extends ActionKeys<M>>(load: () => Promise<M>, exportName: K): (...args: unknown[]) => Promise<void> {
  const run = lazyAction(load, exportName);
  return (...args: unknown[]) => run(...args.slice(0, -1));
}

export function registerSharingCommands(program: Command): void {
  program
    .command('share')
    .description('Share a conversation by link: print the join link and join code (Shared Sessions)')
    .argument('<conversation>', 'Conversation id (the number in /conv/<id>) or conversation name')
    .option('--json', 'Print the share as JSON')
    .action(sharingAction(() => import('./share.js'), 'shareCommand'));

  program
    .command('join')
    .description('Join a shared conversation from a link or join code: signs in, starts Overdeck if needed, opens the lobby')
    .argument('<link-or-code>', 'Join link (https://share.overdeck.ai/s/<code>) or join code (BCDF-GHJK)')
    .option('--no-open', 'Print the shared-conversation URL instead of opening a browser')
    .action(sharingAction(() => import('./join.js'), 'joinCommand'));
}
