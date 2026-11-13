import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerWatchEvent } from '@overdeck/contracts';
import {
  createExternalChangeController,
  DELETE_WINDOW_MS,
  REREAD_DELAY_MS,
  type DiskRead,
  type ExternalChangeState,
} from '../external-change';

function harness(opts: { dirty?: boolean; base?: string } = {}) {
  const state = {
    path: 'src/a.ts',
    base: opts.base ?? 'base-sig',
    dirty: opts.dirty ?? false,
    inFlight: false,
    disk: { missing: false, text: 'disk text', signature: 'disk-sig' } as DiskRead,
    selfWrites: new Set<string>(),
    idle: Promise.resolve(),
  };
  const reloads: Array<{ text: string; signature: string }> = [];
  const states: ExternalChangeState[] = [];
  const reread = vi.fn(async () => state.disk);
  const controller = createExternalChangeController({
    getPath: () => state.path,
    getBaseSignature: () => state.base,
    isDirty: () => state.dirty,
    isSaveInFlight: () => state.inFlight,
    whenSaveIdle: () => state.idle,
    reread,
    isSelfWrite: (signature) => state.selfWrites.has(signature),
    reload: (read) => reloads.push(read),
    setState: (s) => states.push(s),
  });
  return { controller, state, reloads, states, reread };
}

const ev = (kind: ExplorerWatchEvent['kind'], path: string, extra: Partial<ExplorerWatchEvent> = {}): ExplorerWatchEvent => ({
  kind,
  path,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('updates', () => {
  it('reloads a clean pane once, 250 ms after updates for its path', async () => {
    const { controller, reloads, reread } = harness();
    controller.handle([ev('update', 'src/a.ts')]);
    controller.handle([ev('update', 'src/a.ts'), ev('update', 'src/other.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS - 1);
    expect(reread).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reread).toHaveBeenCalledTimes(1);
    expect(reloads).toEqual([{ text: 'disk text', signature: 'disk-sig' }]);
  });

  it('marks a dirty pane changed with the disk text and signature', async () => {
    const { controller, reloads, states } = harness({ dirty: true });
    controller.handle([ev('update', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS);
    expect(reloads).toEqual([]);
    expect(states).toEqual([{ kind: 'changed', diskText: 'disk text', diskSignature: 'disk-sig' }]);
  });

  it('ignores events for other paths', async () => {
    const { controller, reread } = harness();
    controller.handle([ev('update', 'src/b.ts'), ev('create', 'src/c.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS * 4);
    expect(reread).not.toHaveBeenCalled();
  });

  it('does nothing when disk holds the base signature or a recent self-write', async () => {
    const { controller, state, reloads, states } = harness({ dirty: true });
    state.disk = { missing: false, text: 'x', signature: 'base-sig' };
    controller.handle([ev('update', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS);
    state.disk = { missing: false, text: 'y', signature: 'mine' };
    state.selfWrites.add('mine');
    controller.handle([ev('update', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS);
    expect(reloads).toEqual([]);
    expect(states).toEqual([]);
  });

  it('waits for an in-flight save before re-reading', async () => {
    const { controller, state, reread, reloads } = harness();
    let settle!: () => void;
    state.inFlight = true;
    state.idle = new Promise<void>((resolve) => {
      settle = resolve;
    });
    controller.handle([ev('update', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS * 4);
    expect(reread).not.toHaveBeenCalled();
    state.inFlight = false;
    state.base = 'disk-sig';
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(reread).toHaveBeenCalledTimes(1);
    expect(reloads).toEqual([]);
  });

  it('re-reads after an overflow event', async () => {
    const { controller, reread } = harness();
    controller.handle([ev('overflow', '')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS);
    expect(reread).toHaveBeenCalledTimes(1);
  });
});

describe('deletes and renames', () => {
  it('marks renamed when a delete is followed in 500 ms by a create of the same basename', async () => {
    const { controller, states, reread } = harness();
    controller.handle([ev('delete', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(DELETE_WINDOW_MS - 100);
    controller.handle([ev('create', 'lib/a.ts')]);
    await vi.advanceTimersByTimeAsync(DELETE_WINDOW_MS);
    expect(states).toEqual([{ kind: 'renamed', newPath: 'lib/a.ts' }]);
    expect(reread).not.toHaveBeenCalled();
  });

  it('treats a delete then create of the same path as an update', async () => {
    const { controller, states, reloads } = harness();
    controller.handle([ev('delete', 'src/a.ts'), ev('create', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(DELETE_WINDOW_MS * 2);
    expect(states).toEqual([]);
    expect(reloads).toEqual([{ text: 'disk text', signature: 'disk-sig' }]);
  });

  it('marks deleted 500 ms after a delete alone, and a later create clears the mark', async () => {
    const { controller, state, states, reloads } = harness();
    state.disk = { missing: true };
    controller.handle([ev('delete', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(DELETE_WINDOW_MS - 1);
    expect(states).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(states).toEqual([{ kind: 'deleted' }]);

    state.disk = { missing: false, text: 'back', signature: 'back-sig' };
    controller.handle([ev('create', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS);
    expect(reloads).toEqual([{ text: 'back', signature: 'back-sig' }]);
    expect(states).toEqual([{ kind: 'deleted' }, { kind: 'clean' }]);
  });

  it('a delete whose file is back when the window closes is handled as an update', async () => {
    const { controller, states, reloads } = harness();
    controller.handle([ev('delete', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(DELETE_WINDOW_MS);
    expect(states).toEqual([]);
    expect(reloads).toEqual([{ text: 'disk text', signature: 'disk-sig' }]);
  });

  it('marks renamed at once on a rename event from the pane path', () => {
    const { controller, states } = harness();
    controller.handle([ev('rename', 'src/b.ts', { oldPath: 'src/a.ts' })]);
    expect(states).toEqual([{ kind: 'renamed', newPath: 'src/b.ts' }]);
  });
});

describe('dispose', () => {
  it('clears every pending timer', async () => {
    const { controller, reread, states } = harness();
    controller.handle([ev('update', 'src/a.ts'), ev('delete', 'src/a.ts')]);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(DELETE_WINDOW_MS * 4);
    expect(reread).not.toHaveBeenCalled();
    expect(states).toEqual([]);
    controller.handle([ev('update', 'src/a.ts')]);
    await vi.advanceTimersByTimeAsync(REREAD_DELAY_MS * 2);
    expect(reread).not.toHaveBeenCalled();
  });
});
