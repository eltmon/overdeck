/**
 * pan account <verb> — optional sign-in to overdeck.ai (PRD PAN-4330 W-7).
 *
 * Every verb is a lazyAction import so the group costs nothing until invoked,
 * mirroring `pan vault`'s registration pattern.
 */
import { Command } from 'commander';
import { lazyAction, type ActionKeys } from '../../lazy-action.js';

/**
 * Commander calls an action with `(...positionals, options, command)`. Every
 * account verb takes `(options, io, deps)`, so drop the trailing Command;
 * otherwise it lands in `io` and the verb throws on `io.out`.
 */
function accountAction<M, K extends ActionKeys<M>>(load: () => Promise<M>, exportName: K): (...args: unknown[]) => Promise<void> {
  const run = lazyAction(load, exportName);
  return (...args: unknown[]) => run(...args.slice(0, -1));
}

export function registerAccountCommands(program: Command): void {
  const account = program
    .command('account')
    .description('Optional overdeck.ai sign-in for this machine (directory and hosted features)');

  account
    .command('login')
    .description("Sign in to overdeck.ai with the device flow and store this machine's device token")
    .option('--base-url <url>', 'Account service URL (default https://account.overdeck.ai, or OVERDECK_ACCOUNT_URL)')
    .action(accountAction(() => import('./login.js'), 'loginCommand'));

  account
    .command('status')
    .description('Show the signed-in GitHub account and this device')
    .option('--json', 'Output in JSON format')
    .action(accountAction(() => import('./status.js'), 'statusCommand'));

  account
    .command('logout')
    .description("Revoke this machine's device token and delete it locally")
    .action(accountAction(() => import('./logout.js'), 'logoutCommand'));
}
