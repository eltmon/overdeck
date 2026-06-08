import { homedir } from 'node:os';
import { join } from 'node:path';

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';

import { getConversationSearchConfigSync, type NormalizedConversationSearchConfig } from '../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider } from '../../../lib/conversation-search/embedding-provider.js';
import { indexConversationFile, indexConversationSearch, type ConversationIndexResult } from '../../../lib/conversation-search/indexer.js';

interface WatcherLike {
  on(event: 'add' | 'change', callback: (filePath: string) => void): WatcherLike;
  on(event: 'error', callback: (error: unknown) => void): WatcherLike;
  close(): Promise<unknown> | unknown;
}

type WatchFactory = (paths: string[], options: { ignoreInitial: boolean; awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } }) => WatcherLike;
type IndexAllFn = (options: { config: NormalizedConversationSearchConfig; roots: string[]; signal?: AbortSignal }) => Promise<ConversationIndexResult>;
type IndexFileFn = (options: { filePath: string; config: NormalizedConversationSearchConfig; signal?: AbortSignal }) => Promise<ConversationIndexResult>;

export interface ConversationSearchWatcherOptions {
  config?: NormalizedConversationSearchConfig;
  roots?: string[];
  debounceMs?: number;
  watchFactory?: WatchFactory;
  indexAll?: IndexAllFn;
  indexFile?: IndexFileFn;
  maxConcurrentIndexers?: number;
  log?: Pick<Console, 'log' | 'warn'>;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_WRITE_STABILITY_MS = 250;
const DEFAULT_WRITE_POLL_MS = 50;

let activeWatcher: ConversationSearchWatcher | null = null;

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
  private readonly maxConcurrentIndexers: number;
  private readonly log: Pick<Console, 'log' | 'warn'>;
  readonly signature: string;
  private watcher: WatcherLike | null = null;
  private stopped = false;
  private activeIndexers = 0;
  private abortController: AbortController | null = null;
  private startupTask: Promise<void> | null = null;
  private readonly activeTasks = new Set<Promise<void>>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queued = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly rerun = new Set<string>();

  constructor(options: ConversationSearchWatcherOptions = {}) {
    this.config = options.config ?? getConversationSearchConfigSync();
    this.roots = options.roots ?? defaultConversationRoots();
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.signature = watcherSignature(this.config, this.roots);
    this.watchFactory = options.watchFactory ?? ((paths, watchOptions) => chokidarWatch(paths, watchOptions) as FSWatcher);
    this.indexAll = options.indexAll ?? indexConversationSearch;
    this.indexFile = options.indexFile ?? indexConversationFile;
    this.maxConcurrentIndexers = Math.max(1, options.maxConcurrentIndexers ?? 1);
    this.log = options.log ?? console;
  }

  start(): void {
    if (this.stopped) return;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.startupTask = this.indexAll({ config: this.config, roots: this.roots, signal })
      .then((result) => {
        if (signal.aborted || this.stopped) return;
        if (result.disabled) {
          this.log.warn(`[conversation-search] startup index skipped: ${result.unavailableReason ?? 'disabled'}`);
        } else {
          this.log.log(`[conversation-search] startup indexed ${result.chunksIndexed} chunk${result.chunksIndexed === 1 ? '' : 's'} across ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'}`);
        }
      })
      .catch((error) => {
        if (!isAbortError(error)) this.log.warn('[conversation-search] startup index failed:', error);
      })
      .finally(() => {
        this.startupTask = null;
        this.drainQueue();
      });

    this.watcher = this.watchFactory(this.roots, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: DEFAULT_WRITE_STABILITY_MS,
        pollInterval: DEFAULT_WRITE_POLL_MS,
      },
    });
    this.watcher
      .on('add', (filePath) => this.schedule(filePath))
      .on('change', (filePath) => this.schedule(filePath))
      .on('error', (error) => this.log.warn('[conversation-search] watcher error:', error));
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
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

  private drainQueue(): void {
    if (this.stopped || this.startupTask) return;
    const signal = this.abortController?.signal;
    while (this.activeIndexers < this.maxConcurrentIndexers && this.queued.size > 0) {
      const filePath = this.queued.values().next().value as string;
      this.queued.delete(filePath);
      this.inFlight.add(filePath);
      this.activeIndexers += 1;
      const task = this.indexFile({ filePath, config: this.config, signal })
        .catch((error) => {
          if (!isAbortError(error)) this.log.warn(`[conversation-search] failed to index ${filePath}:`, error);
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
  const config = options.config ?? getConversationSearchConfigSync();
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
  const config = options.config ?? getConversationSearchConfigSync();
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
  if (activeWatcher?.signature === signature) return activeWatcher;

  if (activeWatcher) {
    await stopConversationSearchWatcher();
    options.log?.log?.('[conversation-search] watcher restarting because config changed');
  }
  activeWatcher = new ConversationSearchWatcher({ ...options, config, roots });
  activeWatcher.start();
  return activeWatcher;
}

function defaultConversationRoots(): string[] {
  return [join(homedir(), '.claude', 'projects')];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
