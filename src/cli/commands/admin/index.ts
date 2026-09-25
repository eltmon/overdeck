/**
 * pan admin — plumbing namespace
 *
 * Groups all internal/debug commands under a single 'admin' subcommand
 * so they don't clutter the happy-path help output.
 *
 * Usage: pan admin <group> <subcommand> [options]
 */

import { Command } from 'commander';
import { collectCommandTree } from '../../command-introspection.js';
import { CommandGroupLoader, group, resolveGroupDemand, type GroupDemand } from '../../command-group-loader.js';
import { registerCloisterCommands } from '../cloister/index.js';
import { registerSpecialistsCommands } from '../specialists/index.js';
import { registerRemoteCommands } from '../remote/index.js';
import { lazyAction } from '../../lazy-action.js';

/**
 * Admin subcommands whose modules carry their implementations: registered
 * only when argv invokes them, so `pan admin specialists done` does not load
 * the db, config and migration tooling (PAN-4195).
 */
export const ADMIN_COMMAND_GROUPS = {
  seedUatFixtures: group({
    names: ['seed-uat-fixtures'],
    load: () => import('./seed-uat-fixtures.js'),
    register: (mod, admin) => mod.registerSeedUatFixturesCommand(admin),
  }),
  migratePlanHome: group({
    names: ['migrate-plan-home'],
    load: () => import('./migrate-plan-home.js'),
    register: (mod, admin) => mod.registerMigratePlanHomeCommand(admin),
  }),
  agents: group({
    names: ['agents'],
    load: () => import('./agents-exited.js'),
    register: (mod, admin) => mod.registerAgentsCommands(admin),
  }),
  db: group({
    names: ['db'],
    load: () => import('../db.js'),
    register: (mod, admin) => mod.registerDbCommands(admin),
  }),
  config: group({
    names: ['config'],
    load: () => import('../config.js'),
    register: (mod, admin) => mod.registerConfigCommand(admin),
  }),
};

export async function registerAdminCommands(
  program: Command,
  demand: GroupDemand = resolveGroupDemand(process.argv, ['admin']),
): Promise<void> {
  const admin = program
    .command('admin')
    .description('Plumbing commands: watchdog, specialists, infra, db, config, and more');

  admin
    .command('commands')
    .description('List every visible pan command (plumbing; feeds composer autocomplete codegen)')
    .option('--json', 'Emit machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const tree = collectCommandTree(program);
      if (options.json) {
        console.log(JSON.stringify(tree, null, 2));
        return;
      }
      for (const command of tree) {
        console.log(`pan ${command.path.join(' ')}  —  ${command.description}`);
      }
    });

  const groups = new CommandGroupLoader(admin, demand, ADMIN_COMMAND_GROUPS);
  await groups.register('seedUatFixtures');
  await groups.register('migratePlanHome');
  await groups.register('agents');

  // pan admin cloister — lifecycle watchdog
  registerCloisterCommands(admin);

  // pan admin specialists — review/test/merge agents
  registerSpecialistsCommands(admin);

  // pan admin remote — Fly.io infra
  registerRemoteCommands(admin);

  // pan admin db — database seeding
  await groups.register('db');

  // pan task — canonical beads mutation door (top level: the work-agent
  // prompts instruct `pan task close|claim|...`; PAN-2564 FR-9/WI-13).
  // Also kept under pan admin beads for the reconcile/migration-gate docs.

  // pan admin config — configuration management
  await groups.register('config');

  // pan admin hooks — harness hook management
  const hooks = admin
    .command('hooks')
    .description('Manage heartbeat hooks');

  hooks
    .command('install')
    .description('Configure heartbeat hooks for Claude Code and/or Pi')
    .option('--dry-run', 'Preview the proposed settings.json diff without writing')
    .option('--harness <harness>', 'Target harness: claude-code, pi, or both')
    .action(async (opts: { dryRun?: boolean; harness?: string }) => {
      const { parseHookHarness, setupHooksCommand } = await import('../setup/hooks.js');
      return setupHooksCommand({
        dryRun: opts.dryRun,
        harness: parseHookHarness(opts.harness),
      });
    });

  hooks
    .command('status')
    .description('Show installed hook harness support')
    .action(async () => (await import('../setup/hooks.js')).hooksStatusCommand());

  // pan admin tldr — TLDR daemon management
  admin
    .command('tldr [action] [workspace]')
    .description('TLDR daemon: status, start, stop, warm')
    .option('--json', 'Output as JSON')
    .action(async (action, workspace, options) => {
      (await import('./tldr-handler.js')).tldrCommand(action || 'status', workspace, options);
    });

  // pan admin fpp — first-person-plural hooks
  admin
    .command('fpp [action] [idOrMessage...]')
    .description('FPP hooks: check, push, pop, clear, mail')
    .option('--json', 'Output as JSON')
    .action(async (action, idOrMessage, options) => {
      (await import('./fpp-handler.js')).hookCommand(action || 'help', idOrMessage?.join(' '), options);
    });

  // pan admin conversations — conversation maintenance
  const conversations = admin
    .command('conversations')
    .description('Conversation maintenance utilities');

  conversations
    .command('backfill-titles')
    .description('Backfill titles for conversations stuck on "New conversation"')
    .option('--dry-run', 'Preview changes without writing to the database')
    .action(async (options: { dryRun?: boolean }) => {
      await (await import('./conversations-handler.js')).backfillTitlesCommand(options);
    });

  // pan admin tracker — tracker-specific operations
  const tracker = admin
    .command('tracker')
    .description('Tracker-specific operations (Linear, GitHub, etc.)');

  tracker
    .command('linear-states')
    .description('Manage Linear workflow states')
    .option('-t, --team <team>', 'Team key (default: MIN)')
    .action(async (options) => (await import('./tracker-handler.js')).listStatesCommand(options));

  tracker
    .command('linear-cleanup')
    .description('Archive old Linear custom states')
    .option('-t, --team <team>', 'Team key (default: MIN)')
    .option('-s, --state <state>', 'State name to archive (default: Planning)')
    .option('--dry-run', 'Show what would be archived without making changes')
    .action(async (options) => (await import('./tracker-handler.js')).cleanupStatesCommand(options));

  // pan admin migrate-config — one-time settings.json → config.yaml migration
  admin
    .command('migrate-config')
    .description('One-time migration from settings.json to config.yaml')
    .option('--force', 'Force migration even if config.yaml exists')
    .option('--preview', 'Preview migration without applying changes')
    .option('--no-backup', 'Do not back up settings.json')
    .option('--delete-legacy', 'Delete settings.json after migration')
    .action(lazyAction(() => import('../migrate-config.js'), 'migrateConfigCommand'));

  await groups.finish();
}
