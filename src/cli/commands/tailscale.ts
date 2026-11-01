/**
 * `pan tailscale` — Tailscale state and setup for Overdeck Anywhere (PAN-1254).
 *
 *   pan tailscale status [--json]
 *   pan tailscale setup [--userspace]
 *
 * `status` prints what Tailscale looks like on this machine, the next setup
 * step with its remedy, and the other tailnet machines that run Overdeck.
 *
 * `setup` walks the same steps as Settings → Anywhere → Set up Tailscale.
 * Commands that may need `sudo` run with inherited stdio, so the operator
 * types any password in their own terminal and Overdeck never sees it
 * (NFR-1). Serve is turned on through the running dashboard
 * (`POST /api/tailscale/serve`), because the token-mint and trusted-origin
 * caches live in the server process (D-3).
 * See configuration/tailscale.mdx.
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. The Tailscale lib
 * modules load inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import type { InstallPlan } from '../../lib/tailscale/installer.js';
import type { LoginResult } from '../../lib/tailscale/login.js';
import type { TailnetPeer } from '../../lib/tailscale/peers.js';
import type { TailscaleState } from '../../lib/tailscale/state.js';
import type { UserspaceResult } from '../../lib/tailscale/userspace.js';

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

const NOT_RUNNING = 'Overdeck dashboard is not running; start it with `pan up`.';
const NEEDS_PAN_UP = 'The dashboard rejected this machine\'s internal token. `pan tailscale setup` needs a dashboard started by `pan up`.';
const USERSPACE_UNAVAILABLE = 'Installing Tailscale without an administrator password is not available yet. Run `pan tailscale setup` without --userspace to use the installer.';
const MAX_SETUP_STEPS = 8;
const LOGIN_POLL_MS = 2000;
const LOGIN_WAIT_MS = 10 * 60_000;

export type ServePostResult = { kind: 'unreachable' } | { kind: 'response'; status: number; body: unknown };

/** Everything `setup` touches outside this module; tests replace parts. */
export interface SetupDeps {
  readState: () => Promise<TailscaleState>;
  resolvePlan: (userspace: boolean) => Promise<InstallPlan>;
  userspaceAvailable: boolean;
  operatorCommand: () => string | null;
  /** Run a shell command with inherited stdio; resolves with the exit code. */
  runShell: (command: string) => Promise<number | null>;
  installUserspace: () => Promise<UserspaceResult>;
  restartUserspace: () => Promise<UserspaceResult>;
  startLogin: (state: TailscaleState) => Promise<LoginResult>;
  postServe: () => Promise<ServePostResult>;
  overdeckPeers: (state: TailscaleState) => Promise<TailnetPeer[]>;
  platform: NodeJS.Platform;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

async function defaultSetupDeps(): Promise<SetupDeps> {
  const { spawn } = await import('node:child_process');
  const { userInfo } = await import('node:os');
  const state = await import('../../lib/tailscale/state.js');
  const installer = await import('../../lib/tailscale/installer.js');
  return {
    readState: () => {
      state.invalidateTailscaleStateCache();
      return state.readTailscaleState();
    },
    resolvePlan: (userspace) => installer.resolveInstallPlan({ userspace }),
    userspaceAvailable: installer.USERSPACE_MODE_AVAILABLE,
    operatorCommand: () => installer.operatorCommand(userInfo().username),
    runShell: (command) => new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], { stdio: 'inherit' });
      child.on('error', () => resolve(null));
      child.on('exit', (code) => resolve(code));
    }),
    installUserspace: async () => (await import('../../lib/tailscale/userspace.js')).installUserspaceTailscale(),
    restartUserspace: async () => (await import('../../lib/tailscale/userspace.js')).restartUserspaceDaemon(),
    startLogin: async (current) => (await import('../../lib/tailscale/login.js')).startTailscaleLogin(current),
    postServe: async () => {
      const { callDashboard, isDashboardUnreachable } = await import('./pair.js');
      try {
        const response = await callDashboard('/api/tailscale/serve', { method: 'POST', body: {} });
        return { kind: 'response', status: response.status, body: await response.json().catch(() => null) };
      } catch (error) {
        if (isDashboardUnreachable(error)) return { kind: 'unreachable' };
        throw error;
      }
    },
    overdeckPeers,
    platform: process.platform,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  };
}

async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

/** Run a command the operator may need to type a password into. False when it fails. */
async function runInTerminal(deps: SetupDeps, command: string): Promise<boolean> {
  console.log(`\n$ ${chalk.bold(command)}`);
  const code = await deps.runShell(command);
  if (code === 0) return true;
  console.error(chalk.red(`That command exited with code ${code ?? 'unknown'}.`));
  return false;
}

async function waitForSignIn(deps: SetupDeps): Promise<boolean> {
  const deadline = deps.now() + LOGIN_WAIT_MS;
  while (deps.now() < deadline) {
    await deps.sleep(LOGIN_POLL_MS);
    if ((await deps.readState()).backendState === 'Running') return true;
  }
  return false;
}

/** Act on one step. Returns false when setup cannot continue (the caller exits 1). */
async function runSetupStep(state: TailscaleState, deps: SetupDeps, options: { userspace?: boolean }, memo: { operatorRetried: boolean }): Promise<boolean> {
  switch (state.nextStep) {
    case 'install': {
      const plan = await deps.resolvePlan(options.userspace === true);
      if (plan.kind === 'pane') return runInTerminal(deps, plan.command);
      if (plan.kind === 'userspace') {
        console.log('Installing Tailscale for this user (no administrator password)…');
        const result = await deps.installUserspace();
        if (result.ok) return true;
        console.error(chalk.red(result.message));
        console.error(`Install it with the installer instead: ${result.fallbackCommand}`);
        return false;
      }
      console.log(plan.message);
      console.log(`  ${plan.url}`);
      if (plan.command) console.log(`  ${chalk.bold(plan.command)}`);
      return false;
    }
    case 'start-daemon':
      if (state.mode === 'userspace') {
        const result = await deps.restartUserspace();
        if (!result.ok) console.error(chalk.red(result.message));
        return result.ok;
      }
      if (state.mode === 'system' && deps.platform === 'linux') {
        return runInTerminal(deps, 'sudo systemctl enable --now tailscaled');
      }
      console.log('Open the Tailscale app, then run `pan tailscale setup` again.');
      return false;
    case 'operator': {
      const command = deps.operatorCommand();
      if (!command) {
        console.log(nextStepRemedy(state, null));
        return false;
      }
      return runInTerminal(deps, command);
    }
    case 'login': {
      const result = await deps.startLogin(state);
      if ('authUrl' in result) {
        if (result.authUrl) {
          console.log(`\nOpen this link to sign in: ${chalk.bold(result.authUrl)}`);
          console.log('Waiting for sign-in…');
          if (!await waitForSignIn(deps)) {
            console.error(chalk.red('Sign-in did not finish within 10 minutes.'));
            return false;
          }
        }
        return true;
      }
      if (result.error === 'access-denied' && !memo.operatorRetried) {
        // D-6: an unknown operator turned out not to be us; make us the operator, then retry once.
        memo.operatorRetried = true;
        const command = deps.operatorCommand();
        if (!command) {
          console.log(nextStepRemedy({ ...state, nextStep: 'operator' }, null));
          return false;
        }
        return runInTerminal(deps, command);
      }
      console.error(chalk.red(result.message));
      return false;
    }
    case 'enable-https':
      console.log(ADMIN_DNS_INSTRUCTION);
      return false;
    case 'serve':
    case 'protect': {
      const posted = await deps.postServe();
      if (posted.kind === 'unreachable') return fail(NOT_RUNNING);
      if (posted.status === 401) return fail(NEEDS_PAN_UP);
      if (posted.status >= 200 && posted.status < 300) return true;
      const body = posted.body as { message?: unknown; error?: unknown; adminUrl?: unknown } | null;
      const message = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : `HTTP ${posted.status}`;
      console.error(chalk.red(message));
      if (typeof body?.adminUrl === 'string') console.error(`  ${body.adminUrl}`);
      return false;
    }
    case 'ready':
      return true;
  }
}

export async function runTailscaleSetup(options: { userspace?: boolean }, overrides: Partial<SetupDeps> = {}): Promise<void> {
  const deps: SetupDeps = { ...(await defaultSetupDeps()), ...overrides };
  if (options.userspace && !deps.userspaceAvailable) return fail(USERSPACE_UNAVAILABLE);

  const memo = { operatorRetried: false };
  let previous: TailscaleState['nextStep'] | null = null;
  let repeats = 0;
  for (let step = 0; step < MAX_SETUP_STEPS; step += 1) {
    const state = await deps.readState();
    if (state.nextStep === 'ready') {
      console.log(chalk.bold(`\nTailscale is ready: ${state.serveUrl}`));
      console.log(nextStepRemedy(state, null));
      const peers = await deps.overdeckPeers(state);
      printPeers(peers);
      return;
    }
    // A step whose action did not move setup on gets one retry, then setup stops.
    repeats = state.nextStep === previous ? repeats + 1 : 0;
    previous = state.nextStep;
    if (repeats > 1) return fail(`Setup is still at "${state.nextStep}". ${nextStepRemedy(state, deps.operatorCommand())}`);
    console.log(chalk.dim(`\n[${state.nextStep}]`));
    if (!await runSetupStep(state, deps, options, memo)) {
      return fail(`Setup stopped at "${state.nextStep}". Run \`pan tailscale setup\` again after fixing it.`);
    }
  }
  return fail(`Setup did not finish within ${MAX_SETUP_STEPS} steps. Run \`pan tailscale status\` to see where it stands.`);
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
  tailscale
    .command('setup')
    .description('Install Tailscale, sign in and turn on protected HTTPS access to this dashboard')
    .option('--userspace', 'On Linux, install for this user without an administrator password')
    .action((options: { userspace?: boolean }) => runTailscaleSetup(options));
}
