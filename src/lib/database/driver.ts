import { createRequire } from 'node:module';

export type SqliteScalar = string | number | bigint | null | Uint8Array;
export type SqliteBindValue = unknown;
export type SqliteBindParams = SqliteBindValue | Record<string, SqliteBindValue>;
export type SqliteRow = Record<string, SqliteScalar>;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: SqliteBindParams[]): SqliteRunResult;
  get<TRow = SqliteRow>(...params: SqliteBindParams[]): TRow | undefined;
  all<TRow = SqliteRow>(...params: SqliteBindParams[]): TRow[];
  iterate<TRow = SqliteRow>(...params: SqliteBindParams[]): IterableIterator<TRow>;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
  loadExtension(path: string): void;
  close(): void;
}

export interface OpenDatabaseOptions {
  allowExtension?: boolean;
}

declare const Bun: unknown;

type RawStatement = {
  run: (...params: unknown[]) => SqliteRunResult;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  iterate: (...params: unknown[]) => IterableIterator<unknown>;
};

type RawDatabase = {
  exec: (sql: string) => void;
  prepare?: (sql: string) => RawStatement;
  query?: (sql: string) => RawStatement;
  enableLoadExtension?: (enabled: boolean) => void;
  loadExtension?: (path: string) => void;
  close: () => void;
};

type EmitWarningArgs = Parameters<typeof process.emitWarning>;

const _require = createRequire(import.meta.url);
const SQLITE_WARNING_FILTER = Symbol.for('panopticon.sqliteWarningFilterInstalled');

function isBunRuntime(): boolean {
  return typeof Bun !== 'undefined';
}

function warningName(args: EmitWarningArgs): string | undefined {
  const [warning, typeOrOptions] = args;
  if (warning instanceof Error) {
    return warning.name;
  }
  if (typeof typeOrOptions === 'string') {
    return typeOrOptions;
  }
  return typeOrOptions?.type;
}

function warningMessage(args: EmitWarningArgs): string {
  const [warning] = args;
  return warning instanceof Error ? warning.message : String(warning);
}

function isSqliteExperimentalWarning(args: EmitWarningArgs): boolean {
  return warningName(args) === 'ExperimentalWarning' && /SQLite/.test(warningMessage(args));
}

function installSqliteWarningFilter(): void {
  const processWithFlag = process as typeof process & { [SQLITE_WARNING_FILTER]?: true };
  if (processWithFlag[SQLITE_WARNING_FILTER]) {
    return;
  }

  const previousEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((...args: EmitWarningArgs) => {
    if (isSqliteExperimentalWarning(args)) {
      return;
    }
    return previousEmitWarning(...args);
  }) as typeof process.emitWarning;
  processWithFlag[SQLITE_WARNING_FILTER] = true;
}

installSqliteWarningFilter();

function assertNoBooleanBind(value: unknown): void {
  if (typeof value === 'boolean') {
    throw new TypeError('SQLite boolean bind values are not supported; bind 0 or 1 explicitly.');
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoBooleanBind(item);
    }
    return;
  }
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    for (const item of Object.values(value)) {
      assertNoBooleanBind(item);
    }
  }
}

function validateBindParams(params: unknown[]): void {
  for (const param of params) {
    assertNoBooleanBind(param);
  }
}

function isBindRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function normalizeNamedBindRecord(sql: string, record: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(record)) {
    if (/^[:@$]/.test(key)) {
      if (sql.includes(key)) {
        normalized[key] = value;
      } else {
        changed = true;
      }
      continue;
    }

    const prefixedKey = [`@${key}`, `:${key}`, `$${key}`].find((candidate) => sql.includes(candidate));
    if (!prefixedKey) {
      changed = true;
      continue;
    }

    normalized[prefixedKey] = value;
    changed = true;
  }

  return changed ? normalized : record;
}

function normalizeBindParams(sql: string, params: SqliteBindParams[]): unknown[] {
  const positionalParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return positionalParams.map((param) => (isBindRecord(param) ? normalizeNamedBindRecord(sql, param) : param));
}

function wrapStatement(sql: string, statement: RawStatement): SqliteStatement {
  return {
    run: (...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.run(...normalizeBindParams(sql, params));
    },
    get: <TRow = SqliteRow>(...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.get(...normalizeBindParams(sql, params)) as TRow | undefined;
    },
    all: <TRow = SqliteRow>(...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.all(...normalizeBindParams(sql, params)) as TRow[];
    },
    iterate: <TRow = SqliteRow>(...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.iterate(...normalizeBindParams(sql, params)) as IterableIterator<TRow>;
    },
  };
}

function rawPrepare(db: RawDatabase, sql: string): RawStatement {
  if (db.prepare) {
    return db.prepare(sql);
  }
  if (db.query) {
    return db.query(sql);
  }
  throw new Error('SQLite driver does not expose prepare() or query().');
}

function readFirstColumn(row: unknown): unknown {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const values = Object.values(row);
  return values.length === 0 ? null : values[0];
}

function wrapDatabase(raw: RawDatabase): SqliteDatabase {
  let transactionDepth = 0;
  let savepointId = 0;

  const db: SqliteDatabase = {
    exec: (sql: string) => {
      raw.exec(sql);
    },
    prepare: (sql: string) => wrapStatement(sql, rawPrepare(raw, sql)),
    pragma: (sql: string, options?: { simple?: boolean }) => {
      const rows = db.prepare(`PRAGMA ${sql}`).all();
      if (options?.simple) {
        return readFirstColumn(rows[0]);
      }
      return rows;
    },
    transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => {
      return (...args: TArgs): TResult => {
        if (transactionDepth === 0) {
          raw.exec('BEGIN');
          transactionDepth = 1;
          let committed = false;
          try {
            const result = fn(...args);
            raw.exec('COMMIT');
            committed = true;
            return result;
          } catch (error) {
            if (!committed) raw.exec('ROLLBACK');
            throw error;
          } finally {
            transactionDepth = 0;
          }
        }

        const savepoint = `panopticon_tx_${++savepointId}`;
        raw.exec(`SAVEPOINT ${savepoint}`);
        transactionDepth++;
        let released = false;
        try {
          const result = fn(...args);
          raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
          released = true;
          return result;
        } catch (error) {
          if (!released) {
            raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
          }
          throw error;
        } finally {
          transactionDepth--;
        }
      };
    },
    loadExtension: (path: string) => {
      if (!raw.loadExtension) {
        throw new Error('SQLite driver does not support loadable extensions.');
      }
      raw.enableLoadExtension?.(true);
      raw.loadExtension(path);
    },
    close: () => {
      raw.close();
    },
  };

  return db;
}

function loadNodeSqlite(): { DatabaseSync: new (path: string, options?: OpenDatabaseOptions) => RawDatabase } {
  try {
    return _require('node:sqlite') as { DatabaseSync: new (path: string, options?: OpenDatabaseOptions) => RawDatabase };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load node:sqlite (${message}). Panopticon requires Node 22.16+ or Node 24+ for the bundled SQLite driver; older Node 22 builds may require --experimental-sqlite and are not supported.`,
      { cause: error },
    );
  }
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  if (isBunRuntime()) {
    const { Database } = _require('bun:sqlite') as { Database: new (path: string) => RawDatabase };
    return wrapDatabase(new Database(path));
  }

  const { DatabaseSync } = loadNodeSqlite();
  return wrapDatabase(new DatabaseSync(path, options));
}
