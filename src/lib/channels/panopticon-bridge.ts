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
 *     so the dashboard server can post inbound messages that this bridge
 *     forwards as channel notifications. The listener itself lands in the
 *     follow-up bead workspace-bvzr; this file currently scaffolds the MCP
 *     server and leaves the socket as a TODO.
 *   - Unlinks its socket path on startup before binding. This is INTENTIONAL,
 *     not defensive — a previous bridge crash can leave a stale socket file
 *     that would otherwise cause EADDRINUSE on rebind. Do not "fix" the
 *     unlink-on-startup; it is part of the documented lifecycle.
 *   - When `claude` exits, this child process exits with it. No daemon mode.
 *
 * Capability scope (PAN-985):
 *   - `experimental['claude/channel'] = {}` — one-way notifications to Claude.
 *   - NO tools, NO `claude/channel/permission`. Bidirectional reply tool and
 *     dashboard-routed permission relay are explicitly out of scope and
 *     tracked as separate follow-up issues (see hazards H4 and H5 in the
 *     PAN-985 vBRIEF).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { chmod, mkdir, unlink, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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
  'When you receive a `notifications/claude/channel` message with',
  '`params.source` set to `panopticon-bridge`, the body is operator-supplied',
  'text from the Panopticon dashboard or CLI that is being delivered',
  'out-of-band of the normal user-prompt input stream. Treat the body as if',
  'the user had typed it into the prompt and continue the conversation',
  'accordingly.',
  '',
  'When you reach a meaningful status boundary, call `channel_reply` with a',
  'structured payload instead of relying on terminal prose alone. Use',
  '`kind: "done"` when implementation is complete and you are ready for the',
  'orchestrator to treat the work as finished. Use `kind: "needs_input"` when',
  'you are blocked on a human answer. Use `kind: "status"` for non-terminal',
  'progress updates. Include a terse `summary` and optional `artifactRefs`',
  'entries when you want the dashboard to link to specific files or artefacts.',
].join('\n');

export const CHANNEL_REPLY_KINDS = ['status', 'done', 'needs_input'] as const;
export type ChannelReplyKind = (typeof CHANNEL_REPLY_KINDS)[number];

export interface ChannelReplyArtifactRef {
  uri: string;
  label?: string;
}

export interface ChannelReplyPayload {
  kind: ChannelReplyKind;
  summary: string;
  artifactRefs?: ChannelReplyArtifactRef[];
}

export interface AcceptedChannelReply {
  kind: ChannelReplyKind;
  summary: string;
  artifactRefs: ChannelReplyArtifactRef[];
}

export const CHANNEL_REPLY_TOOL: Tool = {
  name: 'channel_reply',
  title: 'Send structured status to Panopticon',
  description:
    'Send structured agent status back to Panopticon. `kind` is one of `status`, `done`, or `needs_input`; `summary` is terse human-readable status text; `artifactRefs` optionally links files, logs, or PRs by URI.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [...CHANNEL_REPLY_KINDS],
        description: 'Status class: status, done, or needs_input.',
      },
      summary: {
        type: 'string',
        description: 'Terse human-readable status summary for the orchestrator and dashboard.',
      },
      artifactRefs: {
        type: 'array',
        description: 'Optional artefact references such as file:// paths, PR URLs, or log URLs.',
        items: {
          type: 'object',
          properties: {
            uri: { type: 'string', description: 'URI or absolute path for the related artefact.' },
            label: { type: 'string', description: 'Optional short display label for the artefact.' },
          },
          required: ['uri'],
        },
      },
    },
    required: ['kind', 'summary'],
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
    readOnlyHint: false,
  },
};

export function listBridgeTools(): ListToolsResult {
  return { tools: [CHANNEL_REPLY_TOOL] };
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
      },
      tools: {},
    },
    instructions: INSTRUCTIONS,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => listBridgeTools());
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'channel_reply') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  return handleChannelReplyCall(request.params.arguments ?? {}, resolveAgentIdOrExit(), async () => {
    // PAN-986 bead 1 only defines the MCP surface and validates payloads.
    // Bead 2 wires accepted replies into the dashboard runtime event stream.
  });
});

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

export interface ChannelPushPayload {
  content: string;
  meta?: Record<string, string>;
}

export interface ChannelPushResult {
  ok: boolean;
  status: number;
  body: unknown;
}

function isChannelReplyKind(value: unknown): value is ChannelReplyKind {
  return typeof value === 'string' && CHANNEL_REPLY_KINDS.includes(value as ChannelReplyKind);
}

export function validateChannelReplyPayload(payload: unknown): AcceptedChannelReply {
  if (payload === null || typeof payload !== 'object') {
    throw new Error('channel_reply payload must be an object');
  }

  const source = payload as {
    kind?: unknown;
    summary?: unknown;
    artifactRefs?: unknown;
  };

  if (!isChannelReplyKind(source.kind)) {
    throw new Error('channel_reply.kind must be one of: status, done, needs_input');
  }
  if (typeof source.summary !== 'string' || source.summary.trim().length === 0) {
    throw new Error('channel_reply.summary must be a non-empty string');
  }
  if (source.artifactRefs !== undefined && !Array.isArray(source.artifactRefs)) {
    throw new Error('channel_reply.artifactRefs must be an array when provided');
  }

  const artifactRefs = (source.artifactRefs ?? []).map((item, index) => {
    if (item === null || typeof item !== 'object') {
      throw new Error(`channel_reply.artifactRefs[${index}] must be an object`);
    }
    const ref = item as { uri?: unknown; label?: unknown };
    if (typeof ref.uri !== 'string' || ref.uri.trim().length === 0) {
      throw new Error(`channel_reply.artifactRefs[${index}].uri must be a non-empty string`);
    }
    if (ref.label !== undefined && typeof ref.label !== 'string') {
      throw new Error(`channel_reply.artifactRefs[${index}].label must be a string when provided`);
    }
    return {
      uri: ref.uri,
      ...(typeof ref.label === 'string' ? { label: ref.label } : {}),
    };
  });

  return {
    kind: source.kind,
    summary: source.summary.trim(),
    artifactRefs,
  };
}

export async function handleChannelReplyCall(
  payload: unknown,
  agentId: string,
  sink: (reply: AcceptedChannelReply) => Promise<void>,
): Promise<CallToolResult> {
  const reply = validateChannelReplyPayload(payload);
  await sink(reply);
  await appendBridgeLog(agentId, {
    direction: 'outbound',
    kind: reply.kind,
    summaryLength: reply.summary.length,
    artifactCount: reply.artifactRefs.length,
  });
  return {
    content: [
      {
        type: 'text',
        text: `channel_reply accepted (${reply.kind})`,
      },
    ],
  };
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
    direction: 'inbound',
    contentLength: content.length,
    metaKeys: meta ? Object.keys(meta) : [],
  });

  return { ok: true, status: 200, body: 'ok' };
}

async function appendBridgeLog(
  agentId: string,
  entry:
    | { direction: 'inbound'; contentLength: number; metaKeys: string[] }
    | { direction: 'outbound'; kind: ChannelReplyKind; summaryLength: number; artifactCount: number },
): Promise<void> {
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
      const result = await pushChannelNotification(mcp, parsed, agentId);
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

  const shutdown = async (): Promise<void> => {
    try {
      await httpServer.stop();
    } catch {
      // best-effort
    }
    try {
      await unlink(getSocketPath(agentId));
    } catch {
      // best-effort
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
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
