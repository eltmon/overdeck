import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Stream } from 'effect';
import type { ConversationEvent } from '@overdeck/contracts';
import type { ParseResult } from '../conversation/types.js';

const mocks = vi.hoisted(() => ({
  watch: vi.fn(), close: vi.fn(), stat: vi.fn(), stopPoller: vi.fn(), refresh: vi.fn(), startPoller: vi.fn(),
}));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), watch: mocks.watch }));
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), stat: mocks.stat }));
vi.mock('../conversation/subagents.js', () => ({ startSubagentListPolling: mocks.startPoller }));
vi.mock('../conversation/codex-subagents.js', () => ({ listCodexSubagents: vi.fn() }));
import { streamResolvedFullParseSnapshots } from '../full-parse-stream.js';

const parsed = (text = 'Hello'): ParseResult => ({
  messages: [{ id: 'user', role: 'user', text, createdAt: '2026-09-09' }], workLog: [],
  streaming: false, totalCost: 0, totalTokens: 0, byteOffset: 100, mtimeMs: 1,
  latestAssistantUsage: null, contextBoundaryOffset: 0, contextActiveBytes: 100,
  pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 1,
});
let change: (event: string, filename: string) => void;
let controller: AbortController;
let running: Promise<unknown>;
let events: ConversationEvent[];
const flush = () => vi.advanceTimersByTimeAsync(0);
const start = (parse: (path: string) => Promise<ParseResult>, resolve = async () => '/tmp/rollout.jsonl', subagents = false) => {
  controller = new AbortController();
  events = [];
  running = Effect.runPromise(streamResolvedFullParseSnapshots(resolve, parse, null, false, subagents).pipe(
    Stream.runForEach(event => Effect.sync(() => { events.push(event); })),
  ), { signal: controller.signal }).catch(() => {});
};
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.watch.mockImplementation((_path, cb) => { change = cb; return { close: mocks.close }; });
  mocks.stat.mockResolvedValue({ dev: 1, ino: 2, size: 100, mtimeMs: 1 });
  mocks.startPoller.mockResolvedValue({ stop: mocks.stopPoller, refresh: mocks.refresh });
});
afterEach(async () => { controller?.abort(); await flush(); await running; vi.useRealTimers(); });

describe('full parser stream lifecycle', () => {
  it('coalesces file events, suppresses unchanged history, and cleans the watcher and subagent poller', async () => {
    const parse = vi.fn(async () => parsed());
    start(parse, undefined, true);
    await flush();
    expect(events).toHaveLength(1);
    expect(mocks.watch).toHaveBeenCalledWith('/tmp', expect.any(Function));
    change('change', 'unrelated.jsonl');
    await vi.advanceTimersByTimeAsync(300);
    expect(parse).toHaveBeenCalledTimes(1);
    change('change', 'rollout.jsonl'); change('change', 'rollout.jsonl');
    await vi.advanceTimersByTimeAsync(300);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    change('change', 'rollout.jsonl');
    controller.abort(); await flush(); await running;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.stopPoller).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('watches replacement files and emits a reset that can clear shorter cached history', async () => {
    const parse = vi.fn(async () => parsed());
    start(parse); await flush();
    mocks.stat.mockResolvedValue({ dev: 1, ino: 3, size: 0, mtimeMs: 2 });
    parse.mockResolvedValue({ ...parsed(), messages: [] });
    change('rename', 'rollout.jsonl'); await vi.advanceTimersByTimeAsync(300);
    expect(events[1]).toMatchObject({ snapshot: true, reset: true, messages: [] });
    mocks.stat.mockResolvedValue({ dev: 1, ino: 3, size: 100, mtimeMs: 3 });
    parse.mockResolvedValue(parsed('New'));
    change('change', 'rollout.jsonl'); await vi.advanceTimersByTimeAsync(300);
    expect(events[2]).toMatchObject({ snapshot: false, messages: [{ text: 'New' }] });
  });

  it('retries an append that arrives during parsing before emitting the next delta', async () => {
    let finish!: (result: ParseResult) => void;
    const parse = vi.fn<() => Promise<ParseResult>>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(parsed('Updated'));
    start(parse); await flush();
    change('change', 'rollout.jsonl'); await vi.advanceTimersByTimeAsync(300);
    finish(parsed()); await flush();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ snapshot: false, messages: [{ text: 'Updated' }] });
  });
  it('closes the watcher immediately when disconnected during the initial parse', async () => {
    let finish!: (result: ParseResult) => void;
    start(() => new Promise(resolve => { finish = resolve; }));
    await flush();
    controller.abort(); await flush(); await running;
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    finish(parsed()); await flush();
    expect(events).toEqual([]);
  });

});
