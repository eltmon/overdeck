import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

export type ConversationWatchEvent = 'add' | 'change' | 'unlink';

type FileHandler = (filePath: string) => void;
type ErrorHandler = (error: unknown) => void;

/**
 * Watch a directory tree without asking fs.watch/chokidar to watch every file.
 *
 * Linux implements recursive fs.watch by opening one FSEventWrap per path,
 * including files. The transcript tree contains thousands of immutable support
 * files, so that shape retained hundreds of megabytes in native watcher state.
 * Directory watches already report child file changes; one watcher per directory
 * preserves recursive discovery while keeping file count out of memory growth.
 */
export class ConversationDirectoryWatcher {
  readonly ready: Promise<void>;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly knownJsonl = new Set<string>();
  private readonly fileHandlers = new Map<ConversationWatchEvent, FileHandler[]>();
  private readonly errorHandlers: ErrorHandler[] = [];
  private stopped = false;

  constructor(roots: readonly string[]) {
    this.ready = Promise.all(roots.map(root => this.addTree(root, false))).then(() => undefined);
  }

  get watchedDirectoryCount(): number {
    return this.watchers.size;
  }

  on(event: ConversationWatchEvent, callback: FileHandler): this;
  on(event: 'error', callback: ErrorHandler): this;
  on(event: ConversationWatchEvent | 'error', callback: FileHandler | ErrorHandler): this {
    if (event === 'error') {
      this.errorHandlers.push(callback as ErrorHandler);
    } else {
      const handlers = this.fileHandlers.get(event) ?? [];
      handlers.push(callback as FileHandler);
      this.fileHandlers.set(event, handlers);
    }
    return this;
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.knownJsonl.clear();
    await this.ready.catch(() => undefined);
  }

  private emitFile(event: ConversationWatchEvent, filePath: string): void {
    for (const handler of this.fileHandlers.get(event) ?? []) handler(filePath);
  }

  private emitError(error: unknown): void {
    for (const handler of this.errorHandlers) handler(error);
  }

  private async addTree(dirPath: string, emitExisting: boolean): Promise<void> {
    if (this.stopped || this.watchers.has(dirPath)) return;

    let watcher: FSWatcher;
    try {
      watcher = watch(dirPath, (_eventType, filename) => {
        if (this.stopped || filename == null) return;
        void this.handlePathEvent(join(dirPath, filename.toString())).catch(error => this.emitError(error));
      });
    } catch (error) {
      this.emitError(error);
      return;
    }

    watcher.on('error', error => this.emitError(error));
    this.watchers.set(dirPath, watcher);

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      watcher.close();
      this.watchers.delete(dirPath);
      if (!this.stopped) this.emitError(error);
      return;
    }

    for (const entry of entries) {
      if (this.stopped) return;
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.addTree(entryPath, emitExisting);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.jsonl')) {
        const known = this.knownJsonl.has(entryPath);
        this.knownJsonl.add(entryPath);
        if (emitExisting && !known) this.emitFile('add', entryPath);
      }
    }
  }

  private async handlePathEvent(filePath: string): Promise<void> {
    try {
      const pathStat = await stat(filePath);
      if (pathStat.isDirectory()) {
        await this.addTree(filePath, true);
        return;
      }
      if (!pathStat.isFile() || !filePath.endsWith('.jsonl')) return;

      const known = this.knownJsonl.has(filePath);
      this.knownJsonl.add(filePath);
      this.emitFile(known ? 'change' : 'add', filePath);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT') throw error;
      if (this.knownJsonl.delete(filePath)) this.emitFile('unlink', filePath);
      this.removeTree(filePath);
    }
  }

  private removeTree(dirPath: string): void {
    const prefix = `${dirPath}${sep}`;
    for (const [watchedPath, watcher] of this.watchers) {
      if (watchedPath !== dirPath && !watchedPath.startsWith(prefix)) continue;
      watcher.close();
      this.watchers.delete(watchedPath);
    }
    for (const filePath of this.knownJsonl) {
      if (!filePath.startsWith(prefix)) continue;
      this.knownJsonl.delete(filePath);
      this.emitFile('unlink', filePath);
    }
  }
}
