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

type ProgressHandler = (progress: unknown) => void | Promise<void>;

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  progressListeners: Set<ProgressHandler>;
  progressChain: Promise<void>;
}

interface SharedJob {
  promise: Promise<unknown>;
  progressListeners: Set<ProgressHandler>;
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

const MAX_PENDING_JOBS = 32;
const COALESCED_OPERATIONS = new Set<DashboardDbOperation>([
  'scanConversations',
  'enrichSessions',
  'embedSessions',
]);

let worker: Worker | null = null;
const pending = new Map<string, PendingJob>();
const sharedJobs = new Map<string, SharedJob>();

function workerScriptUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./dashboard-db-worker.ts', import.meta.url)
    : new URL('./dashboard-db-worker.js', import.meta.url);
}

function failPending(err: Error): void {
  for (const job of pending.values()) job.reject(err);
  pending.clear();
  sharedJobs.clear();
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== 'function' && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function coalescingKey(operation: DashboardDbOperation, payload: unknown): string | null {
  if (!COALESCED_OPERATIONS.has(operation)) return null;
  return `${operation}:${stableStringify(payload)}`;
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
      job.progressChain = job.progressChain.then(async () => {
        for (const listener of job.progressListeners) {
          await listener(message.progress);
        }
      });
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

  const key = coalescingKey(operation, payload);
  const existing = key ? sharedJobs.get(key) : undefined;
  if (existing) {
    if (onProgress) existing.progressListeners.add(onProgress);
    return existing.promise as Promise<T>;
  }

  if (pending.size >= MAX_PENDING_JOBS) {
    return Promise.reject(new Error('Dashboard database worker queue is full'));
  }

  const id = randomUUID();
  const progressListeners = new Set<ProgressHandler>();
  if (onProgress) progressListeners.add(onProgress);

  const promise = new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      progressListeners,
      progressChain: Promise.resolve(),
    });
    getWorker().postMessage({ id, operation, payload });
  });

  if (key) {
    sharedJobs.set(key, { promise, progressListeners });
    promise.then(
      () => sharedJobs.delete(key),
      () => sharedJobs.delete(key),
    );
  }

  return promise;
}
