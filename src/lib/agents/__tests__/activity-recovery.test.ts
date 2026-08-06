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
    readAgentPlaneRecord: () => null,
    readEventSessionId: () => null,
    transcriptExists: () => false,
    listTranscriptSessionIds: () => [],
    log: vi.fn(),
    ...overrides,
  };
}

describe('Claude session reconstruction fallback', () => {
  it('keeps sync and async resolution aligned for a durable-plane-only session', async () => {
    const recoveryDeps = deps({
      getAgentState: () => agentState,
      readAgentPlaneRecord: () => ({
        version: 1,
        agentId: agentState.id,
        issueId: agentState.issueId,
        projectKey: 'myn',
        role: 'work',
        origin: { machineId: 'origin', overdeckHome: '/home/origin/.overdeck' },
        launch: { harness: 'claude-code', model: 'claude-opus-5', workspace: agentState.workspace, branch: 'feature/min-839' },
        sessions: [
          { id: 'durable-only-session', startedAt: '2026-08-01T11:00:00.000Z', reason: 'spawn' },
        ],
        lifecycle: [],
        archiveRef: null,
        recovered: false,
      }),
      transcriptExists: (_workspace, sessionId) => sessionId === 'durable-only-session',
    });

    const syncSessionId = resolveLatestSessionIdSync(agentState.id, recoveryDeps).sessionId;
    const asyncSessionId = await Effect.runPromise(getLatestSessionId(agentState.id, recoveryDeps));

    expect(syncSessionId).toBe('durable-only-session');
    expect(asyncSessionId).toBe(syncSessionId);
  });

  it('uses the freshest agents-plane session that has a local transcript', () => {
    const result = resolveClaudeSessionRecoverySync(agentState.id, agentState, deps({
      readAgentPlaneRecord: () => ({
        version: 1,
        agentId: agentState.id,
        issueId: agentState.issueId,
        projectKey: 'myn',
        role: 'work',
        origin: { machineId: 'origin', overdeckHome: '/home/origin/.overdeck' },
        launch: { harness: 'claude-code', model: 'claude-opus-5', workspace: agentState.workspace, branch: 'feature/min-839' },
        sessions: [
          { id: 'older-session', startedAt: '2026-08-01T10:00:00.000Z', reason: 'spawn' },
          { id: 'newer-session', startedAt: '2026-08-01T11:00:00.000Z', reason: 'rotation' },
        ],
        lifecycle: [],
        archiveRef: null,
        recovered: false,
      }),
      transcriptExists: (_workspace, sessionId) => sessionId === 'newer-session',
    }));

    expect(result).toEqual({
      sessionId: 'newer-session',
      checked: ['durable agents plane'],
      needsPointerRepair: true,
    });
  });

  it('uses the latest event-store session when its transcript exists', () => {
    const result = resolveClaudeSessionRecoverySync(agentState.id, agentState, deps({
      readEventSessionId: () => 'event-session',
      transcriptExists: (_workspace, sessionId) => sessionId === 'event-session',
    }));

    expect(result).toEqual({
      sessionId: 'event-session',
      checked: ['durable agents plane', 'agent.model_set event history'],
      needsPointerRepair: true,
    });
  });

  it('accepts a transcript-directory fallback only when exactly one JSONL exists', () => {
    const result = resolveClaudeSessionRecoverySync(agentState.id, agentState, deps({
      listTranscriptSessionIds: () => ['only-session'],
    }));

    expect(result.sessionId).toBe('only-session');
    expect(result.checked).toContain('exactly-one transcript-directory scan');
  });

  it('refuses an ambiguous transcript directory', () => {
    const result = resolveClaudeSessionRecoverySync(agentState.id, agentState, deps({
      listTranscriptSessionIds: () => ['reviewer-session', 'work-session'],
    }));

    expect(result.sessionId).toBeNull();
    expect(result.checked).toEqual([
      'durable agents plane',
      'agent.model_set event history',
      'exactly-one transcript-directory scan',
    ]);
  });

  it('returns null with every recovery source named when all are empty', () => {
    expect(resolveClaudeSessionRecoverySync(agentState.id, agentState, deps())).toEqual({
      sessionId: null,
      checked: [
        'durable agents plane',
        'agent.model_set event history',
        'exactly-one transcript-directory scan',
      ],
    });
  });
});
