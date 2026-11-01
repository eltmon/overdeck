/**
 * `pan tailscale` — Tailscale state and setup for Overdeck Anywhere (PAN-1254).
 *
 *   pan tailscale status [--json]
 *
 * `status` prints what Tailscale looks like on this machine, the next setup
 * step with its remedy, and the other tailnet machines that run Overdeck.
 * See configuration/tailscale.mdx.
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. The Tailscale lib
 * modules load inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TailnetPeer } from '../../lib/tailscale/peers.js';
import type { TailscaleState } from '../../lib/tailscale/state.js';

const DOCS_PAGE = 'configuration/tailscale.mdx';
export const NOT_INSTALLED = 'Tailscale is not installed. Run `pan tailscale setup`.';
export const ADMIN_DNS_INSTRUCTION = 'Turn on MagicDNS and HTTPS certificates at https://login.tailscale.com/admin/dns, then run `pan tailscale setup` again.';

/** One line telling the operator what to do about `state.nextStep`. */
export function nextStepRemedy(state: TailscaleState, operatorCommand: string | null): string {
  switch (state.nextStep) {
    case 'install':
      return 'Run `pan tailscale setup` to install Tailscale.';
    case 'start-daemon':
      if (state.mode === 'userspace') return 'Run `pan tailscale setup` to restart overdeck-tailscaled.service.';
      if (state.mode === 'app') return 'Open the Tailscale app.';
      return 'Start the Tailscale daemon: `sudo systemctl enable --now tailscaled`.';
    case 'operator':
      return operatorCommand
        ? `Make this user the Tailscale operator: \`${operatorCommand}\`.`
        : 'Make this user the Tailscale operator with `sudo tailscale set --operator=$USER`.';
    case 'login':
      return state.authUrl ? `Open this link to sign in: ${state.authUrl}` : 'Run `pan tailscale setup` to sign in.';
    case 'enable-https':
      return ADMIN_DNS_INSTRUCTION;
    case 'serve':
      return 'Run `pan tailscale setup` to turn on HTTPS access to this dashboard.';
    case 'protect':
      return 'Tailscale Serve sends tailnet visitors here but a token is not required to sign in. Run `pan tailscale setup` to require one.';
    case 'ready':
      return `New browsers must pair: run \`pan pair --url ${state.serveUrl ?? 'https://<MagicDNS name>'}\`.`;
  }
}

async function readSelfEnvironmentId(): Promise<string> {
  const { readEnvironmentIdentity } = await import('../../lib/environment-identity.js');
  try {
    return (await readEnvironmentIdentity())?.environmentId ?? '';
  } catch {
    return '';
  }
}

async function overdeckPeers(state: TailscaleState): Promise<TailnetPeer[]> {
  if (state.backendState !== 'Running') return [];
  const { discoverTailnetPeers } = await import('../../lib/tailscale/peers.js');
  const found = await discoverTailnetPeers(state, { port: state.port, selfEnvironmentId: await readSelfEnvironmentId() });
  return found.filter((peer) => peer.overdeck !== null);
}

function printPeers(peers: TailnetPeer[]): void {
  console.log(`\n${chalk.bold('Overdeck on your tailnet')}`);
  if (peers.length === 0) {
    console.log('  No other tailnet machine answered as Overdeck.');
    return;
  }
  const header = ['HOST', 'LABEL', 'VERSION', 'URL'];
  const rows = peers.map((peer) => [peer.hostName, peer.overdeck!.label, peer.overdeck!.serverVersion, peer.overdeck!.url]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => `  ${cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd()}`;
  console.log(chalk.bold(line(header)));
  for (const row of rows) console.log(line(row));
}

export async function runTailscaleStatus(options: { json?: boolean }): Promise<void> {
  const { readTailscaleState } = await import('../../lib/tailscale/state.js');
  const state = await readTailscaleState();
  const peers = state.installed ? await overdeckPeers(state) : [];

  if (options.json) {
    console.log(JSON.stringify({ state, peers }, null, 2));
    return;
  }
  if (!state.installed) {
    console.log(NOT_INSTALLED);
    return;
  }

  const { operatorCommand } = await import('../../lib/tailscale/installer.js');
  const { userInfo } = await import('node:os');
  const fields: Array<[string, string]> = [
    ['Mode', state.mode ?? '-'],
    ['Version', state.version ?? '-'],
    ['Backend', state.daemonRunning ? (state.backendState ?? '-') : `not reachable${state.statusError ? ` (${state.statusError})` : ''}`],
    ['MagicDNS name', state.magicDnsName ?? '-'],
    ['Signed in as', state.loginName ?? '-'],
    ['HTTPS certificates', state.httpsEnabled ? 'on' : 'off'],
    ['Serve', state.serve.proxiesDashboard ? (state.serveUrl ?? 'on') : 'off'],
    ['Token sign-in', state.requireTokenMint ? 'required' : 'not required'],
    ['Next step', `${state.nextStep} — ${nextStepRemedy(state, operatorCommand(userInfo().username))}`],
  ];
  const width = Math.max(...fields.map(([label]) => label.length));
  console.log(chalk.bold('Tailscale'));
  for (const [label, value] of fields) console.log(`  ${`${label}:`.padEnd(width + 1)}  ${value}`);
  if (state.backendState === 'Running') printPeers(peers);
}

export function registerTailscaleCommands(program: Command): void {
  const tailscale = program
    .command('tailscale')
    .description(`Reach this machine over Tailscale: state, setup and tailnet peers (see ${DOCS_PAGE})`);
  tailscale
    .command('status')
    .description('Show Tailscale state, the next setup step and Overdeck machines on the tailnet')
    .option('--json', 'Print { state, peers } as JSON')
    .action((options: { json?: boolean }) => runTailscaleStatus(options));
}
