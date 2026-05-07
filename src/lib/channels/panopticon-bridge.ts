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

const AGENT_ID = process.env.PANOPTICON_AGENT_ID;
if (!AGENT_ID) {
  process.stderr.write(
    'panopticon-bridge: PANOPTICON_AGENT_ID env var is required. ' +
      'It is normally supplied by the per-agent MCP config; if you are running this script ' +
      'manually for development, set it explicitly.\n',
  );
  process.exit(2);
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
  'No reply tool is exposed in PAN-985; respond by continuing your normal',
  'turn. Status updates back to the orchestrator are scraped from the',
  'output pane until a follow-up issue lands the bidirectional reply tool.',
].join('\n');

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
    },
    instructions: INSTRUCTIONS,
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // TODO(workspace-bvzr): bind the Unix-socket inbound listener at
  // ${PANOPTICON_HOME}/sockets/agent-<id>.sock and forward every payload as
  // a `notifications/channel` notification through `server.notification`.
  // The unlink-on-startup is documented in the header comment above; do
  // not move it elsewhere.

  // Block on stdin so Bun does not exit before claude tears down the
  // process. Claude closes stdin when the parent session ends, which
  // cleanly resolves the StdioServerTransport.
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
