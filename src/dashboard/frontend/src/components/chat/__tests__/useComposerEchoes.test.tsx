import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';
import { TURN_STALL_MS } from '../../../lib/workingPhase';
import { useComposerEchoes } from '../useComposerEchoes';
import type { ChatMessage } from '../chat-types';

const CONV = 'echo-hook';
const EMPTY: ChatMessage[] = [];
const store = () => useComposerStore.getState();

describe('transcript confirmation delays', () => {
  beforeEach(() => { vi.useFakeTimers(); resetComposerStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('never turns accepted delivery into a failed send while the conversation is streaming', async () => {
    store().addOptimistic(CONV, 'hello', 0, { clientMessageId: 'id', echoBaselineIds: [] });
    store().acknowledgeOptimistic(CONV, 'hello', 'id');
    const { result } = renderHook(() => useComposerEchoes(CONV, EMPTY, [], true));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000 + TURN_STALL_MS); });
    expect(result.current[0]).toMatchObject({ deliveryState: 'accepted', acknowledged: true });
    expect(store().byConversation[CONV].failed).toEqual([]);
  });

  it('moves a stalled accepted bubble to the not-found outbox once the conversation is not streaming (PAN-4247 AC1)', async () => {
    store().addOptimistic(CONV, 'hello', 0, { clientMessageId: 'id', echoBaselineIds: [] });
    store().acknowledgeOptimistic(CONV, 'hello', 'id');
    const { result } = renderHook(() => useComposerEchoes(CONV, EMPTY, [], false));
    await act(async () => { await vi.advanceTimersByTimeAsync(TURN_STALL_MS); });
    expect(result.current).toEqual([]);
    expect(store().byConversation[CONV].failed).toMatchObject([
      { text: 'hello', notFoundInTranscript: true, deliveryUnknown: true, retryable: true },
    ]);
  });

  it('does not schedule the not-found timer while streaming, but does once streaming stops (PAN-4247 AC1)', async () => {
    store().addOptimistic(CONV, 'hello', 0, { clientMessageId: 'id', echoBaselineIds: [] });
    store().acknowledgeOptimistic(CONV, 'hello', 'id');
    const { result, rerender } = renderHook(
      ({ streaming }) => useComposerEchoes(CONV, EMPTY, [], streaming),
      { initialProps: { streaming: true } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(TURN_STALL_MS); });
    expect(store().byConversation[CONV].failed).toEqual([]);

    // The stall window already elapsed while streaming, so the newly armed
    // timer (re-evaluated on the streaming:false rerender) is due immediately.
    rerender({ streaming: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toEqual([]);
    expect(store().byConversation[CONV].failed).toMatchObject([{ notFoundInTranscript: true }]);
  });

  it('labels an unacknowledged stall unknown without moving it into the failed outbox', async () => {
    store().addOptimistic(CONV, 'hello', 0);
    const { result } = renderHook(() => useComposerEchoes(CONV, EMPTY));
    await act(async () => { await vi.advanceTimersByTimeAsync(TURN_STALL_MS); });
    expect(result.current[0].deliveryState).toBe('unknown');
    expect(store().byConversation[CONV].failed).toEqual([]);
  });

  it('reconciles the failed outbox when a late echo arrives after switching back', () => {
    store().addOptimistic(CONV, 'hello', 0, { clientMessageId: 'id', echoBaselineIds: [] });
    store().failSend(CONV, 'hello', 'prompt', { clientMessageId: 'id', deliveryUnknown: true });
    const { rerender } = renderHook(({ name, messages }) => useComposerEchoes(name, messages), {
      initialProps: { name: 'other', messages: EMPTY },
    });
    expect(store().byConversation[CONV].failed).toHaveLength(1);
    rerender({ name: CONV, messages: [{ id: 'echo', role: 'user', text: 'hello', createdAt: new Date().toISOString() }] });
    expect(store().byConversation[CONV]?.failed ?? []).toEqual([]);
  });
});
