import { join } from 'node:path';

import { getPanopticonHome, packageRoot } from '../paths.js';

export const OVERDECK_TABLE_COUNT = 29;
export const OVERDECK_MIGRATION_PATH = join(packageRoot, 'drizzle', 'overdeck', '0000_overdeck_init.sql');

export function getOverdeckDatabasePath(): string {
  return join(getPanopticonHome(), 'overdeck.db');
}
