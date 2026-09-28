import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AgentSnapshot, DerivedIssueState, SessionNode } from '@overdeck/contracts';
import type { SessionAgent } from './agentConversation';
import { useAgentSessionOutcome, useSessionNodeOutcome } from './useSessionOutcome';
import { useDashboardStore } from './store';

function node(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    type: 'work',
    sessionId: 'agent-pan-1-work',
    model: 'claude-code',
    startedAt: '2026-01-01T00:00:00Z',
    duration: 60,
    status: 'stopped',
    presence: 'ended',
    ...overrides,
  } as SessionNode;
}

function derived(overrides: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return {
    issueId: 'PAN-1',
    state: 'working',
    ...overrides,
  } as DerivedIssueState;
}

function agentSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-pan-1-work',
    issueId: 'PAN-1',
    status: 'stopped',
    ...overrides,
  } as AgentSnapshot;
}

function setStore(state: { derivedIssueStateByIssueId?: Record<string, DerivedIssueState>; agentsById?: Record<string, AgentSnapshot> }) {
  useDashboardStore.setState({
    derivedIssueStateByIssueId: state.derivedIssueStateByIssueId ?? {},
    agentsById: state.agentsById ?? {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

describe('useSessionNodeOutcome', () => {
  afterEach(() => {
    setStore({});
  });

  it('a merged work node returns Merged', () => {
    setStore({ derivedIssueStateByIssueId: { 'PAN-1': derived({ pr: { url: 'u', number: 1, reviewState: 'approved', checks: 'green', mergeable: true, merged: true } }) } });
    const { result } = renderHook(() => useSessionNodeOutcome(node(), 'PAN-1'));
    expect(result.current?.label).toBe('Merged');
  });

  it('a not-ended node returns null', () => {
    setStore({ derivedIssueStateByIssueId: { 'PAN-1': derived() } });
    const { result } = renderHook(() => useSessionNodeOutcome(node({ presence: 'active' }), 'PAN-1'));
    expect(result.current).toBeNull();
  });

  it('reads derived state case-insensitively (issueId is upper-cased before the lookup)', () => {
    setStore({ derivedIssueStateByIssueId: { 'PAN-1': derived({ pr: { url: 'u', number: 1, reviewState: 'approved', checks: 'green', mergeable: true, merged: true } }) } });
    const { result } = renderHook(() => useSessionNodeOutcome(node(), 'pan-1'));
    expect(result.current?.label).toBe('Merged');
  });

  it('reads the agent snapshot by node.sessionId', () => {
    setStore({
      derivedIssueStateByIssueId: { 'PAN-1': derived() },
      agentsById: { 'agent-pan-1-work': agentSnapshot({ status: 'error' }) },
    });
    const { result } = renderHook(() => useSessionNodeOutcome(node(), 'PAN-1'));
    expect(result.current?.label).toBe('Ended unexpectedly');
    expect(result.current?.tone).toBe('attention');
  });
});

describe('useAgentSessionOutcome', () => {
  afterEach(() => {
    setStore({});
  });

  it('an ended drawer work agent with stoppedByUser true in agentsById returns Stopped by operator', () => {
    const drawerAgent: SessionAgent = { id: 'agent-pan-1-work', issueId: 'PAN-1', status: 'stopped', role: 'work' };
    setStore({
      derivedIssueStateByIssueId: { 'PAN-1': derived() },
      agentsById: { 'agent-pan-1-work': agentSnapshot({ stoppedByUser: true }) },
    });
    const { result } = renderHook(() => useAgentSessionOutcome(drawerAgent));
    expect(result.current?.label).toBe('Stopped by operator');
  });

  it('a live drawer agent returns null', () => {
    const drawerAgent: SessionAgent = { id: 'agent-pan-1-work', issueId: 'PAN-1', status: 'running', role: 'work' };
    const { result } = renderHook(() => useAgentSessionOutcome(drawerAgent));
    expect(result.current).toBeNull();
  });

  it('a null agent returns null', () => {
    const { result } = renderHook(() => useAgentSessionOutcome(null));
    expect(result.current).toBeNull();
  });
});
