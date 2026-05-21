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
import { getConversationByName } from '../../../lib/database/conversations-db.js';
import { getSetting, setSetting } from '../../../lib/database/app-settings.js';
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
  | 'searchSessionsSemantic'
  | 'scanConversations'
  | 'enrichSessions'
  | 'embedSessions'
  | 'getConversationByName'
  | 'getSetting'
  | 'setSetting';

type ProgressHandler = (progress: unknown) => void | Promise<void>;
type WorkerLane = 'read' | 'long' | 'semantic';

interface PendingJob {
  lane: WorkerLane;
  operation: DashboardDbOperation;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  progressListeners: Set<ProgressHandler>;
  progressChain: Promise<void>;
  timeout: NodeJS.Timeout | null;
}

interface SharedJob {
  lane: WorkerLane;
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
const SEMANTIC_SEARCH_TIMEOUT_MS = Number.parseInt(process.env['PANOPTICON_SEMANTIC_SEARCH_TIMEOUT_MS'] ?? '15000', 10);
const COALESCED_OPERATIONS = new Set<DashboardDbOperation>([
  'scanConversations',
  'enrichSessions',
  'embedSessions',
  'searchSessionsSemantic',
]);

const workers: Record<WorkerLane, Worker | null> = { read: null, long: null, semantic: null };
const pending = new Map<string, PendingJob>();
const sharedJobs = new Map<string, SharedJob>();
let latestSemanticJobId: string | null = null;

function workerScriptUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./dashboard-db-worker.ts', import.meta.url)
    : new URL('./dashboard-db-worker.js', import.meta.url);
}

function failPendingForLane(lane: WorkerLane, err: Error): void {
  for (const [id, job] of pending.entries()) {
    if (job.lane !== lane) continue;
    if (job.timeout) clearTimeout(job.timeout);
    job.reject(err);
    pending.delete(id);
  }
  for (const [key, job] of sharedJobs.entries()) {
    if (job.lane === lane) sharedJobs.delete(key);
  }
  if (lane === 'semantic') latestSemanticJobId = null;
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

function workerLane(operation: DashboardDbOperation): WorkerLane {
  if (operation === 'searchSessionsSemantic') return 'semantic';
  return COALESCED_OPERATIONS.has(operation) ? 'long' : 'read';
}

function cancelOlderSemanticSearches(): void {
  if (!latestSemanticJobId && !workers.semantic) return;
  failPendingForLane('semantic', new Error('Superseded by a newer semantic search'));
  void workers.semantic?.terminate();
  workers.semantic = null;
}

function aggregateDiscoveredSessionCostByPayload(payload: unknown) {
  if (typeof payload === 'string') {
    return aggregateDiscoveredSessionCostBy(payload as 'workspace' | 'model' | 'day' | 'month');
  }
  const input = payload as { groupBy?: 'workspace' | 'model' | 'day' | 'month'; filter?: ConversationFilter } | undefined;
  return aggregateDiscoveredSessionCostBy(input?.groupBy ?? 'workspace', input?.filter ?? {});
}

function getWorker(lane: WorkerLane): Worker {
  const existing = workers[lane];
  if (existing) return existing;

  const worker = new Worker(workerScriptUrl(), {
    execArgv: process.execArgv.filter((arg) => !arg.startsWith('--inspect')),
  } as ConstructorParameters<typeof Worker>[1]);
  workers[lane] = worker;

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
    if (job.timeout) clearTimeout(job.timeout);
    if (job.lane === 'semantic' && latestSemanticJobId === message.id) latestSemanticJobId = null;

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
    failPendingForLane(lane, err);
    if (workers[lane] === worker) workers[lane] = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0) failPendingForLane(lane, new Error(`Dashboard database ${lane} worker exited with code ${code}`));
    if (workers[lane] === worker) workers[lane] = null;
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
      return aggregateDiscoveredSessionCostByPayload(payload);
    case 'searchSessions':
    case 'searchSessionsSemantic':
      return searchSessions(payload as SearchQuery);
    case 'scanConversations':
      return scan({ ...(payload as ScanOptions), onProgress });
    case 'enrichSessions':
      return enrichSessions({ ...(payload as EnrichOptions), onProgress });
    case 'embedSessions':
      return embedSessions({ ...(payload as EmbedSessionsOptions), onProgress });
    case 'getConversationByName':
      return getConversationByName(payload as string);
    case 'getSetting':
      return getSetting(payload as string);
    case 'setSetting': {
      const input = payload as { key: string; value: string };
      setSetting(input.key, input.value);
      return null;
    }
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
  const lane = workerLane(operation);
  if (operation === 'searchSessionsSemantic') {
    cancelOlderSemanticSearches();
    latestSemanticJobId = id;
  }
  const progressListeners = new Set<ProgressHandler>();
  if (onProgress) progressListeners.add(onProgress);

  const promise = new Promise<T>((resolve, reject) => {
    const timeout = operation === 'searchSessionsSemantic'
      ? setTimeout(() => {
          const job = pending.get(id);
          if (!job) return;
          pending.delete(id);
          for (const [sharedKey, sharedJob] of sharedJobs.entries()) {
            if (sharedJob.promise === promise) sharedJobs.delete(sharedKey);
          }
          if (latestSemanticJobId === id) latestSemanticJobId = null;
          reject(new Error('Semantic search timed out'));
          void workers.semantic?.terminate();
          workers.semantic = null;
        }, Number.isFinite(SEMANTIC_SEARCH_TIMEOUT_MS) ? SEMANTIC_SEARCH_TIMEOUT_MS : 15000)
      : null;
    pending.set(id, {
      lane,
      operation,
      resolve: resolve as (value: unknown) => void,
      reject,
      progressListeners,
      progressChain: Promise.resolve(),
      timeout,
    });
    getWorker(lane).postMessage({ id, operation, payload });
  });

  if (key) {
    sharedJobs.set(key, { lane, promise, progressListeners });
    promise.then(
      () => sharedJobs.delete(key),
      () => sharedJobs.delete(key),
    );
  }

  return promise;
}
