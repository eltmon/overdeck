import parcelWatcher from '@parcel/watcher';

export type ConversationWatchEvent = 'add' | 'change' | 'unlink';

type FileHandler = (filePath: string) => void;
type ErrorHandler = (error: unknown) => void;
type Subscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>;

/**
 * Watch conversation trees through one native recursive subscription per root.
 *
 * Node's fs.watch/chokidar implementations retain one FSEventWrap per watched
 * path on Linux. The transcript tree contains thousands of historical
 * directories, so even directory-only fs.watch recursion retained more than a
 * gigabyte of native watcher state. Parcel's native backend keeps recursive
 * watch bookkeeping outside Node's per-path FSWatcher objects.
 */
export class ConversationDirectoryWatcher {
  readonly ready: Promise<void>;
  private readonly subscriptions = new Set<Subscription>();
  private readonly fileHandlers = new Map<ConversationWatchEvent, FileHandler[]>();
  private readonly errorHandlers: ErrorHandler[] = [];
  private stopped = false;

  constructor(roots: readonly string[]) {
    this.ready = Promise.all(roots.map(root => this.subscribe(root))).then(() => undefined);
  }

  get activeSubscriptionCount(): number {
    return this.subscriptions.size;
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
    await this.ready.catch(() => undefined);
    const subscriptions = [...this.subscriptions];
    this.subscriptions.clear();
    await Promise.allSettled(subscriptions.map(subscription => subscription.unsubscribe()));
  }

  private async subscribe(root: string): Promise<void> {
    try {
      const subscription = await parcelWatcher.subscribe(root, (error, events) => {
        if (this.stopped) return;
        if (error) {
          this.emitError(error);
          return;
        }
        for (const event of events) {
          if (!event.path.endsWith('.jsonl')) continue;
          if (event.type === 'create') this.emitFile('add', event.path);
          else if (event.type === 'update') this.emitFile('change', event.path);
          else this.emitFile('unlink', event.path);
        }
      });
      if (this.stopped) {
        await subscription.unsubscribe();
      } else {
        this.subscriptions.add(subscription);
      }
    } catch (error) {
      if (!this.stopped) this.emitError(error);
    }
  }

  private emitFile(event: ConversationWatchEvent, filePath: string): void {
    for (const handler of this.fileHandlers.get(event) ?? []) handler(filePath);
  }

  private emitError(error: unknown): void {
    for (const handler of this.errorHandlers) handler(error);
  }
}
