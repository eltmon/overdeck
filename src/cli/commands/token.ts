/**
 * `pan token` — create, list and revoke scoped access tokens (PAN-2351).
 *
 *   pan token create <name> --scopes <list> [--json]
 *   pan token list [--json]
 *   pan token revoke <id>
 *
 * `create` and `list` use the registry (`~/.overdeck/access-tokens.json`)
 * directly; a running dashboard accepts a new token within 5 seconds (its
 * snapshot refresh). `revoke` goes through `DELETE /api/access-tokens/:id` so
 * the token's live connections close at once, and writes the registry
 * directly only when the dashboard is unreachable (no connections can be open
 * then). See configuration/remote-access.mdx.
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. The registry and the
 * dashboard client load inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

const DOCS_PAGE = 'configuration/remote-access.mdx';
const NEEDS_PAN_UP = 'The dashboard rejected this machine\'s internal token. `pan token revoke` needs a dashboard started by `pan up` (a `pan serve` server does not share it).';

interface TokenRow { id: string; name: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt?: string | null }

async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

async function errorText(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
}

export async function runTokenCreate(name: string, options: { scopes: string; json?: boolean }): Promise<void> {
  const { createAccessToken, parseAccessTokenScopes } = await import('../../lib/access-tokens.js');
  let scopes: ReturnType<typeof parseAccessTokenScopes>;
  try {
    scopes = parseAccessTokenScopes(options.scopes);
  } catch (error) {
    return fail((error as Error).message);
  }
  let created: Awaited<ReturnType<typeof createAccessToken>>;
  try {
    created = await createAccessToken({ name, scopes, kind: 'token' });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { token, record } = created;
  if (options.json) {
    console.log(JSON.stringify({ id: record.id, name: record.name, scopes: record.scopes, token }));
    return;
  }
  console.log(`Created access token ${record.id}`);
  console.log(`  name:   ${record.name}`);
  console.log(`  scopes: ${record.scopes.join(', ')}\n`);
  console.log(token);
  console.log('\nThis token is shown once. A running dashboard accepts it within 5 seconds.');
}

export async function runTokenList(options: { json?: boolean }): Promise<void> {
  const { listAccessTokens } = await import('../../lib/access-tokens.js');
  const tokens = (await listAccessTokens()).filter((record) => record.kind === 'token');
  if (options.json) {
    console.log(JSON.stringify(tokens));
    return;
  }
  if (tokens.length === 0) {
    console.log('No access tokens. Create one with `pan token create`.');
    return;
  }
  const header = ['ID', 'NAME', 'SCOPES', 'CREATED', 'LAST USED', 'REVOKED'];
  const rows = tokens.map((t) => [t.id, t.name, t.scopes.join(','), t.createdAt, t.lastUsedAt ?? '-', t.revokedAt ?? '-']);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  console.log(chalk.bold(line(header)));
  for (const row of rows) console.log(line(row));
}

export async function runTokenRevoke(id: string): Promise<void> {
  const { callDashboard, isDashboardUnreachable } = await import('./pair.js');
  let response: Response;
  try {
    response = await callDashboard(`/api/access-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    const { revokeAccessToken, listAccessTokens } = await import('../../lib/access-tokens.js');
    const target = (await listAccessTokens()).find((record) => record.id === id && record.kind === 'token');
    if (!target) return fail(`No access token with id ${id}.`);
    await revokeAccessToken(id);
    console.log('Dashboard not running; revoked in the registry. No live connections were open.');
    return;
  }
  if (response.status === 404) return fail(`No access token with id ${id}.`);
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan token revoke failed: ${await errorText(response)}`);
  const { token, closedConnections } = await response.json() as { token: TokenRow; closedConnections: number };
  console.log(`Revoked access token "${token.name}" (${token.id}); closed ${closedConnections} live connection(s).`);
}

export function registerTokenCommands(program: Command): void {
  const token = program
    .command('token')
    .description(`Create, list or revoke scoped access tokens (see ${DOCS_PAGE})`);
  token
    .command('create <name>')
    .description('Create a scoped access token and print it once')
    .requiredOption('--scopes <list>', 'Comma-separated scopes: read:events, read:state, read:conversations, tell, operate, admin')
    .option('--json', 'Print { id, name, scopes, token } as JSON')
    .action((name: string, options: { scopes: string; json?: boolean }) => runTokenCreate(name, options));
  token
    .command('list')
    .description('List access tokens with scopes and created, last-used and revoked times')
    .option('--json', 'Print the tokens as JSON')
    .action((options: { json?: boolean }) => runTokenList(options));
  token
    .command('revoke <id>')
    .description('Revoke an access token and close its live connections')
    .action((id: string) => runTokenRevoke(id));
}
