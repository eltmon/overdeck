/** `pan memory sync [--setup <git-url>] [--status] [--json]` (PAN-4578): sync the operator memory store. */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  isOperatorMemorySynced,
  readOperatorMemorySyncStatus,
  setupOperatorMemorySync,
  syncOperatorMemory,
  type OperatorMemorySetupResult,
  type OperatorMemorySyncOutcome,
  type OperatorMemorySyncStatus,
} from '../../lib/memory/facts/operator-sync.js';
import { exitCli } from '../exit.js';

/** The fact id a conflict copy `<id>-conflict-<slug>` was made from. */
function conflictSourceId(copyId: string): string {
  const at = copyId.lastIndexOf('-conflict-');
  return at > 0 ? copyId.slice(0, at) : copyId;
}

export function formatSyncOutcome(outcome: OperatorMemorySyncOutcome): { lines: string[]; ok: boolean } {
  switch (outcome.status) {
    case 'synced': {
      const lines = [
        chalk.green(`✓ Operator memory synced (${outcome.pulled.length} pulled, ${outcome.pushed ? 'pushed' : 'nothing to push'})`),
      ];
      for (const copy of outcome.conflicts) {
        const id = conflictSourceId(copy);
        lines.push(chalk.yellow(
          `conflict: kept the remote ${id}; your version is ${copy}; ` +
          `resolve with pan memory edit --user ${id} and pan memory retire --user ${copy}`,
        ));
      }
      for (const file of outcome.heldBack) {
        lines.push(chalk.yellow(`held back ${file.path}: ${file.reason}; it stays on this machine`));
      }
      return { lines, ok: true };
    }
    case 'not-configured':
      return {
        lines: ['Operator memory is not synced. Run pan memory sync --setup <git-url> with a private repository.'],
        ok: false,
      };
    case 'offline':
      return {
        lines: [chalk.yellow(
          `Operator memory sync is offline: ${outcome.error}; local changes stay committed here and push on the next sync.`,
        )],
        ok: false,
      };
    case 'failed':
      return { lines: [chalk.red(`Operator memory sync failed: ${outcome.error}`)], ok: false };
  }
}

export interface OperatorMemorySyncStepIo {
  isSynced?: () => boolean;
  sync?: () => Promise<OperatorMemorySyncOutcome>;
  log?: (line: string) => void;
  spinner?: boolean;
}

/** The `pan sync` step (D11): silent when the store is not synced; never throws, never sets the exit code. */
export async function runOperatorMemorySyncStep(io: OperatorMemorySyncStepIo = {}): Promise<void> {
  const isSynced = io.isSynced ?? (() => isOperatorMemorySynced());
  const sync = io.sync ?? (() => syncOperatorMemory());
  const log = io.log ?? ((line: string) => console.log(line));
  try {
    if (!isSynced()) return;
    const spinner = io.spinner === false ? null : ora('Syncing operator memory...').start();
    const outcome = await sync();
    spinner?.stop();
    for (const line of formatSyncOutcome(outcome).lines) log(line);
  } catch (error) {
    log(chalk.yellow(`Operator memory sync skipped: ${error instanceof Error ? error.message : String(error)}`));
  }
}

export interface MemorySyncOptions {
  setup?: string;
  status?: boolean;
  json?: boolean;
}

export interface MemorySyncDeps {
  sync: () => Promise<OperatorMemorySyncOutcome>;
  setup: (remoteUrl: string) => Promise<OperatorMemorySetupResult>;
  status: () => Promise<OperatorMemorySyncStatus>;
}

const defaultDeps: MemorySyncDeps = {
  sync: () => syncOperatorMemory(),
  setup: (remoteUrl) => setupOperatorMemorySync(remoteUrl),
  status: () => readOperatorMemorySyncStatus(),
};

function printStatus(status: OperatorMemorySyncStatus): void {
  if (!status.configured) {
    console.log(`Operator memory: not synced (${status.dir})`);
    console.log('  Run pan memory sync --setup <git-url> with a private repository.');
    return;
  }
  console.log(`Operator memory: synced with ${status.remote ?? '(no origin)'} (${status.dir})`);
  console.log(status.lastCommit
    ? `  Last commit: ${status.lastCommit.sha.slice(0, 7)} ${status.lastCommit.date} ${status.lastCommit.subject}`
    : '  Last commit: none');
  console.log(`  Ahead/behind origin/main (as of the last fetch): ${status.ahead}/${status.behind}`);
  console.log(`  Uncommitted changes: ${status.uncommitted}`);
  console.log(`  Conflict copies: ${status.conflicts.length > 0 ? status.conflicts.join(', ') : 'none'}`);
}

export async function memorySyncCommand(options: MemorySyncOptions, deps: MemorySyncDeps = defaultDeps): Promise<void> {
  if (options.setup !== undefined && options.status) {
    console.error(chalk.red('--setup and --status are mutually exclusive'));
    return exitCli(1);
  }

  if (options.status) {
    const status = await deps.status();
    if (options.json) console.log(JSON.stringify(status, null, 2));
    else printStatus(status);
    return;
  }

  if (options.setup !== undefined) {
    let result: OperatorMemorySetupResult;
    try {
      result = await deps.setup(options.setup);
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      return exitCli(1);
    }
    const formatted = formatSyncOutcome(result.outcome);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const moved of result.migrated) console.log(`moved ${moved.id} to the machine store: ${moved.to}`);
      for (const id of result.kept) {
        console.log(chalk.yellow(
          `kept ${id} in the operator store: the machine store already has ${id}; it is held back from every sync`,
        ));
      }
      for (const line of formatted.lines) console.log(line);
    }
    if (result.outcome.status !== 'synced') return exitCli(1);
    return;
  }

  const outcome = await deps.sync();
  const formatted = formatSyncOutcome(outcome);
  if (options.json) console.log(JSON.stringify(outcome, null, 2));
  else for (const line of formatted.lines) console.log(line);
  if (!formatted.ok) return exitCli(1);
}

export function registerMemorySyncCommand(memory: Command): void {
  memory
    .command('sync')
    .description('Sync the operator memory store with your private git remote')
    .option('--setup <git-url>', 'Turn on sync: use this private git repository as the remote, then sync')
    .option('--status', 'Show sync state without touching the network')
    .option('--json', 'Output JSON')
    .action((options: MemorySyncOptions) => memorySyncCommand(options));
}
