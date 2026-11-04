/**
 * The Overdeck MCP server (PAN-4649): one tool module that both transports
 * serve — `pan mcp serve` over stdio and `POST /mcp` on the dashboard in
 * stateless JSON mode.
 *
 * Every tool proxies to an existing dashboard HTTP route with the caller's
 * Bearer `odk_` token (`dashboard-api.ts`), so the route-scope table judges
 * each call and no operation gains a second path (parent PRD D-21). The tool
 * layer adds one check of its own: `answer_question` needs `approve`
 * (D-4649-5). `tools/list` and `tools/call` only ever see a caller's visible
 * tools (scope and audience, PAN-4927 D-14); a hidden tool answers like an
 * unknown one. It uses the low-level SDK `Server` with hand-written JSON
 * Schemas (D-4649-12).
 *
 * This module imports only Node built-ins, the SDK, `../access-tokens.js` and
 * its own files; it never imports dashboard server code.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { scopeSatisfies } from '../access-tokens.js';
import { errorResult, type McpToolContext, type OverdeckTool } from './tool.js';
import { APPROVE_TOOLS } from './tools-approve.js';
import { READ_TOOLS } from './tools-read.js';
import { SCHEDULE_TOOLS } from './tools-schedule.js';
import { SELF_TOOLS } from './tools-self.js';
import { WRITE_TOOLS } from './tools-write.js';

export type { McpToolContext, OverdeckTool } from './tool.js';
export { hasAgentId, routeErrorResult } from './tool.js';

export const MCP_SERVER_NAME = 'overdeck';
/** The server reports a fixed version; `list_machines` carries the real `serverVersion`. */
const MCP_SERVER_VERSION = '0.0.0';

/** The default scopes Copy MCP URL and the docs name (D-4649-3). */
export const MCP_DEFAULT_SCOPES = ['read:state', 'read:conversations', 'operate'] as const;

/** Every tool, in tools/list order. Exported so tests compare against it. */
export const ALL_TOOLS: readonly OverdeckTool[] = [...READ_TOOLS, ...WRITE_TOOLS, ...SCHEDULE_TOOLS, ...APPROVE_TOOLS, ...SELF_TOOLS];

/** The tools a caller may list and call: its scopes cover the tool's scope, and agent-only tools need an agent token (PAN-4927 D-14). */
export function visibleTools(ctx: Pick<McpToolContext, 'scopes' | 'isAgent'>, tools: readonly OverdeckTool[] = ALL_TOOLS): OverdeckTool[] {
  return tools.filter((tool) => scopeSatisfies(ctx.scopes, tool.scope) && (tool.audience === 'any' || ctx.isAgent));
}

export function createOverdeckMcpServer(ctx: McpToolContext, tools: readonly OverdeckTool[] = ALL_TOOLS): Server {
  const server = new Server({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { capabilities: { tools: {} } });
  const visible = visibleTools(ctx, tools);
  const byName = new Map(visible.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) return errorResult(`Unknown tool ${request.params.name}`);
    try {
      return await tool.run(request.params.arguments ?? {}, ctx);
    } catch (error: unknown) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}
