import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
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
import { listSubstrateBugWeights } from '../../../lib/overdeck/substrate-bug-weights-service.js';
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
  | 'listSubstrateBugWeights'
  | 'getArtifactBySlug'
  | 'listArtifactsForWorkspaceOrIssue'
  | 'unshareArtifactBySlug'
  | 'parseTranscriptSnapshot'
  | 'costReconcileSweep';

type ProgressHandler = (progress: unknown) => void | Promise<void>;
export type WorkerLane = 'read' | 'long' | 'semantic' | 'parse';

type TranscriptParserName = 'pi' | 'ohmypi' | 'codex' | 'acp' | 'kimi' | 'claude-initial';
type TranscriptParser = (sessionFile: string) => Promise<ParseResult>;

const transcriptParsers: Record<TranscriptParserName, TranscriptParser> = {
  pi: parsePiConversationMessages,
  ohmypi: parseOhmypiConversationMessages,
  codex: parseCodexConversationMessages,
  acp: parseAcpConversationMessages,
  kimi: parseKimiConversationMessages,
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
  'scanConversations',
  'enrichSessions',
  'embedSessions',
  'searchSessionsSemantic',
  'listSubstrateBugWeights',
  'parseTranscriptSnapshot',
]);

const workers: Record<WorkerLane, Worker | null> = { read: null, long: null, semantic: null, parse: null };
const pending = new Map<string, PendingJob>();
const sharedJobs = new Map<string, SharedJob>();
let latestSemanticJobId: string | null = null;

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

export function workerLane(operation: DashboardDbOperation): WorkerLane {
  if (operation === 'searchSessionsSemantic') return 'semantic';
  if (operation === 'parseTranscriptSnapshot') return 'parse';
  if (operation === 'costReconcileSweep') return 'long';
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
    case 'listSubstrateBugWeights': {
      const input = payload as { window: string; limit: number; offset: number };
      return listSubstrateBugWeights(input.window, { limit: input.limit, offset: input.offset });
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

export function runDashboardDbJob<T>(
  operation: DashboardDbOperation,
  payload?: unknown,
  onProgress?: (progress: unknown) => void | Promise<void>,
): Promise<T> {
  const key = coalescingKey(operation, payload);
  const existing = key ? sharedJobs.get(key) : undefined;
  if (existing) {
    if (onProgress) existing.progressListeners.add(onProgress);
    return existing.promise as Promise<T>;
  }

  if (import.meta.url.endsWith('.ts') && process.env['VITEST']) {
    const progressListeners = new Set<ProgressHandler>();
    if (onProgress) progressListeners.add(onProgress);
    const promise = runInline(operation, payload, onProgress) as Promise<T>;
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
    pending.set(id, {
      lane,
      operation,
      resolve: resolve as (value: unknown) => void,
      reject,
      progressListeners,
      progressChain: Promise.resolve(),
      timeout,
      enqueuedAt: Date.now(),
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
