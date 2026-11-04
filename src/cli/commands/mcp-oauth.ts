/**
 * `pan mcp oauth` — manage OAuth sign-ins to `/mcp` (PAN-4945 D-13). See
 * configuration/mcp.mdx.
 *
 * Every verb calls the root-only `/api/mcp-oauth/*` routes through
 * `callDashboard` with this machine's internal token; the CLI never touches
 * `mcp-oauth.json` itself. `issue` prints the two tokens once, for clients
 * that cannot open a browser. `pending`, `approve` and `deny` let the operator
 * finish a browser sign-in without the dashboard approval card.
 *
 * `src/cli/index.ts` registers this module at startup through `mcp.ts`, so it
 * imports only types statically. Everything else loads inside the call.
 */
import type { Command } from 'commander';

export interface McpOAuthCliDeps {
  callDashboard(path: string, init: { method: string; body?: unknown }): Promise<Response>;
  stdout(line: string): void;
  stderr(line: string): void;
}

interface ApprovalRow { id: string; clientName: string; redirectHost: string; requestedLevel: string; approvalCode: string; expiresAt: string }
interface SignInRow { familyId: string; clientName: string; level: string; lastUsedAt: string | null; refreshExpiresAt: string }

const NOT_RUNNING = 'The dashboard is not running. Start it with pan up.';
const LEVEL_HINT = 'The level must be one of read, message, operate, approve.';

/** Call the dashboard; on failure print the reason and return exit code 1. */
async function call(deps: McpOAuthCliDeps, path: string, init: { method: string; body?: unknown }, notFound?: string): Promise<Response | 1> {
  const { errorText, isDashboardUnreachable } = await import('./dashboard-call.js');
  let response: Response;
  try {
    response = await deps.callDashboard(path, init);
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    deps.stderr(NOT_RUNNING);
    return 1;
  }
  if (response.ok) return response;
  deps.stderr(response.status === 404 && notFound !== undefined ? notFound : await errorText(response));
  return 1;
}

async function isLevel(level: string | undefined): Promise<boolean> {
  const { isOAuthLevel } = await import('../../lib/mcp/oauth-flow.js');
  return isOAuthLevel(level);
}

function when(value: string): string {
  return new Date(value).toLocaleString();
}

/** `KQZT-MWRB`, `kqztmwrb` and `kqzt-mwrb` all name the same approval. */
function normalizeCode(code: string): string {
  return code.replaceAll('-', '').toUpperCase();
}

export async function runMcpOAuthIssue(deps: McpOAuthCliDeps, options: { name: string; level: string }): Promise<number> {
  if (!(await isLevel(options.level))) {
    deps.stderr(LEVEL_HINT);
    return 1;
  }
  const response = await call(deps, '/api/mcp-oauth/issue', { method: 'POST', body: { name: options.name, level: options.level } });
  if (response === 1) return 1;
  const body = await response.json() as { clientId: string; familyId: string; level: string; access_token: string; refresh_token: string };
  deps.stdout(`Client id:     ${body.clientId}`);
  deps.stdout(`Sign-in id:    ${body.familyId}`);
  deps.stdout(`Level:         ${body.level}`);
  deps.stdout(`Access token:  ${body.access_token}`);
  deps.stdout(`Refresh token: ${body.refresh_token}`);
  deps.stdout('These tokens are shown once. Store them in your client now.');
  return 0;
}

export async function runMcpOAuthList(deps: McpOAuthCliDeps): Promise<number> {
  const response = await call(deps, '/api/mcp-oauth/sign-ins', { method: 'GET' });
  if (response === 1) return 1;
  const { signIns } = await response.json() as { signIns: SignInRow[] };
  if (signIns.length === 0) deps.stdout('No MCP sign-ins.');
  for (const row of signIns) {
    deps.stdout(`${row.familyId}  ${row.level}  ${row.clientName}  last used ${row.lastUsedAt ? when(row.lastUsedAt) : 'never'}  refresh expires ${row.refreshExpiresAt.slice(0, 10)}`);
  }
  return 0;
}

export async function runMcpOAuthRevoke(deps: McpOAuthCliDeps, familyId: string): Promise<number> {
  const response = await call(deps, `/api/mcp-oauth/sign-ins/${encodeURIComponent(familyId)}`, { method: 'DELETE' }, `No active sign-in ${familyId}.`);
  if (response === 1) return 1;
  deps.stdout(`Revoked sign-in ${familyId}.`);
  return 0;
}

async function listApprovals(deps: McpOAuthCliDeps): Promise<ApprovalRow[] | 1> {
  const response = await call(deps, '/api/mcp-oauth/approvals', { method: 'GET' });
  if (response === 1) return 1;
  return (await response.json() as { approvals: ApprovalRow[] }).approvals;
}

export async function runMcpOAuthPending(deps: McpOAuthCliDeps): Promise<number> {
  const approvals = await listApprovals(deps);
  if (approvals === 1) return 1;
  if (approvals.length === 0) deps.stdout('No sign-ins are waiting.');
  for (const row of approvals) {
    deps.stdout(`${row.approvalCode}  ${row.clientName}  → ${row.redirectHost}  wants ${row.requestedLevel}  expires ${when(row.expiresAt)}`);
  }
  return 0;
}

export async function runMcpOAuthDecide(deps: McpOAuthCliDeps, code: string, decision: 'approve' | 'deny', level?: string): Promise<number> {
  if (decision === 'approve' && !(await isLevel(level))) {
    deps.stderr(LEVEL_HINT);
    return 1;
  }
  const approvals = await listApprovals(deps);
  if (approvals === 1) return 1;
  const match = approvals.find((row) => normalizeCode(row.approvalCode) === normalizeCode(code));
  if (!match) {
    deps.stderr(`No waiting sign-in has code ${code.toUpperCase()}.`);
    return 1;
  }
  const body = decision === 'approve' ? { decision, level } : { decision };
  const response = await call(deps, `/api/mcp-oauth/approvals/${encodeURIComponent(match.id)}`, { method: 'POST', body });
  if (response === 1) return 1;
  deps.stdout(decision === 'approve'
    ? `Approved sign-in ${match.approvalCode} for ${match.clientName} at level ${level}.`
    : `Denied sign-in ${match.approvalCode} for ${match.clientName}.`);
  return 0;
}

async function runWith(run: (deps: McpOAuthCliDeps) => Promise<number>): Promise<void> {
  const { callDashboard } = await import('./dashboard-call.js');
  const code = await run({
    callDashboard,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
  const { exitCli } = await import('../exit.js');
  await exitCli(code);
}

export function registerMcpOAuthCommands(mcp: Command): void {
  const oauth = mcp.command('oauth').description('Manage OAuth sign-ins to /mcp (see configuration/mcp.mdx)');
  oauth
    .command('issue')
    .description('Create a sign-in for a client that cannot open a browser; prints its tokens once')
    .requiredOption('--name <name>', 'Name shown in the sign-in list')
    .requiredOption('--level <level>', 'Access level: read, message, operate or approve')
    .action((options: { name: string; level: string }) => runWith((deps) => runMcpOAuthIssue(deps, options)));
  oauth
    .command('list')
    .description('List active OAuth sign-ins')
    .action(() => runWith(runMcpOAuthList));
  oauth
    .command('revoke <familyId>')
    .description('End one OAuth sign-in')
    .action((familyId: string) => runWith((deps) => runMcpOAuthRevoke(deps, familyId)));
  oauth
    .command('pending')
    .description('List sign-ins waiting for your approval')
    .action(() => runWith(runMcpOAuthPending));
  oauth
    .command('approve <code>')
    .description('Approve the waiting sign-in that shows this approval code')
    .requiredOption('--level <level>', 'Access level: read, message, operate or approve')
    .action((code: string, options: { level: string }) => runWith((deps) => runMcpOAuthDecide(deps, code, 'approve', options.level)));
  oauth
    .command('deny <code>')
    .description('Deny the waiting sign-in that shows this approval code')
    .action((code: string) => runWith((deps) => runMcpOAuthDecide(deps, code, 'deny')));
}
