/**
 * D1 shim over node:sqlite for the account-service unit tests (PRD PAN-4293 D-24, R-1).
 *
 * Implements only the D1 subset the Worker uses: prepare(sql) → bind(...) → first()/all()/run(), and batch().
 * Anything else (exec, dump, withSession) is deliberately absent so runtime code cannot depend on it.
 * applyMigrations() replays services/account/migrations/*.sql in name order.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../services/account/migrations');

export type D1Value = string | number | null | ArrayBuffer | Uint8Array;

export interface D1ShimMeta {
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read: number;
  rows_written: number;
  size_after: number;
  changed_db: boolean;
}

export interface D1ShimResult<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: D1ShimMeta;
}

export interface D1ShimStatement {
  bind(...values: D1Value[]): D1ShimStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ShimResult<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ShimResult<T>>;
}

export interface D1Shim {
  prepare(sql: string): D1ShimStatement;
  batch<T = Record<string, unknown>>(statements: D1ShimStatement[]): Promise<D1ShimResult<T>[]>;
  /** Test-only escape hatch for inspecting state; runtime code never sees it. */
  readonly raw: DatabaseSync;
}

function plain<T>(row: unknown): T {
  // node:sqlite returns null-prototype objects; D1 returns plain ones.
  return { ...(row as Record<string, unknown>) } as T;
}

function meta(changes = 0, lastRowId = 0): D1ShimMeta {
  return { changes, last_row_id: lastRowId, duration: 0, rows_read: 0, rows_written: changes, size_after: 0, changed_db: changes > 0 };
}

interface StatementInternals {
  execute(raw: DatabaseSync): D1ShimResult;
}

function makeStatement(raw: DatabaseSync, sql: string, values: D1Value[]): D1ShimStatement & StatementInternals {
  const args = values as SQLInputValue[];
  const execute = (db: DatabaseSync): D1ShimResult => {
    const stmt = db.prepare(sql);
    const results = stmt.all(...args).map((row) => plain<Record<string, unknown>>(row));
    const changes = db.prepare('SELECT changes() AS c, last_insert_rowid() AS r').get() as { c: number; r: number };
    return { results, success: true, meta: meta(changes.c, changes.r) };
  };
  return {
    execute,
    bind(...next: D1Value[]) {
      return makeStatement(raw, sql, next);
    },
    async first(column?: string) {
      const row = raw.prepare(sql).get(...args);
      if (row === undefined) return null;
      const p = plain<Record<string, unknown>>(row);
      if (column === undefined) return p;
      return column in p ? (p[column] as never) : null;
    },
    async all() {
      return execute(raw) as never;
    },
    async run() {
      return execute(raw) as never;
    },
  };
}

export function createTestD1(): D1Shim {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  return {
    raw,
    prepare(sql: string) {
      return makeStatement(raw, sql, []);
    },
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => (s as D1ShimStatement & StatementInternals).execute(raw));
        raw.exec('COMMIT');
        return out as never;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/** Applies every services/account/migrations/*.sql file in name order. */
export function applyMigrations(db: D1Shim): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) db.raw.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  return files;
}

export function listTables(db: D1Shim): string[] {
  return (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
}

/** Every row of every table as one JSON string, for "no secret is persisted" assertions (NFR-2, NFR-3). */
export function dumpAllTables(db: D1Shim): string {
  const out: Record<string, unknown[]> = {};
  for (const table of listTables(db)) out[table] = db.raw.prepare(`SELECT * FROM "${table}"`).all().map((r) => plain(r));
  return JSON.stringify(out);
}
