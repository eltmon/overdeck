import { beforeEach, describe, expect, it } from 'vitest';

import { validateAgentDeliveryMethodOrigin, validateAgentMessageOrigin, validateAgentRuntimeEventAuth } from '../agents.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { validateSpecialistAutoCompleteMetadata } from '../specialists.js';

describe('agent mutation origin validation', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    process.env.PORT = '3011';
    delete process.env.DASHBOARD_URL;
    delete process.env.PANOPTICON_INTERNAL_TOKEN;
    _resetTrustedOriginsForTests();
  });

  it('rejects cross-origin delivery method POSTs before mutating delivery method', () => {
    const result = validateAgentDeliveryMethodOrigin({
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
      },
    } as any);

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { error: 'forbidden' },
    });
  });

  it('rejects cross-origin message and tell POSTs before delivering agent instructions', () => {
    const result = validateAgentMessageOrigin({
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
      },
    } as any);

    expect(result.ok).toBe(false);
  });

  it('rejects missing-origin message and tell POSTs before delivering agent instructions', () => {
    const result = validateAgentMessageOrigin({
      method: 'POST',
      headers: {},
    } as any);

    expect(result.ok).toBe(false);
  });

  it('rejects agent runtime event POSTs without the internal token', async () => {
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';

    const result = await validateAgentRuntimeEventAuth({
      method: 'POST',
      headers: {},
    } as any);

    expect(result.ok).toBe(false);
  });

  it('allows agent runtime event POSTs with the internal token', async () => {
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';

    const result = await validateAgentRuntimeEventAuth({
      method: 'POST',
      headers: { 'x-panopticon-internal-token': 'test-token' },
    } as any);

    expect(result.ok).toBe(true);
  });
});

describe('specialist auto-complete metadata validation', () => {
  const reviewAgentState = {
    id: 'agent-pan-1134-review',
    issueId: 'PAN-1134',
    workspace: '/tmp/workspace',
    role: 'review',
    model: 'pi',
    status: 'running',
    startedAt: '2026-05-27T00:00:00.000Z',
  } as const;

  it('rejects transcript-only completion without trusted agent metadata', () => {
    const result = validateSpecialistAutoCompleteMetadata(
      'review-agent',
      { issueId: 'PAN-1134', status: 'passed' },
      null,
      null,
    );

    expect(result).toEqual({ ok: false, status: 400, error: 'agentId and role required' });
  });

  it('rejects mismatched specialist role metadata', () => {
    const result = validateSpecialistAutoCompleteMetadata(
      'review-agent',
      { agentId: 'agent-pan-1134-test', issueId: 'PAN-1134', role: 'test', status: 'passed' },
      { ...reviewAgentState, id: 'agent-pan-1134-test', role: 'test' } as any,
      null,
    );

    expect(result).toEqual({ ok: false, status: 403, error: 'role does not match specialist' });
  });

  it('rejects stale session metadata for an active specialist run', () => {
    const result = validateSpecialistAutoCompleteMetadata(
      'review-agent',
      { agentId: 'agent-pan-1134-review', issueId: 'PAN-1134', role: 'review', sessionId: 'old-session', status: 'passed' },
      reviewAgentState as any,
      { state: 'active', lastActivity: '2026-05-27T00:01:00.000Z', claudeSessionId: 'current-session' },
    );

    expect(result).toEqual({ ok: false, status: 403, error: 'session does not match active run' });
  });

  it('allows matching authenticated runtime metadata', () => {
    const result = validateSpecialistAutoCompleteMetadata(
      'review-agent',
      { agentId: 'agent-pan-1134-review', issueId: 'PAN-1134', role: 'review', sessionId: 'current-session', status: 'passed' },
      reviewAgentState as any,
      { state: 'active', lastActivity: '2026-05-27T00:01:00.000Z', claudeSessionId: 'current-session' },
    );

    expect(result).toEqual({ ok: true });
  });
});
