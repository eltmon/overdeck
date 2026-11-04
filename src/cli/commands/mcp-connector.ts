/**
 * `pan mcp connector login|pair|serve|status|logout` — the Overdeck connector a self-hosted bot
 * runs to reach one Overdeck machine's MCP tools (PAN-4927 W-CONN2, PAN-4950 FR-2 to FR-4, FR-9).
 * See configuration/mcp.mdx.
 *
 * `src/cli/commands/mcp.ts` registers this group at startup, so this module imports only Commander
 * types statically (NFR-5). The connector modules (werift, the directory client, the channel code
 * and the MCP SDK) load inside each action. Every command keeps its state in the connector home
 * (`OVERDECK_CONNECTOR_HOME`, default `~/.overdeck-connector`) and never touches `~/.overdeck`.
 */
import type { Command } from 'commander';

export const PORT_MESSAGE = '--port must be an integer from 1 to 65535';

/** `--port`: an integer from 1 to 65535, default 7466; null for anything else. */
export function parseConnectorPort(raw: string | undefined): number | null {
  if (raw === undefined) return 7466;
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

const io = {
  out: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line: string) => {
    process.stderr.write(`${line}\n`);
  },
};

async function finish(code: number): Promise<never> {
  const { exitCli } = await import('../exit.js');
  return exitCli(code);
}

async function home(): Promise<string> {
  const { connectorHome } = await import('../../lib/mcp/connector/home.js');
  return connectorHome(process.env);
}

/** Validates `--port` before any connector module loads; exits 1 on a bad value. */
async function portOrExit(raw: string | undefined): Promise<number> {
  const port = parseConnectorPort(raw);
  if (port !== null) return port;
  io.err(PORT_MESSAGE);
  return finish(1);
}

export function registerMcpConnectorCommands(mcp: Command, appVersion: () => string): void {
  const connector = mcp.command('connector').description('Run an Overdeck connector for a self-hosted bot (see configuration/mcp.mdx)');

  connector
    .command('login')
    .description('Sign this connector in to overdeck.ai with the device flow')
    .option('--account-url <url>', 'overdeck.ai account service URL')
    .option('--directory-url <url>', 'overdeck.ai directory URL')
    .action(async (options: { accountUrl?: string; directoryUrl?: string }) => {
      const { runConnectorLogin } = await import('../../lib/mcp/connector/account.js');
      await finish(await runConnectorLogin({ ...options, home: await home(), env: process.env }, io));
    });

  connector
    .command('pair <pairingString>')
    .description('Pair with one Overdeck machine using the string from Connect a bot')
    .option('--label <name>', 'name this connector shows on the machine (default: host name)')
    .action(async (pairingString: string, options: { label?: string }) => {
      const { runConnectorPair } = await import('../../lib/mcp/connector/pair.js');
      await finish(await runConnectorPair({ pairingString, ...options, home: await home(), appVersion: appVersion() }, io));
    });

  connector
    .command('serve')
    .description('Serve the Overdeck MCP tools on 127.0.0.1 (or stdio) for the paired machine')
    .option('--port <port>', 'loopback port for http://127.0.0.1:<port>/mcp (default 7466)')
    .option('--stdio', 'serve one MCP session on stdin and stdout instead')
    .option('--label <name>', 'name this connector shows in the overdeck.ai directory (default: host name)')
    .action(async (options: { port?: string; stdio?: boolean; label?: string }) => {
      const port = await portOrExit(options.port);
      const { runConnectorServe } = await import('../../lib/mcp/connector/serve.js');
      const code = await runConnectorServe(
        {
          home: await home(),
          port,
          stdio: options.stdio === true,
          ...(options.label !== undefined ? { label: options.label } : {}),
          appVersion: appVersion(),
          stdin: process.stdin,
          stdout: process.stdout,
        },
        // In stdio mode stdout carries only JSON-RPC, so every line goes to stderr.
        options.stdio === true ? { out: io.err, err: io.err } : io,
      );
      await finish(code);
    });

  connector
    .command('status')
    .description('Show the signed-in account, the paired machine, its scopes and the live route')
    .option('--port <port>', 'port of the running serve (default 7466)')
    .action(async (options: { port?: string }) => {
      const port = await portOrExit(options.port);
      const { runConnectorStatus } = await import('../../lib/mcp/connector/account.js');
      await finish(await runConnectorStatus({ home: await home(), port }, io));
    });

  connector
    .command('logout')
    .description('Remove this connector from its machine and overdeck.ai, then delete its files')
    .action(async () => {
      const { runConnectorLogout } = await import('../../lib/mcp/connector/pair.js');
      await finish(await runConnectorLogout({ home: await home(), appVersion: appVersion() }, io));
    });
}
