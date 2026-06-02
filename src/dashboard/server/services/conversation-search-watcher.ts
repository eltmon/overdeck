import { homedir } from 'node:os';
import { join } from 'node:path';

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';

import { getConversationSearchConfigSync, type NormalizedConversationSearchConfig } from '../../../lib/config-yaml.js';
import { indexConversationFile, indexConversationSearch, type ConversationIndexResult } from '../../../lib/conversation-search/indexer.js';

interface WatcherLike {
  on(event: 'add' | 'change', callback: (filePath: string) => void): WatcherLike;
  on(event: 'error', callback: (error: unknown) => void): WatcherLike;
  close(): Promise<unknown> | unknown;
}

type WatchFactory = (paths: string[], options: { ignoreInitial: boolean; awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } }) => WatcherLike;
type IndexAllFn = (options: { config: NormalizedConversationSearchConfig; roots: string[] }) => Promise<ConversationIndexResult>;
type IndexFileFn = (options: { filePath: string; config: NormalizedConversationSearchConfig }) => Promise<ConversationIndexResult>;

export interface ConversationSearchWatcherOptions {
  config?: NormalizedConversationSearchConfig;
  roots?: string[];
  debounceMs?: number;
  watchFactory?: WatchFactory;
  indexAll?: IndexAllFn;
  indexFile?: IndexFileFn;
  log?: Pick<Console, 'log' | 'warn'>;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_WRITE_STABILITY_MS = 250;
const DEFAULT_WRITE_POLL_MS = 50;

let activeWatcher: ConversationSearchWatcher | null = null;

export class ConversationSearchWatcher {
  private readonly config: NormalizedConversationSearchConfig;
  private readonly roots: string[];
  private readonly debounceMs: number;
  private readonly watchFactory: WatchFactory;
  private readonly indexAll: IndexAllFn;
  private readonly indexFile: IndexFileFn;
  private readonly log: Pick<Console, 'log' | 'warn'>;
  private watcher: WatcherLike | null = null;
  private stopped = false;
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: ConversationSearchWatcherOptions = {}) {
    this.config = options.config ?? getConversationSearchConfigSync();
    this.roots = options.roots ?? defaultConversationRoots();
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.watchFactory = options.watchFactory ?? ((paths, watchOptions) => chokidarWatch(paths, watchOptions) as FSWatcher);
    this.indexAll = options.indexAll ?? indexConversationSearch;
    this.indexFile = options.indexFile ?? indexConversationFile;
    this.log = options.log ?? console;
  }

  start(): void {
    if (this.stopped) return;
    void this.indexAll({ config: this.config, roots: this.roots })
      .then((result) => {
        if (result.disabled) {
          this.log.warn(`[conversation-search] startup index skipped: ${result.unavailableReason ?? 'disabled'}`);
        } else {
          this.log.log(`[conversation-search] startup indexed ${result.chunksIndexed} chunk${result.chunksIndexed === 1 ? '' : 's'} across ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'}`);
        }
      })
      .catch((error) => this.log.warn('[conversation-search] startup index failed:', error));

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
    const watcher = this.watcher;
    this.watcher = null;
    if (watcher) await watcher.close();
  }

  private schedule(filePath: string): void {
    if (this.stopped || !filePath.endsWith('.jsonl')) return;
    const existing = this.pending.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(filePath);
      if (this.stopped) return;
      void this.indexFile({ filePath, config: this.config })
        .catch((error) => this.log.warn(`[conversation-search] failed to index ${filePath}:`, error));
    }, this.debounceMs);
    this.pending.set(filePath, timer);
  }
}

export function startConversationSearchWatcher(options: ConversationSearchWatcherOptions = {}): ConversationSearchWatcher | null {
  const config = options.config ?? getConversationSearchConfigSync();
  if (!config.enabled) {
    options.log?.log?.('[conversation-search] watcher disabled by config');
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
  if (!config.enabled) {
    await stopConversationSearchWatcher();
    options.log?.log?.('[conversation-search] watcher stopped because config is disabled');
    return null;
  }
  return startConversationSearchWatcher({ ...options, config });
}

function defaultConversationRoots(): string[] {
  return [join(homedir(), '.claude', 'projects')];
}
