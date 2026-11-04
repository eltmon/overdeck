/**
 * PAN-4930 W-9: the agent-token sweep — D-9 revoke rules for dead agents and
 * ended conversations, the 7-day prune, per-token failure isolation, and the
 * D-10 timer chain (60 s, then 10 minutes after each run, never overlapping).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicAccessTokenRecord } from '../../../../../src/lib/access-tokens.js';
import type { LivenessVerdict } from '../../../../../src/lib/agents/liveness.js';
import {
  AGENT_TOKEN_PRUNE_AFTER_MS,
  AGENT_TOKEN_SWEEP_FIRST_MS,
  AGENT_TOKEN_SWEEP_INTERVAL_MS,
  startAgentTokenSweep,
  stopAgentTokenSweep,
  sweepAgentTokensOnce,
  type AgentTokenSweepDeps,
} from '../../../../../src/dashboard/server/services/agent-token-sweep.js';
import { conversationStateDir } from '../../../../../src/lib/overdeck/conversation-pane-role.js';

const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function token(agentId: string, agentKind: 'agent' | 'conversation', createdMinutesAgo: number, extra: Partial<PublicAccessTokenRecord> = {}): PublicAccessTokenRecord {
  return {
    id: `tok-${agentId}`,
    name: `agent:work:${agentId}`,
    scopes: ['tell'],
    createdAt: ago(createdMinutesAgo),
    lastUsedAt: null,
    kind: 'token',
    agentId,
    agentKind,
    role: agentKind === 'agent' ? 'work' : 'conversation',
    ...extra,
  };
}

type Conv = ReturnType<AgentTokenSweepDeps['getConversationByName']>;

function makeDeps(records: PublicAccessTokenRecord[], opts: {
  states?: Record<string, { startedAt?: string; lastResumeAt?: string }>;
  verdicts?: Record<string, LivenessVerdict | Error>;
  conversations?: Record<string, Conv>;
} = {}) {
  return {
    listAccessTokens: vi.fn(async () => records),
    getAgentState: vi.fn((id: string) => opts.states?.[id] ?? null),
    isAlive: vi.fn(async (id: string): Promise<LivenessVerdict> => {
      const verdict = opts.verdicts?.[id] ?? { alive: true, paneAlive: true };
      if (verdict instanceof Error) throw verdict;
      return verdict;
    }),
    getConversationByName: vi.fn((name: string) => opts.conversations?.[name] ?? null),
    revokeAgentMcpTokens: vi.fn(async () => 1),
    pruneEndedAccessTokens: vi.fn(async () => 0),
    now: () => NOW,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  stopAgentTokenSweep();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sweepAgentTokensOnce (PAN-4930 D-9)', () => {
  it('revokes a confirmed-dead agent past the grace, keeps an indeterminate one and a fresh one', async () => {
    const deps = makeDeps(
      [token('agent-dead', 'agent', 30), token('agent-unsure', 'agent', 30), token('agent-new', 'agent', 1)],
      {
        states: { 'agent-dead': { startedAt: ago(30) }, 'agent-unsure': { startedAt: ago(30) }, 'agent-new': { startedAt: ago(30) } },
        verdicts: {
          'agent-dead': { alive: false, reason: 'no-session' },
          'agent-unsure': { alive: false, reason: 'runtime-indeterminate' },
          'agent-new': { alive: false, reason: 'no-session' },
        },
      },
    );

    expect(await sweepAgentTokensOnce(deps)).toEqual({ revoked: 1, pruned: 0 });
    expect(deps.revokeAgentMcpTokens).toHaveBeenCalledTimes(1);
    expect(deps.revokeAgentMcpTokens).toHaveBeenCalledWith('agent-dead');
  });

  it('keeps a dead agent whose last resume is within the grace', async () => {
    const deps = makeDeps([token('agent-resumed', 'agent', 30)], {
      states: { 'agent-resumed': { startedAt: ago(60), lastResumeAt: ago(2) } },
      verdicts: { 'agent-resumed': { alive: false, reason: 'no-session' } },
    });
    expect(await sweepAgentTokensOnce(deps)).toEqual({ revoked: 0, pruned: 0 });
  });

  it('revokes an agent token whose state is missing past the grace, without probing liveness', async () => {
    const deps = makeDeps([token('agent-gone', 'agent', 11)]);
    expect((await sweepAgentTokensOnce(deps)).revoked).toBe(1);
    expect(deps.revokeAgentMcpTokens).toHaveBeenCalledWith('agent-gone');
    expect(deps.isAlive).not.toHaveBeenCalled();
  });

  it('keeps a fresh agent token whose state is not saved yet (PAN-4932 D-9)', async () => {
    const deps = makeDeps([token('agent-planning', 'agent', 1)]);
    expect((await sweepAgentTokensOnce(deps)).revoked).toBe(0);
    expect(deps.revokeAgentMcpTokens).not.toHaveBeenCalled();
    expect(deps.isAlive).not.toHaveBeenCalled();
  });

  it('revokes a conversation token when the row is missing, archived or ended, and keeps an active one', async () => {
    const deps = makeDeps(
      [token('missing', 'conversation', 1), token('archived', 'conversation', 1), token('ended', 'conversation', 30), token('ended-fresh', 'conversation', 1), token('active', 'conversation', 30)],
      {
        conversations: {
          archived: { tmuxSession: 'conv-archived', status: 'ended', archivedAt: ago(5) },
          ended: { tmuxSession: 'conv-ended', status: 'ended', archivedAt: null },
          'ended-fresh': { tmuxSession: 'conv-ended-fresh', status: 'ended', archivedAt: null },
          active: { tmuxSession: 'conv-active', status: 'active', archivedAt: null },
        },
      },
    );

    expect((await sweepAgentTokensOnce(deps)).revoked).toBe(3);
    expect(deps.revokeAgentMcpTokens.mock.calls).toEqual([
      ['missing', { agentKind: 'conversation', dir: conversationStateDir('conv-missing') }],
      ['archived', { agentKind: 'conversation', dir: conversationStateDir('conv-archived') }],
      ['ended', { agentKind: 'conversation', dir: conversationStateDir('conv-ended') }],
    ]);
  });

  it('prunes once per run with the 7-day window, and skips revoked and plain tokens', async () => {
    const deps = makeDeps([
      token('agent-revoked', 'agent', 30, { revokedAt: ago(5) }),
      { id: 'plain', name: 'plain', scopes: ['tell'], createdAt: ago(30), lastUsedAt: null, kind: 'token' },
    ]);
    deps.pruneEndedAccessTokens.mockResolvedValueOnce(2);

    expect(await sweepAgentTokensOnce(deps)).toEqual({ revoked: 0, pruned: 2 });
    expect(deps.pruneEndedAccessTokens).toHaveBeenCalledTimes(1);
    expect(deps.pruneEndedAccessTokens).toHaveBeenCalledWith(AGENT_TOKEN_PRUNE_AFTER_MS, NOW);
    expect(deps.revokeAgentMcpTokens).not.toHaveBeenCalled();
  });

  it('a throwing liveness probe for one token does not stop the next revoke', async () => {
    const deps = makeDeps([token('agent-broken', 'agent', 30), token('agent-dead', 'agent', 30)], {
      states: { 'agent-broken': { startedAt: ago(30) }, 'agent-dead': { startedAt: ago(30) } },
      verdicts: { 'agent-broken': new Error('probe exploded'), 'agent-dead': { alive: false, reason: 'pane-dead' } },
    });

    expect((await sweepAgentTokensOnce(deps)).revoked).toBe(1);
    expect(deps.revokeAgentMcpTokens).toHaveBeenCalledWith('agent-dead');
  });
});

describe('startAgentTokenSweep (PAN-4930 D-10)', () => {
  it('runs at 60 s, again 10 minutes after that run, stops on stop, and a second start does not double runs', async () => {
    vi.useFakeTimers();
    const deps = makeDeps([]);

    startAgentTokenSweep(deps);
    startAgentTokenSweep(deps);
    await vi.advanceTimersByTimeAsync(AGENT_TOKEN_SWEEP_FIRST_MS - 1);
    expect(deps.listAccessTokens).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.listAccessTokens).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AGENT_TOKEN_SWEEP_INTERVAL_MS);
    expect(deps.listAccessTokens).toHaveBeenCalledTimes(2);

    stopAgentTokenSweep();
    await vi.advanceTimersByTimeAsync(AGENT_TOKEN_SWEEP_INTERVAL_MS * 3);
    expect(deps.listAccessTokens).toHaveBeenCalledTimes(2);
  });
});
