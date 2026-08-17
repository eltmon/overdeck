import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendCallbackRelayed: vi.fn(),
  appendHealthy: vi.fn(),
  messageAgent: vi.fn(),
  resolve: vi.fn(),
  getIssues: vi.fn(),
  getConversationByName: vi.fn(),
}));

vi.mock('../../../../lib/agents/messaging.js', () => ({
  messageAgent: mocks.messageAgent,
}));

vi.mock('../../../../lib/linear-mcp-auth.js', () => ({
  appendLinearMcpAuthCallbackRelayedEvent: mocks.appendCallbackRelayed,
  appendLinearMcpAuthHealthyEvent: mocks.appendHealthy,
  resolveLinearMcpAuthIntervention: mocks.resolve,
}));

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(() => ({ getIssues: mocks.getIssues })),
}));

vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  getConversationByName: mocks.getConversationByName,
}));

import {
  LINEAR_MCP_AUTH_CALLBACK_COPY_PREFIX,
  linearMcpAuthRouteLayer,
} from '../linear-mcp-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';

const NONE = {
  status: 'none',
  authUrl: null,
  authUrlAgentId: null,
  authUrlExpiresAt: null,
  declaredAt: null,
  blockedAgents: [],
};

const ACTIVE = {
  status: 'active',
  authUrl: 'https://linear.app/oauth/authorize?state=auth-state',
  authUrlAgentId: 'agent-min-852',
  authUrlExpiresAt: '2026-07-21T12:30:00.000Z',
  declaredAt: '2026-07-21T12:00:00.000Z',
  blockedAgents: [{
    agentId: 'agent-min-852',
    issueId: 'MIN-852',
    declaredAt: '2026-07-21T12:00:00.000Z',
    expiresAt: '2026-07-21T12:30:00.000Z',
    notifiedAt: null,
  }],
};

async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  includeOrigin = true,
) {
  const headers = new Headers();
  if (includeOrigin) headers.set('origin', 'http://localhost:3011');
  if (body !== undefined) headers.set('content-type', 'application/json');
  const webRequest = new Request(`http://localhost:3011${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const httpRequest = HttpServerRequest.fromWeb(webRequest);
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(linearMcpAuthRouteLayer), app =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, httpRequest)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

describe('Linear MCP auth routes', () => {
  beforeEach(() => {
    process.env.PORT = '3011';
    delete process.env.DASHBOARD_URL;
    delete process.env.OVERDECK_TRUSTED_ORIGINS;
    _resetTrustedOriginsForTests();
    mocks.appendCallbackRelayed.mockReset().mockResolvedValue(1);
    mocks.appendHealthy.mockReset().mockResolvedValue(1);
    mocks.messageAgent.mockReset().mockResolvedValue(undefined);
    mocks.resolve.mockReset().mockResolvedValue(NONE);
    mocks.getIssues.mockReset().mockReturnValue([]);
    mocks.getConversationByName.mockReset().mockReturnValue(null);
  });

  it('GET returns the projection without side effects', async () => {
    mocks.resolve.mockResolvedValue(ACTIVE);

    const result = await request('GET', '/api/linear-mcp-auth');

    expect(result).toEqual({
      status: 200,
      body: {
        ...ACTIVE,
        blockedAgents: [{ ...ACTIVE.blockedAgents[0], issueUrl: null, conversationUrl: null }],
      },
    });
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.appendCallbackRelayed).not.toHaveBeenCalled();
    expect(mocks.appendHealthy).not.toHaveBeenCalled();
  });

  it('GET enriches each blocked agent with its canonical tracker URL', async () => {
    mocks.resolve.mockResolvedValue(ACTIVE);
    mocks.getIssues.mockReturnValue([
      { identifier: 'MIN-852', url: 'https://linear.app/mind-your-now/issue/MIN-852/habits-full-bug-audit' },
    ]);

    const result = await request('GET', '/api/linear-mcp-auth');

    expect(result.status).toBe(200);
    expect((result.body['blockedAgents'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      agentId: 'agent-min-852',
      issueUrl: 'https://linear.app/mind-your-now/issue/MIN-852/habits-full-bug-audit',
    });
  });

  it('GET enriches a blocked conversation with its canonical /conv/<rowid> URL', async () => {
    mocks.resolve.mockResolvedValue({
      ...ACTIVE,
      authUrlAgentId: 'conv-20260815-f8c3',
      blockedAgents: [{
        agentId: 'conv-20260815-f8c3',
        issueId: null,
        declaredAt: '2026-08-15T12:19:35.000Z',
        expiresAt: '2026-08-15T16:52:22.000Z',
        notifiedAt: null,
      }],
    });
    mocks.getConversationByName.mockReturnValue({ id: 173, name: 'conv-20260815-f8c3' });

    const result = await request('GET', '/api/linear-mcp-auth');

    expect(result.status).toBe(200);
    expect(mocks.getConversationByName).toHaveBeenCalledWith('conv-20260815-f8c3');
    expect((result.body['blockedAgents'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      agentId: 'conv-20260815-f8c3',
      conversationUrl: '/conv/173',
    });
  });

  it('GET projects a null conversationUrl for non-conversation agents and unresolved conversations', async () => {
    mocks.resolve.mockResolvedValue({
      ...ACTIVE,
      blockedAgents: [
        { ...ACTIVE.blockedAgents[0] },
        {
          agentId: 'conv-20260815-0000',
          issueId: null,
          declaredAt: '2026-08-15T12:19:35.000Z',
          expiresAt: '2026-08-15T16:52:22.000Z',
          notifiedAt: null,
        },
      ],
    });
    mocks.getConversationByName.mockReturnValue(null);

    const result = await request('GET', '/api/linear-mcp-auth');

    expect(result.status).toBe(200);
    const agents = result.body['blockedAgents'] as Array<Record<string, unknown>>;
    expect(agents[0]).toMatchObject({ agentId: 'agent-min-852', conversationUrl: null });
    expect(agents[1]).toMatchObject({ agentId: 'conv-20260815-0000', conversationUrl: null });
    // The read door is only consulted for conv-* agents.
    expect(mocks.getConversationByName).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationByName).toHaveBeenCalledWith('conv-20260815-0000');
  });

  it.each([
    'https://evil.example/callback?code=abc&state=xyz',
    'http://localhost:43110/callback?code=abc',
    'http://127.0.0.1:43110/callback?state=xyz',
  ])('POST callback rejects invalid URL %s', async (callbackUrl) => {
    const result = await request('POST', '/api/linear-mcp-auth/callback', { callbackUrl });

    expect(result.status).toBe(400);
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('POST callback rejects when no agent owns an authorization URL', async () => {
    const result = await request('POST', '/api/linear-mcp-auth/callback', {
      callbackUrl: 'http://localhost:43110/callback?code=abc&state=xyz',
    });

    expect(result.status).toBe(409);
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('POST callback relays the exact URL and records callback_relayed', async () => {
    mocks.resolve.mockResolvedValue(ACTIVE);
    const callbackUrl = 'http://localhost:43110/callback?code=abc&state=xyz';

    const result = await request('POST', '/api/linear-mcp-auth/callback', { callbackUrl });

    expect(result).toEqual({
      status: 200,
      body: { success: true, relayedTo: 'agent-min-852' },
    });
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      `${LINEAR_MCP_AUTH_CALLBACK_COPY_PREFIX} ${callbackUrl} — then re-check Linear access and resume your canonical task.`,
      'linear-mcp-auth-callback',
    );
    expect(mocks.appendCallbackRelayed).toHaveBeenCalledWith({
      agentId: 'agent-min-852',
      issueId: 'MIN-852',
    });
  });

  it('POST complete records operator-source healthy', async () => {
    const result = await request('POST', '/api/linear-mcp-auth/complete');

    expect(result).toEqual({ status: 200, body: { success: true } });
    expect(mocks.appendHealthy).toHaveBeenCalledWith({
      agentId: 'operator',
      issueId: null,
      source: 'operator',
    });
  });

  it('POST mutations reject requests without an origin', async () => {
    const result = await request('POST', '/api/linear-mcp-auth/complete', undefined, false);

    expect(result.status).toBe(403);
    expect(mocks.appendHealthy).not.toHaveBeenCalled();
  });
});
