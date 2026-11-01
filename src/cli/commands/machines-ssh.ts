/**
 * `pan machines` SSH verbs (PAN-4404).
 *
 *   pan machines add-ssh <host> [--pan-path <path>] [--one-way] [--agent-fenced] [--json]
 *   pan machines test-ssh <host> [--pan-path <path>] [--json]
 *   pan machines ssh-helper start --linker <uuid> [--no-pair] --json   (hidden; runs on the SSH host)
 *   pan machines ssh-helper stop --linker <uuid> --json                (hidden; runs on the SSH host)
 *
 * `add-ssh` and `test-ssh` ask the running dashboard, which runs `ssh` with its
 * own keys and `~/.ssh/config` (FR-1, FR-9). The hidden `ssh-helper` verb is the
 * remote half of an SSH machine: the linking server runs it over SSH (D-4404-1).
 * It prints exactly one result line, `OVERDECK_SSH_HELPER <json>`, and exits 0
 * when the result is `ok`, else 1. Its logic lives in
 * `src/lib/anywhere/ssh/helper.ts`, loaded on demand so the CLI start-up stays
 * light.
 */
import type { Command } from 'commander';
import type { MachineLinkView, SshTestResult } from '@overdeck/contracts';

import { call, fail } from './machines-call.js';

export interface AddSshOptions { panPath?: string; oneWay?: boolean; agentFenced?: boolean; json?: boolean }
export interface TestSshOptions { panPath?: string; json?: boolean }

export async function runMachinesAddSsh(host: string, options: AddSshOptions): Promise<void> {
  const body: Record<string, unknown> = { host, bothWays: !options.oneWay, access: options.agentFenced ? 'agent-fenced' : 'operator' };
  if (options.panPath) body.panPath = options.panPath;
  const response = await call('add-ssh', '/api/machines/ssh', { method: 'POST', body });
  const view = await response.json() as MachineLinkView;
  if (options.json) {
    console.log(JSON.stringify(view));
    return;
  }
  const destination = view.ssh?.destination ?? host;
  const launch = view.ssh?.launch === 'managed' ? 'started there' : 'was already running there';
  console.log(`Linked ${view.label} (${view.fingerprint}) over ssh ${destination}; Overdeck ${launch}`);
  console.log('`pan machines list` shows its state; `pan machines unlink` removes it.');
}

export async function runMachinesTestSsh(host: string, options: TestSshOptions): Promise<void> {
  const body: Record<string, unknown> = { host };
  if (options.panPath) body.panPath = options.panPath;
  const response = await call('test-ssh', '/api/machines/ssh/test', { method: 'POST', body });
  const result = await response.json() as SshTestResult;
  if (options.json) {
    console.log(JSON.stringify(result));
    if (result.error) {
      const { exitCli } = await import('../exit.js');
      await exitCli(1);
    }
    return;
  }
  if (result.error) return fail(result.message ?? `pan machines test-ssh failed: ${result.error}`);
  console.log(`Reached ${host}: pan ${result.panVersion ?? '?'} (matches this machine)`);
}

interface HelperOptions { linker?: string; pair?: boolean; json?: boolean }

/** The root program's version (`pan --version`). */
function cliVersion(command: Command): string {
  let root: Command = command;
  while (root.parent) root = root.parent;
  return root.version() ?? '0.0.0';
}

async function runHelper(op: 'start' | 'stop', options: HelperOptions, command: Command): Promise<void> {
  const { formatHelperResult } = await import('../../lib/anywhere/ssh/target.js');
  const { defaultHelperDeps, runHelperStart, runHelperStop } = await import('../../lib/anywhere/ssh/helper.js');
  const linker = options.linker ?? '';
  const deps = defaultHelperDeps(cliVersion(command));
  const result = op === 'start'
    ? await runHelperStart({ linker, pair: options.pair !== false }, deps)
    : await runHelperStop({ linker }, deps);
  process.stdout.write(`${formatHelperResult(result)}\n`);
  const { exitCli } = await import('../exit.js');
  await exitCli(result.ok ? 0 : 1);
}

export function registerMachinesSshCommands(machines: Command): void {
  machines
    .command('add-ssh <host>')
    .description('Link a machine reached over SSH: this dashboard starts or adopts Overdeck there and forwards a port to it')
    .option('--pan-path <path>', 'Absolute path to pan on the host (default: pan from its login PATH)')
    .option('--one-way', 'Only this machine reaches the other; do not give it a link back')
    .option('--agent-fenced', 'Agent-fenced access: forwarded requests are never operator-level')
    .option('--json', 'Print the new link as JSON')
    .action((host: string, options: AddSshOptions) => runMachinesAddSsh(host, options));
  machines
    .command('test-ssh <host>')
    .description('Check that this dashboard reaches <host> over SSH and that it has the same pan version')
    .option('--pan-path <path>', 'Absolute path to pan on the host (default: pan from its login PATH)')
    .option('--json', 'Print { reachable, panVersion, localVersion, versionMatches, error, message } as JSON')
    .action((host: string, options: TestSshOptions) => runMachinesTestSsh(host, options));
  const helper = machines
    .command('ssh-helper', { hidden: true })
    .description('Remote half of an SSH machine; the linking server runs it over SSH');
  helper
    .command('start')
    .description('Adopt or start this host\'s dashboard and report it')
    .option('--linker <uuid>', 'Environment id of the machine that runs this helper over SSH')
    .option('--no-pair', 'Do not mint a pairing credential')
    .option('--json', 'Print the result line (always on)')
    .action((options: HelperOptions, command: Command) => runHelper('start', options, command));
  helper
    .command('stop')
    .description('Stop this host\'s dashboard when the linker started it and nobody else uses it')
    .option('--linker <uuid>', 'Environment id of the machine that runs this helper over SSH')
    .option('--json', 'Print the result line (always on)')
    .action((options: HelperOptions, command: Command) => runHelper('stop', options, command));
}
