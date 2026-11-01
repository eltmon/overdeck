/**
 * `pan machines` — link this dashboard to another machine and manage links
 * (PAN-4645 WI-14, FR-1).
 *
 *   pan machines link <pairing-url> [--one-way] [--agent-fenced] [--allow-loopback] [--json]
 *   pan machines list [--json]
 *   pan machines unlink <label|environment-id|link-id> [--keep-server] [--json]
 *
 * The SSH verbs (`add-ssh`, `test-ssh`, the hidden `ssh-helper`) live in
 * `machines-ssh.ts` (PAN-4404).
 *
 * Every verb talks to the running dashboard with the internal token; the
 * dashboard owns the keys, the channel and the link store. Registered from
 * `pair.ts` (`registerPairCommands`) so `src/cli/index.ts` does not grow.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import type { MachineLinkView, MachinesResponse } from '@overdeck/contracts';

import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';
import { call, fail, NEEDS_PAN_UP, NOT_RUNNING } from './machines-call.js';
import { registerMachinesSshCommands } from './machines-ssh.js';

export { NOT_RUNNING } from './machines-call.js';

const DOCS_PAGE = 'configuration/linked-machines.mdx';

export interface MachinesLinkOptions { oneWay?: boolean; agentFenced?: boolean; allowLoopback?: boolean; json?: boolean }

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
      ['LABEL', 'STATE', 'ROUTE', 'ACCESS', 'SSH', 'FINGERPRINT'],
      machines.links.map((link) => [
        link.label,
        formatLinkState(link),
        link.currentRoute ?? link.routes[0]?.url ?? '-',
        link.access,
        link.ssh ? `${link.ssh.destination} (${link.ssh.forward}, ${link.ssh.launch})` : '-',
        link.fingerprint,
      ]),
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

export async function runMachinesUnlink(target: string, options: { json?: boolean; keepServer?: boolean }): Promise<void> {
  let response: Response;
  try {
    response = await callDashboard(`/api/machines/${encodeURIComponent(target)}${options.keepServer ? '?keepServer=1' : ''}`, { method: 'DELETE' });
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail(NOT_RUNNING);
    throw error;
  }
  if (response.status === 404) return fail(`No machine link matches "${target}" (by label, environment id or link id). \`pan machines list\` shows the links.`);
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan machines unlink failed: ${await errorText(response)}`);
  const result = await response.json() as { ok: boolean; peerNotified: boolean; ssh?: { stopped: boolean; reason: string } | null };
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(result.peerNotified
    ? `Unlinked "${target}"; the other machine was told and its token here was revoked.`
    : `Unlinked "${target}"; its token here was revoked. The other machine could not be reached and will see the link as revoked when it next connects.`);
  if (result.ssh) {
    console.log(result.ssh.stopped
      ? `Stopped the Overdeck server on ${target}.`
      : `Left the Overdeck server on ${target} running (${result.ssh.reason}).`);
  }
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
    .option('--keep-server', 'For an SSH machine this dashboard started: leave its Overdeck server running')
    .option('--json', 'Print { ok, peerNotified, ssh } as JSON')
    .action((target: string, options: { json?: boolean; keepServer?: boolean }) => runMachinesUnlink(target, options));
  registerMachinesSshCommands(machines);
}
