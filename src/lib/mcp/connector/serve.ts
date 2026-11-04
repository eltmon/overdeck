/**
 * `pan mcp connector serve`: the bot-facing MCP endpoint (PAN-4927 W-CONN2, PAN-4950 FR-4, FR-7,
 * NFR-1, NFR-2, D-6, D-7, D-8).
 *
 * HTTP mode binds `127.0.0.1` only and serves `POST /mcp` in stateless JSON mode: one fresh MCP
 * `Server` and SDK `StreamableHTTPServerTransport` per request, closed after the response, as the
 * dashboard's `/mcp` does. A bot must send `Authorization: Bearer <local token>`, compared in
 * constant time. `GET /healthz` is unauthenticated and answers `{ ok, machine, route }` with no
 * secret. Stdio mode serves one session; stdout then carries only JSON-RPC and every diagnostic
 * goes to stderr.
 *
 * Every tool call travels to the paired machine with the connector token over a link channel
 * (`channel-api.ts`). The tool list is the shared one minus `list_machines`, and the three start
 * tools lose their `machine` and `needs` arguments: a connector reaches only its paired machine.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { setRtcDialer } from '../../anywhere/channel/open.js';
import type { DashboardApi } from '../dashboard-api.js';
import { ALL_TOOLS, createOverdeckMcpServer } from '../server.js';
import { errorResult, type OverdeckTool } from '../tool.js';
import type { ConnectorIo } from './account.js';
import { ConnectorLink, type ConnectorRoute, createConnectorDashboardApi } from './channel-api.js';
import { machineInDirectory, waitDirectoryOnline } from './directory.js';
import { readAccount, readIdentity, readLocalToken, readPairing } from './home.js';
import { connectorLabel, type ConnectorDeps, defaultConnectorDeps } from './pair.js';

export const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;

const START_TOOLS = new Set(['start_conversation', 'start_worker', 'start_issue']);
const LOCAL_ONLY_MESSAGE = 'A connector reaches only the machine it paired with; omit machine and needs.';

/** D-6: the shared tools minus `list_machines`, with the start tools pinned to the paired machine. */
export function connectorTools(tools: readonly OverdeckTool[] = ALL_TOOLS): OverdeckTool[] {
  return tools
    .filter((tool) => tool.name !== 'list_machines')
    .map((tool): OverdeckTool => {
      if (!START_TOOLS.has(tool.name)) return tool;
      const { machine: _machine, needs: _needs, ...properties } = tool.inputSchema.properties ?? {};
      return {
        ...tool,
        inputSchema: { ...tool.inputSchema, properties },
        run: (args, ctx) =>
          args['machine'] !== undefined || args['needs'] !== undefined ? Promise.resolve(errorResult(LOCAL_ONLY_MESSAGE)) : tool.run(args, ctx),
      };
    });
}

export interface ConnectorHealth {
  ok: boolean;
  machine: string;
  route: ConnectorRoute;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1], 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The request body, or null after answering 413 when it passes the limit. */
function readBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    const refuse = (): void => {
      tooLarge = true;
      sendJson(res, 413, { error: `request body over ${MAX_MCP_BODY_BYTES} bytes` }, { connection: 'close' });
      resolve(null);
    };
    if (declared > MAX_MCP_BODY_BYTES) refuse();
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_MCP_BODY_BYTES) {
        chunks.length = 0;
        refuse();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

export async function startConnectorHttp(input: {
  port: number;
  localToken: string;
  api: DashboardApi;
  scopes: readonly string[];
  health(): ConnectorHealth;
}): Promise<{ host: string; port: number; close(): Promise<void> }> {
  const expected = Buffer.from(input.localToken, 'utf8');
  const tools = connectorTools();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/healthz' && req.method === 'GET') {
      sendJson(res, 200, input.health(), { 'cache-control': 'no-store' });
      return;
    }
    if (path !== '/mcp') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
      return;
    }
    if (!bearerMatches(req.headers.authorization, expected)) {
      req.resume();
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const body = await readBody(req, res);
    if (body === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      return;
    }
    const server = createOverdeckMcpServer({ api: input.api, scopes: input.scopes, isAgent: false }, tools);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  };

  const http: HttpServer = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(input.port, '127.0.0.1', () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address();
  const bound = typeof address === 'object' && address !== null ? address : { address: '127.0.0.1', port: input.port };
  return {
    host: bound.address,
    port: bound.port,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

/** One stdio MCP session; resolves when stdin ends. */
export async function serveConnectorStdio(input: {
  api: DashboardApi;
  scopes: readonly string[];
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
}): Promise<void> {
  const server = createOverdeckMcpServer({ api: input.api, scopes: input.scopes, isAgent: false }, connectorTools());
  const closed = new Promise<void>((resolve) => {
    input.stdin.once('end', resolve);
    input.stdin.once('close', resolve);
  });
  await server.connect(new StdioServerTransport(input.stdin as NodeJS.ReadStream, input.stdout as NodeJS.WriteStream));
  await closed;
  await server.close();
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runConnectorServe(
  opts: {
    home: string;
    port: number;
    stdio: boolean;
    label?: string;
    appVersion: string;
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
  },
  io: ConnectorIo,
  deps: ConnectorDeps & { waitForShutdown?: () => Promise<void> } = defaultConnectorDeps(),
): Promise<number> {
  let account, identity, pairing, localToken: string | null = null;
  try {
    account = await readAccount(opts.home);
    identity = await readIdentity(opts.home);
    pairing = await readPairing(opts.home);
    if (!opts.stdio) localToken = await readLocalToken(opts.home);
  } catch (error) {
    io.err(errorText(error));
    return 1;
  }
  if (!account || !identity) {
    io.err('Sign in first: pan mcp connector login');
    return 1;
  }
  if (!pairing) {
    io.err("Pair first: pan mcp connector pair '<pairing string>'");
    return 1;
  }
  if (!opts.stdio && !localToken) {
    io.err("The local token is missing; run pan mcp connector pair '<pairing string>' again.");
    return 1;
  }

  const directory = deps.createDirectory({ account, identity, label: connectorLabel(opts.label, identity.clientId), appVersion: opts.appVersion });
  try {
    await directory.start();
    await waitDirectoryOnline(directory);
  } catch (error) {
    directory.stop();
    io.err(errorText(error));
    return 1;
  }
  const found = machineInDirectory(directory, pairing.environmentId);
  if (!found.ok) {
    // Absent: wrong account, a fatal mismatch. Offline: keep serving; the link waits for it.
    if (!directory.machines.some((machine) => machine.environmentId === pairing.environmentId)) {
      directory.stop();
      io.err(found.error);
      return 1;
    }
    io.err(found.error);
  }

  const rtc = deps.createRtc(directory);
  setRtcDialer(rtc.dialer);
  const link = new ConnectorLink({ pairing, identity, rtc, directory, openProbe: deps.openPairingChannel });
  void link.connect();
  const api = createConnectorDashboardApi(link, deps.linkFetch ? { linkFetch: deps.linkFetch } : {});
  const shutdown = (): void => {
    link.stop();
    setRtcDialer(null);
    rtc.stop();
    directory.stop();
  };

  if (opts.stdio) {
    try {
      await serveConnectorStdio({ api, scopes: pairing.scopes, stdin: opts.stdin, stdout: opts.stdout });
    } finally {
      shutdown();
    }
    return 0;
  }

  let http: { host: string; port: number; close(): Promise<void> };
  try {
    http = await startConnectorHttp({ port: opts.port, localToken: localToken!, api, scopes: pairing.scopes, health: () => link.health() });
  } catch (error) {
    shutdown();
    io.err((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${opts.port} is in use; pass --port` : errorText(error));
    return 1;
  }
  io.err(`Overdeck connector for ${pairing.machineLabel} listening on http://127.0.0.1:${http.port}/mcp`);
  await (deps.waitForShutdown ?? waitForSignal)();
  await http.close();
  shutdown();
  return 0;
}
