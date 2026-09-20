import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../agent-state.js';
import {
  getLatestSessionId,
  resolveClaudeSessionRecoverySync,
  resolveLatestSessionIdSync,
  type ClaudeSessionRecoveryDeps,
} from '../activity.js';

const agentState: AgentState = {
  id: 'agent-min-839',
  issueId: 'MIN-839',
  workspace: '/work/myn/workspaces/feature-min-839',
  harness: 'claude-code',
  role: 'work',
  model: 'claude-opus-5',
  status: 'stopped',
  startedAt: '2026-08-01T10:58:11.000Z',
};

function deps(overrides: Partial<ClaudeSessionRecoveryDeps> = {}): ClaudeSessionRecoveryDeps {
  return {
    readEventSessionId: () => null,
    transcriptExists: () => false,
    log: vi.fn(),
    ...overrides,
  };
}

describe('Claude session reconstruction fallback', () => {
  it('keeps sync and async resolution aligned for an event-store-only session', async () => {
    const recoveryDeps = deps({
      getAgentState: () => agentState,
      readEventSessionId: () => 'event-only-session',
      transcriptExists: (_workspace, sessionId) => sessionId === 'event-only-session',
    });

    const syncSessionId = resolveLatestSessionIdSync(agentState.id, recoveryDeps).sessionId;
    const asyncSessionId = await Effect.runPromise(getLatestSessionId(agentState.id, recoveryDeps));

    expect(syncSessionId).toBe('event-only-session');
    expect(asyncSessionId).toBe(syncSessionId);
  });

  it('does not reconstruct a reset session from the event store', () => {
    const result = resolveLatestSessionIdSync(agentState.id, deps({
      isSessionReset: () => true,
      readEventSessionId: () => 'reset-session',
      transcriptExists: () => true,
    }));

    expect(result).toEqual({ sessionId: null, checked: ['session reset marker'] });
  });

  it('uses the latest event-store session when its transcript exists', () => {
    const result = resolveClaudeSessionRecoverySync(agentState.id, agentState, deps({
      readEventSessionId: () => 'event-session',
      transcriptExists: (_workspace, sessionId) => sessionId === 'event-session',
    }));

    expect(result).toEqual({
      sessionId: 'event-session',
      checked: ['agent.model_set event history'],
    });
  });

  it('PAN-3849: never adopts a transcript by directory listing, even when exactly one JSONL exists', () => {
    // The planner and the work agent share a workspace path, so "exactly one
    // file" proved nothing about ownership — an unreferenced transcript
    // resolves to null, and only the event-store source is consulted
    // (PAN-3917: the durable agent-plane source this also checked is gone
    // with the record plane).
    const result = resolveClaudeSessionRecoverySync(agentState.id, agentState, deps());

    expect(result.sessionId).toBeNull();
    expect(result.checked).toEqual(['agent.model_set event history']);
  });

  it('returns null with the recovery source named when empty', () => {
    expect(resolveClaudeSessionRecoverySync(agentState.id, agentState, deps())).toEqual({
      sessionId: null,
      checked: ['agent.model_set event history'],
    });
  });
});
