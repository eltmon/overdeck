/**
 * The read tools of the Overdeck MCP server (PAN-4649 FR-5, FR-6):
 * `list_machines`, `list_conversations`, `search_conversations` and
 * `read_conversation`. Each proxies one dashboard route; the route enforces
 * the scope.
 */
import type { DashboardApi } from './dashboard-api.js';
import {
  isOk,
  jsonResult,
  optionalInteger,
  optionalString,
  requiredString,
  routeErrorResult,
  routeResult,
  type OverdeckTool,
} from './tool.js';

/** The conversation-row keys `list_conversations` returns. */
const CONVERSATION_KEYS = [
  'name',
  'title',
  'projectKey',
  'harness',
  'model',
  'status',
  'issueId',
  'origin',
  'sessionAlive',
  'isWorking',
  'lastActivityAt',
  'pendingInputCount',
] as const;

function projectConversation(row: unknown): Record<string, unknown> {
  const source = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const projected: Record<string, unknown> = {};
  for (const key of CONVERSATION_KEYS) {
    if (key in source) projected[key] = source[key];
  }
  return projected;
}

interface ThisMachine {
  environmentId: string;
  label: string;
  platform: unknown;
  serverVersion: unknown;
}

async function readThisMachine(api: DashboardApi): Promise<{ ok: true; machine: ThisMachine } | { ok: false; status: number; json: unknown }> {
  const response = await api.request('GET', '/api/environment');
  const body = response.json && typeof response.json === 'object' ? (response.json as Record<string, unknown>) : null;
  if (!isOk(response) || !body || typeof body['environmentId'] !== 'string') {
    return { ok: false, status: response.status, json: response.json };
  }
  return {
    ok: true,
    machine: {
      environmentId: body['environmentId'],
      label: typeof body['label'] === 'string' ? body['label'] : '',
      platform: body['platform'],
      serverVersion: body['serverVersion'],
    },
  };
}

/**
 * FR-6: `machine` may be omitted, `auto`, this machine's label or its
 * environment id; all four run here. Anything else is refused by name.
 */
export async function resolveMachine(api: DashboardApi, machine?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (machine === undefined || machine === 'auto') return { ok: true };
  const result = await readThisMachine(api);
  if (!result.ok) return { ok: false, error: `Could not read this machine's identity (HTTP ${result.status}).` };
  const { label, environmentId } = result.machine;
  if (machine === label || machine === environmentId) return { ok: true };
  return { ok: false, error: `Unknown machine "${machine}". This server can start work only on ${label} (${environmentId}).` };
}

const listMachines: OverdeckTool = {
  name: 'list_machines',
  description: 'List the machines this MCP server can reach. Today that is this machine only.',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const result = await readThisMachine(ctx.api);
    if (!result.ok) return routeErrorResult({ status: result.status, json: result.json });
    return jsonResult([{ ...result.machine, thisMachine: true }]);
  },
};

const listConversations: OverdeckTool = {
  name: 'list_conversations',
  description: 'List recent Overdeck conversations on this machine with their status, harness, model and pending input.',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many rows to return (default 50).' } },
  },
  async run(args, ctx) {
    const limit = optionalInteger(args, 'limit', 1, 200, 50);
    if (!limit.ok) return limit.error;
    const response = await ctx.api.request('GET', `/api/conversations?limit=${limit.value}`);
    return routeResult(response, (json) => (Array.isArray(json) ? json.map(projectConversation) : json));
  },
};

const searchConversations: OverdeckTool = {
  name: 'search_conversations',
  description: 'Search conversations on this machine by title and content.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search text.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many matches to return (default 20).' },
    },
    required: ['query'],
  },
  async run(args, ctx) {
    const query = requiredString(args, 'query');
    if (!query.ok) return query.error;
    const limit = optionalInteger(args, 'limit', 1, 50, 20);
    if (!limit.ok) return limit.error;
    const params = new URLSearchParams({ q: query.value, limit: String(limit.value) });
    const response = await ctx.api.request('GET', `/api/palette/search?${params.toString()}`);
    return routeResult(response, (json) => {
      const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
      return Array.isArray(body['conversations']) ? body['conversations'] : [];
    });
  },
};

const readConversation: OverdeckTool = {
  name: 'read_conversation',
  description: 'Read the messages of one conversation. Pass the cursor from a previous page as `before` to read older messages.',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id.' },
      before: { type: 'string', description: 'A page cursor from a previous read, for older messages.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'How many timeline rows to return with `before`.' },
    },
    required: ['conversation'],
  },
  async run(args, ctx) {
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const before = optionalString(args, 'before');
    if (!before.ok) return before.error;
    const limit = optionalInteger(args, 'limit', 1, 500, undefined);
    if (!limit.ok) return limit.error;
    const params = new URLSearchParams();
    if (before.value !== undefined) params.set('before', before.value);
    if (limit.value !== undefined) params.set('limit', String(limit.value));
    const query = params.toString();
    const path = `/api/conversations/${encodeURIComponent(conversation.value)}/messages${query ? `?${query}` : ''}`;
    return routeResult(await ctx.api.request('GET', path));
  },
};

export const READ_TOOLS: readonly OverdeckTool[] = [listMachines, listConversations, searchConversations, readConversation];
