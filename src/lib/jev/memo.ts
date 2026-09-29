/**
 * In-process memo for Jev judgment calls (PAN-4369): an LRU of answered results, an in-flight
 * dedupe map, and a concurrency cap. Modeled on the pane-detection cache in
 * `src/lib/agent-input-detection.ts`.
 *
 * - The key is content-addressed (feature, model, question-set version, and a sha256 of state +
 *   questions), so entries never go stale and there is no TTL. Only `answered` results are stored
 *   by the caller; a transient failure must not stick.
 * - A shared in-flight request runs with the first caller's `signal`. A later identical caller
 *   that joins it inherits its outcome, including `aborted`.
 * - At most JEV_MAX_CONCURRENT_REQUESTS bodies run at once; extra callers wait FIFO, and a freed
 *   slot is handed directly to the next waiter so a new arrival cannot jump the queue.
 *
 * Nothing here is persisted; a restart starts cold.
 */
import { createHash } from 'node:crypto';

export const JEV_MEMO_MAX_ENTRIES = 256;
export const JEV_MAX_CONCURRENT_REQUESTS = 4;

const memo = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();
const slotWaiters: Array<() => void> = [];
let activeRequests = 0;

export function jevMemoKey(parts: {
  featureKey: string;
  model: string;
  questionSetVersion: number;
  state: unknown;
  questions: unknown;
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ state: parts.state, questions: parts.questions }))
    .digest('hex');
  return `${parts.featureKey}:${parts.model}:${parts.questionSetVersion}:${digest}`;
}

/** Returns the cached value and marks it most recently used. */
export function getMemoized<T>(key: string): T | undefined {
  if (!memo.has(key)) return undefined;
  const value = memo.get(key) as T;
  memo.delete(key);
  memo.set(key, value);
  return value;
}

/** Stores a value, evicting the least recently used entries past JEV_MEMO_MAX_ENTRIES. */
export function setMemoized<T>(key: string, value: T): void {
  memo.delete(key);
  memo.set(key, value);
  while (memo.size > JEV_MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

/** Runs `run` once per key at a time; concurrent callers with the same key share its promise. */
export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = (async () => {
    try {
      return await run();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/** Runs `run` once one of the JEV_MAX_CONCURRENT_REQUESTS slots is free. */
export async function withJevSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeRequests >= JEV_MAX_CONCURRENT_REQUESTS) {
    // The releasing body hands its slot over without decrementing activeRequests.
    await new Promise<void>((resolve) => slotWaiters.push(resolve));
  } else {
    activeRequests += 1;
  }
  try {
    return await run();
  } finally {
    const next = slotWaiters.shift();
    if (next) next();
    else activeRequests = Math.max(0, activeRequests - 1);
  }
}

/** Clears the memo, the in-flight map and the slot state. For tests. */
export function resetJevMemo(): void {
  memo.clear();
  inFlight.clear();
  slotWaiters.length = 0;
  activeRequests = 0;
}
