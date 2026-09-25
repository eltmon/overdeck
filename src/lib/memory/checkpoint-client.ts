import type { Worker } from 'node:worker_threads';
import { spawnModuleWorker } from '../module-worker.js';
import type {
  ClaimTranscriptRangeInput,
  ClaimTranscriptRangeResult,
  CommitTranscriptRangeInput,
  CommitTranscriptRangeResult,
  TranscriptCheckpoint,
} from './checkpoints.js';

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function getCheckpointWorker(): Worker {
  if (worker) return worker;

  const newWorker = spawnModuleWorker(checkpointWorkerUrl());

  newWorker.on('message', (message: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const request = pendingRequests.get(message.id);
    if (!request) return;
    pendingRequests.delete(message.id);
    if (message.ok) {
      request.resolve(message.result);
    } else {
      request.reject(new Error(message.error ?? 'Checkpoint worker failed'));
    }
  });

  newWorker.on('error', (err) => {
    for (const req of pendingRequests.values()) req.reject(err);
    pendingRequests.clear();
    if (worker === newWorker) worker = null;
  });

  newWorker.on('exit', (code) => {
    if (worker === newWorker) worker = null;
    if (code !== 0) {
      for (const req of pendingRequests.values()) req.reject(new Error(`Checkpoint worker exited with code ${code}`));
      pendingRequests.clear();
    }
  });

  worker = newWorker;
  return worker;
}

// Built workers are sibling entries of their bundle: `dist/dashboard/checkpoint-worker.js`
// (src/dashboard/server/tsdown.config.ts) and `dist/lib/memory/checkpoint-worker.js`
// (tsdown.config.ts, for the CLI's `pan memory backfill`). Resolve from the dist root so
// the worker is found wherever the bundler puts the chunk that contains this module.
// Same pattern as `memoryFtsWorkerUrl` (fts-db.ts).
function checkpointWorkerUrl(moduleUrl = import.meta.url): URL {
  if (moduleUrl.endsWith('.ts')) return new URL('./checkpoint-worker.ts', moduleUrl);

  const distMarker = '/dist/';
  const distIndex = moduleUrl.lastIndexOf(distMarker);
  if (distIndex !== -1) {
    const distRoot = moduleUrl.slice(0, distIndex + distMarker.length);
    const workerPath = moduleUrl.startsWith(`${distRoot}dashboard/`)
      ? 'dashboard/checkpoint-worker.js'
      : 'lib/memory/checkpoint-worker.js';
    return new URL(workerPath, distRoot);
  }

  return new URL('./checkpoint-worker.js', moduleUrl);
}

async function runInline(operation: string, payload: unknown): Promise<unknown> {
  const {
    claimTranscriptRange,
    commitTranscriptRange,
    releaseTranscriptRange,
    getTranscriptCheckpoint,
    listTranscriptCheckpoints,
  } = await import('./checkpoints.js');

  switch (operation) {
    case 'claimTranscriptRange':
      return claimTranscriptRange(payload as ClaimTranscriptRangeInput);
    case 'commitTranscriptRange':
      return commitTranscriptRange(payload as CommitTranscriptRangeInput);
    case 'releaseTranscriptRange': {
      const p = payload as { sessionId: string; expectedFromOffset: number; toOffset: number };
      releaseTranscriptRange(p.sessionId, p.expectedFromOffset, p.toOffset);
      return undefined;
    }
    case 'getTranscriptCheckpoint':
      return getTranscriptCheckpoint(payload as string);
    case 'listTranscriptCheckpoints':
      return listTranscriptCheckpoints(payload as number | undefined);
  }
}

function requestViaWorker<T>(operation: string, payload: unknown): Promise<T> {
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getCheckpointWorker().postMessage({ id, operation, payload });
  });
}

function postWorkerRequest<T>(operation: string, payload: unknown): Promise<T> {
  if (import.meta.url.endsWith('.ts') && process.env['VITEST']) {
    return runInline(operation, payload) as Promise<T>;
  }
  return requestViaWorker<T>(operation, payload);
}

// The worker is never unref()'d, so a test that boots the real one must terminate it.
async function terminateWorker(): Promise<void> {
  const current = worker;
  worker = null;
  if (current) await current.terminate();
}

export const __testInternals = { checkpointWorkerUrl, requestViaWorker, terminateWorker };

const toError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause));

/** Run one checkpoint-worker request; a rejection is always an `Error`. */
function request<T>(operation: string, payload: unknown): Promise<T> {
  return postWorkerRequest<T>(operation, payload).catch((cause: unknown) => {
    throw toError(cause);
  });
}

/** Claim a transcript byte range for memory extraction (checkpoint worker). */
export function claimTranscriptRange(input: ClaimTranscriptRangeInput): Promise<ClaimTranscriptRangeResult> {
  return request('claimTranscriptRange', input);
}

/** Commit a previously claimed transcript range (checkpoint worker). */
export function commitTranscriptRange(input: CommitTranscriptRangeInput): Promise<CommitTranscriptRangeResult> {
  return request('commitTranscriptRange', input);
}

/** Release a claimed transcript range without committing it (checkpoint worker). */
export function releaseTranscriptRange(sessionId: string, expectedFromOffset: number, toOffset: number): Promise<void> {
  return request('releaseTranscriptRange', { sessionId, expectedFromOffset, toOffset });
}

/** Read the transcript checkpoint for a session, or null (checkpoint worker). */
export function getTranscriptCheckpoint(sessionId: string): Promise<TranscriptCheckpoint | null> {
  return request('getTranscriptCheckpoint', sessionId);
}

/** List transcript checkpoints, up to `limit` (checkpoint worker). */
export function listTranscriptCheckpoints(limit?: number): Promise<TranscriptCheckpoint[]> {
  return request('listTranscriptCheckpoints', limit);
}
