import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../agent-state-read.js';
import { handleAgentLiveEffort, type AgentLiveEffortDeps } from '../agent-live-effort.js';
import type { ClaudeLiveEffortResult } from '../effort-live.js';

function agentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    workspace: '/tmp/ws-pan-1',
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    status: 'running',
    effort: 'high',
    effortSource: 'role',
    ...overrides,
  } as AgentState;
}

function makeDeps(
  result: ClaudeLiveEffortResult,
  overrides: Partial<AgentLiveEffortDeps> = {},
) {
  return {
    getAgentState: vi.fn((_id: string) => agentState()),
    isAlive: vi.fn(async () => ({ alive: true }) as never),
    applyLiveEffort: vi.fn(async () => result),
    saveAgentState: vi.fn(),
    getLatestSessionId: vi.fn(() => 'session-1'),
    ...overrides,
  };
}

describe('handleAgentLiveEffort', () => {
  it('persists the confirmed level as explicit', async () => {
    const deps = makeDeps({ ok: true, effort: 'medium' });

    const response = await handleAgentLiveEffort('agent-pan-1', { level: 'medium' }, deps);

    expect(response).toEqual({ status: 200, body: { ok: true, effort: 'medium', source: 'explicit' } });
    expect(deps.applyLiveEffort).toHaveBeenCalledWith(
      expect.objectContaining({ paneId: 'agent-pan-1', workspace: '/tmp/ws-pan-1', sessionId: 'session-1', caller: 'agent-effort' }),
      'medium',
    );
    expect(deps.saveAgentState).toHaveBeenCalledTimes(1);
    expect(deps.saveAgentState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-pan-1', effort: 'medium', effortSource: 'explicit' }),
    );
  });

  it('uses the supervisor delivery method for a supervisor-backed agent', async () => {
    const deps = makeDeps({ ok: true, effort: 'low' }, {
      getAgentState: vi.fn(() => agentState({ supervisorEnabled: true })),
    });

    await handleAgentLiveEffort('agent-pan-1', { level: 'low' }, deps);

    expect(deps.applyLiveEffort).toHaveBeenCalledWith(expect.objectContaining({ deliveryMethod: 'supervisor' }), 'low');
  });

  it('answers 504 and writes nothing when Claude Code does not confirm', async () => {
    const deps = makeDeps({ ok: false, code: 'not-confirmed', error: 'no confirmation' });

    const response = await handleAgentLiveEffort('agent-pan-1', { level: 'medium' }, deps);

    expect(response).toEqual({ status: 504, body: { error: 'no confirmation', code: 'not-confirmed' } });
    expect(deps.saveAgentState).not.toHaveBeenCalled();
  });

  it('refuses a codex agent without delivering', async () => {
    const deps = makeDeps({ ok: true, effort: 'low' }, {
      getAgentState: vi.fn(() => agentState({ harness: 'codex' })),
    });

    const response = await handleAgentLiveEffort('agent-pan-1', { level: 'low' }, deps);

    expect(response.status).toBe(400);
    expect(deps.applyLiveEffort).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown agent', async () => {
    const deps = makeDeps({ ok: true, effort: 'low' }, { getAgentState: vi.fn(() => null) });

    const response = await handleAgentLiveEffort('agent-missing', { level: 'low' }, deps);

    expect(response.status).toBe(404);
    expect(deps.applyLiveEffort).not.toHaveBeenCalled();
  });

  it('answers 422 for a dead session', async () => {
    const deps = makeDeps({ ok: true, effort: 'low' }, { isAlive: vi.fn(async () => ({ alive: false }) as never) });

    const response = await handleAgentLiveEffort('agent-pan-1', { level: 'low' }, deps);

    expect(response.status).toBe(422);
    expect(deps.applyLiveEffort).not.toHaveBeenCalled();
  });

  it('answers 400 for an invalid level', async () => {
    const deps = makeDeps({ ok: true, effort: 'low' });

    const response = await handleAgentLiveEffort('agent-pan-1', { level: 'auto' }, deps);

    expect(response.status).toBe(400);
    expect(deps.applyLiveEffort).not.toHaveBeenCalled();
  });

  it('answers 422 when the agent has no transcript yet', async () => {
    const deps = makeDeps({ ok: true, effort: 'low' }, { getLatestSessionId: vi.fn(() => null) });

    const response = await handleAgentLiveEffort('agent-pan-1', { level: 'low' }, deps);

    expect(response.status).toBe(422);
    expect(deps.applyLiveEffort).not.toHaveBeenCalled();
  });
});
