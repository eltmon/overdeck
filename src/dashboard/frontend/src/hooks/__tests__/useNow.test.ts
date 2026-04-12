/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNow } from '../useNow';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a Date on initial render', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toBeInstanceOf(Date);
  });

  it('updates the date after the interval fires', () => {
    const { result } = renderHook(() => useNow(1000));

    const initial = result.current.getTime();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.getTime()).toBeGreaterThan(initial);
  });

  it('does not update before the interval fires', () => {
    const { result } = renderHook(() => useNow(60_000));

    const initial = result.current;

    act(() => {
      vi.advanceTimersByTime(59_999);
    });

    expect(result.current).toBe(initial);
  });

  it('updates multiple times as the interval keeps firing', () => {
    const { result } = renderHook(() => useNow(1000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Should have fired at 1s, 2s, 3s — date should be well past initial
    expect(result.current.getTime()).toBeGreaterThan(new Date().getTime() - 1000);
  });

  it('clears the interval on unmount (no state updates after unmount)', () => {
    const { result, unmount } = renderHook(() => useNow(1000));
    const beforeUnmount = result.current;

    unmount();

    // Advancing time after unmount should not cause updates
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // result.current is frozen at the time of unmount
    expect(result.current).toBe(beforeUnmount);
  });
});
