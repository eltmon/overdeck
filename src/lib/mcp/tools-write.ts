/**
 * The write tools of the Overdeck MCP server (PAN-4649 FR-5, FR-6):
 * `send_message`, `start_conversation`, `start_worker` and (PAN-4938 FR-6,
 * FR-7) `start_issue`, `stop_conversation` and `interrupt_conversation`. Each
 * proxies one dashboard route; the route enforces the scope (`tell` or
 * `operate`).
 * PAN-4651 D-4651-18: the start tools go through the fleet routes, which
 * resolve `machine` (a label, an environment id or `auto`, with `needs`) and
 * start the work on that machine; `send_message` takes `@<machine>/<name>`.
 */
import { errorResult, optionalString, requiredString, routeErrorResult, routeResult, type ArgResult, type OverdeckTool } from './tool.js';

const MACHINE_PROPERTY = {
  type: 'string',
  description: 'Where to run: omit for this machine, a linked machine\'s label or environment id, or "auto" to place it by load.',
} as const;

const NEEDS_PROPERTY = {
  type: 'array',
  items: { type: 'string' },
  description: 'With machine "auto": capability tags the machine must have, such as docker or gpu.',
} as const;

/** `machine` and `needs` into the fleet body. */
function copyPlacement(args: Record<string, unknown>, body: Record<string, unknown>): ArgResult<null> {
  const copied = copyOptionalStrings(args, ['machine'], body);
  if (!copied.ok) return copied;
  const needs = args['needs'];
  if (needs === undefined) return { ok: true, value: null };
  if (!Array.isArray(needs) || !needs.every((tag) => typeof tag === 'string')) return { ok: false, error: errorResult('needs must be a list of tags') };
  body['needs'] = needs;
  return { ok: true, value: null };
}

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
  scope: 'tell',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id; @<machine>/<name> for one on a linked machine.' },
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
  description: 'Start a new conversation with a first message, on this machine or a linked one.',
  scope: 'operate',
  audience: 'any',
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
      needs: NEEDS_PROPERTY,
    },
    required: ['message'],
  },
  async run(args, ctx) {
    const message = requiredString(args, 'message');
    if (!message.ok) return message.error;
    const body: Record<string, unknown> = { message: message.value };
    const copied = copyOptionalStrings(args, ['projectKey', 'model', 'harness', 'effort', 'issueId'], body);
    if (!copied.ok) return copied.error;
    const placed = copyPlacement(args, body);
    if (!placed.ok) return placed.error;
    return routeResult(await ctx.api.request('POST', '/api/fleet/conversations', body));
  },
};

const startWorker: OverdeckTool = {
  name: 'start_worker',
  description: 'Start a registered worker agent on an issue whose workspace exists on the chosen machine (this one by default).',
  scope: 'operate',
  audience: 'any',
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
      needs: NEEDS_PROPERTY,
    },
    required: ['issueId', 'prompt'],
  },
  async run(args, ctx) {
    const issueId = requiredString(args, 'issueId');
    if (!issueId.ok) return issueId.error;
    const prompt = requiredString(args, 'prompt');
    if (!prompt.ok) return prompt.error;
    const body: Record<string, unknown> = { issueId: issueId.value, prompt: prompt.value };
    const copied = copyOptionalStrings(args, ['model', 'harness', 'effort'], body);
    if (!copied.ok) return copied.error;
    if (args['readOnly'] !== undefined) {
      if (typeof args['readOnly'] !== 'boolean') return errorResult('readOnly must be a boolean');
      body['readOnly'] = args['readOnly'];
    }
    const named = copyOptionalStrings(args, ['name'], body);
    if (!named.ok) return named.error;
    const placed = copyPlacement(args, body);
    if (!placed.ok) return placed.error;
    return routeResult(await ctx.api.request('POST', '/api/fleet/workers', body));
  },
};

const startIssue: OverdeckTool = {
  name: 'start_issue',
  description: 'Start an issue\'s work agent, on this machine or a linked one, through the same gates as the dashboard\'s Start button. The issue must be planned.',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'The planned issue to start, such as PAN-123.' },
      model: { type: 'string', description: 'The model id or alias; omit for the configured default.' },
      harness: { type: 'string', description: 'The agent harness, such as claude-code or codex.' },
      effort: { type: 'string', description: 'Reasoning effort: low, medium, high, xhigh or max.' },
      machine: MACHINE_PROPERTY,
      needs: NEEDS_PROPERTY,
    },
    required: ['issueId'],
  },
  async run(args, ctx) {
    const issueId = requiredString(args, 'issueId');
    if (!issueId.ok) return issueId.error;
    const body: Record<string, unknown> = {};
    const copied = copyOptionalStrings(args, ['model', 'harness', 'effort'], body);
    if (!copied.ok) return copied.error;
    const placed = copyPlacement(args, body);
    if (!placed.ok) return placed.error;
    const response = await ctx.api.request('POST', `/api/fleet/issues/${encodeURIComponent(issueId.value)}/start`, body);
    if (response.status === 422) {
      const routeErrorText = routeErrorResult(response).content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      return errorResult(`${routeErrorText}. If ${issueId.value} is not planned yet, run pan start ${issueId.value}, which plans first.`);
    }
    return routeResult(response);
  },
};

const CONVERSATION_PROPERTY = {
  type: 'string',
  description: 'The conversation name or id; @<machine>/<name> for one on a linked machine.',
} as const;

/** A tool that posts `{}` to `/api/conversations/<conversation>/<action>`. */
function conversationControlTool(name: string, action: 'stop' | 'abort', description: string): OverdeckTool {
  return {
    name,
    description,
    scope: 'operate',
    audience: 'any',
    inputSchema: {
      type: 'object',
      properties: { conversation: CONVERSATION_PROPERTY },
      required: ['conversation'],
    },
    async run(args, ctx) {
      const conversation = requiredString(args, 'conversation');
      if (!conversation.ok) return conversation.error;
      return routeResult(await ctx.api.request('POST', `/api/conversations/${encodeURIComponent(conversation.value)}/${action}`, {}));
    },
  };
}

const stopConversation = conversationControlTool('stop_conversation', 'stop', 'Stop a conversation: end its agent session.');

const interruptConversation = conversationControlTool(
  'interrupt_conversation',
  'abort',
  'Interrupts the current turn of a Pi conversation. Other harnesses answer an error; use stop_conversation to end them.',
);

export const WRITE_TOOLS: readonly OverdeckTool[] = [sendMessage, startConversation, startWorker, startIssue, stopConversation, interruptConversation];
