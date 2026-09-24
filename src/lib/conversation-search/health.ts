/**
 * Runtime health for the conversation-search embedding pipeline (PAN-3771).
 *
 * Config-level availability (key configured, DB openable) is checked when the
 * provider and DB are constructed, but per-call failures — exhausted credits,
 * quota limits, network errors — only surface while an embed is actually
 * running. This module records the most recent outcome so the dashboard can
 * show a banner instead of silently returning zero search hits.
 *
 * The transcript file watcher's own state lives beside it (PAN-3915): a
 * watcher error is not an embed failure, it re-arms the watcher, and the
 * payload says whether the watcher is running, waiting to restart, or has
 * stopped restarting after repeated failures.
 */

export interface ConversationSearchWatcherHealth {
  /**
   * `restarting` while a failed watcher waits for its backoff to re-arm it;
   * `failed` once the restart circuit breaker tripped and no restart is scheduled.
   */
  state: 'running' | 'restarting' | 'failed';
  /** Times the watcher was re-armed after an error since it started. */
  restarts: number;
  /** ISO timestamp of the most recent watcher error, if any. */
  lastErrorAt: string | null;
  /** Human-readable reason from the most recent watcher error. */
  lastErrorReason: string | null;
  /** When `restarting`, the ISO timestamp the next re-arm is scheduled for. */
  nextRestartAt: string | null;
}

export interface ConversationSearchHealth {
  /** ISO timestamp of the most recent failed embed/index call, if any. */
  lastErrorAt: string | null;
  /** Human-readable reason from the most recent failure. */
  lastErrorReason: string | null;
  /** ISO timestamp of the most recent successful embed/index call, if any. */
  lastSuccessAt: string | null;
  /** Transcript watcher state; null while no watcher is running. */
  watcher: ConversationSearchWatcherHealth | null;
}

interface ConversationSearchHealthState {
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  lastSuccessAt: string | null;
  watcher: ConversationSearchWatcherHealth | null;
}

const state: ConversationSearchHealthState = {
  lastErrorAt: null,
  lastErrorReason: null,
  lastSuccessAt: null,
  watcher: null,
};

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function recordConversationSearchFailure(reason: unknown): void {
  state.lastErrorAt = new Date().toISOString();
  state.lastErrorReason = reasonText(reason);
}

export function recordConversationSearchSuccess(): void {
  state.lastSuccessAt = new Date().toISOString();
}

/** The watcher started fresh (dashboard boot or config change). */
export function recordConversationSearchWatcherStarted(): void {
  state.watcher = { state: 'running', restarts: 0, lastErrorAt: null, lastErrorReason: null, nextRestartAt: null };
}

/** The watcher failed and will be re-armed after `restartInMs`. */
export function recordConversationSearchWatcherError(reason: unknown, restartInMs: number): void {
  const now = Date.now();
  state.watcher = {
    state: 'restarting',
    restarts: state.watcher?.restarts ?? 0,
    lastErrorAt: new Date(now).toISOString(),
    lastErrorReason: reasonText(reason),
    nextRestartAt: new Date(now + restartInMs).toISOString(),
  };
}

/** A failed watcher was re-armed. The last error stays for diagnosis. */
export function recordConversationSearchWatcherRestarted(): void {
  const previous = state.watcher;
  state.watcher = {
    state: 'running',
    restarts: (previous?.restarts ?? 0) + 1,
    lastErrorAt: previous?.lastErrorAt ?? null,
    lastErrorReason: previous?.lastErrorReason ?? null,
    nextRestartAt: null,
  };
}

/**
 * The restart circuit breaker tripped: the watcher kept failing right after
 * each re-arm, so no further restart is scheduled until the dashboard restarts
 * or conversation-search settings are saved. ENOSPC/EMFILE almost always mean
 * the inotify watch limit, so the reason says which sysctl to raise.
 */
export function recordConversationSearchWatcherFailed(reason: unknown): void {
  const previous = state.watcher;
  state.watcher = {
    state: 'failed',
    restarts: previous?.restarts ?? 0,
    lastErrorAt: new Date().toISOString(),
    lastErrorReason: watcherFailureText(reason),
    nextRestartAt: null,
  };
}

function watcherFailureText(reason: unknown): string {
  const text = reasonText(reason);
  const code = typeof reason === 'object' && reason !== null ? (reason as NodeJS.ErrnoException).code : undefined;
  if (/^(ENOSPC|EMFILE)$/.test(code ?? '') || /ENOSPC|EMFILE/.test(text)) {
    return `${text} (inotify watch limit reached; raise fs.inotify.max_user_watches)`;
  }
  return text;
}

/** The watcher was stopped on purpose (shutdown, disabled, config change). */
export function recordConversationSearchWatcherStopped(): void {
  state.watcher = null;
}

/** Snapshot copy — callers must not mutate live state. */
export function getConversationSearchHealth(): ConversationSearchHealth {
  return { ...state, watcher: state.watcher ? { ...state.watcher } : null };
}

export function resetConversationSearchHealthForTests(): void {
  state.lastErrorAt = null;
  state.lastErrorReason = null;
  state.lastSuccessAt = null;
  state.watcher = null;
}
