// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/shared/file-watch/filesystem-watch-batch-window.ts @ c6b9ac9549b
// upstream: src/main/ipc/filesystem/watchers/filesystem-watcher-local-events.ts @ c6b9ac9549b
/**
 * Watch event batching (PAN-5183, FR-3). Pure: no I/O. The flush window
 * (`watchBatchFlushDelayMs`) and `coalesceEvents` are ported unchanged in
 * logic; `createWatchBatcher` is Overdeck's buffer and timer around them,
 * modeled on Orca's `scheduleLocalBatchFlush`. Paths are root-relative, so
 * Orca's path normalization step is not needed here.
 */
import type { ExplorerWatchEvent } from '@overdeck/contracts';

// Share local/runtime flush timing to prevent latency drift.

// Trailing debounce stalls under continuous agent writes; use a leading coalescing tick then fixed cadence.
// 75 ms joins the native watcher’s first event and ~50 ms tail so atomic saves remain one batch.
export const WATCH_BATCH_LEADING_MS = 75;
export const WATCH_BATCH_INTERVAL_MS = 100;

/** Delay before flushing a batch armed at `now`; `lastFlushAt` is 0 before the first flush. */
export function watchBatchFlushDelayMs(
  now: number,
  lastFlushAt: number,
  leadingMs: number = WATCH_BATCH_LEADING_MS,
  intervalMs: number = WATCH_BATCH_INTERVAL_MS,
): number {
  // Why cap at intervalMs: a backwards wall-clock jump must not stall delivery.
  return Math.min(intervalMs, Math.max(leadingMs, lastFlushAt + intervalMs - now));
}

/** One native watcher event with a root-relative path. */
export interface RawWatchEvent {
  type: 'create' | 'update' | 'delete';
  path: string;
}

// delete→create retains both for subtree/parent refresh; create→delete cancels within the window.
export function coalesceEvents(raw: readonly RawWatchEvent[]): RawWatchEvent[] {
  const lastByPath = new Map<string, { type: RawWatchEvent['type']; index: number }>();
  const deleteBeforeCreate = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const evt = raw[i]!;
    const p = evt.path;
    const prev = lastByPath.get(p);

    if (prev) {
      if (prev.type === 'delete' && evt.type === 'create') {
        deleteBeforeCreate.add(p);
      }
      if (prev.type === 'create' && evt.type === 'delete') {
        lastByPath.delete(p);
        deleteBeforeCreate.delete(p);
        continue;
      }
    }

    lastByPath.set(p, { type: evt.type, index: i });

    // Later events can supersede delete→create; do not retain its stale delete.
    if (evt.type !== 'create' && deleteBeforeCreate.has(p)) {
      deleteBeforeCreate.delete(p);
    }
  }

  const result: RawWatchEvent[] = [];

  for (const p of deleteBeforeCreate) {
    result.push({ type: 'delete', path: p });
  }

  for (const [p, entry] of lastByPath) {
    result.push({ type: entry.type, path: p });
  }

  return result;
}

/** Past this many buffered events in one window, the batch flushes a single overflow. */
export const MAX_BUFFERED_WATCH_EVENTS = 5000;

export interface WatchBatcherDeps {
  flush(events: ExplorerWatchEvent[]): void;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface WatchBatcher {
  push(events: readonly RawWatchEvent[]): void;
  dispose(): void;
}

export function createWatchBatcher(deps: WatchBatcherDeps): WatchBatcher {
  const now = deps.now ?? Date.now;
  const arm = deps.setTimeout ?? setTimeout;
  const disarm = deps.clearTimeout ?? clearTimeout;

  let buffer: RawWatchEvent[] = [];
  let overflowed = false;
  let lastFlushAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fire = () => {
    timer = null;
    lastFlushAt = now();
    const events = buffer;
    const wasOverflowed = overflowed;
    buffer = [];
    overflowed = false;
    if (wasOverflowed) {
      deps.flush([{ kind: 'overflow', path: '' }]);
      return;
    }
    const coalesced = coalesceEvents(events);
    if (coalesced.length > 0) deps.flush(coalesced.map((e) => ({ kind: e.type, path: e.path })));
  };

  return {
    push(events) {
      if (disposed) return;
      if (!overflowed) {
        buffer.push(...events);
        if (buffer.length > MAX_BUFFERED_WATCH_EVENTS) {
          buffer = [];
          overflowed = true;
        }
      }
      // Resetting an armed timer would starve delivery under continuous writes.
      if (timer === null) timer = arm(fire, watchBatchFlushDelayMs(now(), lastFlushAt));
    },
    dispose() {
      disposed = true;
      if (timer !== null) disarm(timer);
      timer = null;
      buffer = [];
      overflowed = false;
    },
  };
}
