import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LINEAR_MCP_AUTH_VERIFY_COPY,
  LINEAR_MCP_AUTH_VERIFY_THROTTLE_MS,
  requestLinearMcpAuthVerify,
  _resetLinearMcpAuthVerifyForTests,
} from '../linear-mcp-auth-verify.js';
import type { LinearMcpAuthIntervention } from '../linear-mcp-auth.js';

const OWNER = 'conv-20261001-eba1';

function intervention(overrides: Partial<LinearMcpAuthIntervention> = {}): LinearMcpAuthIntervention {
  return {
    status: 'active',
    authUrl: 'https://linear.app/oauth/authorize?state=fresh',
    authUrlAgentId: OWNER,
    authUrlExpiresAt: '2026-10-01T12:30:00.000Z',
    declaredAt: '2026-10-01T12:00:00.000Z',
    blockedAgents: [
      { agentId: OWNER, issueId: null, declaredAt: '2026-10-01T12:00:00.000Z', expiresAt: '2026-10-01T12:30:00.000Z', notifiedAt: null },
    ],
    ...overrides,
  };
}

describe('requestLinearMcpAuthVerify', () => {
  let clock: number;
  let resolve: ReturnType<typeof vi.fn>;
  let messageAgent: ReturnType<typeof vi.fn>;
  const deps = () => ({ resolve, messageAgent, now: () => clock });

  beforeEach(() => {
    _resetLinearMcpAuthVerifyForTests();
    clock = Date.parse('2026-10-01T12:15:00.000Z');
    resolve = vi.fn().mockResolvedValue(intervention());
    messageAgent = vi.fn().mockResolvedValue({ delivered: true, queuedToMail: false });
  });

  it('reports already-connected when no lifecycle is open', async () => {
    resolve.mockResolvedValue(intervention({ status: 'none', authUrlAgentId: null, blockedAgents: [] }));

    await expect(requestLinearMcpAuthVerify(deps())).resolves.toEqual({ kind: 'already-connected' });
    expect(messageAgent).not.toHaveBeenCalled();
  });

  it('reports no-owner when no agent owns the authorization URL', async () => {
    resolve.mockResolvedValue(intervention({ authUrlAgentId: null }));

    await expect(requestLinearMcpAuthVerify(deps())).resolves.toEqual({ kind: 'no-owner' });
    expect(messageAgent).not.toHaveBeenCalled();
  });

  it('messages the owner with the verify copy', async () => {
    await expect(requestLinearMcpAuthVerify(deps())).resolves.toEqual({ kind: 'requested', requestedFrom: OWNER });
    expect(messageAgent).toHaveBeenCalledWith(OWNER, LINEAR_MCP_AUTH_VERIFY_COPY, 'linear-mcp-auth-verify');
  });

  it('forbids a second authenticate call in the verify copy', () => {
    expect(LINEAR_MCP_AUTH_VERIFY_COPY).toContain('do NOT call mcp__linear__authenticate');
  });

  it('throttles a repeat verify for the same lifecycle within 15 s', async () => {
    await requestLinearMcpAuthVerify(deps());
    clock += LINEAR_MCP_AUTH_VERIFY_THROTTLE_MS - 1;
    await expect(requestLinearMcpAuthVerify(deps())).resolves.toEqual({ kind: 'requested', requestedFrom: OWNER });
    expect(messageAgent).toHaveBeenCalledTimes(1);

    clock += 1;
    await requestLinearMcpAuthVerify(deps());
    expect(messageAgent).toHaveBeenCalledTimes(2);
  });

  it('reports unreachable with the delivery reason when the owner is not delivered', async () => {
    messageAgent.mockResolvedValue({ delivered: false, queuedToMail: false, reason: 'pane is gone' });

    const result = await requestLinearMcpAuthVerify(deps());

    expect(result.kind).toBe('unreachable');
    expect(result).toMatchObject({ error: expect.stringContaining('pane is gone') });
  });

  it('reports unreachable when delivery throws, and does not throttle the retry', async () => {
    messageAgent.mockRejectedValueOnce(new Error('door closed'));

    await expect(requestLinearMcpAuthVerify(deps())).resolves.toMatchObject({
      kind: 'unreachable',
      error: expect.stringContaining('door closed'),
    });
    await expect(requestLinearMcpAuthVerify(deps())).resolves.toEqual({ kind: 'requested', requestedFrom: OWNER });
    expect(messageAgent).toHaveBeenCalledTimes(2);
  });
});
