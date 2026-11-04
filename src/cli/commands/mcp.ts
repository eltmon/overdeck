/**
 * `pan mcp serve` — serve the Overdeck MCP tool module over stdio (PAN-4649
 * FR-7). See configuration/mcp.mdx.
 *
 * The token comes from `OVERDECK_MCP_TOKEN`, or, when that is unset, the
 * 0600 file named by `OVERDECK_MCP_TOKEN_FILE` (PAN-4927 D-7): managed agents
 * get the file, never the token in a launcher or argv (D-4649-7). The
 * command verifies it against the local registry before serving, so a bad
 * token fails at start: it must be known, not revoked, `kind: 'token'`, and
 * without `admin` (MCP is always fenced, D-21). Each tool then calls the
 * dashboard at `getDashboardApiUrl()` with that token, so the route-scope
 * table judges every call.
 *
 * stdout carries only JSON-RPC (NFR-6); every diagnostic goes to stderr.
 *
 * `src/cli/index.ts` imports this module at startup to register the verb, so
 * it imports only Commander types and `./mcp-oauth.js` (`pan mcp oauth`,
 * PAN-4945, itself type-only at load) statically. Everything else loads
 * inside the handler.
 */
import type { Readable, Writable } from 'node:stream';
import type { Command } from 'commander';

import { registerMcpOAuthCommands } from './mcp-oauth.js';

export interface McpServeDeps {
  env: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: Writable;
  stderr: (line: string) => void;
}

const CREATE_HINT = 'pan token create mcp --scopes read:state,read:conversations,operate';

type ReadServeTokenResult = { ok: true; token: string } | { ok: false };

/**
 * The token for `pan mcp serve`: `OVERDECK_MCP_TOKEN` when set, else the
 * 0600 file named by `OVERDECK_MCP_TOKEN_FILE` (PAN-4927 D-5, D-6). Reads the
 * file through one handle, so the mode checked is the mode of the bytes read.
 */
async function readServeToken(deps: McpServeDeps): Promise<ReadServeTokenResult> {
  const fromEnv = deps.env['OVERDECK_MCP_TOKEN']?.trim();
  if (fromEnv) return { ok: true, token: fromEnv };

  const path = deps.env['OVERDECK_MCP_TOKEN_FILE']?.trim();
  if (!path) {
    deps.stderr(`OVERDECK_MCP_TOKEN or OVERDECK_MCP_TOKEN_FILE is not set. Create a token with: ${CREATE_HINT}`);
    return { ok: false };
  }

  const { open } = await import('node:fs/promises');
  let handle;
  try {
    handle = await open(path, 'r');
    const { mode } = await handle.stat();
    if ((mode & 0o077) !== 0) {
      deps.stderr(`OVERDECK_MCP_TOKEN_FILE must be mode 0600 (it is 0${(mode & 0o777).toString(8)}). Fix it with: chmod 600 ${path}`);
      return { ok: false };
    }
    const token = (await handle.readFile('utf8')).trim();
    if (!token) {
      deps.stderr(`OVERDECK_MCP_TOKEN_FILE is empty: ${path}`);
      return { ok: false };
    }
    return { ok: true, token };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.stderr(`OVERDECK_MCP_TOKEN_FILE could not be read: ${message}`);
    return { ok: false };
  } finally {
    await handle?.close();
  }
}

/** Resolves 1 on a refused token; otherwise serves until stdin closes, then 0. */
export async function runMcpServe(deps: McpServeDeps): Promise<number> {
  const read = await readServeToken(deps);
  if (!read.ok) return 1;
  const token = read.token;

  const { refreshAccessTokens, verifyAccessToken } = await import('../../lib/access-tokens.js');
  await refreshAccessTokens();
  const verified = verifyAccessToken(token);
  if (!verified.ok) {
    deps.stderr(`OVERDECK_MCP_TOKEN is refused: the token is unknown or revoked. Create a token with: ${CREATE_HINT}`);
    return 1;
  }
  const { record } = verified;
  if (record.kind !== 'token') {
    deps.stderr('OVERDECK_MCP_TOKEN is refused: a paired device credential cannot drive MCP.');
    return 1;
  }
  if (record.scopes.includes('admin')) {
    deps.stderr(`OVERDECK_MCP_TOKEN is refused: MCP tokens cannot carry admin. Create a token with: ${CREATE_HINT}`);
    return 1;
  }

  const [{ StdioServerTransport }, { getDashboardApiUrl }, { createFetchDashboardApi }, { createOverdeckMcpServer, hasAgentId }] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('../../lib/config.js'),
    import('../../lib/mcp/dashboard-api.js'),
    import('../../lib/mcp/server.js'),
  ]);
  const server = createOverdeckMcpServer({
    api: createFetchDashboardApi({ baseUrl: getDashboardApiUrl(), token }),
    scopes: record.scopes,
    isAgent: hasAgentId(record),
  });
  const closed = new Promise<void>((resolve) => {
    deps.stdin.once('end', resolve);
    deps.stdin.once('close', resolve);
  });
  await server.connect(new StdioServerTransport(deps.stdin, deps.stdout));
  await closed;
  await server.close();
  return 0;
}

export function registerMcpCommands(program: Command): void {
  const mcp = program.command('mcp').description('Serve Overdeck to MCP clients (see configuration/mcp.mdx)');
  mcp
    .command('serve')
    .description('Serve Overdeck as an MCP server over stdio (token from OVERDECK_MCP_TOKEN or OVERDECK_MCP_TOKEN_FILE; see configuration/mcp.mdx)')
    .action(async () => {
      const code = await runMcpServe({
        env: process.env,
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: (line) => process.stderr.write(`${line}\n`),
      });
      const { exitCli } = await import('../exit.js');
      await exitCli(code);
    });
  registerMcpOAuthCommands(mcp);
}
