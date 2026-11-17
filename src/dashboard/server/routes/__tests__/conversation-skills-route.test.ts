/** PAN-5465 WI-5: the conversation skill routes. The apply service is spied; the conversation lookup is mocked. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelfCallerDeps } from '../../self-caller.js';
import type { DashboardCredential } from '../dashboard-auth.js';

const mocks = vi.hoisted(() => ({
  getConversationByName: vi.fn(),
  applyConversationSkills: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/conversations.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/conversations.js')>()),
  getConversationByName: mocks.getConversationByName,
}));

vi.mock('../../../../lib/overdeck/conversation-skill-apply.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/conversation-skill-apply.js')>()),
  applyConversationSkills: mocks.applyConversationSkills,
}));

import { requiredScopeFor } from '../../route-scopes.js';
import { conversationSkillRoutes, handleSelfSkillsAdd, NOT_A_CONVERSATION } from '../conversation-skills.js';

async function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', origin: 'http://localhost:3010' } };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationSkillRoutes), app =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const AGENT_TOKEN: DashboardCredential = { kind: 'token', tokenId: 't', scopes: ['operate'], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' };
const CONVERSATION_TOKEN: DashboardCredential = { kind: 'token', tokenId: 't', scopes: ['operate'], agentId: 'conv-a', agentKind: 'conversation', role: 'conversation' };
const callerDeps: SelfCallerDeps = {
  getAgentState: () => ({ workspace: '/w', issueId: 'PAN-1' }),
  getConversationByName: () => ({ cwd: '/w', tmuxSession: 'conv-a', issueId: null }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConversationByName.mockReturnValue(null);
  mocks.applyConversationSkills.mockResolvedValue({ status: 200, body: { outcome: 'queued', added: ['mattpocock/tdd'], warnings: [] } });
});

describe('conversation skill routes', () => {
  it('maps the scopes', () => {
    expect(requiredScopeFor('GET', '/api/conversations/conv-a/skills')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/conversations/conv-a/skills')).toBe('operate');
    expect(requiredScopeFor('POST', '/api/self/skills')).toBe('operate');
  });

  it('GET of an unknown conversation answers 404', async () => {
    expect(await request('GET', '/api/conversations/conv-zz/skills')).toEqual({ status: 404, body: { error: 'Conversation not found' } });
    expect(mocks.getConversationByName).toHaveBeenCalledWith('conv-zz');
  });

  it('POST with a malformed packs value answers 400 Invalid packs without applying', async () => {
    expect(await request('POST', '/api/conversations/conv-a/skills', { packs: 'mattpocock' })).toEqual({ status: 400, body: { error: 'Invalid packs' } });
    expect(await request('POST', '/api/conversations/conv-a/skills', '{not json')).toEqual({ status: 400, body: { error: 'body must be JSON' } });
    expect(mocks.applyConversationSkills).not.toHaveBeenCalled();
  });

  it('POST applies the parsed body to the named conversation', async () => {
    const result = await request('POST', '/api/conversations/conv-a/skills', { packs: ['mattpocock'], restart: true });
    expect(result).toEqual({ status: 200, body: { outcome: 'queued', added: ['mattpocock/tdd'], warnings: [] } });
    expect(mocks.applyConversationSkills).toHaveBeenCalledWith('conv-a', { skills: [], packs: ['mattpocock'], off: [], restart: true }, { self: false });
  });
});

describe('POST /api/self/skills', () => {
  it('answers 409 not-a-conversation for an agent-kind token', async () => {
    expect(await handleSelfSkillsAdd(AGENT_TOKEN, { packs: ['mattpocock'] }, { caller: callerDeps }))
      .toEqual({ status: 409, body: NOT_A_CONVERSATION });
    expect(mocks.applyConversationSkills).not.toHaveBeenCalled();
  });

  it('applies to the token conversation with self: true, and an empty body parses as {}', async () => {
    const result = await handleSelfSkillsAdd(CONVERSATION_TOKEN, { packs: ['mattpocock'] }, { caller: callerDeps });
    expect(result).toEqual({ status: 200, body: { outcome: 'queued', added: ['mattpocock/tdd'], warnings: [] } });
    expect(mocks.applyConversationSkills).toHaveBeenCalledWith('conv-a', { skills: [], packs: ['mattpocock'], off: [], restart: false }, { self: true });
    await handleSelfSkillsAdd(CONVERSATION_TOKEN, null, { caller: callerDeps });
    expect(mocks.applyConversationSkills).toHaveBeenLastCalledWith('conv-a', { skills: [], packs: [], off: [], restart: false }, { self: true });
  });

  it('refuses a non-agent credential with 403', async () => {
    expect((await handleSelfSkillsAdd({ kind: 'token', tokenId: 't', scopes: ['operate'] }, {}, { caller: callerDeps })).status).toBe(403);
  });
});
