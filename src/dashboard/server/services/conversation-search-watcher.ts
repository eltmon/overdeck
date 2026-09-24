
import { getConversationSearchConfig, type NormalizedConversationSearchConfig } from '../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider } from '../../../lib/conversation-search/embedding-provider.js';
import {
  recordConversationSearchFailure,
  recordConversationSearchSuccess,
  recordConversationSearchWatcherError,
  recordConversationSearchWatcherFailed,
  recordConversationSearchWatcherRestarted,
  recordConversationSearchWatcherStarted,
  recordConversationSearchWatcherStopped,
} from '../../../lib/conversation-search/health.js';
import { indexConversationFile, indexConversationSearch, sessionIdFromPath, type ConversationIndexResult } from '../../../lib/conversation-search/indexer.js';
import { dimensionsForModel, openEmbeddingsDb } from '../../../lib/overdeck/conversations-search.js';
import { ConversationDirectoryWatcher } from './conversation-directory-watcher.js';
import { claudeProjectsRoot } from '../../../lib/runtimes/storage/claude-code.js';

interface WatcherLike {
  on(event: 'add' | 'change' | 'unlink', callback: (filePath: string) => void): WatcherLike;
  on(event: 'error', callback: (error: unknown) => void): WatcherLike;
  close(): Promise<unknown> | unknown;
}

type WatchFactory = (paths: string[], options: { ignoreInitial: boolean; awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } }) => WatcherLike;
type IndexAllFn = (options: { config: NormalizedConversationSearchConfig; roots: string[]; signal?: AbortSignal; modifiedSince?: number }) => Promise<ConversationIndexResult>;
type IndexFileFn = (options: { filePath: string; config: NormalizedConversationSearchConfig; signal?: AbortSignal }) => Promise<ConversationIndexResult>;
type RemoveFileFn = (options: { filePath: string; config: NormalizedConversationSearchConfig }) => Promise<void>;

export interface ConversationSearchWatcherOptions {
  config?: NormalizedConversationSearchConfig;
  roots?: string[];
  debounceMs?: number;
  watchFactory?: WatchFactory;
  indexAll?: IndexAllFn;
  indexFile?: IndexFileFn;
  removeFile?: RemoveFileFn;
  maxConcurrentIndexers?: number;
  /** First restart delay after a watcher error; doubles per consecutive error. */
  restartBaseDelayMs?: number;
  /** Upper bound on the restart delay; a re-armed watcher that stays up this long counts as healthy. */
  restartMaxDelayMs?: number;
  /** Re-armed watchers in a row that may fail inside the healthy window before restarts stop. */
  maxConsecutiveRestarts?: number;
  log?: Pick<Console, 'log' | 'warn'>;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_WRITE_STABILITY_MS = 250;
const DEFAULT_WRITE_POLL_MS = 50;
const DEFAULT_RESTART_BASE_DELAY_MS = 1_000;
const DEFAULT_RESTART_MAX_DELAY_MS = 60_000;
const DEFAULT_MAX_CONSECUTIVE_RESTARTS = 5;
/** Catch-up looks back this far before the first watcher error, for writes whose events were lost as it died. */
const CATCH_UP_MARGIN_MS = 5_000;

let activeWatcher: ConversationSearchWatcher | null = null;

/** Drop a deleted transcript's chunks and indexing cursor so search stops surfacing it. */
async function defaultRemoveFile(options: { filePath: string; config: NormalizedConversationSearchConfig }): Promise<void> {
  const { filePath, config } = options;
  const db = openEmbeddingsDb(config.dbPath, dimensionsForModel(config.model));
  try {
    if (!db.available) return;
    db.deleteCursor(filePath);
    db.deleteSession(sessionIdFromPath(filePath));
  } finally {
    db.close();
  }
}

function watcherSignature(config: NormalizedConversationSearchConfig, roots: string[]): string {
  return JSON.stringify({
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    apiKeyRef: config.apiKeyRef ?? null,
    dbPath: config.dbPath,
    roots,
  });
}

export class ConversationSearchWatcher {
  private readonly config: NormalizedConversationSearchConfig;
  private readonly roots: string[];
  private readonly debounceMs: number;
  private readonly watchFactory: WatchFactory;
  private readonly indexAll: IndexAllFn;
  private readonly indexFile: IndexFileFn;
  private readonly removeFile: RemoveFileFn;
  private readonly maxConcurrentIndexers: number;
  private readonly restartBaseDelayMs: number;
  private readonly restartMaxDelayMs: number;
  private readonly maxConsecutiveRestarts: number;
  private readonly log: Pick<Console, 'log' | 'warn'>;
  readonly signature: string;
  private watcher: WatcherLike | null = null;
  private stopped = false;
  private activeIndexers = 0;
  private abortController: AbortController | null = null;
  private startupTask: Promise<void> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** Watcher errors in a row, each within `restartMaxDelayMs` of the last re-arm; drives the backoff. */
  private consecutiveWatcherErrors = 0;
  private lastArmedAt = 0;
  /** When the watcher first went down and no catch-up has covered it yet (epoch ms). */
  private outageStartedAt: number | null = null;
  /** A restart happened while a sweep was running; run the catch-up once it ends. */
  private catchUpPending = false;
  private breakerTripped = false;
  private readonly activeTasks = new Set<Promise<void>>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queued = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly rerun = new Set<string>();

  constructor(options: ConversationSearchWatcherOptions = {}) {
    this.config = options.config ?? getConversationSearchConfig();
    this.roots = options.roots ?? defaultConversationRoots();
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.signature = watcherSignature(this.config, this.roots);
    this.watchFactory = options.watchFactory ?? ((paths) => new ConversationDirectoryWatcher(paths));
    this.indexAll = options.indexAll ?? indexConversationSearch;
    this.indexFile = options.indexFile ?? indexConversationFile;
    this.removeFile = options.removeFile ?? defaultRemoveFile;
    this.maxConcurrentIndexers = Math.max(1, options.maxConcurrentIndexers ?? 1);
    this.restartBaseDelayMs = Math.max(1, options.restartBaseDelayMs ?? DEFAULT_RESTART_BASE_DELAY_MS);
    this.restartMaxDelayMs = Math.max(this.restartBaseDelayMs, options.restartMaxDelayMs ?? DEFAULT_RESTART_MAX_DELAY_MS);
    this.maxConsecutiveRestarts = Math.max(0, options.maxConsecutiveRestarts ?? DEFAULT_MAX_CONSECUTIVE_RESTARTS);
    this.log = options.log ?? console;
  }

  /** The restart circuit breaker tripped; only a fresh watcher (restart or settings save) retries. */
  get failed(): boolean {
    return this.breakerTripped;
  }

  start(): void {
    if (this.stopped) return;
    this.abortController = new AbortController();
    recordConversationSearchWatcherStarted();
    this.runFullIndex('startup');
    this.armWatcher();
  }

  /**
   * Sweep every root. At startup this catches up on transcripts written while
   * the dashboard was down. After a watcher restart it catches up on the ones
   * written while the watcher was dead, and only those: files whose mtime
   * predates the outage are skipped from their stat, so a flapping watcher does
   * not re-read every transcript on each restart.
   */
  private runFullIndex(label: 'startup' | 'catch-up'): void {
    const signal = this.abortController?.signal;
    if (!signal) return;
    let modifiedSince: number | undefined;
    if (label === 'catch-up') {
      // Capture and clear: a later error starts a new outage window.
      modifiedSince = (this.outageStartedAt ?? Date.now()) - CATCH_UP_MARGIN_MS;
      this.outageStartedAt = null;
    }
    const startupT0 = performance.now();
    this.startupTask = this.indexAll({ config: this.config, roots: this.roots, signal, ...(modifiedSince != null ? { modifiedSince } : {}) })
      .then((result) => {
        if (signal.aborted || this.stopped) return;
        if (result.disabled) {
          this.log.warn(`[conversation-search] ${label} index skipped: ${result.unavailableReason ?? 'disabled'}`);
        } else if (result.errors.length > 0) {
          // PAN-3771: surface per-file embed failures (e.g. exhausted credits)
          // through the health state instead of only the log.
          recordConversationSearchFailure(result.errors[result.errors.length - 1]?.message ?? `${label} indexing reported errors`);
          const prunedNote = result.sessionsPruned > 0 ? `, pruned ${result.sessionsPruned} stale session${result.sessionsPruned === 1 ? '' : 's'}` : '';
          this.log.warn(`[conversation-search] ${label} indexed with ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} across ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'}${prunedNote}: ${result.errors[0]?.message}`);
        } else {
          recordConversationSearchSuccess();
          const prunedNote = result.sessionsPruned > 0 ? `, pruned ${result.sessionsPruned} stale session${result.sessionsPruned === 1 ? '' : 's'}` : '';
          this.log.log(`[conversation-search] ${label} indexed ${result.chunksIndexed} chunk${result.chunksIndexed === 1 ? '' : 's'} across ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'}${prunedNote}`);
        }
        if (label === 'startup') this.log.log(`[boot-timing] conversation-search startup index completed at +${Math.round(performance.now() - startupT0)}ms`);
      })
      .catch((error) => {
        if (!isAbortError(error)) this.log.warn(`[conversation-search] ${label} index failed:`, error);
        if (label === 'startup') this.log.log(`[boot-timing] conversation-search startup index failed at +${Math.round(performance.now() - startupT0)}ms`);
      })
      .finally(() => {
        this.startupTask = null;
        if (this.catchUpPending && !this.stopped && this.watcher) {
          this.catchUpPending = false;
          this.runFullIndex('catch-up');
          return;
        }
        this.drainQueue();
      });
  }

  private armWatcher(): void {
    const watcher = this.watchFactory(this.roots, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: DEFAULT_WRITE_STABILITY_MS,
        pollInterval: DEFAULT_WRITE_POLL_MS,
      },
    });
    this.watcher = watcher;
    this.lastArmedAt = Date.now();
    watcher
      .on('add', (filePath) => this.onFileEvent(watcher, filePath, 'index'))
      .on('change', (filePath) => this.onFileEvent(watcher, filePath, 'index'))
      .on('unlink', (filePath) => this.onFileEvent(watcher, filePath, 'remove'))
      .on('error', (error) => this.onWatcherError(watcher, error));
  }

  private onFileEvent(watcher: WatcherLike, filePath: string, action: 'index' | 'remove'): void {
    if (watcher !== this.watcher) return;
    if (action === 'index') this.schedule(filePath);
    else this.remove(filePath);
  }

  /**
   * PAN-3915: a watcher error (e.g. parcel's "Unable to poll: Interrupted
   * system call") can leave the subscription dead, and no event would ever
   * arrive again. Close it and re-arm after a bounded exponential backoff.
   */
  private onWatcherError(watcher: WatcherLike, error: unknown): void {
    if (this.stopped || watcher !== this.watcher) return;
    this.watcher = null;
    const now = Date.now();
    this.outageStartedAt ??= now;
    // Only a watcher that stayed up for a full backoff cap starts the backoff over,
    // so an error loop (even one with events in between) cannot restart faster.
    if (now - this.lastArmedAt >= this.restartMaxDelayMs) this.consecutiveWatcherErrors = 0;
    this.closeErroredWatcher(watcher);
    // Circuit breaker: every re-armed watcher failed inside the healthy window.
    if (this.consecutiveWatcherErrors >= this.maxConsecutiveRestarts) {
      this.breakerTripped = true;
      recordConversationSearchWatcherFailed(error);
      this.log.warn(`[conversation-search] watcher failed ${this.consecutiveWatcherErrors + 1} times in a row; not restarting until the dashboard restarts or conversation-search settings are saved:`, error);
      return;
    }
    const delayMs = Math.min(this.restartMaxDelayMs, this.restartBaseDelayMs * 2 ** this.consecutiveWatcherErrors);
    this.consecutiveWatcherErrors += 1;
    recordConversationSearchWatcherError(error, delayMs);
    this.log.warn(`[conversation-search] watcher error, restarting in ${delayMs}ms:`, error);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopped) return;
      this.armWatcher();
      recordConversationSearchWatcherRestarted();
      this.log.log('[conversation-search] watcher restarted');
      // Transcripts written while the watcher was dead produced no events. A
      // sweep already running may have passed them, so queue one after it.
      if (this.startupTask) this.catchUpPending = true;
      else this.runFullIndex('catch-up');
    }, delayMs);
  }

  private closeErroredWatcher(watcher: WatcherLike): void {
    const closing = Promise.resolve()
      .then(() => watcher.close())
      .then(() => undefined, (closeError: unknown) => {
        this.log.warn('[conversation-search] failed to close errored watcher:', closeError);
      })
      .finally(() => {
        this.activeTasks.delete(closing);
      });
    this.activeTasks.add(closing);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    recordConversationSearchWatcherStopped();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.queued.clear();
    this.rerun.clear();
    this.abortController?.abort();
    const watcher = this.watcher;
    this.watcher = null;
    if (watcher) await watcher.close();
    await Promise.allSettled([
      ...(this.startupTask ? [this.startupTask] : []),
      ...this.activeTasks,
    ]);
    this.abortController = null;
  }

  private schedule(filePath: string): void {
    if (this.stopped || !filePath.endsWith('.jsonl')) return;
    const existing = this.pending.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(filePath);
      if (this.stopped) return;
      this.enqueue(filePath);
    }, this.debounceMs);
    this.pending.set(filePath, timer);
  }

  private enqueue(filePath: string): void {
    if (this.inFlight.has(filePath)) {
      this.rerun.add(filePath);
      return;
    }
    this.queued.add(filePath);
    this.drainQueue();
  }

  private remove(filePath: string): void {
    if (this.stopped || !filePath.endsWith('.jsonl')) return;
    // A pending or queued index for a now-deleted file would only fail on ENOENT.
    const timer = this.pending.get(filePath);
    if (timer) clearTimeout(timer);
    this.pending.delete(filePath);
    this.queued.delete(filePath);
    this.rerun.delete(filePath);
    const task = Promise.resolve()
      .then(() => this.removeFile({ filePath, config: this.config }))
      .catch((error: unknown) => {
        this.log.warn(`[conversation-search] failed to prune deleted session ${filePath}:`, error);
      })
      .finally(() => {
        this.activeTasks.delete(task);
      });
    this.activeTasks.add(task);
  }

  private drainQueue(): void {
    if (this.stopped || this.startupTask) return;
    const signal = this.abortController?.signal;
    while (this.activeIndexers < this.maxConcurrentIndexers && this.queued.size > 0) {
      const filePath = this.queued.values().next().value as string;
      this.queued.delete(filePath);
      this.inFlight.add(filePath);
      this.activeIndexers += 1;
      const task = this.indexFile({ filePath, config: this.config, signal })
        .then((result) => {
          if (result.disabled) return;
          const firstError = result.errors[0];
          if (firstError) {
            recordConversationSearchFailure(firstError.message);
          } else {
            recordConversationSearchSuccess();
          }
        }, (error) => {
          if (isMissingFileError(error)) {
            // PAN-3915: deleted mid-index; the unlink handler prunes it.
            return;
          }
          if (!isAbortError(error)) {
            recordConversationSearchFailure(error);
            this.log.warn(`[conversation-search] failed to index ${filePath}:`, error);
          }
        })
        .finally(() => {
          this.activeTasks.delete(task);
          this.activeIndexers = Math.max(0, this.activeIndexers - 1);
          this.inFlight.delete(filePath);
          if (this.rerun.delete(filePath) && !this.stopped) this.queued.add(filePath);
          this.drainQueue();
        });
      this.activeTasks.add(task);
    }
  }
}

export function startConversationSearchWatcher(options: ConversationSearchWatcherOptions = {}): ConversationSearchWatcher | null {
  const config = options.config ?? getConversationSearchConfig();
  if (!config.enabled) {
    options.log?.log?.('[conversation-search] watcher disabled by config');
    return null;
  }
  const provider = createConversationEmbeddingProvider({ config });
  if (!provider.enabled) {
    options.log?.warn?.(`[conversation-search] watcher disabled: ${provider.unavailableReason ?? 'embedding provider unavailable'}`);
    return null;
  }
  if (activeWatcher) return activeWatcher;
  activeWatcher = new ConversationSearchWatcher({ ...options, config });
  activeWatcher.start();
  return activeWatcher;
}

export async function stopConversationSearchWatcher(): Promise<void> {
  const watcher = activeWatcher;
  activeWatcher = null;
  if (watcher) await watcher.stop();
}

export async function syncConversationSearchWatcher(options: ConversationSearchWatcherOptions = {}): Promise<ConversationSearchWatcher | null> {
  const config = options.config ?? getConversationSearchConfig();
  const roots = options.roots ?? defaultConversationRoots();
  if (!config.enabled) {
    await stopConversationSearchWatcher();
    options.log?.log?.('[conversation-search] watcher stopped because config is disabled');
    return null;
  }
  const provider = createConversationEmbeddingProvider({ config });
  if (!provider.enabled) {
    await stopConversationSearchWatcher();
    options.log?.warn?.(`[conversation-search] watcher stopped because embedding provider is unavailable: ${provider.unavailableReason ?? 'unknown'}`);
    return null;
  }

  const signature = watcherSignature(config, roots);
  // A watcher whose restart breaker tripped is replaced even when nothing
  // changed: saving the settings is the operator's retry.
  if (activeWatcher?.signature === signature && !activeWatcher.failed) return activeWatcher;

  if (activeWatcher) {
    await stopConversationSearchWatcher();
    options.log?.log?.('[conversation-search] watcher restarting because config changed');
  }
  activeWatcher = new ConversationSearchWatcher({ ...options, config, roots });
  activeWatcher.start();
  return activeWatcher;
}

function defaultConversationRoots(): string[] {
  return [claudeProjectsRoot()];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
