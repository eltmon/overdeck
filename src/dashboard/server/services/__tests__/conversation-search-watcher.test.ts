import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../../../lib/config-yaml.js';
import { getConversationSearchHealth, resetConversationSearchHealthForTests } from '../../../../lib/conversation-search/health.js';
import { ConversationDirectoryWatcher } from '../conversation-directory-watcher.js';
import { ConversationSearchWatcher, startConversationSearchWatcher, stopConversationSearchWatcher, type ConversationSearchWatcherOptions } from '../conversation-search-watcher.js';

class FakeWatcher {
  handlers = new Map<string, Array<(arg: string) => void>>();
  close = vi.fn(async () => undefined);

  on(event: 'add' | 'change' | 'unlink' | 'error', callback: (arg: string) => void): this {
    const existing = this.handlers.get(event) ?? [];
    existing.push(callback);
    this.handlers.set(event, existing);
    return this;
  }

  emit(event: 'add' | 'change' | 'unlink', filePath: string): void {
    for (const handler of this.handlers.get(event) ?? []) handler(filePath);
  }

  emitError(error: unknown): void {
    for (const handler of this.handlers.get('error') ?? []) (handler as (arg: unknown) => void)(error);
  }
}

const EMPTY_INDEX_RESULT = { filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false };

function restartableWatcher(overrides: ConversationSearchWatcherOptions = {}) {
  const watchers: FakeWatcher[] = [];
  const watchFactory = vi.fn(() => {
    const fake = new FakeWatcher();
    watchers.push(fake);
    return fake;
  });
  const indexAll = vi.fn(async () => EMPTY_INDEX_RESULT);
  const indexFile = vi.fn(async () => ({ ...EMPTY_INDEX_RESULT, filesScanned: 1 }));
  const watcher = new ConversationSearchWatcher({
    config: config(),
    roots: ['/tmp/conversations'],
    debounceMs: 25,
    watchFactory,
    indexAll,
    indexFile,
    removeFile: vi.fn(async () => undefined),
    restartBaseDelayMs: 1_000,
    restartMaxDelayMs: 4_000,
    log: { log: vi.fn(), warn: vi.fn() },
    ...overrides,
  });
  return { watcher, watchers, watchFactory, indexAll, indexFile };
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
    resetConversationSearchHealthForTests();
    vi.useFakeTimers();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  });

  afterEach(async () => {
    await stopConversationSearchWatcher();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetConversationSearchHealthForTests();
  });

  it('debounces JSONL changes into incremental index calls after startup scan', async () => {
    const fakeWatcher = new FakeWatcher();
    const indexAll = vi.fn(async () => ({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false }));
    const indexFile = vi.fn(async () => ({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false }));
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
    let resolveFirst!: (value: { filesScanned: number; filesIndexed: number; chunksIndexed: number; chunksSkipped: number; sessionsPruned: number; errors: []; disabled: false }) => void;
    const firstResult = new Promise<{ filesScanned: number; filesIndexed: number; chunksIndexed: number; chunksSkipped: number; sessionsPruned: number; errors: []; disabled: false }>((resolve) => {
      resolveFirst = resolve;
    });
    const indexFile = vi
      .fn()
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValue({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false });
    const watcher = new ConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      debounceMs: 25,
      watchFactory: vi.fn(() => fakeWatcher),
      indexAll: vi.fn(async () => ({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false })),
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

    resolveFirst({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(indexFile).toHaveBeenCalledTimes(2);
  });

  it('prunes the index when a watched JSONL file is deleted', async () => {
    const fakeWatcher = new FakeWatcher();
    const removeFile = vi.fn(async () => undefined);
    const indexFile = vi.fn(async () => ({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 1, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false }));
    const watcher = new ConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      debounceMs: 25,
      watchFactory: vi.fn(() => fakeWatcher),
      indexAll: vi.fn(async () => ({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false })),
      indexFile,
      removeFile,
      log: { log: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    // A change lands first and sits in the debounce window; the delete must cancel it.
    fakeWatcher.emit('change', '/tmp/conversations/session-a.jsonl');
    fakeWatcher.emit('unlink', '/tmp/conversations/session-a.jsonl');
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await Promise.resolve();

    expect(removeFile).toHaveBeenCalledTimes(1);
    expect(removeFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/conversations/session-a.jsonl', config: config() }));
    expect(indexFile).not.toHaveBeenCalled();
  });

  it('treats a transcript deleted mid-index as a skip, not a search failure (PAN-3915)', async () => {
    const fakeWatcher = new FakeWatcher();
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, stat '/tmp/conversations/session-a.jsonl'"), { code: 'ENOENT' });
    const indexFile = vi.fn(async () => { throw enoent; });
    const log = { log: vi.fn(), warn: vi.fn() };
    const watcher = new ConversationSearchWatcher({
      config: config(),
      roots: ['/tmp/conversations'],
      debounceMs: 25,
      watchFactory: vi.fn(() => fakeWatcher),
      indexAll: vi.fn(async () => ({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false })),
      indexFile,
      removeFile: vi.fn(async () => undefined),
      log,
    });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    const healthBefore = getConversationSearchHealth();
    fakeWatcher.emit('add', '/tmp/conversations/session-a.jsonl');
    await vi.advanceTimersByTimeAsync(25);

    expect(indexFile).toHaveBeenCalledTimes(1);
    expect(getConversationSearchHealth().lastErrorAt).toBe(healthBefore.lastErrorAt);
    expect(getConversationSearchHealth().lastErrorAt).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('aborts and awaits startup indexing when stopped', async () => {
    const fakeWatcher = new FakeWatcher();
    let startupSignal: AbortSignal | undefined;
    const indexAll = vi.fn(({ signal }: { signal?: AbortSignal }) => {
      startupSignal = signal;
      return new Promise<{ filesScanned: number; filesIndexed: number; chunksIndexed: number; chunksSkipped: number; sessionsPruned: number; errors: []; disabled: false }>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false }), { once: true });
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

  it('uses one native recursive subscription per root instead of one watcher per path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'overdeck-conversation-watch-'));
    const nested = join(root, 'session', 'subagents');
    mkdirSync(nested, { recursive: true });
    for (let index = 0; index < 100; index += 1) {
      writeFileSync(join(nested, `agent-${index}.jsonl`), '{}\n');
      writeFileSync(join(nested, `metadata-${index}.json`), '{}\n');
    }

    const watcher = new ConversationDirectoryWatcher([root]);
    try {
      await watcher.ready;
      expect(watcher.activeSubscriptionCount).toBe(1);
      await watcher.close();
      expect(watcher.activeSubscriptionCount).toBe(0);
    } finally {
      await watcher.close();
      rmSync(root, { recursive: true, force: true });
    }
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
      indexAll: vi.fn(async () => ({ filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false })),
      indexFile: vi.fn(),
      log: { log: vi.fn(), warn: vi.fn() },
    });

    expect(active).not.toBeNull();
    await stopConversationSearchWatcher();

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  describe('watcher restart after an error (PAN-3915)', () => {
    it('closes the failed watcher, re-arms it after the backoff, and runs a catch-up index', async () => {
      const { watcher, watchers, watchFactory, indexAll } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(getConversationSearchHealth().watcher).toMatchObject({ state: 'running', restarts: 0 });

      watchers[0]!.emitError(new Error('Unable to poll: Interrupted system call'));
      await vi.advanceTimersByTimeAsync(0);
      expect(watchers[0]!.close).toHaveBeenCalledTimes(1);
      expect(getConversationSearchHealth().watcher).toMatchObject({
        state: 'restarting',
        lastErrorReason: 'Unable to poll: Interrupted system call',
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(watchFactory).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(watchFactory).toHaveBeenCalledTimes(2);
      expect(indexAll).toHaveBeenCalledTimes(2);
      expect(getConversationSearchHealth().watcher).toMatchObject({
        state: 'running',
        restarts: 1,
        lastErrorReason: 'Unable to poll: Interrupted system call',
        nextRestartAt: null,
      });

      await watcher.stop();
    });

    it('re-armed watcher delivers events; errors from the closed watcher are ignored', async () => {
      const { watcher, watchers, watchFactory, indexFile } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      watchers[0]!.emitError(new Error('boom'));
      await vi.advanceTimersByTimeAsync(1_000);

      watchers[0]!.emitError(new Error('late error from the old watcher'));
      watchers[0]!.emit('change', '/tmp/conversations/old.jsonl');
      watchers[1]!.emit('change', '/tmp/conversations/session-a.jsonl');
      await vi.advanceTimersByTimeAsync(25);

      expect(watchFactory).toHaveBeenCalledTimes(2);
      expect(getConversationSearchHealth().watcher?.state).toBe('running');
      expect(indexFile).toHaveBeenCalledTimes(1);
      expect(indexFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/conversations/session-a.jsonl' }));

      await watcher.stop();
    });

    it('backs off exponentially up to the cap, and a delivered event resets the backoff', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);

      const expectedDelays = [1_000, 2_000, 4_000, 4_000];
      for (const [attempt, delay] of expectedDelays.entries()) {
        watchers[attempt]!.emitError(new Error(`error ${attempt}`));
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(watchFactory).toHaveBeenCalledTimes(attempt + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(watchFactory).toHaveBeenCalledTimes(attempt + 2);
      }

      watchers[4]!.emit('change', '/tmp/conversations/session-a.jsonl');
      watchers[4]!.emitError(new Error('after recovery'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(watchFactory).toHaveBeenCalledTimes(6);

      await watcher.stop();
    });

    it('clears a stale failure once the catch-up index after a restart succeeds', async () => {
      const indexAll = vi
        .fn()
        .mockResolvedValueOnce({ ...EMPTY_INDEX_RESULT, filesScanned: 1, errors: [{ filePath: '/tmp/conversations/a.jsonl', message: 'network down' }] })
        .mockResolvedValue(EMPTY_INDEX_RESULT);
      const { watcher, watchers } = restartableWatcher({ indexAll });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      const failing = getConversationSearchHealth();
      expect(failing.lastErrorReason).toBe('network down');
      expect(failing.lastSuccessAt).toBeNull();

      watchers[0]!.emitError(new Error('Unable to poll: Interrupted system call'));
      await vi.advanceTimersByTimeAsync(1_000);

      const recovered = getConversationSearchHealth();
      expect(recovered.lastSuccessAt).not.toBeNull();
      expect(recovered.lastSuccessAt! > recovered.lastErrorAt!).toBe(true);

      await watcher.stop();
    });

    it('stop() cancels a pending restart and clears the watcher health', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      watchers[0]!.emitError(new Error('boom'));

      await watcher.stop();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(watchFactory).toHaveBeenCalledTimes(1);
      expect(getConversationSearchHealth().watcher).toBeNull();
    });
  });
});
