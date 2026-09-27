import { stat } from 'node:fs/promises';
import { discoverConversationJsonlFiles } from '../../../lib/conversation-search/indexer.js';

export type ConversationWatchEvent = 'add' | 'change' | 'unlink';

type FileHandler = (filePath: string) => void;
type ErrorHandler = (error: unknown) => void;

const DEFAULT_POLL_INTERVAL_MS = 15_000;

/**
 * PAN-4193: true for the error a `@parcel/watcher` subscription died with when a
 * signal interrupted its inotify poll. The polling watcher below never raises it;
 * the owner still classifies errors through it.
 */
export function isInterruptedPollError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as NodeJS.ErrnoException).code === 'EINTR') return true;
  const message = error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? '');
  return /Interrupted system call|\bEINTR\b/.test(message);
}

/**
 * Watch conversation trees by polling: every interval, walk the roots for
 * `.jsonl` transcripts, compare each file's mtime and size with the last scan,
 * and emit add/change/unlink.
 *
 * This replaced `@parcel/watcher`, which froze the dashboard. SIGCHLD from the
 * dashboard's child processes makes parcel's inotify `poll()` fail with EINTR,
 * and parcel does not retry it. `InotifyBackend::start` (2.6.0) then throws out of
 * its loop without calling `mEndedSignal.notify()`. `~InotifyBackend` waits on
 * that signal, so whichever thread drops the last reference to the dead backend
 * blocks forever. When it was the main thread, the event loop stopped at 0% CPU.
 * Each dead backend also leaked the thread and an unreaped `sh` from parcel's
 * watchman probe.
 *
 * Node's fs.watch is not an option either: it keeps one FSEventWrap per watched
 * path on Linux, and the transcript tree has thousands of directories, which cost
 * more than a gigabyte of native watcher state. Polling holds only a path-to-stat
 * map and uses no native watcher threads.
 */
export class ConversationDirectoryWatcher {
  readonly ready: Promise<void>;
  private readonly fileHandlers = new Map<ConversationWatchEvent, FileHandler[]>();
  private readonly errorHandlers: ErrorHandler[] = [];
  private known = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly roots: readonly string[],
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {
    this.ready = this.scan(false).then(
      () => this.scheduleNextScan(),
      (error: unknown) => {
        if (!this.stopped) this.emitError(error);
      },
    );
  }

  get activeSubscriptionCount(): number {
    return this.timer ? 1 : 0;
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.ready.catch(() => undefined);
  }

  private scheduleNextScan(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.scan(true).then(
        () => this.scheduleNextScan(),
        (error: unknown) => {
          this.timer = null;
          if (!this.stopped) this.emitError(error);
        },
      );
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  private async scan(emit: boolean): Promise<void> {
    const seen = new Map<string, string>();
    for (const filePath of await discoverConversationJsonlFiles([...this.roots])) {
      if (this.stopped) return;
      const info = await stat(filePath).catch(() => null);
      if (info) seen.set(filePath, `${info.mtimeMs}:${info.size}`);
    }
    if (this.stopped) return;
    if (emit) {
      for (const [filePath, signature] of seen) {
        const previous = this.known.get(filePath);
        if (previous === undefined) this.emitFile('add', filePath);
        else if (previous !== signature) this.emitFile('change', filePath);
      }
      for (const filePath of this.known.keys()) {
        if (!seen.has(filePath)) this.emitFile('unlink', filePath);
      }
    }
    this.known = seen;
  }

  private emitFile(event: ConversationWatchEvent, filePath: string): void {
    for (const handler of this.fileHandlers.get(event) ?? []) handler(filePath);
  }

  private emitError(error: unknown): void {
    for (const handler of this.errorHandlers) handler(error);
  }
}
