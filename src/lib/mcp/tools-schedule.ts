/** The schedule tools of the Overdeck MCP server (PAN-4927 W-SCHED1, FR-5): one-shot scheduled messages (PAN-4641) and recurring schedules (PAN-4640). Each proxies the conversation's existing routes; the route-scope table judges each call. A one-shot message has no time: the server sends it after the conversation's usage limit resets, or at once when it is not limited. */
import { errorResult, isOk, jsonResult, optionalString, requiredString, routeErrorResult, routeResult, type ArgResult, type OverdeckTool } from './tool.js';

function conversationPath(name: string): string {
  return `/api/conversations/${encodeURIComponent(name)}`;
}

function requiredId(args: Record<string, unknown>): ArgResult<number> {
  const value = args['id'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, error: errorResult('id must be a positive integer') };
  }
  return { ok: true, value };
}

const CONVERSATION_PROPERTY = {
  type: 'string',
  description: 'The conversation name; @<machine>/<name> for one on a linked machine.',
} as const;

const scheduleMessage: OverdeckTool = {
  name: 'schedule_message',
  description:
    "Queue a message to send to a Claude Code conversation after its usage limit resets. If the conversation is not rate-limited, Overdeck sends it within a minute. Claude Code conversations only; at most 20 queued; /pan commands are refused.",
  scope: 'tell',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
      message: { type: 'string', description: 'The text to send.' },
    },
    required: ['conversation', 'message'],
  },
  async run(args, ctx) {
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const message = requiredString(args, 'message');
    if (!message.ok) return message.error;
    const path = `${conversationPath(conversation.value)}/scheduled-messages`;
    return routeResult(await ctx.api.request('POST', path, { message: message.value }));
  },
};

const scheduleRecurring: OverdeckTool = {
  name: 'schedule_recurring',
  description:
    'Create a recurring schedule that sends a stored prompt to a conversation on a 5-field cron (minute hour day-of-month month day-of-week), for example `0 9 * * 1-5` for weekdays at 09:00. Runs must be at least 15 minutes apart. Agent conversations and Session Vault copies cannot be scheduled; at most 20 schedules per conversation.',
  scope: 'tell',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
      prompt: { type: 'string', description: 'The stored prompt to send on each run.' },
      cron: { type: 'string', description: 'A 5-field cron expression, for example 0 9 * * 1-5.' },
      timeZone: { type: 'string', description: "An IANA time zone such as America/New_York; omit for the Overdeck machine's zone." },
      enabled: { type: 'boolean', description: 'false creates the schedule paused; default true.' },
    },
    required: ['conversation', 'prompt', 'cron'],
  },
  async run(args, ctx) {
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const prompt = requiredString(args, 'prompt');
    if (!prompt.ok) return prompt.error;
    const cron = requiredString(args, 'cron');
    if (!cron.ok) return cron.error;
    const timeZone = optionalString(args, 'timeZone');
    if (!timeZone.ok) return timeZone.error;
    const body: Record<string, unknown> = { prompt: prompt.value, cron: cron.value };
    if (timeZone.value !== undefined) body['timeZone'] = timeZone.value;
    if (args['enabled'] !== undefined) {
      if (typeof args['enabled'] !== 'boolean') return errorResult('enabled must be a boolean');
      body['enabled'] = args['enabled'];
    }
    const path = `${conversationPath(conversation.value)}/schedules`;
    return routeResult(await ctx.api.request('POST', path, body));
  },
};

const listScheduled: OverdeckTool = {
  name: 'list_scheduled',
  description:
    "List a conversation's pending one-shot scheduled messages (`once`) and its recurring schedules (`recurring`). `onceSupported` is false for conversations that cannot hold one-shot messages; `usageLimit` is the conversation's current usage-limit state.",
  scope: 'read:conversations',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
    },
    required: ['conversation'],
  },
  async run(args, ctx) {
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const base = conversationPath(conversation.value);
    const [once, recurring] = await Promise.all([ctx.api.request('GET', `${base}/scheduled-messages`), ctx.api.request('GET', `${base}/schedules`)]);
    if (!isOk(once)) return routeErrorResult(once);
    if (!isOk(recurring)) return routeErrorResult(recurring);
    const o = (once.json ?? {}) as Record<string, unknown>;
    const r = (recurring.json ?? {}) as Record<string, unknown>;
    return jsonResult({ once: o['messages'] ?? [], recurring: r['schedules'] ?? [], onceSupported: o['supported'] ?? false, usageLimit: o['limit'] ?? null });
  },
};

export const SCHEDULE_TOOLS: readonly OverdeckTool[] = [scheduleMessage, scheduleRecurring, listScheduled];
