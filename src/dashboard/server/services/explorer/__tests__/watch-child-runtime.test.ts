import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AsyncSubscription, Event, Options, SubscribeCallback } from '@parcel/watcher';
import { runWatchChild, type WatchChildDeps } from '../watch-child-runtime.js';
import type { ChildToSupervisor, SupervisorToChild } from '../watch-protocol.js';

const ROOT = '/repo/root';

interface Harness {
  sent: ChildToSupervisor[];
  exit: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  deliver(msg: SupervisorToChild): void;
  disconnect(): void;
  callback(): SubscribeCallback;
}

function start(opts: { rejectSubscribe?: boolean } = {}): Harness {
  const sent: ChildToSupervisor[] = [];
  let onMessage: (msg: SupervisorToChild) => void = () => {};
  let onDisconnect: () => void = () => {};
  let lastCallback: SubscribeCallback | null = null;
  const unsubscribe = vi.fn(async () => {});
  const subscribe = vi.fn(async (_dir: string, cb: SubscribeCallback, _options?: Options): Promise<AsyncSubscription> => {
    lastCallback = cb;
    if (opts.rejectSubscribe) throw new Error('inotify limit reached');
    return { unsubscribe };
  });
  const exit = vi.fn();
  const deps: WatchChildDeps = {
    subscribe: subscribe as unknown as WatchChildDeps['subscribe'],
    send: (msg) => sent.push(msg),
    onMessage: (cb) => {
      onMessage = cb;
    },
    onDisconnect: (cb) => {
      onDisconnect = cb;
    },
    exit,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    now: Date.now,
    platform: 'linux',
  };
  runWatchChild(deps);
  return {
    sent,
    exit,
    subscribe,
    unsubscribe,
    deliver: (msg) => onMessage(msg),
    disconnect: () => onDisconnect(),
    callback: () => lastCallback!,
  };
}

const watchMsg: SupervisorToChild = { type: 'watch', rootId: 'issue:PAN-1', absPath: ROOT, topLevelDirs: ['workspaces'] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runWatchChild', () => {
  it('subscribes with the root path, the platform backend and ignore regexes', async () => {
    const h = start();
    h.deliver(watchMsg);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    const [dir, , options] = h.subscribe.mock.calls[0]!;
    expect(dir).toBe(ROOT);
    expect(options).toMatchObject({ backend: 'inotify' });
    expect((options as { ignoreGlobs?: unknown }).ignoreGlobs).toEqual(expect.any(Array));
    expect((options as { ignoreGlobs: string[] }).ignoreGlobs).toHaveLength(2);
  });

  it('ignores a second watch of the same root', async () => {
    const h = start();
    h.deliver(watchMsg);
    h.deliver(watchMsg);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
  });

  it('sends batched root-relative events after 75 ms', async () => {
    const h = start();
    h.deliver(watchMsg);
    await vi.advanceTimersByTimeAsync(0);
    const events: Event[] = [
      { type: 'create', path: join(ROOT, 'src', 'a.ts') },
      { type: 'update', path: join(ROOT, 'b.txt') },
      { type: 'update', path: '/elsewhere/c.txt' },
      { type: 'update', path: ROOT },
    ];
    h.callback()(null, events);
    await vi.advanceTimersByTimeAsync(74);
    expect(h.sent.filter((m) => m.type === 'events')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent.filter((m) => m.type === 'events')).toEqual([
      {
        type: 'events',
        rootId: 'issue:PAN-1',
        events: [
          { kind: 'create', path: 'src/a.ts' },
          { kind: 'update', path: 'b.txt' },
        ],
      },
    ]);
  });

  it('reports a backend error and exits with code 3', async () => {
    const h = start();
    h.deliver(watchMsg);
    await vi.advanceTimersByTimeAsync(0);
    h.callback()(new Error('inotify backend died'), []);
    expect(h.sent).toContainEqual({ type: 'error', rootId: 'issue:PAN-1', message: 'Error: inotify backend died' });
    expect(h.exit).toHaveBeenCalledWith(3);
  });

  it('reports a failed subscribe and stays up', async () => {
    const h = start({ rejectSubscribe: true });
    h.deliver(watchMsg);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toContainEqual({ type: 'watch-failed', rootId: 'issue:PAN-1', message: 'inotify limit reached' });
    expect(h.exit).not.toHaveBeenCalled();
  });

  it('sends a heartbeat every 5 s', async () => {
    const h = start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.sent.filter((m) => m.type === 'heartbeat')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent.filter((m) => m.type === 'heartbeat')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sent.filter((m) => m.type === 'heartbeat')).toHaveLength(3);
  });

  it('exits with code 0 when the IPC channel disconnects', () => {
    const h = start();
    h.disconnect();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('unsubscribes on unwatch and drops later events', async () => {
    const h = start();
    h.deliver(watchMsg);
    await vi.advanceTimersByTimeAsync(0);
    const cb = h.callback();
    h.deliver({ type: 'unwatch', rootId: 'issue:PAN-1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    cb(null, [{ type: 'create', path: join(ROOT, 'late.txt') }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.sent.filter((m) => m.type === 'events')).toEqual([]);
  });
});
