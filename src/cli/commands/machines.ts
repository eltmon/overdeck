/**
 * `pan machines` — link this dashboard to another machine and manage links
 * (PAN-4645 WI-14, FR-1), and see and update versions across them (PAN-4654
 * FR-11).
 *
 *   pan machines link <pairing-url> [--one-way] [--agent-fenced] [--allow-loopback] [--json]
 *   pan machines list [--json]
 *   pan machines unlink <label|environment-id|link-id> [--keep-server] [--json]
 *   pan machines versions [--json]
 *   pan machines update [--now] [--machine <label>]... [--cancel] [--json]
 *
 * Through the overdeck.ai directory (PAN-2356 WI-16):
 *
 *   pan machines directory [--json]
 *   pan machines join [--to <label|environment-id>] [--json]
 *   pan machines accept <request-id> | reject <request-id>
 *   pan machines approve <request-id> [--yes]
 *   pan machines forget <label|environment-id>
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
import {
  compareFleetBinaries,
  type DirectoryResponse,
  FLEET_UPDATE_STILL_WAITING_MS,
  type FleetUpdateJob,
  type FleetUpdateResponse,
  type FleetVersionRow,
  type FleetVersionsResponse,
  formatMachineLoad,
  formatMachineProfile,
  type MachineLinkView,
  type MachinesResponse,
} from '@overdeck/contracts';

import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';
import { call, fail, NEEDS_PAN_UP, NOT_RUNNING } from './machines-call.js';
import { registerMachinesAddProjectCommand } from './machines-add-project.js';
import { registerMachinesWhoCommand } from './machines-who.js';
import { registerMachinesSshCommands } from './machines-ssh.js';
import { registerMachinesFlyCommands } from './machines-fly.js';

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
  console.log('');
  // PAN-4651 FR-6/FR-7: this machine first, then each link, with load and capability tags.
  const loadCell = (view: { load?: MachineLinkView['load']; tags?: MachineLinkView['tags']; placement?: MachineLinkView['placement'] }) =>
    [formatMachineLoad(view.load) ?? '-', formatMachineProfile(view.tags, view.placement)?.replace(/^tags: /, '') ?? '-'];
  table(
    ['LABEL', 'STATE', 'ROUTE', 'ACCESS', 'SSH', 'FINGERPRINT', 'LOAD', 'TAGS'],
    [
      [`${machines.self.label} (this machine)`, 'self', '-', '-', '-', machines.self.fingerprint, ...loadCell(machines.self)],
      ...machines.links.map((link) => [
        link.label,
        formatLinkState(link),
        link.currentRoute ?? link.routes[0]?.url ?? '-',
        link.access,
        link.ssh ? `${link.ssh.destination} (${link.ssh.forward}, ${link.ssh.launch})` : '-',
        link.fingerprint,
        ...loadCell(link),
      ]),
    ],
  );
  if (machines.links.length === 0) {
    console.log('');
    console.log('No linked machines. Link one with `pan machines link <pairing-url>` using a `pan pair` link from the other machine.');
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
  const result = await response.json() as { ok: boolean; peerNotified: boolean; ssh?: { stopped: boolean; reason: string } | null; fly?: { destroyed: boolean } | null };
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
  if (result.fly) {
    console.log(result.fly.destroyed
      ? `Destroyed the Fly machine behind ${target}.`
      : `Left the Fly machine behind ${target} running (--keep-server). Nothing here heartbeats it any more, so it stops itself within about 5 minutes and loses its disk.`);
  }
}

// ── Directory verbs (PAN-2356) ─────────────────────────────────────────────

export const JOIN_POLL_MS = 2_000;

/** Prompting and waiting, injected so tests run without a TTY or a clock. */
export interface DirectoryCliDeps {
  isTTY: () => boolean;
  ask: (question: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

async function askYesNo(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

const defaultDirectoryDeps: DirectoryCliDeps = {
  isTTY: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  ask: askYesNo,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

async function loadDirectoryState(verb: string): Promise<DirectoryResponse> {
  const response = await call(verb, '/api/directory', { method: 'GET' });
  return await response.json() as DirectoryResponse;
}

export async function runMachinesDirectory(options: { json?: boolean }): Promise<void> {
  const directory = await loadDirectoryState('directory');
  if (options.json) {
    console.log(JSON.stringify(directory));
    return;
  }
  if (!directory.signedIn) {
    console.log('Sign in with pan account login to find your machines through overdeck.ai.');
    return;
  }
  if (directory.refusal) console.log(chalk.yellow(directory.refusal));
  if (directory.machines.length === 0) {
    console.log('The directory lists no machines yet.');
  } else {
    table(['LABEL', 'FINGERPRINT', 'STATE', 'LINKED', 'ENVIRONMENT'], directory.machines.map((m) => [
      m.label,
      m.fingerprint,
      m.online ? 'online' : `last seen ${formatAgo(m.lastSeenAt)}`,
      m.linked ? 'linked' : '-',
      m.environmentId,
    ]));
  }
  for (const approval of directory.approvals) {
    console.log(`\nApproval request ${approval.requestId} from ${approval.label} (${approval.fingerprint}): ${approval.state}${approval.sas ? `, code ${approval.sas}` : ''}${approval.error ? `: ${approval.error}` : ''}`);
  }
  for (const join of directory.joins) {
    console.log(`\nJoin request ${join.requestId}: ${join.state}${join.sas ? `, code ${join.sas}` : ''}`);
  }
}

export async function runMachinesJoin(options: { to?: string; json?: boolean }, deps: DirectoryCliDeps = defaultDirectoryDeps): Promise<void> {
  let to: string | null = null;
  if (options.to) {
    const directory = await loadDirectoryState('join');
    const target = directory.machines.find((m) => m.environmentId === options.to || m.label === options.to);
    if (!target) return fail(`The directory does not list a machine "${options.to}". \`pan machines directory\` lists them.`);
    to = target.environmentId;
  }
  const self = await (await call('join', '/api/machines', { method: 'GET' })).json() as MachinesResponse;
  const { requestId } = await (await call('join', '/api/directory/join', { method: 'POST', body: to ? { to } : {} })).json() as { requestId: string };
  if (!options.json) console.log(`Requested approval (request ${requestId}). This machine's fingerprint: ${self.self.fingerprint}`);

  const deadline = deps.now() + 10 * 60_000;
  for (;;) {
    const directory = await loadDirectoryState('join');
    const join = directory.joins.find((entry) => entry.requestId === requestId);
    if (!join || join.state === 'rejected') return fail('The approval was rejected or expired.');
    if (join.sas) {
      const approver = directory.machines.find((m) => m.fingerprint === join.fingerprint);
      if (options.json) {
        console.log(JSON.stringify({ requestId, sas: join.sas, fingerprint: join.fingerprint, approver: approver?.label ?? null }));
      } else {
        console.log(`Code: ${join.sas} · approver ${approver?.label ?? 'unknown'} ${join.fingerprint ?? ''}`.trimEnd());
      }
      if (!deps.isTTY()) {
        if (!options.json) console.log(`Confirm with: pan machines accept ${requestId}`);
        return;
      }
      const accepted = await deps.ask('Accept? [y/N] ');
      await call(accepted ? 'accept' : 'reject', `/api/directory/joins/${encodeURIComponent(requestId)}/${accepted ? 'accept' : 'reject'}`, { method: 'POST' });
      console.log(accepted ? 'Accepted. The link appears in pan machines list when the approver finishes.' : 'Rejected.');
      return;
    }
    if (deps.now() >= deadline) return fail('No machine opened the approval request within 10 minutes.');
    await deps.sleep(JOIN_POLL_MS);
  }
}

export async function runMachinesAccept(requestId: string): Promise<void> {
  await call('accept', `/api/directory/joins/${encodeURIComponent(requestId)}/accept`, { method: 'POST' });
  console.log('Accepted. The link appears in pan machines list when the approver finishes.');
}

/** Rejects an incoming approval request or this machine's own join request, whichever the id names. */
export async function runMachinesReject(requestId: string): Promise<void> {
  const directory = await loadDirectoryState('reject');
  const path = directory.approvals.some((approval) => approval.requestId === requestId)
    ? `/api/directory/approvals/${encodeURIComponent(requestId)}/reject`
    : `/api/directory/joins/${encodeURIComponent(requestId)}/reject`;
  await call('reject', path, { method: 'POST' });
  console.log('Rejected.');
}

export async function runMachinesApprove(requestId: string, options: { yes?: boolean }, deps: DirectoryCliDeps = defaultDirectoryDeps): Promise<void> {
  const id = encodeURIComponent(requestId);
  const opened = await (await call('approve', `/api/directory/approvals/${id}/open`, { method: 'POST' })).json() as { sas: string; fingerprint: string };
  console.log(`Code: ${opened.sas} · fingerprint ${opened.fingerprint}`);
  console.log('Approve only if the other machine shows the same code.');
  if (!options.yes) {
    if (!deps.isTTY()) return fail('Pass --yes to approve without a prompt.');
    if (!(await deps.ask('Approve? [y/N] '))) {
      await call('reject', `/api/directory/approvals/${id}/reject`, { method: 'POST' });
      console.log('Rejected.');
      return;
    }
  }
  await call('approve', `/api/directory/approvals/${id}/approve`, { method: 'POST' });
  console.log('Approved. The link appears in pan machines list once the other machine accepts.');
}

export async function runMachinesForget(target: string): Promise<void> {
  const result = await (await call('forget', '/api/directory/forget', { method: 'POST', body: { machine: target } })).json() as { label?: string };
  console.log(`Removed ${result.label ?? target} from the directory.`);
}

/** The UPDATE cell: `waiting (2 turns)`, `waiting (2 turns, 31 min: use --now)`, `updating`, `failed: claude`, … */
export function formatFleetUpdateCell(job: FleetUpdateJob | null, now: number = Date.now()): string {
  if (!job) return '-';
  if (job.phase === 'waiting') {
    const turns = `${job.waitingTurns} turn${job.waitingTurns === 1 ? '' : 's'}`;
    const waitedMs = job.waitingSince ? now - new Date(job.waitingSince).getTime() : 0;
    return waitedMs >= FLEET_UPDATE_STILL_WAITING_MS
      ? `waiting (${turns}, ${Math.floor(waitedMs / 60_000)} min: use --now)`
      : `waiting (${turns})`;
  }
  if (job.phase === 'failed') {
    const failed = job.components.find((component) => component.status === 'failed');
    return failed ? `failed: ${failed.name}` : 'failed';
  }
  return job.phase;
}

/** A version cell: the version, or `before → after` once a component of the job changed it. */
function versionCell(job: FleetUpdateJob | null, name: string, version: string | null | undefined): string {
  const component = job?.components.find((entry) => entry.name === name);
  if (component && component.status !== 'pending' && component.status !== 'running' && component.after !== null && component.after !== component.before) {
    return `${component.before ?? '-'} → ${component.after}`;
  }
  return version ?? '-';
}

/** The `pan machines versions` table: header plus one row per machine. */
export function fleetVersionsTable(rows: readonly FleetVersionRow[], now: number = Date.now()): { header: string[]; rows: string[][] } {
  const binaries = [...new Set(rows.flatMap((row) => row.report?.harnesses.map((cli) => cli.binary) ?? []))].sort(compareFleetBinaries);
  return {
    header: ['MACHINE', 'STATE', 'OVERDECK', ...binaries.map((binary) => binary.toUpperCase()), 'UPDATE'],
    rows: rows.map((row) => {
      const job = row.report?.job ?? null;
      return [
        row.label,
        row.self ? 'this machine' : row.state,
        versionCell(job, 'overdeck', row.report?.overdeck.version ?? row.peerVersion),
        ...binaries.map((binary) => versionCell(job, binary, row.report?.harnesses.find((cli) => cli.binary === binary)?.version)),
        formatFleetUpdateCell(job, now),
      ];
    }),
  };
}

export async function runMachinesVersions(options: { json?: boolean }): Promise<void> {
  const response = await call('versions', '/api/machines/versions', { method: 'GET' });
  const fleet = await response.json() as FleetVersionsResponse;
  if (options.json) {
    console.log(JSON.stringify(fleet));
    return;
  }
  const { header, rows } = fleetVersionsTable(fleet.rows);
  table(header, rows);
  const notes = fleet.rows.flatMap((row) => {
    if (row.install) return [`${row.label}: install Overdeck ${row.install.version} on ${row.install.on === 'this-machine' ? 'this machine' : row.label}: ${row.install.command}`];
    return row.error ? [`${row.label}: ${row.error}`] : [];
  });
  if (notes.length > 0) {
    console.log('');
    for (const note of notes) console.log(note);
  }
}

export interface MachinesUpdateOptions { now?: boolean; machine?: string[]; cancel?: boolean; json?: boolean }

export async function runMachinesUpdate(options: MachinesUpdateOptions): Promise<void> {
  let environmentIds: string[] | undefined;
  if (options.machine && options.machine.length > 0) {
    const fleet = await (await call('update', '/api/machines/versions', { method: 'GET' })).json() as FleetVersionsResponse;
    environmentIds = [];
    for (const label of options.machine) {
      const row = fleet.rows.find((entry) => entry.label === label);
      if (!row) return fail(`No machine named ${label}; \`pan machines versions\` lists them.`);
      environmentIds.push(row.environmentId);
    }
  }
  const body = {
    ...(options.cancel ? { cancel: true } : { mode: options.now ? 'now' : 'when-idle' }),
    ...(environmentIds ? { environmentIds } : {}),
  };
  const response = await call('update', '/api/machines/update', { method: 'POST', body });
  const result = await response.json() as FleetUpdateResponse;
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  for (const entry of result.started) {
    console.log(options.cancel ? `Cancelled on ${entry.label}` : `Started on ${entry.label} (${entry.job.mode})`);
  }
  for (const entry of result.skipped) console.log(`Skipped ${entry.label}: ${entry.reason}`);
  console.log('Run `pan machines versions` to follow the update.');
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
    .option('--keep-server', 'For an SSH machine this dashboard started: leave its Overdeck server running; for a Fly machine: do not destroy it')
    .option('--json', 'Print { ok, peerNotified, ssh, fly } as JSON')
    .action((target: string, options: { json?: boolean; keepServer?: boolean }) => runMachinesUnlink(target, options));
  machines
    .command('forward [machine] [port]')
    .description('Forward a TCP port of a linked machine to 127.0.0.1 here and print the URL (for a dev-server preview)')
    .option('--list', 'List the open forwards')
    .option('--stop <id>', 'Close a forward')
    .option('--json', 'Print JSON')
    .action((target: string | undefined, port: string | undefined, options: MachinesForwardOptions) => runMachinesForward(target, port, options));
  machines
    .command('directory')
    .description("List this account's machines in the overdeck.ai directory, with pending approvals and joins")
    .option('--json', 'Print the GET /api/directory response as JSON')
    .action((options: { json?: boolean }) => runMachinesDirectory(options));
  machines
    .command('join')
    .description('Ask your other machines (or one) to link with this one; confirm the code on both screens')
    .option('--to <machine>', 'Ask only this machine (label or environment id)')
    .option('--json', 'Print { requestId, sas, fingerprint, approver } as JSON once a machine opens the request')
    .action((options: { to?: string; json?: boolean }) => runMachinesJoin(options));
  machines
    .command('accept <request-id>')
    .description('Accept a join request after checking that both screens show the same code')
    .action((requestId: string) => runMachinesAccept(requestId));
  machines
    .command('reject <request-id>')
    .description('Reject an approval or join request')
    .action((requestId: string) => runMachinesReject(requestId));
  machines
    .command('approve <request-id>')
    .description('Open an approval request, show its code and approve it')
    .option('--yes', 'Approve without asking')
    .action((requestId: string, options: { yes?: boolean }) => runMachinesApprove(requestId, options));
  machines
    .command('forget <machine>')
    .description('Remove a machine from the overdeck.ai directory (label or environment id)')
    .action((target: string) => runMachinesForget(target));
  machines
    .command('versions')
    .description('Show Overdeck and harness CLI versions on every machine')
    .option('--json', 'Print { rows } as JSON')
    .action((options: { json?: boolean }) => runMachinesVersions(options));
  machines
    .command('update')
    .description('Update Overdeck and the harness CLIs on every online machine, after running turns end')
    .option('--now', 'Do not wait for running turns to end')
    .option('--machine <label>', 'Only this machine; repeat for more', (label: string, labels: string[] = []) => [...labels, label])
    .option('--cancel', 'Cancel waiting updates')
    .option('--json', 'Print { started, skipped } as JSON')
    .action((options: MachinesUpdateOptions) => runMachinesUpdate(options));
  registerMachinesSshCommands(machines);
  registerMachinesAddProjectCommand(machines);
  registerMachinesWhoCommand(machines);
  registerMachinesFlyCommands(machines);
}
