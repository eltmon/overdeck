/**
 * The write tools of the Overdeck MCP server (PAN-4649 FR-5, FR-6):
 * `send_message`, `start_conversation` and `start_worker`. Each proxies one
 * dashboard route; the route enforces the scope (`tell` or `operate`). The two
 * start tools accept a `machine` that must name this machine (FR-6).
 */
import { resolveMachine } from './tools-read.js';
import { errorResult, optionalString, requiredString, routeResult, type ArgResult, type OverdeckTool } from './tool.js';

const MACHINE_PROPERTY = {
  type: 'string',
  description: 'Where to run: omit, "auto", or this machine\'s label or environment id. Other machines are not reachable yet.',
} as const;

/** Copy the given optional string fields into `body`, skipping absent ones. */
function copyOptionalStrings(args: Record<string, unknown>, fields: readonly string[], body: Record<string, unknown>): ArgResult<null> {
  for (const field of fields) {
    const value = optionalString(args, field);
    if (!value.ok) return value;
    if (value.value !== undefined) body[field] = value.value;
  }
  return { ok: true, value: null };
}

const sendMessage: OverdeckTool = {
  name: 'send_message',
  description: 'Send a message to a running conversation, as if typed in the dashboard composer.',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id.' },
      message: { type: 'string', description: 'The text to send.' },
    },
    required: ['conversation', 'message'],
  },
  async run(args, ctx) {
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const message = requiredString(args, 'message');
    if (!message.ok) return message.error;
    const path = `/api/conversations/${encodeURIComponent(conversation.value)}/message`;
    return routeResult(await ctx.api.request('POST', path, { message: message.value }));
  },
};

const startConversation: OverdeckTool = {
  name: 'start_conversation',
  description: 'Start a new conversation on this machine with a first message.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The first message.' },
      projectKey: { type: 'string', description: 'The registered project to run in; omit for the default directory.' },
      model: { type: 'string', description: 'The model id or alias; omit for the configured default.' },
      harness: { type: 'string', description: 'The agent harness, such as claude-code or codex.' },
      effort: { type: 'string', description: 'Reasoning effort: low, medium, high, xhigh or max.' },
      issueId: { type: 'string', description: 'An issue to link the conversation to.' },
      machine: MACHINE_PROPERTY,
    },
    required: ['message'],
  },
  async run(args, ctx) {
    const message = requiredString(args, 'message');
    if (!message.ok) return message.error;
    const machine = optionalString(args, 'machine');
    if (!machine.ok) return machine.error;
    const body: Record<string, unknown> = { message: message.value };
    const copied = copyOptionalStrings(args, ['projectKey', 'model', 'harness', 'effort', 'issueId'], body);
    if (!copied.ok) return copied.error;
    const target = await resolveMachine(ctx.api, machine.value);
    if (!target.ok) return errorResult(target.error);
    return routeResult(await ctx.api.request('POST', '/api/conversations', body));
  },
};

const startWorker: OverdeckTool = {
  name: 'start_worker',
  description: 'Start a registered worker agent on an issue that already has a workspace on this machine.',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'The issue whose workspace the worker runs in.' },
      prompt: { type: 'string', description: 'The worker brief.' },
      model: { type: 'string', description: 'The model id or alias.' },
      harness: { type: 'string', description: 'The agent harness, such as claude-code or codex.' },
      effort: { type: 'string', description: 'Reasoning effort: low, medium, high, xhigh or max.' },
      readOnly: { type: 'boolean', description: 'Run in the issue workspace behind a read-only git guard.' },
      name: { type: 'string', description: 'A label for the worker.' },
      machine: MACHINE_PROPERTY,
    },
    required: ['issueId', 'prompt'],
  },
  async run(args, ctx) {
    const issueId = requiredString(args, 'issueId');
    if (!issueId.ok) return issueId.error;
    const prompt = requiredString(args, 'prompt');
    if (!prompt.ok) return prompt.error;
    const machine = optionalString(args, 'machine');
    if (!machine.ok) return machine.error;
    const body: Record<string, unknown> = { issueId: issueId.value, prompt: prompt.value };
    const copied = copyOptionalStrings(args, ['model', 'harness', 'effort'], body);
    if (!copied.ok) return copied.error;
    if (args['readOnly'] !== undefined) {
      if (typeof args['readOnly'] !== 'boolean') return errorResult('readOnly must be a boolean');
      body['readOnly'] = args['readOnly'];
    }
    const named = copyOptionalStrings(args, ['name'], body);
    if (!named.ok) return named.error;
    const target = await resolveMachine(ctx.api, machine.value);
    if (!target.ok) return errorResult(target.error);
    return routeResult(await ctx.api.request('POST', '/api/workers', body));
  },
};

export const WRITE_TOOLS: readonly OverdeckTool[] = [sendMessage, startConversation, startWorker];
