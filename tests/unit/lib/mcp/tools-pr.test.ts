/**
 * PAN-4943 W-PR1 WI-7: the link_pull_request MCP tool.
 */
import { describe, expect, it } from 'vitest';

import { PR_LINK_TOOLS } from '../../../../src/lib/mcp/tools-pr.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:conversations', 'tell'];
const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';

describe('MCP tool: link_pull_request (PAN-4943 WI-7)', () => {
  it('with conversation and an agent caller, posts { ref, source: "agent" } to the conversation route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/pull-requests': { status: 201, json: { host: 'github.com', repository: 'eltmon/overdeck', number: 42 } } });
    const client = await connectClient(api, SCOPES, true, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { ref: PR_URL, conversation: 'conv-a' });
    expect(result.isError).toBeFalsy();
    expect(resultJson(result)).toEqual({ host: 'github.com', repository: 'eltmon/overdeck', number: 42 });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/pull-requests', body: { ref: PR_URL, source: 'agent' } }]);
  });

  it('with conversation and a non-agent caller, posts { ref } with no source', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/pull-requests': { status: 201, json: { ok: true } } });
    const client = await connectClient(api, SCOPES, false, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { ref: PR_URL, conversation: 'conv-a' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/pull-requests', body: { ref: PR_URL } }]);
  });

  it('with conversation = @desk/conv-a, posts to the encoded linked-machine path', async () => {
    const api = fakeApi({ 'POST /api/conversations/%40desk%2Fconv-a/pull-requests': { status: 201, json: { ok: true } } });
    const client = await connectClient(api, SCOPES, true, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { ref: PR_URL, conversation: '@desk/conv-a' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/%40desk%2Fconv-a/pull-requests', body: { ref: PR_URL, source: 'agent' } }]);
  });

  it('without conversation, an agent caller posts { ref } to /api/self/pull-requests', async () => {
    const api = fakeApi({ 'POST /api/self/pull-requests': { status: 201, json: { ok: true } } });
    const client = await connectClient(api, SCOPES, true, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { ref: PR_URL });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/self/pull-requests', body: { ref: PR_URL } }]);
  });

  it('without conversation, a non-agent caller gets the error text and sends no request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, false, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { ref: PR_URL });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('conversation is required unless an Overdeck agent calls this tool');
    expect(api.calls).toEqual([]);
  });

  it('a 404 no-conversation answer comes back as an HTTP 404 tool error', async () => {
    const api = fakeApi({
      'POST /api/self/pull-requests': { status: 404, json: { error: 'this agent has no conversation; pass conversation to link_pull_request', code: 'no-conversation' } },
    });
    const client = await connectClient(api, SCOPES, true, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { ref: PR_URL });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('HTTP 404: this agent has no conversation; pass conversation to link_pull_request');
  });

  it('a missing ref is a tool error and sends no request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true, PR_LINK_TOOLS);
    const result = await callTool(client, 'link_pull_request', { conversation: 'conv-a' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });
});
