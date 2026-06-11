import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../../../lib/config-yaml.js';
import { ConversationSearchWatcher, startConversationSearchWatcher, stopConversationSearchWatcher } from '../conversation-search-watcher.js';

class FakeWatcher {
  handlers = new Map<string, Array<(arg: string) => void>>();
  close = vi.fn(async () => undefined);

  on(event: 'add' | 'change' | 'error', callback: (arg: string) => void): this {
    const existing = this.handlers.get(event) ?? [];
    existing.push(callback);
    this.handlers.set(event, existing);
    return this;
  }

  emit(event: 'add' | 'change', filePath: string): void {
    for (const handler of this.handlers.get(event) ?? []) handler(filePath);
  }
}

function config(overrides: Partial<NormalizedConversationSearchConfig> = {}): NormalizedConversationSearchConfig {
  return {
    enabled: true,
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKeyRef: undefined,
    dbPath: '/tmp/embeddings.db',
    ...overrides,
  };
}

describe('conversation search watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  });

  afterEach(async () => {
    await stopConversationSearchWatcher();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces JSONL changes into incremental index calls after startup scan', async () => {
    const fakeWatcher = new FakeWatcher();
    const indexAll = vi.fn(async () => ({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, errors: [], disabled: false }));
    const indexFile = vi.fn(async () => ({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, errors: [], disabled: false }));
    const watcher = new ConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      debounceMs: 25,
      watchFactory: vi.fn(() => fakeWatcher),
      indexAll,
      indexFile,
      log: { log: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    fakeWatcher.emit('change', '/tmp/conversations/session-a.jsonl');
    fakeWatcher.emit('change', '/tmp/conversations/session-a.jsonl');
    await vi.advanceTimersByTimeAsync(24);

    expect(indexAll).toHaveBeenCalledWith(expect.objectContaining({ config: config(), roots: ['/tmp/conversations'] }));
    expect(indexFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(indexFile).toHaveBeenCalledTimes(1);
    expect(indexFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/conversations/session-a.jsonl', config: config() }));
  });

  it('coalesces changes for a file while an index call is already in flight', async () => {
    const fakeWatcher = new FakeWatcher();
    let resolveFirst!: (value: { filesScanned: number; filesIndexed: number; chunksIndexed: number; chunksSkipped: number; errors: []; disabled: false }) => void;
    const firstResult = new Promise<{ filesScanned: number; filesIndexed: number; chunksIndexed: number; chunksSkipped: number; errors: []; disabled: false }>((resolve) => {
      resolveFirst = resolve;
    });
    const indexFile = vi
      .fn()
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValue({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, errors: [], disabled: false });
    const watcher = new ConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      debounceMs: 25,
      watchFactory: vi.fn(() => fakeWatcher),
      indexAll: vi.fn(async () => ({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, errors: [], disabled: false })),
      indexFile,
      maxConcurrentIndexers: 1,
      log: { log: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    fakeWatcher.emit('change', '/tmp/conversations/session-a.jsonl');
    await vi.advanceTimersByTimeAsync(25);
    expect(indexFile).toHaveBeenCalledTimes(1);

    fakeWatcher.emit('change', '/tmp/conversations/session-a.jsonl');
    await vi.advanceTimersByTimeAsync(25);
    expect(indexFile).toHaveBeenCalledTimes(1);

    resolveFirst({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, errors: [], disabled: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(indexFile).toHaveBeenCalledTimes(2);
  });

  it('aborts and awaits startup indexing when stopped', async () => {
    const fakeWatcher = new FakeWatcher();
    let startupSignal: AbortSignal | undefined;
    const indexAll = vi.fn(({ signal }: { signal?: AbortSignal }) => {
      startupSignal = signal;
      return new Promise<{ filesScanned: number; filesIndexed: number; chunksIndexed: number; chunksSkipped: number; errors: []; disabled: false }>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, errors: [], disabled: false }), { once: true });
      });
    });
    const watcher = new ConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      watchFactory: vi.fn(() => fakeWatcher),
      indexAll,
      indexFile: vi.fn(),
      log: { log: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    await watcher.stop();

    expect(startupSignal?.aborted).toBe(true);
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  it('does not start while disabled and closes the active watcher on shutdown', async () => {
    const fakeWatcher = new FakeWatcher();
    const watchFactory = vi.fn(() => fakeWatcher);
    const disabled = startConversationSearchWatcher({
      config: config({ enabled: false }),
      roots: ['/tmp/conversations'],
      watchFactory,
      log: { log: vi.fn(), warn: vi.fn() },
    });

    expect(disabled).toBeNull();
    expect(watchFactory).not.toHaveBeenCalled();

    const active = startConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      watchFactory,
      indexAll: vi.fn(async () => ({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, errors: [], disabled: false })),
      indexFile: vi.fn(),
      log: { log: vi.fn(), warn: vi.fn() },
    });

    expect(active).not.toBeNull();
    await stopConversationSearchWatcher();

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });
});
