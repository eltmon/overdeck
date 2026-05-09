import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversationUiState } from '../useConversationUiState';

const STORAGE_KEY = 'panopticon:conversation-ui:v1';

describe('useConversationUiState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults hideToolCalls to false', () => {
    const { result } = renderHook(() => useConversationUiState('conv-1'));
    expect(result.current.hideToolCalls).toBe(false);
  });

  it('toggles hideToolCalls on and persists to localStorage', () => {
    const { result } = renderHook(() => useConversationUiState('conv-1'));

    act(() => {
      result.current.toggleHideToolCalls();
    });

    expect(result.current.hideToolCalls).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.hideToolCallsById['conv-1']).toBe(true);
  });

  it('toggles hideToolCalls off and removes the entry', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hideToolCallsById: { 'conv-1': true } }));

    const { result } = renderHook(() => useConversationUiState('conv-1'));
    expect(result.current.hideToolCalls).toBe(true);

    act(() => {
      result.current.toggleHideToolCalls();
    });

    expect(result.current.hideToolCalls).toBe(false);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.hideToolCallsById['conv-1']).toBeUndefined();
  });

  it('keeps state isolated per conversation id', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hideToolCallsById: { 'conv-a': true } }));

    const { result } = renderHook(() => useConversationUiState('conv-b'));
    expect(result.current.hideToolCalls).toBe(false);
  });
});
