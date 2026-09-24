import { Worker } from 'node:worker_threads';
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

  const scriptPath = import.meta.url.endsWith('.ts')
    ? new URL('./checkpoint-worker.ts', import.meta.url)
    : new URL('./checkpoint-worker.js', import.meta.url);

  const newWorker = new Worker(scriptPath, {
    type: 'module',
    execArgv: process.execArgv.filter((arg) => !arg.startsWith('--inspect')),
  } as ConstructorParameters<typeof Worker>[1]);

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

function postWorkerRequest<T>(operation: string, payload: unknown): Promise<T> {
  if (import.meta.url.endsWith('.ts') && process.env['VITEST']) {
    return runInline(operation, payload) as Promise<T>;
  }

  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getCheckpointWorker().postMessage({ id, operation, payload });
  });
}

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
