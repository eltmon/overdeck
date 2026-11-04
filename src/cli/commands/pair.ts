/**
 * `pan pair` / `pan devices` — pair other devices with this machine's
 * dashboard and manage them (PAN-3762).
 *
 *   pan pair [--label <name>] [--url <base>] [--json]
 *   pan devices list [--json]
 *   pan devices revoke <id>
 *   pan machines link|list|unlink   (PAN-4645, `machines.ts`, registered from here)
 *   pan connect [--url <base>] [--label <name>] [--json]   (PAN-4656, `connect.ts`, registered from here)
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
 * it imports only Commander types, chalk, the import-free
 * `lib/remote-access/loopback.ts` and `../lazy-action.ts` statically. Config
 * and token modules load inside each handler; `connect.ts` loads through
 * `lazyAction` only when `pan connect` runs.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import { isLoopbackOrigin as isLoopbackBase } from '../../lib/remote-access/loopback.js';
import { lazyAction } from '../lazy-action.js';
import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';
import { registerMachinesCommands } from './machines.js';
import { LOOPBACK_WARNING, NOT_RUNNING, requestPairingLink, TOKEN_REJECTED } from './pairing-link.js';

/** True when the base URL only resolves on this machine (PAN-4445 D-7: one check, shared with the server). */
export { isLoopbackBase };

export interface PairOptions { label?: string; url?: string; json?: boolean }

const DOCS_PAGE = 'configuration/remote-access.mdx';
// Shared with `pan connect` (PAN-4656) from a leaf module, so connect.ts never imports this file.
export { LOOPBACK_WARNING, pairingUrl, requestPairingLink, type PairingLinkResult } from './pairing-link.js';

export { callDashboard, isDashboardUnreachable } from './dashboard-call.js';

async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

export async function runPair(options: PairOptions): Promise<void> {
  const link = await requestPairingLink({ label: options.label, base: options.url });
  if (!link.ok) return fail(link.message);
  const { url, credential, expiresAt, base } = link;
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
  if (response.status === 401) return fail(TOKEN_REJECTED);
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
  if (response.status === 401) return fail(TOKEN_REJECTED);
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

  // PAN-4645: `pan machines` registers here so `src/cli/index.ts` does not grow.
  registerMachinesCommands(program);

  // PAN-4656: likewise `pan connect`.
  program
    .command('connect')
    .description('Install this machine\'s server as a lasting service and print one link that links it from another machine (see cli/machines.mdx)')
    .option('--url <base>', 'Address another machine reaches this one at (default: picked automatically)')
    .option('--label <name>', 'Name recorded for the pairing in the activity log')
    .option('--json', 'Print the result as JSON')
    .action(lazyAction(() => import('./connect.js'), 'connectCommand'));
}
