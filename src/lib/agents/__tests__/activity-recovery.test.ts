import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentState } from '../agent-state.js';
import {
  getLatestSessionId,
  resolveClaudeSessionRecovery,
  resolveLatestSessionId,
  type ClaudeSessionRecoveryDeps,
} from '../activity.js';
import { appendSessionIdToHistory } from '../../session-history.js';

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-activity-session-'));
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(tempHome, { recursive: true, force: true });
});

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
  it('prefers the newest indexed Claude session over launcher and projected state', () => {
    const dir = join(tempHome, 'agents', agentState.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'launcher.sh'), "claude --resume '11111111-1111-1111-1111-111111111111'\n");
    appendSessionIdToHistory(agentState.id, 'indexed-session', 'test');

    const result = resolveLatestSessionId(agentState.id, deps({
      getAgentState: () => ({ ...agentState, sessionId: 'stale-state-session' }),
    }));

    expect(result.sessionId).toBe('indexed-session');
  });

  it('does not apply retained Codex state to a Claude harness', () => {
    const dir = join(tempHome, 'agents', agentState.id);
    mkdirSync(join(dir, 'codex-home'), { recursive: true });
    writeFileSync(join(dir, 'codex-thread-id'), 'retained-codex-thread\n');

    expect(resolveLatestSessionId(agentState.id, deps({
      getAgentState: () => agentState,
    })).sessionId).toBeNull();
  });

  it('resolves Codex state only when the current harness is Codex', () => {
    const dir = join(tempHome, 'agents', agentState.id);
    mkdirSync(join(dir, 'codex-home'), { recursive: true });
    writeFileSync(join(dir, 'codex-thread-id'), 'current-codex-thread\n');

    expect(resolveLatestSessionId(agentState.id, deps({
      getAgentState: () => ({ ...agentState, harness: 'codex' }),
    })).sessionId).toBe('current-codex-thread');
  });

  it('keeps sync and async resolution aligned for an event-store-only session', async () => {
    const recoveryDeps = deps({
      getAgentState: () => agentState,
      readEventSessionId: () => 'event-only-session',
      transcriptExists: (_workspace, sessionId) => sessionId === 'event-only-session',
    });

    const syncSessionId = resolveLatestSessionId(agentState.id, recoveryDeps).sessionId;
    const asyncSessionId = getLatestSessionId(agentState.id, recoveryDeps);

    expect(syncSessionId).toBe('event-only-session');
    expect(asyncSessionId).toBe(syncSessionId);
  });

  it('does not reconstruct a reset session from the event store', () => {
    const result = resolveLatestSessionId(agentState.id, deps({
      isSessionReset: () => true,
      readEventSessionId: () => 'reset-session',
      transcriptExists: () => true,
    }));

    expect(result).toEqual({ sessionId: null, checked: ['session reset marker'] });
  });

  it('uses the latest event-store session when its transcript exists', () => {
    const result = resolveClaudeSessionRecovery(agentState.id, agentState, deps({
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
    const result = resolveClaudeSessionRecovery(agentState.id, agentState, deps());

    expect(result.sessionId).toBeNull();
    expect(result.checked).toEqual(['agent.model_set event history']);
  });

  it('returns null with the recovery source named when empty', () => {
    expect(resolveClaudeSessionRecovery(agentState.id, agentState, deps())).toEqual({
      sessionId: null,
      checked: ['agent.model_set event history'],
    });
  });
});
