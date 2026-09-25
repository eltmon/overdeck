import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../../../lib/config-yaml.js';
import type { EmbeddingsDbHandle } from '../../../../lib/database/conversation-embeddings-db.js';
import type { ConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';
import { getConversationSearchHealth, resetConversationSearchHealthForTests } from '../../../../lib/conversation-search/health.js';
import { indexConversationSearch } from '../../../../lib/conversation-search/indexer.js';
import { ConversationDirectoryWatcher, isInterruptedPollError } from '../conversation-directory-watcher.js';
import { ConversationSearchWatcher, startConversationSearchWatcher, stopConversationSearchWatcher, syncConversationSearchWatcher, type ConversationSearchWatcherOptions } from '../conversation-search-watcher.js';

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

function transcriptLine(text: string): string {
  return `${JSON.stringify({ type: 'user', timestamp: '2026-09-24T11:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`;
}

/** In-memory embeddings DB: enough for the real indexer, with a spied cursor lookup. */
function memoryDb() {
  const cursors = new Map<string, number>();
  let rowid = 0;
  const db = {
    available: true,
    dimensions: 2,
    upsertChunk: () => { rowid += 1; return rowid; },
    upsertEmbedding: vi.fn(),
    getCursor: vi.fn((filePath: string) => cursors.get(filePath) ?? 0),
    setCursor: (filePath: string, offset: number) => { cursors.set(filePath, offset); },
    searchBm25: vi.fn(),
    searchVector: vi.fn(),
    getStats: vi.fn(() => ({ chunkCount: rowid, indexedFileCount: cursors.size, lastIndexedAt: null })),
    deleteSession: vi.fn(),
    listFileCursors: vi.fn(() => [...cursors.keys()]),
    deleteCursor: vi.fn((filePath: string) => { cursors.delete(filePath); }),
    close: vi.fn(),
  };
  return { db: db as unknown as EmbeddingsDbHandle, getCursor: db.getCursor, cursors };
}

function embeddedTexts(embed: ReturnType<typeof vi.fn>): string {
  return embed.mock.calls.flatMap((call) => call[0] as string[]).join('\n');
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
    expect(getConversationSearchHealth().lastErrorAt).toBeNull();
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

      watchers[0]!.emitError(new Error('Unable to poll: Bad file descriptor'));
      await vi.advanceTimersByTimeAsync(0);
      expect(watchers[0]!.close).toHaveBeenCalledTimes(1);
      expect(getConversationSearchHealth().watcher).toMatchObject({
        state: 'restarting',
        lastErrorReason: 'Unable to poll: Bad file descriptor',
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(watchFactory).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(watchFactory).toHaveBeenCalledTimes(2);
      expect(indexAll).toHaveBeenCalledTimes(2);
      expect(getConversationSearchHealth().watcher).toMatchObject({
        state: 'running',
        restarts: 1,
        lastErrorReason: 'Unable to poll: Bad file descriptor',
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

    it('backs off exponentially up to the cap, and resets only after a watcher stays up for the cap', async () => {
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

      // Events in between do not reset the backoff: the loop stays at the cap.
      watchers[4]!.emit('change', '/tmp/conversations/session-a.jsonl');
      watchers[4]!.emitError(new Error('flapping'));
      await vi.advanceTimersByTimeAsync(3_999);
      expect(watchFactory).toHaveBeenCalledTimes(5);
      await vi.advanceTimersByTimeAsync(1);
      expect(watchFactory).toHaveBeenCalledTimes(6);

      // A watcher that stayed up for a full cap starts the backoff over.
      await vi.advanceTimersByTimeAsync(4_000);
      watchers[5]!.emitError(new Error('after recovery'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(watchFactory).toHaveBeenCalledTimes(7);

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

      watchers[0]!.emitError(new Error('Unable to poll: Bad file descriptor'));
      await vi.advanceTimersByTimeAsync(1_000);

      const recovered = getConversationSearchHealth();
      expect(recovered.lastSuccessAt).not.toBeNull();
      expect(recovered.lastSuccessAt! > recovered.lastErrorAt!).toBe(true);

      await watcher.stop();
    });

    it('bounds the catch-up to files modified during the outage and leaves older files unread', async () => {
      const root = mkdtempSync(join(tmpdir(), 'pan-watcher-catchup-'));
      try {
        const projectDir = join(root, '-home-user-project');
        mkdirSync(projectDir);
        const oldFile = join(projectDir, '11111111-1111-4111-8111-111111111111.jsonl');
        const edgeFile = join(projectDir, '22222222-2222-4222-8222-222222222222.jsonl');
        const newFile = join(projectDir, '33333333-3333-4333-8333-333333333333.jsonl');
        writeFileSync(oldFile, transcriptLine('old conversation'));

        const errorAt = new Date('2026-09-24T12:00:00.000Z');
        vi.setSystemTime(errorAt);
        const { db, getCursor, cursors } = memoryDb();
        const embed = vi.fn(async (texts: string[]) => ({ embeddings: texts.map(() => new Float32Array([0.1, 0.2])), model: 'text-embedding-3-small' }));
        const provider = { provider: 'openai', model: 'text-embedding-3-small', enabled: true, estimateCost: vi.fn(), embed } as unknown as ConversationEmbeddingProvider;
        const runs: Array<Promise<unknown>> = [];
        const indexAll: NonNullable<ConversationSearchWatcherOptions['indexAll']> = (options) => {
          const run = indexConversationSearch({ ...options, db, provider });
          runs.push(run);
          return run;
        };
        const { watcher, watchers } = restartableWatcher({ roots: [root], indexAll });

        watcher.start();
        await runs[0];
        expect(cursors.get(oldFile)).toBe(statSync(oldFile).size);
        // The old transcript was last written an hour before the outage.
        const hourBefore = new Date(errorAt.getTime() - 3_600_000);
        utimesSync(oldFile, hourBefore, hourBefore);

        watchers[0]!.emitError(new Error('Unable to poll: Interrupted system call'));
        // Written while the watcher is dead: no event reaches the index.
        writeFileSync(newFile, transcriptLine('written during the outage'));
        const duringOutage = new Date(errorAt.getTime() + 500);
        utimesSync(newFile, duringOutage, duringOutage);
        // Written just before the error, inside the safety margin.
        writeFileSync(edgeFile, transcriptLine('written just before the error'));
        const justBefore = new Date(errorAt.getTime() - 3_000);
        utimesSync(edgeFile, justBefore, justBefore);
        getCursor.mockClear();
        embed.mockClear();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(runs).toHaveLength(2);
        await runs[1];

        expect(embeddedTexts(embed)).toContain('written during the outage');
        expect(embeddedTexts(embed)).toContain('written just before the error');
        expect(embeddedTexts(embed)).not.toContain('old conversation');
        expect(cursors.get(newFile)).toBe(statSync(newFile).size);
        // Skipped from its stat alone: not even the cursor lookup ran for it.
        expect(getCursor).not.toHaveBeenCalledWith(oldFile);

        await watcher.stop();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('passes the outage start minus a 5s margin to the catch-up, and nothing to the startup sweep', async () => {
      vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
      const { watcher, watchers, indexAll } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(indexAll.mock.calls[0]![0]).not.toHaveProperty('modifiedSince');

      const firstErrorAt = Date.now();
      watchers[0]!.emitError(new Error('first'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(indexAll).toHaveBeenLastCalledWith(expect.objectContaining({ modifiedSince: firstErrorAt - 5_000 }));

      // The next outage gets its own window, not the first one.
      await vi.advanceTimersByTimeAsync(500);
      const secondErrorAt = Date.now();
      watchers[1]!.emitError(new Error('second'));
      await vi.advanceTimersByTimeAsync(2_000);
      expect(indexAll).toHaveBeenCalledTimes(3);
      expect(indexAll).toHaveBeenLastCalledWith(expect.objectContaining({ modifiedSince: secondErrorAt - 5_000 }));

      await watcher.stop();
    });

    it('runs the catch-up after a sweep that was still running when the watcher restarted', async () => {
      let finishStartup!: (value: typeof EMPTY_INDEX_RESULT) => void;
      const indexAll = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => { finishStartup = resolve; }))
        .mockResolvedValue(EMPTY_INDEX_RESULT);
      const { watcher, watchers } = restartableWatcher({ indexAll });
      watcher.start();
      watchers[0]!.emitError(new Error('boom'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(indexAll).toHaveBeenCalledTimes(1);

      finishStartup(EMPTY_INDEX_RESULT);
      await vi.advanceTimersByTimeAsync(0);
      expect(indexAll).toHaveBeenCalledTimes(2);
      expect(indexAll).toHaveBeenLastCalledWith(expect.objectContaining({ modifiedSince: expect.any(Number) }));

      await watcher.stop();
    });

    it('trips the circuit breaker after 5 re-armed watchers fail in a row and stops restarting', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);

      // The first error plus 4 failed restarts: each re-arm is scheduled.
      for (const [attempt, delay] of [1_000, 2_000, 4_000, 4_000, 4_000].entries()) {
        watchers[attempt]!.emitError(new Error(`error ${attempt}`));
        await vi.advanceTimersByTimeAsync(delay);
        expect(watchFactory).toHaveBeenCalledTimes(attempt + 2);
      }
      expect(watcher.failed).toBe(false);

      // The 5th re-armed watcher fails too: no further restart.
      watchers[5]!.emitError(Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' }));
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(watchFactory).toHaveBeenCalledTimes(6);
      expect(watchers[5]!.close).toHaveBeenCalledTimes(1);
      expect(watcher.failed).toBe(true);
      const health = getConversationSearchHealth().watcher;
      expect(health).toMatchObject({ state: 'failed', restarts: 5, nextRestartAt: null });
      expect(health?.lastErrorReason).toContain('ENOSPC: System limit for number of file watchers reached');
      expect(health?.lastErrorReason).toContain('fs.inotify.max_user_watches');

      await watcher.stop();
    });

    it('a settings save replaces a watcher whose breaker tripped', async () => {
      const watchers: FakeWatcher[] = [];
      const options: ConversationSearchWatcherOptions = {
        config: config(),
        roots: ['/tmp/conversations'],
        watchFactory: vi.fn(() => {
          const fake = new FakeWatcher();
          watchers.push(fake);
          return fake;
        }),
        indexAll: vi.fn(async () => EMPTY_INDEX_RESULT),
        indexFile: vi.fn(async () => EMPTY_INDEX_RESULT),
        maxConsecutiveRestarts: 0,
        log: { log: vi.fn(), warn: vi.fn() },
      };
      const first = await syncConversationSearchWatcher(options);
      await vi.advanceTimersByTimeAsync(0);
      watchers[0]!.emitError(new Error('boom'));
      expect(first?.failed).toBe(true);
      expect(getConversationSearchHealth().watcher?.state).toBe('failed');

      const second = await syncConversationSearchWatcher(options);
      expect(second).not.toBe(first);
      expect(second?.failed).toBe(false);
      expect(watchers).toHaveLength(2);
      expect(getConversationSearchHealth().watcher).toMatchObject({ state: 'running', restarts: 0 });
      // A healthy watcher with the same settings is kept.
      expect(await syncConversationSearchWatcher(options)).toBe(second);
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
  describe('EINTR from the parcel inotify poll (PAN-4193)', () => {
    const eintr = () => new Error('Unable to poll: Interrupted system call');

    it('classifies the parcel poll EINTR as benign and nothing else', () => {
      expect(isInterruptedPollError(eintr())).toBe(true);
      expect(isInterruptedPollError(Object.assign(new Error('poll failed'), { code: 'EINTR' }))).toBe(true);
      expect(isInterruptedPollError(new Error('Unable to poll: Bad file descriptor'))).toBe(false);
      expect(isInterruptedPollError(Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' }))).toBe(false);
      expect(isInterruptedPollError('Interrupted system call')).toBe(false);
      expect(isInterruptedPollError(null)).toBe(false);
    });

    it('resubscribes after a fixed tick, runs a bounded catch-up each time, and never trips the breaker', async () => {
      vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
      const { watcher, watchers, watchFactory, indexAll } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);

      // Far past the 5-restart breaker, at a rate well under the per-minute cap.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const errorAt = Date.now();
        watchers[attempt]!.emitError(eintr());
        await vi.advanceTimersByTimeAsync(49);
        expect(watchers[attempt]!.close).toHaveBeenCalledTimes(1);
        expect(watchFactory).toHaveBeenCalledTimes(attempt + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(watchFactory).toHaveBeenCalledTimes(attempt + 2);
        expect(indexAll).toHaveBeenCalledTimes(attempt + 2);
        expect(indexAll).toHaveBeenLastCalledWith(expect.objectContaining({ modifiedSince: errorAt - 5_000 }));
        await vi.advanceTimersByTimeAsync(10_000);
      }

      expect(watcher.failed).toBe(false);
      expect(getConversationSearchHealth().watcher).toMatchObject({
        state: 'running',
        restarts: 40,
        lastErrorReason: 'Unable to poll: Interrupted system call',
        nextRestartAt: null,
      });

      await watcher.stop();
    });

    it('leaves the backoff state alone: a real error after EINTR resubscribes still sees the healthy window', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);

      watchers[0]!.emitError(new Error('real error'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(watchFactory).toHaveBeenCalledTimes(2);

      // Up for 4s in all, with an EINTR resubscribe partway through.
      await vi.advanceTimersByTimeAsync(3_000);
      watchers[1]!.emitError(eintr());
      await vi.advanceTimersByTimeAsync(50);
      expect(watchFactory).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(950);

      // The watcher stayed up for the full 4s cap, so the backoff starts over at 1s.
      watchers[2]!.emitError(new Error('another real error'));
      await vi.advanceTimersByTimeAsync(999);
      expect(watchFactory).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(watchFactory).toHaveBeenCalledTimes(4);

      await watcher.stop();
    });

    it('treats EINTR past 30 resubscribes a minute as a real failure and trips the breaker', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        watchers[attempt]!.emitError(eintr());
        await vi.advanceTimersByTimeAsync(50);
      }
      expect(watchFactory).toHaveBeenCalledTimes(31);

      // Over the cap: backoff and breaker, exactly as for any other error.
      for (const [step, delay] of [1_000, 2_000, 4_000, 4_000, 4_000].entries()) {
        const current = 30 + step;
        watchers[current]!.emitError(eintr());
        await vi.advanceTimersByTimeAsync(50);
        expect(watchFactory).toHaveBeenCalledTimes(current + 1);
        expect(getConversationSearchHealth().watcher?.state).toBe('restarting');
        await vi.advanceTimersByTimeAsync(delay - 50);
        expect(watchFactory).toHaveBeenCalledTimes(current + 2);
      }
      expect(watcher.failed).toBe(false);

      watchers[35]!.emitError(eintr());
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(watchFactory).toHaveBeenCalledTimes(36);
      expect(watcher.failed).toBe(true);
      expect(getConversationSearchHealth().watcher).toMatchObject({ state: 'failed', nextRestartAt: null });

      await watcher.stop();
    });

    it('a cap of 0 sends EINTR down the regular backoff path', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher({ maxInterruptedResubscribesPerMinute: 0 });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);

      watchers[0]!.emitError(eintr());
      await vi.advanceTimersByTimeAsync(999);
      expect(watchFactory).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(watchFactory).toHaveBeenCalledTimes(2);

      await watcher.stop();
    });

    it('stop() cancels a pending EINTR resubscribe', async () => {
      const { watcher, watchers, watchFactory } = restartableWatcher();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      watchers[0]!.emitError(eintr());

      await watcher.stop();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(watchFactory).toHaveBeenCalledTimes(1);
      expect(getConversationSearchHealth().watcher).toBeNull();
    });
  });
});
