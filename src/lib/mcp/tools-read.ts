/**
 * The read tools of the Overdeck MCP server (PAN-4649 FR-5, FR-6):
 * `list_machines`, `list_conversations`, `search_conversations` and
 * `read_conversation`. Each proxies one dashboard route; the route enforces
 * the scope. PAN-4651 D-4651-18: they reach linked machines through this
 * one — `list_machines` reads `GET /api/fleet/machines`, conversation rows
 * carry their machine, search merges `GET /api/fleet/search`, and a linked
 * conversation is named `@<label|env>/<name>` (the proxy forwards it).
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
  'environmentId',
  'machineLabel',
  'machineState',
] as const;

function projectConversation(row: unknown): Record<string, unknown> {
  const source = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const projected: Record<string, unknown> = {};
  for (const key of CONVERSATION_KEYS) {
    if (key in source) projected[key] = source[key];
  }
  return projected;
}

const listMachines: OverdeckTool = {
  name: 'list_machines',
  description: 'List this machine and its linked machines with their state, load and capability tags.',
  scope: 'read:state',
  audience: 'any',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    return routeResult(await ctx.api.request('GET', '/api/fleet/machines'));
  },
};

const listConversations: OverdeckTool = {
  name: 'list_conversations',
  description: 'List recent Overdeck conversations on this machine and its linked machines (named @<machine>/<name>) with their status, harness, model and pending input.',
  scope: 'read:conversations',
  audience: 'any',
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
  description: 'Search conversations on this machine and every online linked machine by title and content.',
  scope: 'read:conversations',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search text.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many matches to return per machine (default 20).' },
    },
    required: ['query'],
  },
  async run(args, ctx) {
    const query = requiredString(args, 'query');
    if (!query.ok) return query.error;
    const limit = optionalInteger(args, 'limit', 1, 50, 20);
    if (!limit.ok) return limit.error;
    const params = new URLSearchParams({ q: query.value, limit: String(limit.value) });
    const [local, fleet] = await Promise.all([
      ctx.api.request('GET', `/api/palette/search?${params.toString()}`),
      ctx.api.request('GET', `/api/fleet/search?${params.toString()}`),
    ]);
    if (!isOk(local)) return routeErrorResult(local);
    const localBody = local.json && typeof local.json === 'object' ? (local.json as Record<string, unknown>) : {};
    const hits: unknown[] = Array.isArray(localBody['conversations']) ? [...localBody['conversations']] : [];
    // A machine that cannot answer (or a token without fleet reach) leaves only this machine's hits.
    const machines = isOk(fleet) && fleet.json && typeof fleet.json === 'object' ? (fleet.json as { machines?: unknown }).machines : [];
    for (const machine of Array.isArray(machines) ? machines as Array<{ label?: unknown; conversations?: unknown }> : []) {
      for (const hit of Array.isArray(machine.conversations) ? machine.conversations : []) {
        hits.push({ ...(hit as Record<string, unknown>), machineLabel: machine.label });
      }
    }
    return jsonResult(hits);
  },
};

const readConversation: OverdeckTool = {
  name: 'read_conversation',
  description: 'Read the messages of one conversation. Pass the cursor from a previous page as `before` to read older messages.',
  scope: 'read:conversations',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id; @<machine>/<name> for one on a linked machine.' },
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
