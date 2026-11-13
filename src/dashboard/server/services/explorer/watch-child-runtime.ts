/**
 * Explorer watcher child logic (PAN-5183, FR-3, D-5).
 *
 * Runs inside the forked `explorer-watch-child.js`, never in the dashboard
 * process: @parcel/watcher froze the dashboard when it shared a process
 * with child-process spawning (SIGCHLD, PAN-4193). For the same reason this
 * code never spawns a process. Every dependency is injected so tests drive
 * it with fakes; `watch-child.ts` wires in the real process and parcel.
 */
import { relative, sep } from 'node:path';
import type { AsyncSubscription, Event, Options, subscribe as parcelSubscribe } from '@parcel/watcher';
import { createWatchBatcher, type RawWatchEvent, type WatchBatcher } from './watch-batch.js';
import { buildWatchOptions } from './watch-ignore.js';
import { WATCH_CHILD_BACKEND_DEATH_EXIT, type ChildToSupervisor, type SupervisorToChild } from './watch-protocol.js';

export const WATCH_CHILD_HEARTBEAT_MS = 5000;

export interface WatchChildDeps {
  subscribe: typeof parcelSubscribe;
  send(msg: ChildToSupervisor): void;
  onMessage(cb: (msg: SupervisorToChild) => void): void;
  onDisconnect(cb: () => void): void;
  exit(code: number): void;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now: () => number;
  platform: NodeJS.Platform;
}

interface WatchedRoot {
  batcher: WatchBatcher;
  subscription: AsyncSubscription | null;
  /** Set by unwatch; a subscribe that resolves afterwards is dropped at once. */
  closed: boolean;
}

function backendFor(platform: NodeJS.Platform): Options['backend'] | undefined {
  if (platform === 'linux') return 'inotify';
  if (platform === 'darwin') return 'fs-events';
  if (platform === 'win32') return 'windows';
  return undefined;
}

function toRelative(absPath: string, eventPath: string): string | null {
  const rel = relative(absPath, eventPath).split(sep).join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../')) return null;
  return rel;
}

export function runWatchChild(deps: WatchChildDeps): void {
  const roots = new Map<string, WatchedRoot>();

  const heartbeat = deps.setInterval(() => deps.send({ type: 'heartbeat' }), WATCH_CHILD_HEARTBEAT_MS);

  // A dead dashboard must never leave an orphan child.
  deps.onDisconnect(() => {
    deps.clearInterval(heartbeat);
    deps.exit(0);
  });

  const watch = async (rootId: string, absPath: string, topLevelDirs: string[]) => {
    if (roots.has(rootId)) return;
    const root: WatchedRoot = {
      batcher: createWatchBatcher({
        flush: (events) => deps.send({ type: 'events', rootId, events }),
        now: deps.now,
        setTimeout: deps.setTimeout,
        clearTimeout: deps.clearTimeout,
      }),
      subscription: null,
      closed: false,
    };
    roots.set(rootId, root);

    const backend = backendFor(deps.platform);
    const options = { ...buildWatchOptions(topLevelDirs, deps.platform), ...(backend ? { backend } : {}) } as Options;
    const callback = (err: Error | null, events: Event[]) => {
      if (root.closed) return;
      if (err) {
        deps.send({ type: 'error', rootId, message: String(err) });
        deps.exit(WATCH_CHILD_BACKEND_DEATH_EXIT);
        return;
      }
      const raw: RawWatchEvent[] = [];
      for (const e of events) {
        const path = toRelative(absPath, e.path);
        if (path !== null) raw.push({ type: e.type, path });
      }
      if (raw.length > 0) root.batcher.push(raw);
    };

    try {
      const subscription = await deps.subscribe(absPath, callback, options);
      if (root.closed) {
        await subscription.unsubscribe().catch(() => {});
        return;
      }
      root.subscription = subscription;
    } catch (error) {
      root.batcher.dispose();
      if (roots.get(rootId) === root) roots.delete(rootId);
      if (!root.closed) {
        deps.send({ type: 'watch-failed', rootId, message: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  const unwatch = async (rootId: string) => {
    const root = roots.get(rootId);
    if (!root) return;
    roots.delete(rootId);
    root.closed = true;
    root.batcher.dispose();
    await root.subscription?.unsubscribe().catch(() => {});
  };

  deps.onMessage((msg) => {
    if (msg.type === 'watch') void watch(msg.rootId, msg.absPath, msg.topLevelDirs);
    else if (msg.type === 'unwatch') void unwatch(msg.rootId);
  });
}
