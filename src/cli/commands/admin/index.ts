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

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command('admin')
    .description('Plumbing commands: watchdog, specialists, infra, db, config, and more');

  // pan admin cloister — lifecycle watchdog
  registerCloisterCommands(admin);
}
