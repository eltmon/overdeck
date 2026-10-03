import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation } from '../../CommandDeck/ConversationList';
import { useComposerEffort, type UseComposerEffortInput } from '../useComposerEffort';

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), warning: vi.fn(), success: vi.fn() },
}));

const conversation = {
  id: 1,
  name: 'claude-conv',
  tmuxSession: 'conv-claude-conv',
  status: 'active',
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-10-03T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  claudeSessionId: 'session-1',
  title: 'Claude',
  model: 'claude-opus-5-5',
  harness: 'claude-code',
  effort: 'high',
} as unknown as Conversation;

function input(overrides: Partial<UseComposerEffortInput> = {}): UseComposerEffortInput {
  return {
    conversation,
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    piConversation: false,
    observedEffort: 'high',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('useComposerEffort', () => {
  beforeEach(() => {
    mockToastError.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the stored level as set and observed for a live claude-code conversation', () => {
    const { result } = renderHook(() => useComposerEffort(input()));

    expect(result.current.chip).toEqual({ level: 'high', source: 'explicit', observed: true });
    expect(result.current.liveChangeEnabled).toBe(true);
    expect(result.current.title).toContain('Picking a level sends /effort to the session.');
  });

  it('posts a live change to the conversation door and shows Low · set', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, effort: 'low', source: 'explicit' }));
    const { result } = renderHook(() => useComposerEffort(input()));

    act(() => result.current.onChange('low'));
    expect(result.current.pending).toBe(true);

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(fetch).toHaveBeenCalledWith('/api/conversations/claude-conv/thinking-level', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ level: 'low' }),
    }));
    expect(result.current.effort).toBe('low');
    // The transcript still reports the pre-change level; it lags, so it is not a terminal change.
    expect(result.current.chip).toEqual({ level: 'low', source: 'explicit', observed: false });
  });

  it('marks the change observed once the transcript reports it', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, effort: 'low', source: 'explicit' }));
    const { result, rerender } = renderHook((props: UseComposerEffortInput) => useComposerEffort(props), { initialProps: input() });

    act(() => result.current.onChange('low'));
    await waitFor(() => expect(result.current.pending).toBe(false));
    rerender(input({ observedEffort: 'low' }));

    expect(result.current.chip).toEqual({ level: 'low', source: 'explicit', observed: true });
  });

  it('posts to the agent door for an agent-backed panel', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, effort: 'medium', source: 'explicit' }));
    const { result } = renderHook(() => useComposerEffort(input({
      agentId: 'agent-pan-1',
      effortResolution: { effort: 'high', source: 'role' },
    })));

    expect(result.current.chip).toEqual({ level: 'high', source: 'role', observed: true });

    act(() => result.current.onChange('medium'));
    await waitFor(() => expect(result.current.pending).toBe(false));

    expect(fetch).toHaveBeenCalledWith('/api/agents/agent-pan-1/effort', expect.objectContaining({
      body: JSON.stringify({ level: 'medium' }),
    }));
    expect(result.current.chip).toEqual({ level: 'medium', source: 'explicit', observed: false });
  });

  it('restores the previous level and toasts the server error on 504', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      error: 'Claude Code did not confirm the effort change within 10 s; the stored effort is unchanged.',
      code: 'not-confirmed',
    }, 504));
    const { result } = renderHook(() => useComposerEffort(input()));

    act(() => result.current.onChange('low'));
    await waitFor(() => expect(result.current.pending).toBe(false));

    expect(result.current.effort).toBe('high');
    expect(result.current.chip).toEqual({ level: 'high', source: 'explicit', observed: true });
    expect(mockToastError).toHaveBeenCalledWith('Claude Code did not confirm the effort change within 10 s; the stored effort is unchanged.');
  });

  it('shows a native-terminal change as terminal', () => {
    const { result } = renderHook(() => useComposerEffort(input({ observedEffort: 'max' })));

    expect(result.current.chip).toEqual({ level: 'max', source: 'terminal', observed: true });
  });

  it('resolves an unset effort through the default chain', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ effort: 'high', source: 'default', requested: 'high', clamped: false }));
    const { result } = renderHook(() => useComposerEffort(input({
      conversation: { ...conversation, effort: null },
      observedEffort: null,
    })));

    await waitFor(() => expect(result.current.chip).toEqual({ level: 'high', source: 'default', observed: false }));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe('/api/effort/default?model=claude-opus-5-5&harness=claude-code');
  });

  it('has no chip and changes only the draft before a session exists', () => {
    const { result } = renderHook(() => useComposerEffort(input({
      conversation: { ...conversation, sessionAlive: false, claudeSessionId: null, effort: 'medium' },
      observedEffort: null,
    })));

    expect(result.current.chip).toBeNull();
    expect(result.current.liveChangeEnabled).toBe(false);

    act(() => result.current.onChange('low'));

    expect(result.current.effort).toBe('low');
    expect(fetch).not.toHaveBeenCalled();
  });
});
