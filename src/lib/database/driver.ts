import { createRequire } from 'node:module';

export type SqliteScalar = string | number | bigint | null | Uint8Array;
export type SqliteBindValue = SqliteScalar;
export type SqliteBindParams = SqliteBindValue | Record<string, SqliteBindValue>;
export type SqliteRow = Record<string, SqliteScalar>;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: SqliteBindParams[]): SqliteRunResult;
  get(...params: SqliteBindParams[]): SqliteRow | undefined;
  all(...params: SqliteBindParams[]): SqliteRow[];
  iterate(...params: SqliteBindParams[]): IterableIterator<SqliteRow>;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
  close(): void;
}

declare const Bun: unknown;

type RawStatement = {
  run: (...params: unknown[]) => SqliteRunResult;
  get: (...params: unknown[]) => SqliteRow | undefined;
  all: (...params: unknown[]) => SqliteRow[];
  iterate: (...params: unknown[]) => IterableIterator<SqliteRow>;
};

type RawDatabase = {
  exec: (sql: string) => void;
  prepare?: (sql: string) => RawStatement;
  query?: (sql: string) => RawStatement;
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

function wrapStatement(statement: RawStatement): SqliteStatement {
  return {
    run: (...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.run(...params);
    },
    get: (...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.get(...params);
    },
    all: (...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.all(...params);
    },
    iterate: (...params: SqliteBindParams[]) => {
      validateBindParams(params);
      return statement.iterate(...params);
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

function readPragmaScalar(db: SqliteDatabase, sql: string): unknown {
  const key = sql.trim();
  const row = db.prepare(`PRAGMA ${key}`).get();
  if (!row) {
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
    prepare: (sql: string) => wrapStatement(rawPrepare(raw, sql)),
    pragma: (sql: string, options?: { simple?: boolean }) => {
      if (options?.simple) {
        return readPragmaScalar(db, sql);
      }
      raw.exec(`PRAGMA ${sql}`);
      return undefined;
    },
    transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => {
      return (...args: TArgs): TResult => {
        if (transactionDepth === 0) {
          raw.exec('BEGIN');
          transactionDepth++;
          try {
            const result = fn(...args);
            transactionDepth--;
            raw.exec('COMMIT');
            return result;
          } catch (error) {
            transactionDepth--;
            raw.exec('ROLLBACK');
            throw error;
          }
        }

        const savepoint = `panopticon_tx_${++savepointId}`;
        raw.exec(`SAVEPOINT ${savepoint}`);
        transactionDepth++;
        try {
          const result = fn(...args);
          transactionDepth--;
          raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          transactionDepth--;
          raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        }
      };
    },
    close: () => {
      raw.close();
    },
  };

  return db;
}

function loadNodeSqlite(): { DatabaseSync: new (path: string) => RawDatabase } {
  try {
    return _require('node:sqlite') as { DatabaseSync: new (path: string) => RawDatabase };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load node:sqlite (${message}). Panopticon requires Node 22.16+ or Node 24+ for the bundled SQLite driver; older Node 22 builds may require --experimental-sqlite and are not supported.`,
      { cause: error },
    );
  }
}

export function openDatabase(path: string): SqliteDatabase {
  if (isBunRuntime()) {
    const { Database } = _require('bun:sqlite') as { Database: new (path: string) => RawDatabase };
    return wrapDatabase(new Database(path));
  }

  const { DatabaseSync } = loadNodeSqlite();
  return wrapDatabase(new DatabaseSync(path));
}
