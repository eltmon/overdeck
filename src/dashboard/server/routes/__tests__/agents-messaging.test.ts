import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: agentMocks.getAgentState,
  messageAgent: agentMocks.messageAgent,
}));

import { handleAgentMessage } from '../agents/messaging.js';

function decodeJsonResponse(response: { body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  agentMocks.getAgentState.mockReturnValue(Effect.succeed({
    id: 'agent-pan-42',
    issueId: 'PAN-42',
    workspace: '/tmp/pan-42',
    harness: 'codex',
  }));
});

describe('agent message composer routing', () => {
  it('intercepts /pan with the shared structured result and skips messageAgent', async () => {
    const response = await handleAgentMessage('agent-pan-42', '/pan status');

    expect(response.status).toBe(422);
    expect(decodeJsonResponse(response)).toEqual({
      kind: 'terminal-only',
      status: 'rejected',
      message: '/pan status is recognized as a captured command, but its composer executor is not registered yet. Run it in a terminal for now.',
    });
    expect(agentMocks.getAgentState).toHaveBeenCalledWith('agent-pan-42');
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
  });

  it('returns shared parser errors without messaging the agent', async () => {
    const response = await handleAgentMessage('agent-pan-42', '/pan bogus');

    expect(response.status).toBe(404);
    expect(decodeJsonResponse(response)).toMatchObject({
      code: 'unknown-command',
      token: 'bogus',
      expected: '/pan <command>',
    });
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
  });

  it('preserves ordinary agent message delivery', async () => {
    const response = await handleAgentMessage('agent-pan-42', 'please continue');

    expect(response.status).toBe(200);
    expect(decodeJsonResponse(response)).toEqual({ success: true });
    expect(agentMocks.getAgentState).not.toHaveBeenCalled();
    expect(agentMocks.messageAgent).toHaveBeenCalledWith(
      'agent-pan-42',
      'please continue',
      'dashboard:user-message',
    );
  });
});
