#!/usr/bin/env bun
/**
 * panopticon-bridge — per-agent MCP server that proxies orchestrator messages
 * into a Claude Code work-agent session via the research-preview Channels
 * capability.
 *
 * Runtime: Bun. Claude Code's MCP child-process loader runs the configured
 * command directly; the project standard for stdio MCP scripts is Bun
 * because tsx has documented delivery bugs and Node lacks first-class
 * shebang support for TypeScript. Run as:
 *
 *     PANOPTICON_AGENT_ID=<id> bun run src/lib/channels/panopticon-bridge.ts
 *
 * Reference: https://code.claude.com/docs/en/channels
 *
 * Lifecycle:
 *   - Spawned by `claude --dangerously-load-development-channels server:panopticon-bridge`
 *     using the per-agent MCP config the launcher writes alongside the
 *     workspace. PANOPTICON_AGENT_ID is supplied through the MCP config's
 *     env block; this script fail-fasts if the variable is missing.
 *   - Listens on a Unix domain socket at ${PANOPTICON_HOME}/sockets/agent-<id>.sock
 *     so the dashboard server can post inbound messages and permission decisions
 *     that this bridge forwards as Claude channel notifications.
 *   - Receives Claude-originated permission requests over stdio and relays them
 *     back to the dashboard through an authenticated internal HTTP route.
 *   - Unlinks its socket path on startup before binding. This is INTENTIONAL,
 *     not defensive — a previous bridge crash can leave a stale socket file
 *     that would otherwise cause EADDRINUSE on rebind. Do not "fix" the
 *     unlink-on-startup; it is part of the documented lifecycle.
 *   - When `claude` exits, this child process exits with it. No daemon mode.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chmod, mkdir, unlink, appendFile } from 'node:fs/promises';
import { existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../internal-token.js';

/**
 * Resolve the per-agent ID from env. Tests import this module to call the
 * exported helpers (pushChannelNotification, getSocketPath, …) and must NOT
 * trigger process.exit at import time. The fail-fast check below moved into
 * main() so it only fires on direct CLI invocation.
 */
function resolveAgentIdOrExit(): string {
  const id = process.env.PANOPTICON_AGENT_ID;
  if (!id) {
    process.stderr.write(
      'panopticon-bridge: PANOPTICON_AGENT_ID env var is required. ' +
        'It is normally supplied by the per-agent MCP config; if you are running this script ' +
        'manually for development, set it explicitly.\n',
    );
    process.exit(2);
  }
  return id;
}

const INSTRUCTIONS = [
  'Panopticon orchestrator bridge.',
  '',
  'When you receive a `notifications/channel` message with `params.source` set',
  'to `panopticon-bridge`, the body is operator-supplied text from the',
  'Panopticon dashboard or CLI that is being delivered out-of-band of the',
  'normal user-prompt input stream. Treat the body as if the user had typed',
  'it into the prompt and continue the conversation accordingly.',
  '',
  'When you receive a `notifications/claude/channel/permission` message from',
  'the same source, treat it as the operator verdict for a previously-issued',
  '`notifications/claude/channel/permission_request` and resume the suspended',
  'tool call accordingly.',
].join('\n');

interface ChannelPermissionRequestNotification {
  method: 'notifications/claude/channel/permission_request';
  params: {
    request_id: string;
    tool_name: string;
    description: string;
    input_preview: string;
  };
}

export interface ChannelPermissionRequest {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

export interface PermissionDecisionPushPayload {
  type: 'permission_response';
  requestId: string;
  behavior: 'allow' | 'deny';
}

function parsePermissionRequestNotification(payload: unknown): ChannelPermissionRequestNotification {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    (payload as { method?: unknown }).method !== 'notifications/claude/channel/permission_request'
  ) {
    throw new Error('invalid permission request notification method');
  }

  const params = (payload as { params?: unknown }).params;
  if (
    params === null ||
    typeof params !== 'object' ||
    typeof (params as { request_id?: unknown }).request_id !== 'string' ||
    !((params as { request_id: string }).request_id.length > 0) ||
    typeof (params as { tool_name?: unknown }).tool_name !== 'string' ||
    !((params as { tool_name: string }).tool_name.length > 0) ||
    typeof (params as { description?: unknown }).description !== 'string' ||
    !((params as { description: string }).description.length > 0) ||
    typeof (params as { input_preview?: unknown }).input_preview !== 'string'
  ) {
    throw new Error('invalid permission request notification params');
  }

  return payload as ChannelPermissionRequestNotification;
}

function normalizePermissionRequest(
  notification: ChannelPermissionRequestNotification,
): ChannelPermissionRequest {
  return {
    requestId: notification.params.request_id,
    toolName: notification.params.tool_name,
    description: notification.params.description,
    inputPreview: notification.params.input_preview,
  };
}

export const server: Server = new Server(
  {
    name: 'panopticon-bridge',
    version: '0.1.0',
  },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions: INSTRUCTIONS,
  },
);

function installPermissionRequestHandler(mcp: Server): void {
  const handlers = (mcp as unknown as {
    _notificationHandlers?: Map<string, (notification: unknown) => Promise<void>>;
  })._notificationHandlers;
  if (!handlers) {
    throw new Error('panopticon-bridge: MCP server does not expose notification handlers map');
  }

  handlers.set('notifications/claude/channel/permission_request', async (notification) => {
    const agentId = process.env.PANOPTICON_AGENT_ID;
    if (!agentId) {
      throw new Error('PANOPTICON_AGENT_ID missing while handling permission request');
    }
    const parsed = parsePermissionRequestNotification(notification);
    await forwardPermissionRequestToDashboard(agentId, normalizePermissionRequest(parsed));
  });
}

installPermissionRequestHandler(server);

/**
 * Resolve PANOPTICON_HOME with the same fallback semantics as the rest of the
 * codebase: env var first, then ~/.panopticon.
 */
export function getPanopticonHome(): string {
  return process.env.PANOPTICON_HOME ?? join(homedir(), '.panopticon');
}

export function getSocketPath(agentId: string): string {
  return join(getPanopticonHome(), 'sockets', `agent-${agentId}.sock`);
}

export function getBridgeLogPath(agentId: string): string {
  return join(getPanopticonHome(), 'logs', `bridge-${agentId}.log`);
}

function getDashboardBaseUrl(): string {
  return process.env.DASHBOARD_URL || 'http://localhost:3011';
}

export interface ChannelPushPayload {
  content: string;
  meta?: Record<string, string>;
}

export interface ChannelPushResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Validate and translate a single inbound POST payload into a channel
 * notification. Exposed so unit tests can drive the same code path the
 * Unix socket listener uses without binding a real socket.
 */
export async function pushChannelNotification(
  mcp: Server,
  payload: unknown,
  agentId: string,
): Promise<ChannelPushResult> {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof (payload as { content?: unknown }).content !== 'string' ||
    !((payload as { content: string }).content.length > 0)
  ) {
    return {
      ok: false,
      status: 400,
      body: { error: 'content is required and must be a non-empty string' },
    };
  }
  const { content, meta } = payload as ChannelPushPayload;

  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      source: 'panopticon-bridge',
      content,
      ...(meta ? { meta } : {}),
    },
  });

  await appendBridgeLog(agentId, {
    kind: 'channel_message_sent',
    contentLength: content.length,
    metaKeys: meta ? Object.keys(meta) : [],
  });

  return { ok: true, status: 200, body: 'ok' };
}

export async function pushPermissionDecisionNotification(
  mcp: Server,
  payload: unknown,
  agentId: string,
): Promise<ChannelPushResult> {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    (payload as { type?: unknown }).type !== 'permission_response' ||
    typeof (payload as { requestId?: unknown }).requestId !== 'string' ||
    !((payload as { requestId: string }).requestId.length > 0) ||
    (((payload as { behavior?: unknown }).behavior !== 'allow') &&
      ((payload as { behavior?: unknown }).behavior !== 'deny'))
  ) {
    return {
      ok: false,
      status: 400,
      body: { error: 'permission_response requires requestId and behavior=allow|deny' },
    };
  }

  const { requestId, behavior } = payload as PermissionDecisionPushPayload;

  await mcp.notification({
    method: 'notifications/claude/channel/permission',
    params: {
      request_id: requestId,
      behavior,
    },
  });

  await appendBridgeLog(agentId, {
    kind: 'permission_decision_sent',
    requestId,
    behavior,
  });

  return { ok: true, status: 200, body: 'ok' };
}

export async function forwardPermissionRequestToDashboard(
  agentId: string,
  request: ChannelPermissionRequest,
): Promise<void> {
  const token = getInternalToken();
  if (!token) {
    throw new Error('internal token unavailable; dashboard permission relay not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);

  try {
    const res = await fetch(
      `${getDashboardBaseUrl()}/api/internal/agents/${encodeURIComponent(agentId)}/permissions/request`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: token,
        },
        body: JSON.stringify({
          requestId: request.requestId,
          toolName: request.toolName,
          description: request.description,
          inputPreview: request.inputPreview,
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`dashboard returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    await appendBridgeLog(agentId, {
      kind: 'permission_request_forwarded',
      requestId: request.requestId,
      toolName: request.toolName,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function appendBridgeLog(agentId: string, entry: Record<string, unknown>): Promise<void> {
  const logPath = getBridgeLogPath(agentId);
  await mkdir(dirname(logPath), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    agentId,
    ...entry,
  });
  await appendFile(logPath, `${line}\n`, 'utf-8');
}

interface UnixHttpServer {
  stop: () => void | Promise<void>;
}

interface BunGlobal {
  serve: (opts: {
    unix: string;
    fetch: (req: Request) => Response | Promise<Response>;
  }) => UnixHttpServer;
}

async function handleUnixPost(mcp: Server, payload: unknown, agentId: string): Promise<ChannelPushResult> {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { type?: unknown }).type === 'permission_response'
  ) {
    return pushPermissionDecisionNotification(mcp, payload, agentId);
  }
  return pushChannelNotification(mcp, payload, agentId);
}

async function startUnixListener(mcp: Server, agentId: string): Promise<UnixHttpServer> {
  const socketPath = getSocketPath(agentId);
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  if (existsSync(socketPath)) {
    // Pre-existing socket from a prior crashed bridge — unlink before bind.
    // This is intentional, see header comment.
    await unlink(socketPath);
  }

  const bunGlobal = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
  if (!bunGlobal || typeof bunGlobal.serve !== 'function') {
    throw new Error(
      'panopticon-bridge: Bun.serve is required for the Unix socket listener. ' +
        'Run this script under Bun (bun run src/lib/channels/panopticon-bridge.ts).',
    );
  }

  const httpServer = bunGlobal.serve({
    unix: socketPath,
    fetch: async (req: Request) => {
      if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method not allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }
      let parsed: unknown;
      try {
        parsed = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const result = await handleUnixPost(mcp, parsed, agentId);
      const headers = { 'content-type': result.status === 200 ? 'text/plain' : 'application/json' };
      const body =
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      return new Response(body, { status: result.status, headers });
    },
  });

  await chmod(socketPath, 0o600);
  return httpServer;
}

async function main(): Promise<void> {
  const agentId = resolveAgentIdOrExit();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const httpServer = await startUnixListener(server, agentId);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      unlinkSync(getSocketPath(agentId));
    } catch {
      // best-effort
    }
    try {
      void httpServer.stop();
    } catch {
      // best-effort
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Entrypoint: only run when invoked directly. Tests import the module to
// inspect the server instance without spawning the transport.
const isDirectInvocation =
  typeof import.meta.url === 'string' &&
  Boolean(process.argv[1]) &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectInvocation) {
  main().catch((err) => {
    process.stderr.write(
      `panopticon-bridge: fatal error during MCP server startup: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
