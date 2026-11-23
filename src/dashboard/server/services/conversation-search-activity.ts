/**
 * PAN-5609 — the single source of truth for conversation-search indexing
 * activity: one in-flight batch (startup / catch-up / full-reindex) plus one
 * incremental burst, derived into a complete `ConversationSearchActivitySnapshot`
 * and published via `conversation_search.activity_changed` (`emitOnly`, never
 * stored, never replayed), throttled like `github-quota.ts`.
 */

import { basename } from 'node:path';

import type { ConversationSearchActivityKind, ConversationSearchActivitySnapshot } from '@overdeck/contracts';
import type { ConversationIndexProgress } from '../../../lib/conversation-search/indexer.js';
import { getEventStore } from '../event-store.js';

export const ACTIVITY_EMIT_THROTTLE_MS = 500;

export type ConversationSearchBatchKind = Exclude<ConversationSearchActivityKind, 'incremental'>;

export interface ConversationSearchBatchHandle {
  progress(progress: ConversationIndexProgress): void;
  recordError(reason: unknown): void;
  end(): void;
}

export interface ConversationSearchActivityTracker {
  beginBatch(kind: ConversationSearchBatchKind): ConversationSearchBatchHandle;
  /** The watcher queue changed. `startedFile` names a file that just went in flight. */
  setQueue(queued: number, inFlight: number, startedFile?: string): void;
  /** One incremental file finished. */
  recordIncrementalFile(chunksIndexed: number): void;
  recordIncrementalError(reason: unknown): void;
  /** Watcher stopped: queue counts go to 0 and any burst ends. Batches end through their handle. */
  resetQueue(): void;
  getSnapshot(): ConversationSearchActivitySnapshot;
}

interface BatchState {
  token: number;
  kind: ConversationSearchBatchKind;
  filesScanned: number;
  filesIndexed: number;
  chunksIndexed: number;
  currentFile: string | null;
  startedAt: string;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface BurstState {
  filesIndexed: number;
  chunksIndexed: number;
  currentFile: string | null;
  startedAt: string;
  lastError: string | null;
  lastErrorAt: string | null;
  endedAt: string | null;
  active: boolean;
}

function emptyBurst(): BurstState {
  return {
    filesIndexed: 0,
    chunksIndexed: 0,
    currentFile: null,
    startedAt: '',
    lastError: null,
    lastErrorAt: null,
    endedAt: null,
    active: false,
  };
}

function emptySnapshot(): ConversationSearchActivitySnapshot {
  return {
    active: false,
    kind: null,
    filesScanned: 0,
    filesIndexed: 0,
    chunksIndexed: 0,
    currentFile: null,
    queued: 0,
    inFlight: 0,
    startedAt: null,
    endedAt: null,
    lastError: null,
    lastErrorAt: null,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function createConversationSearchActivityTracker(deps?: {
  emit?: (snapshot: ConversationSearchActivitySnapshot) => void;
  now?: () => number;
  throttleMs?: number;
}): ConversationSearchActivityTracker {
  const now = deps?.now ?? Date.now;
  const throttleMs = deps?.throttleMs ?? ACTIVITY_EMIT_THROTTLE_MS;
  const emit =
    deps?.emit ??
    ((activity: ConversationSearchActivitySnapshot) => {
      try {
        getEventStore().emitOnly({
          type: 'conversation_search.activity_changed',
          timestamp: new Date().toISOString(),
          payload: { activity },
        });
      } catch {
        // Event store not ready yet: the next change republishes.
      }
    });

  const iso = (ms: number) => new Date(ms).toISOString();

  let nextToken = 0;
  let batch: BatchState | null = null;
  let burst: BurstState = emptyBurst();
  let queued = 0;
  let inFlight = 0;
  let last: ConversationSearchActivitySnapshot | null = null;

  let lastEmitAt = -Infinity;
  let lastEmittedKey: string | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  function getSnapshot(): ConversationSearchActivitySnapshot {
    if (batch) {
      return {
        active: true,
        kind: batch.kind,
        filesScanned: batch.filesScanned,
        filesIndexed: batch.filesIndexed,
        chunksIndexed: batch.chunksIndexed,
        currentFile: batch.currentFile,
        queued,
        inFlight,
        startedAt: batch.startedAt,
        endedAt: null,
        lastError: batch.lastError,
        lastErrorAt: batch.lastErrorAt,
      };
    }
    if (burst.active) {
      return {
        active: true,
        kind: 'incremental',
        filesScanned: burst.filesIndexed + queued + inFlight,
        filesIndexed: burst.filesIndexed,
        chunksIndexed: burst.chunksIndexed,
        currentFile: burst.currentFile,
        queued,
        inFlight,
        startedAt: burst.startedAt,
        endedAt: null,
        lastError: burst.lastError,
        lastErrorAt: burst.lastErrorAt,
      };
    }
    if (last) {
      return { ...last, queued, inFlight };
    }
    return emptySnapshot();
  }

  function doEmit(): void {
    const snapshot = getSnapshot();
    const key = JSON.stringify(snapshot);
    if (key === lastEmittedKey) return;
    lastEmittedKey = key;
    lastEmitAt = now();
    emit(snapshot);
  }

  function scheduleEmit(): void {
    const elapsed = now() - lastEmitAt;
    if (elapsed >= throttleMs) {
      doEmit();
      return;
    }
    if (trailingTimer) return;
    const remaining = throttleMs - elapsed;
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      doEmit();
    }, remaining);
    trailingTimer.unref?.();
  }

  function endBurst(): void {
    last = {
      active: false,
      kind: 'incremental',
      filesScanned: burst.filesIndexed,
      filesIndexed: burst.filesIndexed,
      chunksIndexed: burst.chunksIndexed,
      currentFile: null,
      queued: 0,
      inFlight: 0,
      startedAt: burst.startedAt,
      endedAt: iso(now()),
      lastError: burst.lastError,
      lastErrorAt: burst.lastErrorAt,
    };
    burst = emptyBurst();
  }

  function maybeStartBurst(): void {
    if (!batch && queued + inFlight > 0 && !burst.active) {
      burst = {
        filesIndexed: 0,
        chunksIndexed: 0,
        currentFile: null,
        startedAt: iso(now()),
        lastError: null,
        lastErrorAt: null,
        endedAt: null,
        active: true,
      };
    }
  }

  function beginBatch(kind: ConversationSearchBatchKind): ConversationSearchBatchHandle {
    if (burst.active) endBurst();
    const token = nextToken++;
    batch = {
      token,
      kind,
      filesScanned: 0,
      filesIndexed: 0,
      chunksIndexed: 0,
      currentFile: null,
      startedAt: iso(now()),
      lastError: null,
      lastErrorAt: null,
    };
    scheduleEmit();
    return {
      progress(progress: ConversationIndexProgress) {
        if (!batch || batch.token !== token) return;
        batch.filesScanned = progress.filesScanned;
        batch.filesIndexed = progress.filesIndexed;
        batch.chunksIndexed = progress.chunksIndexed;
        batch.currentFile = progress.currentFile ?? null;
        scheduleEmit();
      },
      recordError(reason: unknown) {
        if (!batch || batch.token !== token) return;
        batch.lastError = errorMessage(reason);
        batch.lastErrorAt = iso(now());
        scheduleEmit();
      },
      end() {
        if (!batch || batch.token !== token) return;
        last = {
          active: false,
          kind: batch.kind,
          filesScanned: batch.filesScanned,
          filesIndexed: batch.filesIndexed,
          chunksIndexed: batch.chunksIndexed,
          currentFile: null,
          queued: 0,
          inFlight: 0,
          startedAt: batch.startedAt,
          endedAt: iso(now()),
          lastError: batch.lastError,
          lastErrorAt: batch.lastErrorAt,
        };
        batch = null;
        maybeStartBurst();
        scheduleEmit();
      },
    };
  }

  function setQueue(nextQueued: number, nextInFlight: number, startedFile?: string): void {
    queued = nextQueued;
    inFlight = nextInFlight;
    maybeStartBurst();
    if (burst.active && startedFile !== undefined) {
      burst.currentFile = basename(startedFile);
    }
    if (burst.active && queued + inFlight === 0) {
      endBurst();
    }
    scheduleEmit();
  }

  function recordIncrementalFile(chunksIndexed: number): void {
    if (!burst.active) return;
    burst.filesIndexed += 1;
    burst.chunksIndexed += chunksIndexed;
    scheduleEmit();
  }

  function recordIncrementalError(reason: unknown): void {
    if (!burst.active) return;
    burst.lastError = errorMessage(reason);
    burst.lastErrorAt = iso(now());
    scheduleEmit();
  }

  function resetQueue(): void {
    queued = 0;
    inFlight = 0;
    if (burst.active) endBurst();
    scheduleEmit();
  }

  return { beginBatch, setQueue, recordIncrementalFile, recordIncrementalError, resetQueue, getSnapshot };
}

/** The dashboard's tracker; emits `conversation_search.activity_changed` via emitOnly. */
export const conversationSearchActivity: ConversationSearchActivityTracker = createConversationSearchActivityTracker();

/** D-6 legacy shape for GET /api/settings/conversation-search/reindex-progress. */
export function toLegacyReindexProgress(snapshot: ConversationSearchActivitySnapshot): {
  active: boolean;
  filesScanned: number;
  filesIndexed: number;
  chunksIndexed: number;
  currentFile?: string;
  startedAt?: number;
} {
  if (snapshot.kind !== 'full-reindex') {
    return { active: false, filesScanned: 0, filesIndexed: 0, chunksIndexed: 0 };
  }
  return {
    active: snapshot.active,
    filesScanned: snapshot.filesScanned,
    filesIndexed: snapshot.filesIndexed,
    chunksIndexed: snapshot.chunksIndexed,
    ...(snapshot.currentFile !== null ? { currentFile: snapshot.currentFile } : {}),
    ...(snapshot.startedAt !== null ? { startedAt: Date.parse(snapshot.startedAt) } : {}),
  };
}
