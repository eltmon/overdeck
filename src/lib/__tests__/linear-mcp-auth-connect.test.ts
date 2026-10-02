import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectLinearMcpAuth,
  LINEAR_MCP_AUTH_REFRESH_COPY,
  LINEAR_MCP_AUTH_REFRESH_THROTTLE_MS,
  LINEAR_MCP_AUTH_REFRESH_UNREACHABLE_ERROR,
  _resetLinearMcpAuthConnectForTests,
  type ConnectDeps,
} from '../linear-mcp-auth-connect.js';
import type { LinearMcpAuthIntervention } from '../linear-mcp-auth.js';
import type { LivenessVerdict } from '../agents/liveness.js';

const OWNER = 'conv-20261001-eba1';
const AUTH_URL = 'https://linear.app/oauth/authorize?state=old';

function intervention(overrides: Partial<LinearMcpAuthIntervention> = {}): LinearMcpAuthIntervention {
  return {
    status: 'active',
    authUrl: AUTH_URL,
    authUrlAgentId: OWNER,
    authUrlExpiresAt: '2026-10-01T12:30:00.000Z',
    declaredAt: '2026-10-01T12:00:00.000Z',
    blockedAgents: [
      { agentId: OWNER, issueId: null, declaredAt: '2026-10-01T12:00:00.000Z', expiresAt: '2026-10-01T12:30:00.000Z', notifiedAt: null },
      { agentId: 'agent-pan-1', issueId: 'PAN-1', declaredAt: '2026-10-01T12:05:00.000Z', expiresAt: '2026-10-01T12:35:00.000Z', notifiedAt: null },
      { agentId: 'agent-pan-2', issueId: 'PAN-2', declaredAt: '2026-10-01T12:10:00.000Z', expiresAt: '2026-10-01T12:40:00.000Z', notifiedAt: null },
    ],
    ...overrides,
  };
}

const ALIVE: LivenessVerdict = { alive: true, paneAlive: true };
const DELIVERED = { delivered: true, queuedToMail: false };
const NOT_DELIVERED = { delivered: false, queuedToMail: false, reason: 'pane gone' };

describe('connectLinearMcpAuth', () => {
  let clock: number;
  let deps: Required<ConnectDeps> & {
    resolve: ReturnType<typeof vi.fn>;
    isAlive: ReturnType<typeof vi.fn>;
    messageAgent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    _resetLinearMcpAuthConnectForTests();
    clock = Date.parse('2026-10-01T12:15:00.000Z');
    deps = {
      resolve: vi.fn().mockResolvedValue(intervention()),
      isAlive: vi.fn().mockResolvedValue(ALIVE),
      messageAgent: vi.fn().mockResolvedValue(DELIVERED),
      now: () => clock,
    };
  });

  it('returns nothing-pending when no lifecycle is open', async () => {
    deps.resolve.mockResolvedValue(intervention({ status: 'none', authUrl: null, authUrlAgentId: null, declaredAt: null, blockedAgents: [] }));

    await expect(connectLinearMcpAuth(deps)).resolves.toEqual({ kind: 'nothing-pending' });
    expect(deps.messageAgent).not.toHaveBeenCalled();
  });

  it('opens an active link whose owner is alive without messaging anyone', async () => {
    await expect(connectLinearMcpAuth(deps)).resolves.toEqual({ kind: 'open', authUrl: AUTH_URL, authUrlAgentId: OWNER });
    expect(deps.isAlive).toHaveBeenCalledWith(OWNER);
    expect(deps.messageAgent).not.toHaveBeenCalled();
  });

  it('opens when the liveness probe is indeterminate or throws', async () => {
    deps.isAlive.mockResolvedValueOnce({ alive: false, reason: 'runtime-indeterminate' });
    await expect(connectLinearMcpAuth(deps)).resolves.toMatchObject({ kind: 'open' });

    deps.isAlive.mockRejectedValueOnce(new Error('probe failed'));
    await expect(connectLinearMcpAuth(deps)).resolves.toMatchObject({ kind: 'open' });
    expect(deps.messageAgent).not.toHaveBeenCalled();
  });

  it('refreshes an expired link from the owner first with the refresh copy', async () => {
    deps.resolve.mockResolvedValue(intervention({ status: 'expired' }));

    await expect(connectLinearMcpAuth(deps)).resolves.toEqual({
      kind: 'refreshing',
      requestedFrom: OWNER,
      previousAuthUrl: AUTH_URL,
    });
    expect(deps.messageAgent).toHaveBeenCalledTimes(1);
    expect(deps.messageAgent).toHaveBeenCalledWith(OWNER, LINEAR_MCP_AUTH_REFRESH_COPY, 'linear-mcp-auth-refresh');
  });

  it('refreshes an active link whose owner is confirmed dead', async () => {
    deps.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });

    await expect(connectLinearMcpAuth(deps)).resolves.toMatchObject({ kind: 'refreshing', requestedFrom: OWNER });
  });

  it('falls through to the newest-declared candidate when the owner is not delivered', async () => {
    deps.resolve.mockResolvedValue(intervention({ status: 'expired' }));
    deps.messageAgent
      .mockResolvedValueOnce(NOT_DELIVERED)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(DELIVERED);

    await expect(connectLinearMcpAuth(deps)).resolves.toMatchObject({ kind: 'refreshing', requestedFrom: 'agent-pan-1' });
    expect(deps.messageAgent.mock.calls.map(call => call[0])).toEqual([OWNER, 'agent-pan-2', 'agent-pan-1']);
  });

  it('returns unreachable when no candidate is delivered', async () => {
    deps.resolve.mockResolvedValue(intervention({ status: 'expired' }));
    deps.messageAgent.mockResolvedValue(NOT_DELIVERED);

    await expect(connectLinearMcpAuth(deps)).resolves.toEqual({
      kind: 'unreachable',
      error: LINEAR_MCP_AUTH_REFRESH_UNREACHABLE_ERROR,
    });
    expect(deps.messageAgent).toHaveBeenCalledTimes(3);
  });

  it('throttles a second refresh for the same lifecycle within 60 s, then sends again after', async () => {
    deps.resolve.mockResolvedValue(intervention({ status: 'expired' }));

    await connectLinearMcpAuth(deps);
    clock += LINEAR_MCP_AUTH_REFRESH_THROTTLE_MS - 1;
    await expect(connectLinearMcpAuth(deps)).resolves.toMatchObject({ kind: 'refreshing', requestedFrom: OWNER });
    expect(deps.messageAgent).toHaveBeenCalledTimes(1);

    clock += 1;
    await connectLinearMcpAuth(deps);
    expect(deps.messageAgent).toHaveBeenCalledTimes(2);
  });

  it('does not throttle a refresh for a different lifecycle', async () => {
    deps.resolve.mockResolvedValue(intervention({ status: 'expired' }));
    await connectLinearMcpAuth(deps);

    deps.resolve.mockResolvedValue(intervention({ status: 'expired', declaredAt: '2026-10-01T13:00:00.000Z' }));
    await connectLinearMcpAuth(deps);

    expect(deps.messageAgent).toHaveBeenCalledTimes(2);
  });
});
