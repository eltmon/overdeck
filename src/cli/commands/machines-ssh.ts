/**
 * `pan machines` SSH verbs (PAN-4404).
 *
 *   pan machines ssh-helper start --linker <uuid> [--no-pair] --json   (hidden; runs on the SSH host)
 *   pan machines ssh-helper stop --linker <uuid> --json                (hidden; runs on the SSH host)
 *
 * The hidden `ssh-helper` verb is the remote half of an SSH machine: the
 * linking server runs it over SSH (D-4404-1). It prints exactly one result line,
 * `OVERDECK_SSH_HELPER <json>`, and exits 0 when the result is `ok`, else 1.
 * The logic lives in `src/lib/anywhere/ssh/helper.ts`, loaded on demand so the
 * CLI start-up stays light.
 */
import type { Command } from 'commander';

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
