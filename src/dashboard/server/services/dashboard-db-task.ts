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
import { scan } from '../../../lib/conversations/scanner.js';
import type { ScanOptions } from '../../../lib/conversations/scanner.js';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichOptions } from '../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import type { EmbedSessionsOptions } from '../../../lib/conversations/embeddings/index.js';

export type DashboardDbOperation =
  | 'getDiscoveredStats'
  | 'listDiscoveredSessions'
  | 'getDiscoveredSessionById'
  | 'aggregateDiscoveredSessionCost'
  | 'aggregateDiscoveredSessionCostBy'
  | 'searchSessions'
  | 'scanConversations'
  | 'enrichSessions'
  | 'embedSessions';

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: unknown) => void | Promise<void>;
  progressChain: Promise<void>;
}

interface WorkerResponse {
  id: string;
  ok?: boolean;
  result?: unknown;
  progress?: unknown;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
    estimatedCost?: number;
    threshold?: number;
    sessionCount?: number;
  };
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

    if (message.progress !== undefined) {
      if (job.onProgress) {
        job.progressChain = job.progressChain.then(() => Promise.resolve(job.onProgress?.(message.progress)));
      }
      return;
    }

    pending.delete(message.id);

    if (message.ok) {
      job.progressChain.then(() => job.resolve(message.result), job.reject);
      return;
    }

    const err = message.error?.name === 'CostThresholdError'
      ? new CostThresholdError(
        message.error.estimatedCost ?? 0,
        message.error.threshold ?? 0,
        message.error.sessionCount ?? 0,
      )
      : new Error(message.error?.message ?? 'Dashboard database worker failed');
    err.name = message.error?.name ?? 'DashboardDatabaseWorkerError';
    err.stack = message.error?.stack;
    job.progressChain.then(() => job.reject(err), job.reject);
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

async function runInline(
  operation: DashboardDbOperation,
  payload: unknown,
  onProgress?: (progress: unknown) => void | Promise<void>,
): Promise<unknown> {
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
    case 'scanConversations':
      return scan({ ...(payload as ScanOptions), onProgress });
    case 'enrichSessions':
      return enrichSessions({ ...(payload as EnrichOptions), onProgress });
    case 'embedSessions':
      return embedSessions(payload as EmbedSessionsOptions);
  }
}

export function runDashboardDbJob<T>(
  operation: DashboardDbOperation,
  payload?: unknown,
  onProgress?: (progress: unknown) => void | Promise<void>,
): Promise<T> {
  if (import.meta.url.endsWith('.ts') && process.env['VITEST']) {
    return runInline(operation, payload, onProgress) as Promise<T>;
  }

  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onProgress,
      progressChain: Promise.resolve(),
    });
    getWorker().postMessage({ id, operation, payload });
  });
}
