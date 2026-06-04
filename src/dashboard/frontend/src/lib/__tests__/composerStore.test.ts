import { describe, it, expect, beforeEach } from 'vitest';
import { useComposerStore, resetComposerStore } from '../composerStore';

const CONV = 'conv-test';

describe('composerStore optimistic messages', () => {
  beforeEach(() => {
    resetComposerStore();
  });

  it('keeps the first optimistic message when a second is sent before the server echoes (PAN-1591)', () => {
    const { addOptimistic } = useComposerStore.getState();

    // First send: server currently has 4 messages.
    addOptimistic(CONV, 'first message', 4);
    let slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic.map((m) => m.text)).toEqual(['first message']);
    expect(slice.optimisticBaseCount).toBe(4);

    // Second send before the first is echoed — must APPEND, not replace, and the
    // baseline must stay anchored at the original 4.
    addOptimistic(CONV, 'second message', 4);
    slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic.map((m) => m.text)).toEqual(['first message', 'second message']);
    expect(slice.optimisticBaseCount).toBe(4);
  });

  it('anchors a fresh baseline after the previous batch is cleared', () => {
    const { addOptimistic, clearOptimistic } = useComposerStore.getState();

    addOptimistic(CONV, 'first', 2);
    clearOptimistic(CONV);
    expect(useComposerStore.getState().byConversation[CONV]).toBeUndefined();

    // A new batch re-anchors at the current server count.
    addOptimistic(CONV, 'second', 7);
    const slice = useComposerStore.getState().byConversation[CONV];
    expect(slice.optimistic.map((m) => m.text)).toEqual(['second']);
    expect(slice.optimisticBaseCount).toBe(7);
  });
});
