import { parseMuseConversationMessages } from './muse-conversation-parser.js';
import { parsePrimeAgentConversationMessages } from './prime-agent-conversation-parser.js';
import { randomUUID } from 'node:crypto';
import type { Worker } from 'node:worker_threads';
import { spawnModuleWorker } from '../../../lib/module-worker.js';
import {
  aggregateDiscoveredSessionCost,
  aggregateDiscoveredSessionCostBy,
  countDiscoveredSessions,
  findDiscoveredSessions,
  getDiscoveredSessionById,
  getDiscoveredStats,
} from '../../../lib/overdeck/discovered-sessions.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { getSetting, setSetting } from '../../../lib/overdeck/control-settings.js';
import type { ConversationFilter } from '../../../lib/overdeck/discovered-sessions.js';
import { getSessionsFeedFacets, listSessionsFeed } from '../../../lib/overdeck/sessions-feed.js';
import type { SessionsFeedFilter } from '../../../lib/overdeck/sessions-feed.js';
import { searchSessions } from '../../../lib/conversations/search.js';
import type { SearchQuery } from '../../../lib/conversations/search.js';
import { scan } from '../../../lib/conversations/scanner.js';
import type { ScanOptions } from '../../../lib/conversations/scanner.js';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichOptions } from '../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import type { EmbedSessionsOptions } from '../../../lib/conversations/embeddings/index.js';
import { collectCodexCostEvents } from '../../../lib/overdeck/cost.js';
import { collectPiCostEvents } from '../../../lib/costs/reconciler.js';
import { parseAcpConversationMessages } from './acp-conversation-parser.js';
import { parseCodexConversationMessages } from './codex-conversation-parser.js';
import { parseKimiConversationMessages } from './kimi-conversation-parser.js';
import { parseOhmypiConversationMessages } from './ohmypi-conversation-parser.js';
import { parsePiConversationMessages } from './pi-conversation-parser.js';
import { parseEntireConversation } from './conversation-service.js';
import type { ParseResult } from './conversation-service.js';

export type DashboardDbOperation =
  | 'getAgentCostStats'
  | 'getCostsByIssueSnapshot'
  | 'getConversationSearchStats'
  | 'getConversationLedgerCosts'
  | 'getDiscoveredStats'
  | 'listDiscoveredSessions'
  | 'listSessionsFeed'
  | 'getSessionsFeedFacets'
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
  | 'setSetting'
  | 'getArtifactBySlug'
  | 'listArtifactsForWorkspaceOrIssue'
  | 'unshareArtifactBySlug'
  | 'parseTranscriptSnapshot'
  | 'costReconcileSweep'
  | 'searchConversationBm25'
  | 'searchConversationVector'
  | 'filterLiveConversationSessions';

type ProgressHandler = (progress: unknown) => void | Promise<void>;
export type WorkerLane = 'read' | 'long' | 'semantic' | 'parse' | 'poll' | 'conversation-text' | 'conversation-vector';

type TranscriptParserName = 'pi' | 'ohmypi' | 'codex' | 'acp' | 'kimi' | 'muse' | 'prime-agent' | 'claude-initial';
type TranscriptParser = (sessionFile: string) => Promise<ParseResult>;

const transcriptParsers: Record<TranscriptParserName, TranscriptParser> = {
  pi: parsePiConversationMessages,
  ohmypi: parseOhmypiConversationMessages,
  codex: parseCodexConversationMessages,
  acp: parseAcpConversationMessages,
  kimi: parseKimiConversationMessages,
  muse: parseMuseConversationMessages,
  'prime-agent': parsePrimeAgentConversationMessages,
  'claude-initial': sessionFile => parseEntireConversation(sessionFile, { flushPendingToolUse: false }),
};

interface PendingJob {
  lane: WorkerLane;
  operation: DashboardDbOperation;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  progressListeners: Set<ProgressHandler>;
  progressChain: Promise<void>;
  timeout: NodeJS.Timeout | null;
  enqueuedAt: number;
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
  progressSeq?: number;
  startedAt?: number;
  finishedAt?: number;
  bytes?: number;
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
const SEMANTIC_SEARCH_TIMEOUT_MS = Number.parseInt(process.env['OVERDECK_SEMANTIC_SEARCH_TIMEOUT_MS'] ?? '15000', 10);
const COALESCED_OPERATIONS = new Set<DashboardDbOperation>([
  'getAgentCostStats',
  'getCostsByIssueSnapshot',
  'getConversationSearchStats',
  'getConversationLedgerCosts',
  'scanConversations',
  'enrichSessions',
  'embedSessions',
  'searchSessionsSemantic',
  'parseTranscriptSnapshot',
]);

const workers: Record<WorkerLane, Worker | null> = {
  read: null,
  long: null,
  semantic: null,
  parse: null,
  poll: null,
  'conversation-text': null,
  'conversation-vector': null,
};
const pending = new Map<string, PendingJob>();
const sharedJobs = new Map<string, SharedJob>();
let latestSemanticJobId: string | null = null;

/**
 * PAN-5447 serial lanes. The worker starts a synchronous job inside its
 * `message` handler, so nothing posted later can cancel a job it already
 * holds. For these lanes the main thread posts one job at a time and keeps the
 * rest in a FIFO, so an aborted waiter is dropped before the worker sees it.
 * The in-flight job always runs to completion; its result is discarded if its
 * caller aborted. The worker is never terminated to cancel (node:sqlite cannot
 * interrupt a running query, and a replacement would reopen the DB).
 */
const SERIAL_LANES: ReadonlySet<WorkerLane> = new Set<WorkerLane>(['conversation-text', 'conversation-vector']);
/** lane → id of the job posted to that lane's worker and not yet answered. */
const laneInFlight = new Map<WorkerLane, string>();
const laneWaiters = new Map<WorkerLane, Array<{ id: string; post: () => void }>>();
let forceWorkerPath = false;

export function formatSlowJobLine(input: {
  op: DashboardDbOperation;
  lane: WorkerLane;
  waitMs: number;
  runMs: number;
  depth: number;
  bytes?: number;
}): string | null {
  if (input.waitMs <= 1_000 && input.runMs <= 1_000) return null;
  const bytes = input.bytes === undefined ? '' : ` bytes=${input.bytes}`;
  return `[db-jobs] slow: op=${input.op} lane=${input.lane} waitMs=${input.waitMs} runMs=${input.runMs} depth=${input.depth}${bytes}`;
}

// The dashboard runs from dist only: the server bundle and `dashboard-db-worker.js`
// are sibling entries of `dist/dashboard/` (src/dashboard/server/tsdown.config.ts).
// Resolve from the dist root so the worker is found wherever the bundler puts the
// chunk that contains this module. Same pattern as `memoryFtsWorkerUrl` (fts-db.ts).
function workerScriptUrl(moduleUrl = import.meta.url): URL {
  if (moduleUrl.endsWith('.ts')) return new URL('./dashboard-db-worker.ts', moduleUrl);

  const distMarker = '/dist/';
  const distIndex = moduleUrl.lastIndexOf(distMarker);
  if (distIndex !== -1) {
    return new URL('dashboard/dashboard-db-worker.js', moduleUrl.slice(0, distIndex + distMarker.length));
  }

  return new URL('./dashboard-db-worker.js', moduleUrl);
}

// Workers are never unref()'d, so a test that boots a real one must terminate it.
async function terminateWorkers(): Promise<void> {
  for (const lane of Object.keys(workers) as WorkerLane[]) {
    const worker = workers[lane];
    workers[lane] = null;
    laneInFlight.delete(lane);
    laneWaiters.delete(lane);
    if (worker) await worker.terminate();
  }
}

export const __testInternals = {
  workerScriptUrl,
  terminateWorkers,
  /** Skip the Vitest inline branch so a test can drive the worker path against a mocked worker. */
  forceWorkerPath(enabled: boolean): void {
    forceWorkerPath = enabled;
  },
};

function postNextWaiter(lane: WorkerLane): void {
  const waiters = laneWaiters.get(lane);
  while (waiters && waiters.length > 0) {
    const next = waiters.shift()!;
    if (pending.has(next.id)) {
      next.post();
      return;
    }
  }
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
  laneInFlight.delete(lane);
  laneWaiters.delete(lane);
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

export function workerLane(operation: DashboardDbOperation): WorkerLane {
  if (isPollingSnapshot(operation)) return 'poll';
  if (operation === 'searchSessionsSemantic') return 'semantic';
  if (operation === 'parseTranscriptSnapshot') return 'parse';
  if (operation === 'costReconcileSweep') return 'long';
  // PAN-5447: palette chunk search. The vector scan cannot be stopped once
  // started, so it gets its own lane and never delays the next query's BM25.
  if (operation === 'searchConversationVector') return 'conversation-vector';
  if (operation === 'searchConversationBm25' || operation === 'filterLiveConversationSessions') return 'conversation-text';
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

  const worker = spawnModuleWorker(workerScriptUrl());
  workers[lane] = worker;

  worker.on('message', (message: WorkerResponse) => {
    // A serial lane frees up when the worker answers, even for a job whose
    // caller aborted (and is therefore no longer pending).
    if (message.progress === undefined && laneInFlight.get(lane) === message.id) {
      laneInFlight.delete(lane);
      postNextWaiter(lane);
    }
    const job = pending.get(message.id);
    if (!job) return;

    if (message.progress !== undefined) {
      job.progressChain = job.progressChain.then(async () => {
        for (const listener of job.progressListeners) {
          await listener(message.progress);
        }
      }).finally(() => {
        worker.postMessage({ id: message.id, ack: message.progressSeq });
      });
      return;
    }

    pending.delete(message.id);
    if (job.timeout) clearTimeout(job.timeout);
    if (job.lane === 'semantic' && latestSemanticJobId === message.id) latestSemanticJobId = null;
    if (message.startedAt !== undefined && message.finishedAt !== undefined) {
      const line = formatSlowJobLine({
        op: job.operation,
        lane: job.lane,
        waitMs: message.startedAt - job.enqueuedAt,
        runMs: message.finishedAt - message.startedAt,
        depth: [...pending.values()].filter(pendingJob => pendingJob.lane === job.lane).length,
        bytes: message.bytes,
      });
      if (line) console.warn(line);
    }

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

async function executeInline(
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
    case 'listSessionsFeed':
      return listSessionsFeed(payload as SessionsFeedFilter);
    case 'getSessionsFeedFacets':
      return getSessionsFeedFacets(payload as SessionsFeedFilter);
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
      return embedSessions({ ...(payload as EmbedSessionsOptions), autoInstall: true, onProgress });
    case 'getConversationByName':
      return getConversationByName(payload as string);
    case 'parseTranscriptSnapshot': {
      const input = payload as { sessionFile: string; parser: string };
      const parser = transcriptParsers[input.parser as TranscriptParserName];
      if (!parser) throw new Error(`Unknown transcript parser: ${input.parser}`);
      return parser(input.sessionFile);
    }
    case 'getSetting':
      return getSetting(payload as string);
    case 'setSetting': {
      const input = payload as { key: string; value: string };
      setSetting(input.key, input.value);
      return null;
    }
    case 'getArtifactBySlug': {
      const { getArtifactBySlugJob } = await import('./artifact-index-jobs.js');
      return getArtifactBySlugJob(payload as string);
    }
    case 'listArtifactsForWorkspaceOrIssue': {
      const { listArtifactsForWorkspaceOrIssueJob } = await import('./artifact-index-jobs.js');
      return listArtifactsForWorkspaceOrIssueJob(payload as string);
    }
    case 'unshareArtifactBySlug': {
      const { unshareArtifactBySlugJob } = await import('./artifact-index-jobs.js');
      return unshareArtifactBySlugJob(payload as string);
    }
    case 'costReconcileSweep':
      return (payload as { source: 'codex' | 'pi' }).source === 'pi'
        ? collectPiCostEvents({ ...(payload as { maxEvents?: number }), onBatch: async batch => onProgress?.(batch) })
        : collectCodexCostEvents({ ...(payload as { maxEvents?: number }), onBatch: async batch => onProgress?.(batch) });
    case 'searchConversationBm25': {
      const { searchConversationBm25Job } = await import('../../../lib/conversation-search/chunk-search-jobs.js');
      return searchConversationBm25Job(payload as Parameters<typeof searchConversationBm25Job>[0]);
    }
    case 'searchConversationVector': {
      const { searchConversationVectorJob } = await import('../../../lib/conversation-search/chunk-search-jobs.js');
      return searchConversationVectorJob(payload as Parameters<typeof searchConversationVectorJob>[0]);
    }
    case 'filterLiveConversationSessions': {
      const { filterLiveConversationSessionsJob } = await import('../../../lib/conversation-search/chunk-search-jobs.js');
      return filterLiveConversationSessionsJob(payload as Parameters<typeof filterLiveConversationSessionsJob>[0]);
    }
  }
}

async function runInline(
  operation: DashboardDbOperation,
  payload: unknown,
  onProgress?: (progress: unknown) => void | Promise<void>,
): Promise<unknown> {
  const startedAt = Date.now();
  let bytes: number | undefined;
  try {
    const result = await executeInline(operation, payload, onProgress);
    if (operation === 'parseTranscriptSnapshot') bytes = (result as ParseResult).byteOffset;
    return result;
  } finally {
    const line = formatSlowJobLine({
      op: operation, lane: workerLane(operation), waitMs: 0,
      runMs: Date.now() - startedAt, depth: 0,
      bytes,
    });
    if (line) console.warn(line);
  }
}

function isPollingSnapshot(operation: DashboardDbOperation): boolean {
  return operation === 'getAgentCostStats' || operation === 'getCostsByIssueSnapshot' || operation === 'getConversationSearchStats'
    || operation === 'getConversationLedgerCosts';
}

/** Settle with `inner`, or reject with `signal.reason` as soon as `signal` aborts. */
function rejectOnAbort<T>(inner: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    inner.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Run `operation` on its worker lane. `options.signal` aborts the caller's
 * wait: the promise rejects with `signal.reason`, a job still waiting in a
 * serial lane's FIFO is never posted, and a job already running finishes on
 * the worker with its result discarded.
 */
export function runDashboardDbJob<T>(
  operation: DashboardDbOperation,
  payload?: unknown,
  onProgress?: (progress: unknown) => void | Promise<void>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);

  const key = coalescingKey(operation, payload);
  const existing = key ? sharedJobs.get(key) : undefined;
  if (existing) {
    if (onProgress) existing.progressListeners.add(onProgress);
    return existing.promise as Promise<T>;
  }

  if (!forceWorkerPath && import.meta.url.endsWith('.ts') && process.env['VITEST'] && !isPollingSnapshot(operation)) {
    const progressListeners = new Set<ProgressHandler>();
    if (onProgress) progressListeners.add(onProgress);
    const inline = runInline(operation, payload, onProgress) as Promise<T>;
    const promise = signal ? rejectOnAbort(inline, signal) : inline;
    if (key) {
      sharedJobs.set(key, { lane: workerLane(operation), promise, progressListeners });
      promise.then(
        () => sharedJobs.delete(key),
        () => sharedJobs.delete(key),
      );
    }
    return promise;
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
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      if (timeout) clearTimeout(timeout);
      const waiters = laneWaiters.get(lane);
      const waiterIndex = waiters?.findIndex(waiter => waiter.id === id) ?? -1;
      if (waiters && waiterIndex >= 0) waiters.splice(waiterIndex, 1);
      for (const [sharedKey, sharedJob] of sharedJobs.entries()) {
        if (sharedJob.promise === promise) sharedJobs.delete(sharedKey);
      }
      // laneInFlight stays set: the lane is busy until the worker answers.
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const stopListening = () => signal?.removeEventListener('abort', onAbort);
    pending.set(id, {
      lane,
      operation,
      resolve: (value: unknown) => {
        stopListening();
        resolve(value as T);
      },
      reject: (err: Error) => {
        stopListening();
        reject(err);
      },
      progressListeners,
      progressChain: Promise.resolve(),
      timeout,
      enqueuedAt: Date.now(),
    });
    const post = () => {
      if (SERIAL_LANES.has(lane)) laneInFlight.set(lane, id);
      getWorker(lane).postMessage({ id, operation, payload });
    };
    if (SERIAL_LANES.has(lane) && laneInFlight.has(lane)) {
      const waiters = laneWaiters.get(lane) ?? [];
      waiters.push({ id, post });
      laneWaiters.set(lane, waiters);
    } else {
      post();
    }
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
