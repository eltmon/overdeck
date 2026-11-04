/**
 * PAN-4927 W-SCHED1: the MCP schedule tools — one-shot scheduled messages
 * (PAN-4641) and recurring schedules (PAN-4640).
 */
import { describe, expect, it } from 'vitest';

import { SCHEDULE_TOOLS } from '../../../../src/lib/mcp/tools-schedule.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:conversations', 'tell'];

describe('MCP schedule tools: schedule_message (PAN-4927 WI-2)', () => {
  it('schedule_message posts { message } to the encoded scheduled-messages route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/scheduled-messages': { status: 201, json: { id: 1, message: 'later' } } });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_message', { conversation: 'conv-a', message: 'later' });
    expect(result.isError).toBeFalsy();
    expect(resultJson(result)).toEqual({ id: 1, message: 'later' });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/scheduled-messages', body: { message: 'later' } }]);
  });

  it('schedule_message with @desk/conv-a posts to %40desk%2Fconv-a', async () => {
    const api = fakeApi({ 'POST /api/conversations/%40desk%2Fconv-a/scheduled-messages': { status: 201, json: { id: 2 } } });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_message', { conversation: '@desk/conv-a', message: 'hi' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/%40desk%2Fconv-a/scheduled-messages', body: { message: 'hi' } }]);
  });

  it('a 422 limit-detection-unsupported answer is a tool error with the route text', async () => {
    const api = fakeApi({
      'POST /api/conversations/conv-a/scheduled-messages': { status: 422, json: { error: 'limit detection is not supported for this harness' } },
    });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_message', { conversation: 'conv-a', message: 'later' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('limit detection is not supported for this harness');
  });

  it('a missing message is a tool error and sends no request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_message', { conversation: 'conv-a' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });
});

describe('MCP schedule tools: schedule_recurring (PAN-4927 WI-3)', () => {
  it('schedule_recurring posts only the given fields', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/schedules': { status: 201, json: { id: 1 } } });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_recurring', { conversation: 'conv-a', prompt: 'check in', cron: '0 9 * * 1-5' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/schedules', body: { prompt: 'check in', cron: '0 9 * * 1-5' } }]);
  });

  it('schedule_recurring passes timeZone and enabled when given', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/schedules': { status: 201, json: { id: 2 } } });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    await callTool(client, 'schedule_recurring', {
      conversation: 'conv-a',
      prompt: 'check in',
      cron: '0 21 * * *',
      timeZone: 'America/New_York',
      enabled: false,
    });
    expect(api.calls).toEqual([
      {
        method: 'POST',
        path: '/api/conversations/conv-a/schedules',
        body: { prompt: 'check in', cron: '0 21 * * *', timeZone: 'America/New_York', enabled: false },
      },
    ]);
  });

  it('a 409 agent-conversation answer is a tool error', async () => {
    const api = fakeApi({
      'POST /api/conversations/conv-a/schedules': { status: 409, json: { error: 'agent conversations cannot be scheduled' } },
    });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_recurring', { conversation: 'conv-a', prompt: 'check in', cron: '0 9 * * *' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('agent conversations cannot be scheduled');
  });

  it('enabled: "yes" is a tool error and sends no request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'schedule_recurring', { conversation: 'conv-a', prompt: 'check in', cron: '0 9 * * *', enabled: 'yes' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });
});

describe('MCP schedule tools: list_scheduled (PAN-4927 WI-4)', () => {
  it('list_scheduled merges both GETs into { once, recurring, onceSupported, usageLimit }', async () => {
    const api = fakeApi({
      'GET /api/conversations/conv-a/scheduled-messages': { status: 200, json: { messages: [{ id: 1, message: 'later' }], supported: true, limit: null } },
      'GET /api/conversations/conv-a/schedules': { status: 200, json: { schedules: [{ id: 2, prompt: 'check in' }] } },
    });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'list_scheduled', { conversation: 'conv-a' });
    expect(result.isError).toBeFalsy();
    expect(resultJson(result)).toEqual({
      once: [{ id: 1, message: 'later' }],
      recurring: [{ id: 2, prompt: 'check in' }],
      onceSupported: true,
      usageLimit: null,
    });
    expect(api.calls).toEqual([
      { method: 'GET', path: '/api/conversations/conv-a/scheduled-messages' },
      { method: 'GET', path: '/api/conversations/conv-a/schedules' },
    ]);
  });

  it('a 404 on the scheduled-messages GET is the tool error', async () => {
    const api = fakeApi({
      'GET /api/conversations/conv-a/scheduled-messages': { status: 404, json: { error: 'conversation not found' } },
      'GET /api/conversations/conv-a/schedules': { status: 200, json: { schedules: [] } },
    });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'list_scheduled', { conversation: 'conv-a' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('conversation not found');
  });

  it('a 403 on the schedules GET is the tool error, never a partial result', async () => {
    const api = fakeApi({
      'GET /api/conversations/conv-a/scheduled-messages': { status: 200, json: { messages: [], supported: true, limit: null } },
      'GET /api/conversations/conv-a/schedules': { status: 403, json: { error: 'insufficient_scope', missingScope: 'read:conversations' } },
    });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'list_scheduled', { conversation: 'conv-a' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('missingScope: read:conversations');
  });
});

describe('MCP schedule tools: update_scheduled (PAN-4927 WI-5)', () => {
  it('kind once patches { message } on scheduled-messages/:id', async () => {
    const api = fakeApi({ 'PATCH /api/conversations/conv-a/scheduled-messages/1': { status: 200, json: { id: 1, message: 'new text' } } });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'update_scheduled', { conversation: 'conv-a', kind: 'once', id: 1, message: 'new text' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'PATCH', path: '/api/conversations/conv-a/scheduled-messages/1', body: { message: 'new text' } }]);
  });

  it('kind recurring patches only the present fields on schedules/:id', async () => {
    const api = fakeApi({ 'PATCH /api/conversations/conv-a/schedules/2': { status: 200, json: { id: 2 } } });
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'update_scheduled', { conversation: 'conv-a', kind: 'recurring', id: 2, enabled: false });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'PATCH', path: '/api/conversations/conv-a/schedules/2', body: { enabled: false } }]);
  });

  it('kind once with cron is a tool error and sends no request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'update_scheduled', { conversation: 'conv-a', kind: 'once', id: 1, message: 'x', cron: '0 9 * * *' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('kind recurring with message is a tool error', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    const result = await callTool(client, 'update_scheduled', { conversation: 'conv-a', kind: 'recurring', id: 2, message: 'x' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('id 0 and kind "later" are tool errors', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, false, SCHEDULE_TOOLS);
    expect((await callTool(client, 'update_scheduled', { conversation: 'conv-a', kind: 'once', id: 0, message: 'x' })).isError).toBe(true);
    expect((await callTool(client, 'update_scheduled', { conversation: 'conv-a', kind: 'later', id: 1, message: 'x' })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });
});
