import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  aggregateDiscoveredSessionCost,
  aggregateDiscoveredSessionCostBy,
  countDiscoveredSessions,
  findDiscoveredSessions,
  getDiscoveredSessionById,
  getDiscoveredStats,
} from '../../../lib/database/discovered-sessions-db.js';
import type { ConversationFilter } from '../../../lib/database/discovered-sessions-db.js';
import { searchSessions } from '../../../lib/conversations/search.js';
import type { SearchQuery } from '../../../lib/conversations/search.js';

export type DashboardDbOperation =
  | 'getDiscoveredStats'
  | 'listDiscoveredSessions'
  | 'getDiscoveredSessionById'
  | 'aggregateDiscoveredSessionCost'
  | 'aggregateDiscoveredSessionCostBy'
  | 'searchSessions';

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface WorkerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { name?: string; message?: string; stack?: string };
}

let worker: Worker | null = null;
const pending = new Map<string, PendingJob>();

function workerScriptUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./dashboard-db-worker.ts', import.meta.url)
    : new URL('./dashboard-db-worker.js', import.meta.url);
}

function failPending(err: Error): void {
  for (const job of pending.values()) job.reject(err);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(workerScriptUrl(), {
    type: 'module',
    execArgv: process.execArgv.filter((arg) => !arg.startsWith('--inspect')),
  });

  worker.on('message', (message: WorkerResponse) => {
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);

    if (message.ok) {
      job.resolve(message.result);
      return;
    }

    const err = new Error(message.error?.message ?? 'Dashboard database worker failed');
    err.name = message.error?.name ?? 'DashboardDatabaseWorkerError';
    err.stack = message.error?.stack;
    job.reject(err);
  });

  worker.on('error', (err) => {
    failPending(err);
    worker = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0) failPending(new Error(`Dashboard database worker exited with code ${code}`));
    worker = null;
  });

  return worker;
}

async function runInline(operation: DashboardDbOperation, payload: unknown): Promise<unknown> {
  switch (operation) {
    case 'getDiscoveredStats':
      return getDiscoveredStats();
    case 'listDiscoveredSessions': {
      const filter = payload as ConversationFilter;
      return {
        sessions: findDiscoveredSessions(filter),
        total: countDiscoveredSessions({ ...filter, limit: undefined, offset: undefined }),
      };
    }
    case 'getDiscoveredSessionById':
      return getDiscoveredSessionById(payload as number);
    case 'aggregateDiscoveredSessionCost':
      return aggregateDiscoveredSessionCost(payload as ConversationFilter);
    case 'aggregateDiscoveredSessionCostBy':
      return aggregateDiscoveredSessionCostBy(payload as 'workspace' | 'model' | 'day' | 'tier');
    case 'searchSessions':
      return searchSessions(payload as SearchQuery);
  }
}

export function runDashboardDbJob<T>(operation: DashboardDbOperation, payload?: unknown): Promise<T> {
  if (import.meta.url.endsWith('.ts') && process.env['VITEST']) {
    return runInline(operation, payload) as Promise<T>;
  }

  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getWorker().postMessage({ id, operation, payload });
  });
}
