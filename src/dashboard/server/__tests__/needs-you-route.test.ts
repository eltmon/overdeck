/** PAN-4944 (PAN-4927 W-APPR1, D-1–D-3): GET /api/needs-you — this machine's Needs-You for any read:conversations token. */
import { describe, expect, it } from 'vitest';
import { HttpServerResponse } from 'effect/unstable/http';

import { requiredScopeFor } from '../route-scopes.js';
import { handleLocalNeedsYou, localNeedsYou, type LocalNeedsYouDeps } from '../routes/needs-you.js';
import type { NeedsYouFeed } from '../services/needs-you-feed.js';

const feed = (overrides: Partial<NeedsYouFeed> = {}): NeedsYouFeed => ({
  hash: 'should-be-dropped',
  conversations: [{ name: 'conv-a' }],
  agents: [{ id: 'agent-pan-1', issueId: 'PAN-1', pendingInputKinds: ['exitPlanMode'] }],
  ...overrides,
});

function deps(overrides: Partial<LocalNeedsYouDeps> = {}): LocalNeedsYouDeps {
  return {
    build: async () => feed(),
    snapshot: async () => ({ agents: [], channelPermissionRequests: [] }),
    ...overrides,
  };
}

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

describe('localNeedsYou (PAN-4944)', () => {
  it('returns { conversations, agents } and drops hash', async () => {
    const result = await localNeedsYou(deps());
    expect(result).toEqual({ conversations: [{ name: 'conv-a' }], agents: [{ id: 'agent-pan-1', issueId: 'PAN-1', pendingInputKinds: ['exitPlanMode'] }] });
    expect(result).not.toHaveProperty('hash');
  });

  it('copies a snapshot agent\'s pendingAskUserQuestion onto its row', async () => {
    const result = await localNeedsYou(deps({
      snapshot: async () => ({
        agents: [{ id: 'agent-pan-1', pendingAskUserQuestion: { toolUseId: 't1', askedAt: '2026-11-03T00:00:00.000Z', questions: [] } }],
      }),
    }));
    expect(result.agents[0]?.pendingAskUserQuestion).toEqual({ toolUseId: 't1', askedAt: '2026-11-03T00:00:00.000Z', questions: [] });
  });

  it('adds permissionRequests (redacted) and appends permissionRequest to pendingInputKinds exactly once', async () => {
    const result = await localNeedsYou(deps({
      snapshot: async () => ({
        agents: [],
        channelPermissionRequests: [
          { requestId: 'req-1', agentId: 'agent-pan-1', toolName: 'Bash', description: 'run a command', inputPreview: 'token: ghp_abc123', createdAt: '2026-11-03T00:00:00.000Z' },
        ],
      }),
    }));
    const agent = result.agents.find((a) => a.id === 'agent-pan-1');
    expect(agent?.permissionRequests).toEqual([
      { requestId: 'req-1', toolName: 'Bash', description: 'run a command', inputPreview: 'token: [REDACTED]', createdAt: '2026-11-03T00:00:00.000Z' },
    ]);
    expect(agent?.pendingInputKinds.filter((kind) => kind === 'permissionRequest')).toHaveLength(1);
    expect(agent?.pendingInputKinds).toContain('exitPlanMode');
  });

  it('adds an agent present only in channelPermissionRequests', async () => {
    const result = await localNeedsYou(deps({
      build: async () => feed({ agents: [] }),
      snapshot: async () => ({
        agents: [],
        channelPermissionRequests: [
          { requestId: 'req-2', agentId: 'agent-pan-2', issueId: 'PAN-2', toolName: 'Write', description: 'write a file', inputPreview: 'ok', createdAt: '2026-11-03T00:00:00.000Z' },
        ],
      }),
    }));
    expect(result.agents).toEqual([
      {
        id: 'agent-pan-2',
        issueId: 'PAN-2',
        pendingInputKinds: ['permissionRequest'],
        permissionRequests: [{ requestId: 'req-2', toolName: 'Write', description: 'write a file', inputPreview: 'ok', createdAt: '2026-11-03T00:00:00.000Z' }],
      },
    ]);
  });
});

describe('handleLocalNeedsYou (PAN-4944)', () => {
  it('answers 500 with the standard error text when build throws', async () => {
    const { status, json } = await read(await handleLocalNeedsYou(deps({ build: () => { throw new Error('boom'); } })));
    expect(status).toBe(500);
    expect(json).toEqual({ error: 'the Needs-You feed could not be built' });
  });
});

describe('route-scopes (PAN-4944)', () => {
  it('requires read:conversations for GET /api/needs-you', () => {
    expect(requiredScopeFor('GET', '/api/needs-you')).toBe('read:conversations');
  });
});
