/**
 * `pan machines` — link this dashboard to another machine and manage links
 * (PAN-4645 WI-14, FR-1).
 *
 *   pan machines link <pairing-url> [--one-way] [--agent-fenced] [--allow-loopback] [--json]
 *   pan machines list [--json]
 *   pan machines unlink <label|environment-id|link-id> [--json]
 *
 * Every verb talks to the running dashboard with the internal token; the
 * dashboard owns the keys, the channel and the link store. Registered from
 * `pair.ts` (`registerPairCommands`) so `src/cli/index.ts` does not grow.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import type { MachineLinkView, MachinesResponse } from '@overdeck/contracts';

import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';

const DOCS_PAGE = 'configuration/linked-machines.mdx';
export const NOT_RUNNING = 'Overdeck dashboard is not running. Start the dashboard with pan up, then retry.';
const NEEDS_PAN_UP = 'The dashboard rejected this machine\'s internal token. Start the dashboard with pan up (a `pan serve` server does not share it).';

export interface MachinesLinkOptions { oneWay?: boolean; agentFenced?: boolean; allowLoopback?: boolean; json?: boolean }

async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

async function call(verb: string, path: string, init: { method: string; body?: unknown }): Promise<Response | never> {
  let response: Response;
  try {
    response = await callDashboard(path, init);
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail(NOT_RUNNING);
    throw error;
  }
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan machines ${verb} failed: ${await errorText(response)}`);
  return response;
}

/** `5.0 s`, `850 ms`. */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** `just now`, `2 min ago`, `3 h ago`, `2 d ago`. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** The STATE cell: `online`, `online (froze 5.0 s, 2 min ago)`, `offline (network 12.0 s, 1 h ago)`, `unsupported: …`. */
export function formatLinkState(link: MachineLinkView, now: number = Date.now()): string {
  let state: string = link.state;
  if (link.incident) state += ` (${link.incident.kind} ${formatDuration(link.incident.durationMs)}, ${formatAgo(link.incident.at, now)})`;
  if (link.stateDetail && (link.state === 'unsupported' || link.state === 'revoked' || link.state === 'offline')) state += `: ${link.stateDetail}`;
  return state;
}

export function describeLink(view: MachineLinkView, bothWays: boolean): string {
  const route = view.currentRoute ?? view.routes[0]?.url ?? 'no route';
  const kind = view.routes.find((entry) => entry.url === route)?.kind ?? view.routes[0]?.kind ?? 'unknown';
  return `Linked ${view.label} (${view.fingerprint}) over ${kind} ${route}, ${bothWays ? 'both ways' : 'one way'}, ${view.access}-level`;
}

function table(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  console.log(chalk.bold(line(header)));
  for (const row of rows) console.log(line(row));
}

export async function runMachinesLink(pairingUrl: string, options: MachinesLinkOptions): Promise<void> {
  const bothWays = !options.oneWay;
  const response = await call('link', '/api/machines/link', {
    method: 'POST',
    body: { pairingUrl, bothWays, access: options.agentFenced ? 'agent-fenced' : 'operator', allowLoopback: options.allowLoopback ?? false },
  });
  const view = await response.json() as MachineLinkView;
  if (options.json) {
    console.log(JSON.stringify(view));
    return;
  }
  console.log(describeLink(view, bothWays));
  console.log(`See ${DOCS_PAGE} for routes and access levels; \`pan machines list\` shows its state.`);
}

export async function runMachinesList(options: { json?: boolean }): Promise<void> {
  const response = await call('list', '/api/machines', { method: 'GET' });
  const machines = await response.json() as MachinesResponse;
  if (options.json) {
    console.log(JSON.stringify(machines));
    return;
  }
  console.log(`This machine: ${machines.self.label} (${machines.self.fingerprint})`);
  if (machines.links.length === 0) {
    console.log('No linked machines. Link one with `pan machines link <pairing-url>` using a `pan pair` link from the other machine.');
  } else {
    console.log('');
    table(
      ['LABEL', 'STATE', 'ROUTE', 'ACCESS', 'FINGERPRINT'],
      machines.links.map((link) => [link.label, formatLinkState(link), link.currentRoute ?? link.routes[0]?.url ?? '-', link.access, link.fingerprint]),
    );
  }
  console.log('');
  if (machines.inbound.length === 0) {
    console.log('Inbound: no machine links to this one.');
  } else {
    console.log(chalk.bold('Inbound'));
    table(
      ['LABEL', 'ACCESS', 'FINGERPRINT', 'LAST USED', 'TOKEN ID'],
      machines.inbound.map((entry) => [entry.label, entry.access, entry.fingerprint, entry.lastUsedAt ? formatAgo(entry.lastUsedAt) : '-', entry.tokenId]),
    );
  }
}

export async function runMachinesUnlink(target: string, options: { json?: boolean }): Promise<void> {
  let response: Response;
  try {
    response = await callDashboard(`/api/machines/${encodeURIComponent(target)}`, { method: 'DELETE' });
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail(NOT_RUNNING);
    throw error;
  }
  if (response.status === 404) return fail(`No machine link matches "${target}" (by label, environment id or link id). \`pan machines list\` shows the links.`);
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan machines unlink failed: ${await errorText(response)}`);
  const result = await response.json() as { ok: boolean; peerNotified: boolean };
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(result.peerNotified
    ? `Unlinked "${target}"; the other machine was told and its token here was revoked.`
    : `Unlinked "${target}"; its token here was revoked. The other machine could not be reached and will see the link as revoked when it next connects.`);
}

export interface MachinesForwardOptions { json?: boolean; list?: boolean; stop?: string }

interface ForwardView { id: string; label: string; port: number; localPort: number; url: string; connections: number }

/**
 * PAN-4650 WI-18: `pan machines forward <label> <port>` forwards a TCP port of a
 * linked machine to 127.0.0.1 here and prints the URL; `--list` shows the
 * forwards and `--stop <id>` closes one.
 */
export async function runMachinesForward(target: string | undefined, port: string | undefined, options: MachinesForwardOptions): Promise<void> {
  if (options.list) {
    const { forwards } = await (await call('forward', '/api/machines/forwards', { method: 'GET' })).json() as { forwards: ForwardView[] };
    if (options.json) return void console.log(JSON.stringify(forwards));
    if (forwards.length === 0) return void console.log('No forwards are open.');
    for (const forward of forwards) {
      console.log(`${forward.id}  ${forward.label}:${forward.port} → ${forward.url}  (${forward.connections} open)`);
    }
    return;
  }
  if (options.stop) {
    await call('forward', `/api/machines/forwards/${encodeURIComponent(options.stop)}`, { method: 'DELETE' });
    return void console.log(`Stopped forward ${options.stop}.`);
  }
  const portNumber = Number(port);
  if (!target || !Number.isInteger(portNumber)) return fail('Usage: pan machines forward <machine> <port>  (or --list, or --stop <id>)');
  const forward = await (await call('forward', `/api/machines/${encodeURIComponent(target)}/forwards`, { method: 'POST', body: { port: portNumber } })).json() as ForwardView;
  if (options.json) return void console.log(JSON.stringify(forward));
  console.log(`Forwarding ${forward.label}:${forward.port} → ${forward.url}`);
  console.log(chalk.dim(`  Stop it with: pan machines forward --stop ${forward.id}`));
}

export function registerMachinesCommands(program: Command): void {
  const machines = program
    .command('machines')
    .description(`Link this dashboard to other machines and manage the links (see ${DOCS_PAGE})`);
  machines
    .command('link <pairing-url>')
    .description('Link to the machine whose `pan pair` link this is (links both ways unless --one-way)')
    .option('--one-way', 'Only this machine reaches the other; do not give it a link back')
    .option('--agent-fenced', 'Agent-fenced access: forwarded requests are never operator-level')
    .option('--allow-loopback', 'Accept a localhost pairing link (both servers on this host)')
    .option('--json', 'Print the new link as JSON')
    .action((pairingUrl: string, options: MachinesLinkOptions) => runMachinesLink(pairingUrl, options));
  machines
    .command('list')
    .description('List linked machines with state and route, then the machines that link here')
    .option('--json', 'Print { self, links, inbound } as JSON')
    .action((options: { json?: boolean }) => runMachinesList(options));
  machines
    .command('unlink <target>')
    .description('Remove a link by label, environment id or link id, revoking the token the other machine holds')
    .option('--json', 'Print { ok, peerNotified } as JSON')
    .action((target: string, options: { json?: boolean }) => runMachinesUnlink(target, options));
  machines
    .command('forward [machine] [port]')
    .description('Forward a TCP port of a linked machine to 127.0.0.1 here and print the URL (for a dev-server preview)')
    .option('--list', 'List the open forwards')
    .option('--stop <id>', 'Close a forward')
    .option('--json', 'Print JSON')
    .action((target: string | undefined, port: string | undefined, options: MachinesForwardOptions) => runMachinesForward(target, port, options));
}
