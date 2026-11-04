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
