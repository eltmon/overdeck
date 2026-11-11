import { join } from 'node:path';

import { getOverdeckHome, packageRoot } from '../paths.js';

export const OVERDECK_TABLE_COUNT = 44;
export const OVERDECK_MIGRATION_PATH = join(packageRoot, 'drizzle', 'overdeck', '0000_overdeck_init.sql');

/**
 * The db filename, exported so a non-door module that only needs to know its
 * NAME (e.g. classifying a home as new-vs-existing, never opening it) does
 * not have to spell it out — which `lint-overdeck-boundaries.sh` flags as a
 * consumer reaching the db directly (PAN-5151).
 */
export const OVERDECK_DB_FILENAME = 'overdeck.db';

export function getOverdeckDatabasePath(): string {
  return join(getOverdeckHome(), OVERDECK_DB_FILENAME);
}
