import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessagesHttpFallback, MESSAGES_HTTP_FALLBACK_MS } from '../useMessagesHttpFallback';

describe('useMessagesHttpFallback', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stays false until the fallback delay elapses, then becomes true', async () => {
    const { result } = renderHook(() => useMessagesHttpFallback(true, false, 'conv-a'));
    expect(result.current).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(MESSAGES_HTTP_FALLBACK_MS - 1); });
    expect(result.current).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toBe(true);
  });

  it('stays false when a payload arrives before the delay elapses', async () => {
    const { result, rerender } = renderHook(
      ({ receivedFirstPayload }) => useMessagesHttpFallback(true, receivedFirstPayload, 'conv-a'),
      { initialProps: { receivedFirstPayload: false } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    rerender({ receivedFirstPayload: true });

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(result.current).toBe(false);
  });

  it('returns false again once a payload arrives after becoming due', async () => {
    const { result, rerender } = renderHook(
      ({ receivedFirstPayload }) => useMessagesHttpFallback(true, receivedFirstPayload, 'conv-a'),
      { initialProps: { receivedFirstPayload: false } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(MESSAGES_HTTP_FALLBACK_MS); });
    expect(result.current).toBe(true);

    rerender({ receivedFirstPayload: true });
    expect(result.current).toBe(false);
  });

  it('stays false whenever streaming is disabled', async () => {
    const { result } = renderHook(() => useMessagesHttpFallback(false, false, 'conv-a'));

    await act(async () => { await vi.advanceTimersByTimeAsync(MESSAGES_HTTP_FALLBACK_MS * 2); });
    expect(result.current).toBe(false);
  });

  it('restarts the timer when identity changes', async () => {
    const { result, rerender } = renderHook(
      ({ identity }) => useMessagesHttpFallback(true, false, identity),
      { initialProps: { identity: 'conv-a' } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    rerender({ identity: 'conv-b' });

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current).toBe(true);
  });

  it('waits another full delay after streaming toggles off and back on for the same identity', async () => {
    const { result, rerender } = renderHook(
      ({ streamEnabled }) => useMessagesHttpFallback(streamEnabled, false, 'conv-a'),
      { initialProps: { streamEnabled: true } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(MESSAGES_HTTP_FALLBACK_MS); });
    expect(result.current).toBe(true);

    rerender({ streamEnabled: false });
    expect(result.current).toBe(false);

    rerender({ streamEnabled: true });
    expect(result.current).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(MESSAGES_HTTP_FALLBACK_MS - 1); });
    expect(result.current).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toBe(true);
  });
});
