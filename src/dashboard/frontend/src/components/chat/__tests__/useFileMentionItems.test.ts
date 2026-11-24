/**
 * PAN-5662 WI-4: the @ menu's debounced file search. Fake timers drive the
 * 120 ms debounce (repo rule: never wait on real setTimeout in tests).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchFiles = vi.hoisted(() => vi.fn());
vi.mock('../../explorer/explorer-rpc', () => ({ searchFiles }));

import { FILE_MENTION_DEBOUNCE_MS, FILE_MENTION_LIMIT, useFileMentionItems } from '../useFileMentionItems';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useFileMentionItems (PAN-5662)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchFiles.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never searches for an empty filter, a closed menu or a null root', async () => {
    const { result, rerender } = renderHook(
      ({ rootId, filter }: { rootId: string | null; filter: string | null }) => useFileMentionItems(rootId, filter),
      { initialProps: { rootId: 'project:x' as string | null, filter: '' as string | null } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS * 2); });
    rerender({ rootId: 'project:x', filter: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS * 2); });
    rerender({ rootId: null, filter: 'comp' });
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS * 2); });

    expect(searchFiles).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('debounces filter changes into one search with the limit', async () => {
    searchFiles.mockResolvedValue({ paths: ['src/a/Composer.tsx'] });
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) => useFileMentionItems('project:x', filter),
      { initialProps: { filter: 'c' } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    rerender({ filter: 'co' });
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    rerender({ filter: 'comp' });
    expect(searchFiles).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS); });

    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(searchFiles).toHaveBeenCalledWith('project:x', 'comp', FILE_MENTION_LIMIT);
    expect(FILE_MENTION_LIMIT).toBe(20);
    expect(result.current.items.map(item => item.insert)).toEqual(['@src/a/Composer.tsx ']);
  });

  it('drops a slower answer to an older query', async () => {
    const older = deferred<{ paths: string[] }>();
    const newer = deferred<{ paths: string[] }>();
    searchFiles.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) => useFileMentionItems('project:x', filter),
      { initialProps: { filter: 'co' } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS); });
    rerender({ filter: 'comp' });
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS); });
    expect(searchFiles).toHaveBeenCalledTimes(2);

    await act(async () => { newer.resolve({ paths: ['src/Composer.tsx'] }); });
    await act(async () => { older.resolve({ paths: ['src/Config.ts'] }); });

    expect(result.current.items.map(item => item.label)).toEqual(['Composer.tsx']);
  });

  it('shows no rows when the menu reopens on the same query until a fresh answer lands', async () => {
    const fresh = deferred<{ paths: string[] }>();
    searchFiles.mockResolvedValueOnce({ paths: ['src/Old.ts'] }).mockReturnValueOnce(fresh.promise);
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string | null }) => useFileMentionItems('project:x', filter),
      { initialProps: { filter: 'comp' as string | null } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS); });
    expect(result.current.items.map(item => item.label)).toEqual(['Old.ts']);

    rerender({ filter: null });
    rerender({ filter: 'comp' });
    expect(result.current.items).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS); });
    expect(result.current.items).toEqual([]);
    await act(async () => { fresh.resolve({ paths: ['src/New.ts'] }); });
    expect(result.current.items.map(item => item.label)).toEqual(['New.ts']);
  });

  it('yields no rows when the search rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchFiles.mockRejectedValue(new Error('rpc down'));
    const { result } = renderHook(() => useFileMentionItems('project:x', 'comp'));
    await act(async () => { await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS); });

    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
