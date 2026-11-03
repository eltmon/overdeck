/**
 * The shape every Overdeck MCP tool shares (PAN-4649), plus the result and
 * argument helpers the tool files use. Kept apart from `server.ts` so the tool
 * files and the server do not import each other. Also carries the visibility
 * fields (PAN-4927 W-MCP1): a tool's `scope` and `audience`, and the caller's
 * `isAgent` flag.
 */
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import type { AccessTokenScope } from '../access-tokens.js';
import type { DashboardApi, DashboardApiResponse } from './dashboard-api.js';

export interface McpToolContext {
  api: DashboardApi;
  /** The scopes of the token the caller presented. */
  scopes: readonly string[];
  /** True when the token belongs to a managed agent (`hasAgentId`, PAN-4927 D-14). */
  isAgent: boolean;
}

export interface OverdeckTool {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  /** The scope of the route this tool calls; tools/list hides the tool from tokens without it (PAN-4927 D-14). */
  scope: AccessTokenScope;
  /** `'agent'`: listed only to agent tokens. */
  audience: 'any' | 'agent';
  run(args: Record<string, unknown>, ctx: McpToolContext): Promise<CallToolResult>;
}

/**
 * True when a token record or credential names a managed agent (PAN-4927 D-6,
 * D-14): `agentId` is a non-empty string. Reads the field structurally, so it
 * compiles before and after W-TOK1 adds `agentId` to the record and credential types.
 */
export function hasAgentId(value: object): boolean {
  return 'agentId' in value && typeof value.agentId === 'string' && value.agentId.length > 0;
}

/** A successful tool result: the data as pretty-printed JSON text. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** A tool error with operator-readable text. */
export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** True for a 2xx route answer. */
export function isOk(response: DashboardApiResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

/** Map a non-2xx route answer to an MCP tool error: `HTTP <status>: <error>` plus `missingScope` when present. */
export function routeErrorResult(response: DashboardApiResponse): CallToolResult {
  const body = response.json && typeof response.json === 'object' ? (response.json as Record<string, unknown>) : {};
  const error = typeof body['error'] === 'string' ? body['error'] : 'request failed';
  const missingScope = typeof body['missingScope'] === 'string' ? ` (missingScope: ${body['missingScope']})` : '';
  return errorResult(`HTTP ${response.status}: ${error}${missingScope}`);
}

/** The route's JSON on 2xx, else the route error. */
export function routeResult(response: DashboardApiResponse, project: (json: unknown) => unknown = (json) => json): CallToolResult {
  return isOk(response) ? jsonResult(project(response.json)) : routeErrorResult(response);
}

export type ArgResult<T> = { ok: true; value: T } | { ok: false; error: CallToolResult };

/** A required non-empty string argument. */
export function requiredString(args: Record<string, unknown>, field: string): ArgResult<string> {
  const value = args[field];
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: errorResult(`${field} is required and must be a non-empty string`) };
  return { ok: true, value };
}

/** An optional string argument; `undefined` when absent. */
export function optionalString(args: Record<string, unknown>, field: string): ArgResult<string | undefined> {
  const value = args[field];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, error: errorResult(`${field} must be a string`) };
  return { ok: true, value };
}

/** An optional integer argument within `[min, max]`; `fallback` when absent. */
export function optionalInteger<F extends number | undefined>(
  args: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  fallback: F,
): ArgResult<number | F> {
  const value = args[field];
  if (value === undefined || value === null) return { ok: true, value: fallback };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: errorResult(`${field} must be an integer from ${min} to ${max}`) };
  }
  return { ok: true, value };
}
