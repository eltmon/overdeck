/**
 * `pan pair` / `pan devices` — pair other devices with this machine's
 * dashboard and manage them (PAN-3762).
 *
 *   pan pair [--label <name>] [--url <base>] [--json]
 *   pan devices list [--json]
 *   pan devices revoke <id>
 *
 * Asks the running dashboard (with the internal token) for a one-time pairing
 * credential and prints `<base>/#pair=<credential>`. The credential is always
 * in the URL fragment, never a query string, so it never reaches a server log.
 * It is single use and expires after 10 minutes; a dashboard restart drops it.
 * `pan devices revoke` closes the device's live connections through the
 * dashboard; when the dashboard is down it writes the registry directly (no
 * connections can be open then). See configuration/remote-access.mdx.
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types, chalk and the import-free
 * `lib/remote-access/loopback.ts` statically. Config and token modules load
 * inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import { isLoopbackOrigin as isLoopbackBase } from '../../lib/remote-access/loopback.js';

/** True when the base URL only resolves on this machine (PAN-4445 D-7: one check, shared with the server). */
export { isLoopbackBase };

export interface PairOptions { label?: string; url?: string; json?: boolean }

const DOCS_PAGE = 'configuration/remote-access.mdx';
const NOT_RUNNING = 'Overdeck dashboard is not running; start it with `pan up`.';
const NEEDS_PAN_UP = 'The dashboard rejected this machine\'s internal token. `pan pair` needs a dashboard started by `pan up` (a `pan serve` server does not share it).';
const LOOPBACK_WARNING = 'This URL only works on this machine. Pass --url with an address another device can reach, and add that origin to OVERDECK_TRUSTED_ORIGINS.';

/** `<base>/#pair=<credential>`: the credential rides in the fragment only. */
export function pairingUrl(base: string, credential: string): string {
  return `${base.replace(/\/+$/, '')}/#pair=${credential}`;
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

interface DeviceRow { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

export async function runDevicesList(options: { json?: boolean }): Promise<void> {
  let response: Response;
  try {
    response = await callDashboard('/api/devices', { method: 'GET' });
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail(NOT_RUNNING);
    throw error;
  }
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan devices list failed: ${await errorText(response)}`);
  const { devices } = await response.json() as { devices: DeviceRow[] };

  if (options.json) {
    console.log(JSON.stringify(devices));
    return;
  }
  if (devices.length === 0) {
    console.log('No paired devices. Pair one with `pan pair`.');
    return;
  }
  const header = ['ID', 'NAME', 'CREATED', 'LAST USED', 'REVOKED'];
  const rows = devices.map((d) => [d.id, d.name, d.createdAt, d.lastUsedAt ?? '-', d.revokedAt ?? '-']);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  console.log(chalk.bold(line(header)));
  for (const row of rows) console.log(line(row));
}

export async function runDevicesRevoke(id: string): Promise<void> {
  let response: Response;
  try {
    response = await callDashboard(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    const { revokeAccessToken, listAccessTokens } = await import('../../lib/access-tokens.js');
    const target = (await listAccessTokens()).find((record) => record.id === id && record.kind === 'device');
    if (!target) return fail(`No paired device with id ${id}.`);
    await revokeAccessToken(id);
    console.log('Dashboard not running; revoked in the registry. No live connections were open.');
    return;
  }
  if (response.status === 404) return fail(`No paired device with id ${id}.`);
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan devices revoke failed: ${await errorText(response)}`);
  const { device } = await response.json() as { device: DeviceRow };
  console.log(`Revoked device "${device.name}" (${device.id}); its live connections were closed.`);
}

export function registerPairCommands(program: Command): void {
  program
    .command('pair')
    .description(`Print a one-time URL that pairs another device with this dashboard (see ${DOCS_PAGE})`)
    .option('--label <name>', 'Name to record for the pairing in the activity log')
    .option('--url <base>', 'Base URL the other device can reach (default: this dashboard\'s API URL)')
    .option('--json', 'Print { url, credential, expiresAt } as JSON')
    .action((options: PairOptions) => runPair(options));

  const devices = program
    .command('devices')
    .description(`List or revoke paired devices (see ${DOCS_PAGE})`);
  devices
    .command('list')
    .description('List paired devices with created, last-used and revoked times')
    .option('--json', 'Print the devices as JSON')
    .action((options: { json?: boolean }) => runDevicesList(options));
  devices
    .command('revoke <id>')
    .description('Revoke a paired device and close its live connections')
    .action((id: string) => runDevicesRevoke(id));
}
