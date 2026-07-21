/**
 * useAgentSetInvalidation (PAN-2893) — the agent SET changing (spawn/stop over
 * /ws/rpc) must refetch the command-deck projects pane; status churn must not.
 * Uses fake timers per the repo rule for delay-based code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';

import { useDashboardStore } from './store';
import {
  AGENT_SET_INVALIDATION_DEBOUNCE_MS,
  agentSetSignature,
  useAgentSetInvalidation,
} from './useAgentSetInvalidation';

const agent = (id: string, status = 'running') => ({ id, status } as never);

function setAgents(agents: Record<string, unknown>) {
  act(() => {
    useDashboardStore.setState({ agentsById: agents } as never);
  });
}

describe('agentSetSignature', () => {
  it('is order-insensitive and ignores non-id fields', () => {
    expect(agentSetSignature([{ id: 'b' }, { id: 'a' }])).toBe(agentSetSignature([{ id: 'a' }, { id: 'b' }]));
    expect(agentSetSignature([{ id: 'a' }])).not.toBe(agentSetSignature([{ id: 'a' }, { id: 'b' }]));
  });
});

describe('useAgentSetInvalidation', () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  const queryClient = { invalidateQueries } as unknown as QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    invalidateQueries.mockClear();
    setAgents({});
  });
  afterEach(() => { vi.useRealTimers(); });

  it('does not invalidate on the initial baseline observation', async () => {
    setAgents({ 'agent-pan-1': agent('agent-pan-1') });
    renderHook(() => useAgentSetInvalidation(queryClient));
    await act(() => vi.advanceTimersByTimeAsync(AGENT_SET_INVALIDATION_DEBOUNCE_MS * 2));
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('invalidates projects and active membership after a debounced agent-set change', async () => {
    renderHook(() => useAgentSetInvalidation(queryClient));

    setAgents({ 'agent-pan-1': agent('agent-pan-1') });
    expect(invalidateQueries).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(AGENT_SET_INVALIDATION_DEBOUNCE_MS));
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-deck-projects'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project-pipeline-membership'] });
  });

  it('collapses a spawn burst into one invalidation', async () => {
    renderHook(() => useAgentSetInvalidation(queryClient));

    setAgents({ a: agent('a') });
    setAgents({ a: agent('a'), b: agent('b') });
    setAgents({ a: agent('a'), b: agent('b'), c: agent('c') });

    await act(() => vi.advanceTimersByTimeAsync(AGENT_SET_INVALIDATION_DEBOUNCE_MS));
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('ignores status-only churn on a stable agent set', async () => {
    setAgents({ a: agent('a', 'running') });
    renderHook(() => useAgentSetInvalidation(queryClient));

    setAgents({ a: agent('a', 'thinking') });
    await act(() => vi.advanceTimersByTimeAsync(AGENT_SET_INVALIDATION_DEBOUNCE_MS * 2));
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
