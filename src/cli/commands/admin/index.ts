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
    .action(setupHooksCommand);
}
