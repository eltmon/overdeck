/** PAN-4455 WI-6: the dialog store, the target builder and the hand-off notice store. */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Conversation } from '../../../CommandDeck/ConversationList';
import { continueTargetOf, openContinueOnDevice, useContinueOnDeviceStore } from '../continueOnDeviceStore';
import { useHandoffNotice, useHandoffNoticeStore } from '../handoffNoticeStore';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return { id: 42, name: 'conv-42', sessionAlive: true, ...overrides } as Conversation;
}

describe('continueOnDeviceStore (PAN-4455 WI-6)', () => {
  beforeEach(() => {
    useContinueOnDeviceStore.setState({ target: null });
  });

  it('open then close round-trips the target', () => {
    const target = continueTargetOf(conversation({ title: 'Fix the parser', harness: 'codex' }), 'terminal');
    openContinueOnDevice(target);
    expect(useContinueOnDeviceStore.getState().target).toEqual({
      name: 'conv-42',
      id: 42,
      title: 'Fix the parser',
      harness: 'codex',
      sessionAlive: true,
      viewMode: 'terminal',
    });
    useContinueOnDeviceStore.getState().close();
    expect(useContinueOnDeviceStore.getState().target).toBeNull();
  });

  it('continueTargetOf falls back to the name for the title and claude-code for the harness', () => {
    expect(continueTargetOf(conversation({ title: null, harness: null }))).toMatchObject({
      title: 'conv-42',
      harness: 'claude-code',
      viewMode: 'conversation',
    });
  });
});

describe('handoffNoticeStore (PAN-4455 D-15)', () => {
  beforeEach(() => {
    useHandoffNoticeStore.setState({ notices: {} });
  });

  it('returns the recorded notice while the conversation is alive', () => {
    act(() => useHandoffNoticeStore.getState().record('conv-42', '2026-10-01T10:00:00.000Z'));
    const { result } = renderHook(() => useHandoffNotice({ name: 'conv-42', sessionAlive: true }));
    expect(result.current).toEqual({ at: '2026-10-01T10:00:00.000Z' });
    expect(useHandoffNoticeStore.getState().notices['conv-42']).toBeDefined();
  });

  it('hides and clears the notice when the conversation is seen stopped', () => {
    act(() => useHandoffNoticeStore.getState().record('conv-42', '2026-10-01T10:00:00.000Z'));
    const { result } = renderHook(() => useHandoffNotice({ name: 'conv-42', sessionAlive: false }));
    expect(result.current).toBeNull();
    expect(useHandoffNoticeStore.getState().notices['conv-42']).toBeUndefined();
  });

  it('clear removes only that conversation', () => {
    act(() => {
      useHandoffNoticeStore.getState().record('conv-1', 'a');
      useHandoffNoticeStore.getState().record('conv-2', 'b');
      useHandoffNoticeStore.getState().clear('conv-1');
    });
    expect(useHandoffNoticeStore.getState().notices).toEqual({ 'conv-2': { at: 'b' } });
  });
});
