import { join } from 'node:path';

import { getOverdeckHome, packageRoot } from '../paths.js';

export const OVERDECK_TABLE_COUNT = 30;
export const OVERDECK_MIGRATION_PATH = join(packageRoot, 'drizzle', 'overdeck', '0000_overdeck_init.sql');

export function getOverdeckDatabasePath(): string {
  return join(getOverdeckHome(), 'overdeck.db');
}
