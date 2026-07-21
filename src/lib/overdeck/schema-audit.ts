import { readFileSync } from 'node:fs';

import type { SqliteDatabase } from '../database/driver.js';
import { OVERDECK_MIGRATION_PATH } from './paths.js';

export interface SchemaColumnExpectation {
  table: string;
  column: string;
}

export interface SchemaTopUpExpectations {
  columns: SchemaColumnExpectation[];
  indexes: string[];
}

export interface SchemaExpectations {
  tables: Map<string, Set<string>>;
  indexes: Set<string>;
}

export interface SchemaDriftReport {
  missingTables: string[];
  missingIndexes: string[];
  missingColumns: SchemaColumnExpectation[];
}

const EMPTY_TOP_UP_EXPECTATIONS: SchemaTopUpExpectations = {
  columns: [],
  indexes: [],
};

function splitTableDefinitions(body: string): string[] {
  const definitions: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (character === quote && body[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      definitions.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }

  definitions.push(body.slice(start).trim());
  return definitions.filter(Boolean);
}

export function parseOverdeckSchemaExpectations(
  migrationSql: string,
  topUps: SchemaTopUpExpectations = EMPTY_TOP_UP_EXPECTATIONS,
): SchemaExpectations {
  const tables = new Map<string, Set<string>>();
  const indexes = new Set<string>();

  for (const statement of migrationSql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    const tableMatch = trimmed.match(
      /^CREATE TABLE(?: IF NOT EXISTS)?\s+`([^`]+)`\s*\(([\s\S]*)\)\s*;?$/i,
    );
    if (tableMatch) {
      const [, tableName, body] = tableMatch;
      const columns = new Set<string>();
      for (const definition of splitTableDefinitions(body)) {
        const columnMatch = definition.match(/^`([^`]+)`\s+/);
        if (columnMatch) columns.add(columnMatch[1]);
      }
      tables.set(tableName, columns);
      continue;
    }

    const indexMatch = trimmed.match(
      /^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+`([^`]+)`\s+ON\s+`[^`]+`/i,
    );
    if (indexMatch) indexes.add(indexMatch[1]);
  }

  for (const { table, column } of topUps.columns) {
    const columns = tables.get(table) ?? new Set<string>();
    columns.add(column);
    tables.set(table, columns);
  }
  for (const index of topUps.indexes) indexes.add(index);

  return { tables, indexes };
}

export function readOverdeckSchemaExpectationsSync(
  topUps: SchemaTopUpExpectations = EMPTY_TOP_UP_EXPECTATIONS,
): SchemaExpectations {
  return parseOverdeckSchemaExpectations(
    readFileSync(OVERDECK_MIGRATION_PATH, 'utf8'),
    topUps,
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function auditOverdeckSchemaSync(
  db: SqliteDatabase,
  topUps: SchemaTopUpExpectations = EMPTY_TOP_UP_EXPECTATIONS,
): SchemaDriftReport {
  const expected = readOverdeckSchemaExpectationsSync(topUps);
  const artifacts = db
    .prepare(`
      SELECT type, name
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name NOT LIKE 'sqlite_%'
    `)
    .all<{ type: 'table' | 'index'; name: string }>();
  const actualTables = new Set(
    artifacts.filter((artifact) => artifact.type === 'table').map((artifact) => artifact.name),
  );
  const actualIndexes = new Set(
    artifacts.filter((artifact) => artifact.type === 'index').map((artifact) => artifact.name),
  );

  const missingTables = [...expected.tables.keys()]
    .filter((table) => !actualTables.has(table))
    .sort();
  const missingIndexes = [...expected.indexes]
    .filter((index) => !actualIndexes.has(index))
    .sort();
  const missingColumns: SchemaColumnExpectation[] = [];

  for (const [table, expectedColumns] of expected.tables) {
    if (!actualTables.has(table)) continue;
    const actualColumns = new Set(
      db
        .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
        .all<{ name: string }>()
        .map((column) => column.name),
    );
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) missingColumns.push({ table, column });
    }
  }

  missingColumns.sort((left, right) =>
    left.table === right.table
      ? left.column.localeCompare(right.column)
      : left.table.localeCompare(right.table),
  );

  return { missingTables, missingIndexes, missingColumns };
}
