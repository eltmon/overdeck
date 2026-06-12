import { Worker } from 'node:worker_threads';
import type { SqliteBindParams, SqliteRunResult } from '../database/driver.js';
import {
  closeMemoryFtsDatabasesInProcess,
  getMemoryFtsDatabaseSync,
  runMemoryFtsStatementSync,
  runMemoryFtsTransactionSync,
  type MemoryFtsStatement,
} from './fts-operations.js';

export type { MemoryFtsStatement };

export interface MemoryFtsPreparedStatement {
  run(...params: SqliteBindParams[]): Promise<SqliteRunResult>;
  get<TRow = unknown>(...params: SqliteBindParams[]): Promise<TRow | undefined>;
  all<TRow = unknown>(...params: SqliteBindParams[]): Promise<TRow[]>;
}

export interface MemoryFtsDatabaseClient {
  exec(sql: string): Promise<void>;
  prepare(sql: string): MemoryFtsPreparedStatement;
}

interface MemoryFtsWorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

type MemoryFtsWorkerOperation = 'initialize' | 'statement' | 'transaction' | 'close';

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const clients = new Map<string, MemoryFtsDatabaseClient>();

export async function getMemoryFtsDatabase(projectId: string): Promise<MemoryFtsDatabaseClient> {
  const cached = clients.get(projectId);
  if (cached) return cached;

  await postMemoryFtsRequest('initialize', projectId);
  const client = createClient(projectId);
  clients.set(projectId, client);
  return client;
}

export async function withMemoryFtsDatabase<T>(
  projectId: string,
  operation: (db: MemoryFtsDatabaseClient) => T | Promise<T>,
): Promise<T> {
  const db = await getMemoryFtsDatabase(projectId);
  return operation(db);
}

export function runMemoryFtsStatement<T = unknown>(projectId: string, statement: MemoryFtsStatement): Promise<T> {
  return postMemoryFtsRequest<T>('statement', projectId, { statement });
}

export function runMemoryFtsTransaction(projectId: string, statements: MemoryFtsStatement[]): Promise<unknown[]> {
  return postMemoryFtsRequest<unknown[]>('transaction', projectId, { statements });
}

export function closeMemoryFtsDatabases(): void {
  clients.clear();
  closeMemoryFtsDatabasesInProcess();
  if (!worker) return;

  const closing = worker;
  worker = null;
  pendingRequests.forEach((request) => request.reject(new Error('Memory FTS worker closed')));
  pendingRequests.clear();
  closing.postMessage({ id: nextRequestId++, operation: 'close' });
  void closing.terminate();
}

function createClient(projectId: string): MemoryFtsDatabaseClient {
  return {
    exec: async (sql: string) => {
      await runMemoryFtsStatement(projectId, { sql, method: 'exec' });
    },
    prepare: (sql: string) => ({
      run: (...params: SqliteBindParams[]) => runMemoryFtsStatement<SqliteRunResult>(projectId, { sql, params, method: 'run' }),
      get: <TRow = unknown>(...params: SqliteBindParams[]) => runMemoryFtsStatement<TRow | undefined>(projectId, { sql, params, method: 'get' }),
      all: <TRow = unknown>(...params: SqliteBindParams[]) => runMemoryFtsStatement<TRow[]>(projectId, { sql, params, method: 'all' }),
    }),
  };
}

function postMemoryFtsRequest<T = unknown>(operation: MemoryFtsWorkerOperation, projectId?: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (shouldRunInline()) {
    return Promise.resolve().then(() => runInline<T>(operation, projectId, payload));
  }

  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const currentWorker = getMemoryFtsWorker();
    currentWorker.ref();
    currentWorker.postMessage({ id, operation, projectId, ...payload });
  });
}

function runInline<T>(operation: MemoryFtsWorkerOperation, projectId?: string, payload: Record<string, unknown> = {}): T {
  switch (operation) {
    case 'initialize':
      getMemoryFtsDatabaseSync(requireProjectId(projectId));
      return null as T;
    case 'statement':
      return runMemoryFtsStatementSync<T>(requireProjectId(projectId), payload.statement as MemoryFtsStatement);
    case 'transaction':
      return runMemoryFtsTransactionSync(requireProjectId(projectId), payload.statements as MemoryFtsStatement[]) as T;
    case 'close':
      closeMemoryFtsDatabasesInProcess();
      return null as T;
  }
}

function shouldRunInline(): boolean {
  // Source-mode workers cannot reliably resolve this repo's .js TypeScript import specifiers.
  // The supported dashboard runtime is the built Node bundle, which always takes the worker path.
  return import.meta.url.endsWith('.ts');
}

function requireProjectId(projectId: string | undefined): string {
  if (!projectId) throw new Error('Memory FTS request missing projectId');
  return projectId;
}

function getMemoryFtsWorker(): Worker {
  if (worker) return worker;

  const nextWorker = new Worker(memoryFtsWorkerUrl(), {
    type: 'module',
    execArgv: process.execArgv.filter((arg) => !arg.startsWith('--inspect')),
  } as ConstructorParameters<typeof Worker>[1]);

  nextWorker.on('message', (message: MemoryFtsWorkerResponse) => {
    const request = pendingRequests.get(message.id);
    if (!request) return;
    pendingRequests.delete(message.id);
    if (message.ok) {
      request.resolve(message.result);
    } else {
      request.reject(new Error(message.error ?? 'Memory FTS worker failed'));
    }
    if (pendingRequests.size === 0) nextWorker.unref();
  });

  nextWorker.on('error', (err) => {
    failPendingRequests(err);
    if (worker === nextWorker) worker = null;
  });

  nextWorker.on('exit', (code) => {
    if (worker === nextWorker) worker = null;
    if (code !== 0) failPendingRequests(new Error(`Memory FTS worker exited with code ${code}`));
  });

  worker = nextWorker;
  return worker;
}

function failPendingRequests(error: Error): void {
  pendingRequests.forEach((request) => request.reject(error));
  pendingRequests.clear();
}

function memoryFtsWorkerUrl(): URL {
  if (import.meta.url.endsWith('/dist/cli/index.js')) {
    return new URL('../lib/memory/fts-worker.js', import.meta.url);
  }
  if (import.meta.url.endsWith('/dist/index.js') || /\/dist\/fts-db-[^/]+\.js$/.test(import.meta.url)) {
    return new URL('./lib/memory/fts-worker.js', import.meta.url);
  }
  if (import.meta.url.endsWith('/dist/dashboard/server.js') || /\/dist\/dashboard\/fts-db-[^/]+\.js$/.test(import.meta.url)) {
    return new URL('./memory-fts-worker.js', import.meta.url);
  }
  return import.meta.url.endsWith('.ts')
    ? new URL('./fts-worker.ts', import.meta.url)
    : new URL('./fts-worker.js', import.meta.url);
}
