import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openDatabase, type SqliteDatabase } from '../src/lib/database/driver.js';
import {
  getOverdeckDatabasePath,
  OVERDECK_MIGRATION_PATH,
  OVERDECK_TABLE_COUNT,
} from '../src/lib/overdeck/paths.js';

export { getOverdeckDatabasePath, OVERDECK_MIGRATION_PATH, OVERDECK_TABLE_COUNT };

export interface CreateOverdeckDatabaseOptions {
  dbPath?: string;
  migrationPath?: string;
  force?: boolean;
}

export interface CreateOverdeckDatabaseResult {
  dbPath: string;
  tableCount: number;
}

function migrationStatements(migrationPath: string): string[] {
  return readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function userTableNames(db: SqliteDatabase): string[] {
  return db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all<{ name: string }>()
    .map((row) => row.name);
}

function assertEmptyTables(db: SqliteDatabase, tableNames: string[]): void {
  for (const tableName of tableNames) {
    const quoted = tableName.replaceAll('"', '""');
    const row = db.prepare(`SELECT COUNT(*) AS count FROM "${quoted}"`).get<{ count: number }>();
    if (row?.count !== 0) {
      throw new Error(`Expected fresh overdeck.db table ${tableName} to be empty, found ${row?.count ?? 'unknown'} rows.`);
    }
  }
}

function applyMigration(db: SqliteDatabase, migrationPath: string): void {
  db.exec('PRAGMA foreign_keys = ON');

  for (const statement of migrationStatements(migrationPath)) {
    db.exec(statement);
  }
}

export function createOverdeckDatabase(options: CreateOverdeckDatabaseOptions = {}): CreateOverdeckDatabaseResult {
  const dbPath = options.dbPath ?? getOverdeckDatabasePath();
  const migrationPath = options.migrationPath ?? OVERDECK_MIGRATION_PATH;

  if (existsSync(dbPath)) {
    if (!options.force) {
      throw new Error(`Refusing to overwrite existing overdeck.db at ${dbPath}; pass --force to recreate it.`);
    }
    rmSync(dbPath, { force: true });
  }

  mkdirSync(dirname(dbPath), { recursive: true });

  const db = openDatabase(dbPath);
  try {
    applyMigration(db, migrationPath);

    const tables = userTableNames(db);
    if (tables.length !== OVERDECK_TABLE_COUNT) {
      throw new Error(`Expected ${OVERDECK_TABLE_COUNT} overdeck tables, found ${tables.length}: ${tables.join(', ')}`);
    }
    assertEmptyTables(db, tables);
  } finally {
    db.close();
  }

  return { dbPath, tableCount: OVERDECK_TABLE_COUNT };
}

function parseArgs(argv: string[]): CreateOverdeckDatabaseOptions {
  const options: CreateOverdeckDatabaseOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--db') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--db requires a path');
      }
      options.dbPath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = createOverdeckDatabase(parseArgs(process.argv.slice(2)));
  console.log(`Created ${result.dbPath} with ${result.tableCount} empty tables.`);
}
