import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn().mockResolvedValue(undefined),
  runCapturedCommand: vi.fn(async (argv: readonly string[]) => ({
    kind: 'captured' as const,
    status: 'completed' as const,
    command: `/pan ${argv.join(' ')}`,
    output: 'captured output',
    truncated: false,
  })),
}));

vi.mock('../../../../lib/composer-commands/executors.js', () => ({
  runCapturedCommand: agentMocks.runCapturedCommand,
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

    expect(response.status).toBe(200);
    expect(decodeJsonResponse(response)).toEqual({
      kind: 'captured',
      status: 'completed',
      command: '/pan status',
      output: 'captured output',
      truncated: false,
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

  it('returns 404 without executing a command when the agent target is missing', async () => {
    agentMocks.getAgentState.mockReturnValue(Effect.succeed(null));

    const response = await handleAgentMessage('missing-agent', '/pan status');

    expect(response.status).toBe(404);
    expect(decodeJsonResponse(response)).toEqual({
      error: 'Agent not found: missing-agent',
      code: 'agent-not-found',
    });
    expect(agentMocks.runCapturedCommand).not.toHaveBeenCalled();
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
  });

  it('returns 503 without executing a command when agent resolution fails', async () => {
    agentMocks.getAgentState.mockReturnValue(Effect.fail(new Error('registry unavailable')));

    const response = await handleAgentMessage('agent-pan-42', '/pan status');

    expect(response.status).toBe(503);
    expect(decodeJsonResponse(response)).toEqual({
      error: 'Failed to resolve agent target: agent-pan-42',
      code: 'agent-resolution-failed',
    });
    expect(agentMocks.runCapturedCommand).not.toHaveBeenCalled();
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
  });

  it('returns 503 without executing a command when the agent harness is unresolved', async () => {
    agentMocks.getAgentState.mockReturnValue(Effect.succeed({
      id: 'agent-pan-42',
      issueId: 'PAN-42',
      workspace: '/tmp/pan-42',
    }));

    const response = await handleAgentMessage('agent-pan-42', '/pan status');

    expect(response.status).toBe(503);
    expect(decodeJsonResponse(response)).toEqual({
      error: 'Agent harness could not be resolved: agent-pan-42',
      code: 'agent-harness-unresolved',
    });
    expect(agentMocks.runCapturedCommand).not.toHaveBeenCalled();
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
