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

  it('never turns accepted delivery into a failed send after a compaction or stall interval', async () => {
    store().addOptimistic(CONV, 'hello', 0, { clientMessageId: 'id', echoBaselineIds: [] });
    store().acknowledgeOptimistic(CONV, 'hello', 'id');
    const { result } = renderHook(() => useComposerEchoes(CONV, EMPTY));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000 + TURN_STALL_MS); });
    expect(result.current[0]).toMatchObject({ deliveryState: 'accepted', acknowledged: true });
    expect(store().byConversation[CONV].failed).toEqual([]);
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
