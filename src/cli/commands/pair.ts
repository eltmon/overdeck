/**
 * `pan pair` — pair another device with this machine's dashboard (PAN-3762).
 *
 *   pan pair [--label <name>] [--url <base>] [--json]
 *
 * Asks the running dashboard (with the internal token) for a one-time pairing
 * credential and prints `<base>/#pair=<credential>`. The credential is always
 * in the URL fragment, never a query string, so it never reaches a server log.
 * It is single use and expires after 10 minutes; a dashboard restart drops it.
 * See configuration/remote-access.mdx.
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. Config and token
 * modules load inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

export interface PairOptions { label?: string; url?: string; json?: boolean }

const DOCS_PAGE = 'configuration/remote-access.mdx';
const NOT_RUNNING = 'Overdeck dashboard is not running; start it with `pan up`.';
const NEEDS_PAN_UP = 'The dashboard rejected this machine\'s internal token. `pan pair` needs a dashboard started by `pan up` (a `pan serve` server does not share it).';
const LOOPBACK_WARNING = 'This URL only works on this machine. Pass --url with an address another device can reach, and add that origin to OVERDECK_TRUSTED_ORIGINS.';

/** `<base>/#pair=<credential>`: the credential rides in the fragment only. */
export function pairingUrl(base: string, credential: string): string {
  return `${base.replace(/\/+$/, '')}/#pair=${credential}`;
}

/** True when the base URL only resolves on this machine. */
export function isLoopbackBase(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

class DashboardUnreachableError extends Error {}

/** Call the running dashboard with the internal token. Throws DashboardUnreachableError when nothing answers. */
export async function callDashboard(path: string, init: { method: string; body?: unknown }): Promise<Response> {
  const { getDashboardApiUrl } = await import('../../lib/config.js');
  const { ensureInternalToken, INTERNAL_TOKEN_HEADER } = await import('../../lib/internal-token.js');
  try {
    return await fetch(`${getDashboardApiUrl()}${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: ensureInternalToken() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new DashboardUnreachableError((error as Error).message);
  }
}

export function isDashboardUnreachable(error: unknown): boolean {
  return error instanceof DashboardUnreachableError;
}

async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

async function errorText(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
}

export async function runPair(options: PairOptions): Promise<void> {
  let response: Response;
  try {
    response = await callDashboard('/api/pairing/credentials', {
      method: 'POST',
      body: options.label ? { label: options.label } : {},
    });
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail(NOT_RUNNING);
    throw error;
  }
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan pair failed: ${await errorText(response)}`);

  const { credential, expiresAt } = await response.json() as { credential: string; expiresAt: string };
  const { getDashboardApiUrl } = await import('../../lib/config.js');
  const base = options.url ?? getDashboardApiUrl();
  const url = pairingUrl(base, credential);
  const loopback = isLoopbackBase(base);

  if (options.json) {
    console.log(JSON.stringify({ url, credential, expiresAt }));
    if (loopback) console.error(chalk.yellow(LOOPBACK_WARNING));
    return;
  }

  console.log(`Open this URL on the device to pair:\n\n  ${chalk.bold(url)}\n`);
  console.log(`Expires: ${expiresAt} (single use; a dashboard restart invalidates it)`);
  console.log(`Credential for manual entry: ${credential}`);
  if (loopback) console.log(chalk.yellow(`\n${LOOPBACK_WARNING}`));
}

export function registerPairCommands(program: Command): void {
  program
    .command('pair')
    .description(`Print a one-time URL that pairs another device with this dashboard (see ${DOCS_PAGE})`)
    .option('--label <name>', 'Name to record for the pairing in the activity log')
    .option('--url <base>', 'Base URL the other device can reach (default: this dashboard\'s API URL)')
    .option('--json', 'Print { url, credential, expiresAt } as JSON')
    .action((options: PairOptions) => runPair(options));
}
