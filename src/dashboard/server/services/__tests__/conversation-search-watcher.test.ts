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
  });

  afterEach(async () => {
    await stopConversationSearchWatcher();
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

    expect(indexAll).toHaveBeenCalledWith({ config: config(), roots: ['/tmp/conversations'] });
    expect(indexFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(indexFile).toHaveBeenCalledTimes(1);
    expect(indexFile).toHaveBeenCalledWith({ filePath: '/tmp/conversations/session-a.jsonl', config: config() });
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
