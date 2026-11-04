/** The schedule tools of the Overdeck MCP server (PAN-4927 W-SCHED1, FR-5): one-shot scheduled messages (PAN-4641) and recurring schedules (PAN-4640). Each proxies the conversation's existing routes; the route-scope table judges each call. A one-shot message has no time: the server sends it after the conversation's usage limit resets, or at once when it is not limited. */
import { errorResult, requiredString, routeResult, type ArgResult, type OverdeckTool } from './tool.js';

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

export const SCHEDULE_TOOLS: readonly OverdeckTool[] = [scheduleMessage];
