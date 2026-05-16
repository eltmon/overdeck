/**
 * pan admin — plumbing namespace
 *
 * Groups all internal/debug commands under a single 'admin' subcommand
 * so they don't clutter the happy-path help output.
 *
 * Usage: pan admin <group> <subcommand> [options]
 */

import { Command } from 'commander';
import { registerCloisterCommands } from '../cloister/index.js';
import { registerSpecialistsCommands } from '../specialists/index.js';
import { registerRemoteCommands } from '../remote/index.js';
import { registerDbCommands } from '../db.js';
import { registerBeadsCommands } from '../beads.js';
import { registerConfigCommand } from '../config.js';
import { setupHooksCommand } from '../setup/hooks.js';
import { tldrCommand } from './tldr-handler.js';
import { hookCommand } from './fpp-handler.js';
import { listStatesCommand, cleanupStatesCommand } from './tracker-handler.js';
import { migrateConfigCommand } from '../migrate-config.js';

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command('admin')
    .description('Plumbing commands: watchdog, specialists, infra, db, config, and more');

  // pan admin cloister — lifecycle watchdog
  registerCloisterCommands(admin);

  // pan admin specialists — review/test/merge agents
  registerSpecialistsCommands(admin);

  // pan admin remote — Fly.io infra
  registerRemoteCommands(admin);

  // pan admin db — database seeding
  registerDbCommands(admin);

  // pan admin beads — beads CLI management
  registerBeadsCommands(admin);

  // pan admin config — configuration management
  registerConfigCommand(admin);

  // pan admin hooks — Claude Code hooks management
  const hooks = admin
    .command('hooks')
    .description('Manage Claude Code heartbeat hooks');

  hooks
    .command('install')
    .description('Configure heartbeat hooks in settings.json')
    .option('--dry-run', 'Preview the proposed settings.json diff without writing')
    .action((opts: { dryRun?: boolean }) => setupHooksCommand({ dryRun: opts.dryRun }));

  // pan admin tldr — TLDR daemon management
  admin
    .command('tldr [action] [workspace]')
    .description('TLDR daemon: status, start, stop, warm')
    .option('--json', 'Output as JSON')
    .action((action, workspace, options) => {
      tldrCommand(action || 'status', workspace, options);
    });

  // pan admin fpp — first-person-plural hooks
  admin
    .command('fpp [action] [idOrMessage...]')
    .description('FPP hooks: check, push, pop, clear, mail')
    .option('--json', 'Output as JSON')
    .action((action, idOrMessage, options) => {
      hookCommand(action || 'help', idOrMessage?.join(' '), options);
    });

  // pan admin tracker — tracker-specific operations
  const tracker = admin
    .command('tracker')
    .description('Tracker-specific operations (Linear, GitHub, etc.)');

  tracker
    .command('linear-states')
    .description('Manage Linear workflow states')
    .option('-t, --team <team>', 'Team key (default: MIN)')
    .action((options) => listStatesCommand(options));

  tracker
    .command('linear-cleanup')
    .description('Archive old Linear custom states')
    .option('-t, --team <team>', 'Team key (default: MIN)')
    .option('-s, --state <state>', 'State name to archive (default: Planning)')
    .option('--dry-run', 'Show what would be archived without making changes')
    .action((options) => cleanupStatesCommand(options));

  // pan admin migrate-config — one-time settings.json → config.yaml migration
  admin
    .command('migrate-config')
    .description('One-time migration from settings.json to config.yaml')
    .option('--force', 'Force migration even if config.yaml exists')
    .option('--preview', 'Preview migration without applying changes')
    .option('--no-backup', 'Do not back up settings.json')
    .option('--delete-legacy', 'Delete settings.json after migration')
    .action(migrateConfigCommand);
}
