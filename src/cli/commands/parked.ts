/**
 * `pan parked` — the parked-population read surface (PAN-3485 phase 1).
 *
 * Prints every issue currently sitting in a parked orbit (stuck flags, gates,
 * failed merges, zombies, …), oldest first, with the two sentences an operator
 * needs: why it is parked and what would release it. Reads exclusively through
 * resolveParkedPopulation() — never re-derives parking.
 */
import chalk from 'chalk';
import { Command } from 'commander';

import {
  resolveParkedPopulation,
  summarizeParked,
  type ParkedRow,
} from '../../lib/parked/resolver.js';
import { acknowledgeAllOpenRecoveryTrips } from '../../lib/cloister/recovery-trip.js';

interface ParkedOptions {
  json?: boolean;
}

function ageLabel(parkedAt: string, now: number): string {
  const ms = now - Date.parse(parkedAt);
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function runParked(options: ParkedOptions = {}): Promise<ParkedRow[]> {
  const rows = await resolveParkedPopulation();
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return rows;
  }
  if (rows.length === 0) {
    console.log(chalk.green('Nothing parked — every in-flight issue has an autonomous next move.'));
    return rows;
  }
  const summary = summarizeParked(rows);
  const now = Date.now();
  console.log(chalk.bold(`Parked population: ${summary.total} issue(s) in ${rows.length} orbit(s)`));
  console.log(chalk.dim(Object.entries(summary.byOrbit).map(([orbit, count]) => `${orbit}=${count}`).join('  ')));
  console.log('');
  for (const row of rows) {
    console.log(
      `${chalk.bold(row.issueId.padEnd(10))} ${chalk.yellow(row.orbit.padEnd(16))} ${chalk.dim(`parked ${ageLabel(row.parkedAt, now)}`)}`,
    );
    console.log(`  ${chalk.dim('why:')    } ${truncate(row.parkReason, 110)}`);
    console.log(`  ${chalk.dim('release:') } ${truncate(row.unparkCondition, 110)}`);
  }
  return rows;
}

export function createParkedCommand(): Command {
  const command = new Command('parked')
    .description('List every issue parked in a stall orbit (stuck flags, gates, failed merges, zombies), oldest first, with why + release condition')
    .option('--json', 'Print the raw parked rows as JSON')
    .action(async (options: ParkedOptions) => {
      await runParked(options);
    });
  command.addCommand(createParkedAckCommand());
  return command;
}

// ─── pan parked ack — batch-acknowledge needs-you trips ──────────────────────

export interface ParkedAckOptions {
  orbit?: string;
  olderThan?: string;
  dryRun?: boolean;
}

export interface ParkedAckDeps {
  resolveRows?: () => Promise<ParkedRow[]>;
  ackIssueTrips?: (issueId: string) => Promise<number>;
  now?: number;
}

/**
 * Batch-acknowledge parked rows (operator-approved drain for the needs-you
 * mass, PAN-3485 follow-up). Acknowledging a trip silences the escalation;
 * the UNDERLYING decision (release to pipeline or close) still has to happen
 * — threshold-1 trip paths re-fire on the next patrol if the condition
 * persists. The command therefore ends by printing the flywheel hand-off to
 * run next: the flywheel evaluates each acked issue for the order book.
 */
export async function runParkedAck(options: ParkedAckOptions = {}, deps: ParkedAckDeps = {}): Promise<ParkedRow[]> {
  const orbit = options.orbit ?? 'needs-you';
  const now = deps.now ?? Date.now();
  const olderThanDays = options.olderThan ? Number.parseFloat(options.olderThan) : null;
  if (options.olderThan && (!Number.isFinite(olderThanDays) || olderThanDays! < 0)) {
    throw new Error(`--older-than must be a non-negative number of days, got "${options.olderThan}"`);
  }
  const resolveRows = deps.resolveRows ?? resolveParkedPopulation;
  const ackTrips = deps.ackIssueTrips ?? acknowledgeAllOpenRecoveryTrips;

  const rows = (await resolveRows()).filter((row) => {
    if (row.orbit !== orbit) return false;
    if (olderThanDays != null) {
      const ageDays = (now - Date.parse(row.parkedAt)) / 86_400_000;
      if (ageDays < olderThanDays) return false;
    }
    return true;
  });

  if (rows.length === 0) {
    console.log(chalk.green(`Nothing to acknowledge — no parked rows in orbit '${orbit}'${olderThanDays != null ? ` older than ${olderThanDays}d` : ''}.`));
    return rows;
  }

  console.log(chalk.bold(`Acknowledging ${rows.length} '${orbit}' parked row(s)${options.dryRun ? ' (dry run)' : ''}:`));
  let ackedTotal = 0;
  for (const row of rows) {
    const ageDays = Math.floor((now - Date.parse(row.parkedAt)) / 86_400_000);
    if (options.dryRun) {
      console.log(`  ${chalk.bold(row.issueId.padEnd(10))} ${chalk.dim(`${ageDays}d`)} — ${row.parkReason.slice(0, 90)}`);
      continue;
    }
    const acked = await ackTrips(row.issueId);
    ackedTotal += acked;
    console.log(`  ${chalk.bold(row.issueId.padEnd(10))} ${chalk.dim(`${ageDays}d`)} — ${acked} trip(s) acknowledged`);
  }
  if (!options.dryRun) {
    console.log(chalk.green(`\n${ackedTotal} trip(s) acknowledged across ${rows.length} issue(s).`));
    console.log(chalk.bold('\nNext: the underlying pickup decision is the flywheel\'s. Hand the list over:'));
    const ids = rows.map((row) => row.issueId).join(' ');
    console.log(chalk.dim(`  pan tell flywheel-orchestrator "Operator batch-acknowledged these needs-you parked issues: ${ids}. Evaluate each for order-book inclusion or closure — acknowledged pickup-gate trips re-fire if left undecided."`));
  }
  return rows;
}

function createParkedAckCommand(): Command {
  return new Command('ack')
    .description('Batch-acknowledge parked rows (default orbit: needs-you), then print the flywheel hand-off')
    .option('--orbit <orbit>', 'Parked orbit to acknowledge', 'needs-you')
    .option('--older-than <days>', 'Only rows parked at least this many days')
    .option('--dry-run', 'List what would be acknowledged without writing')
    .action(async (options: ParkedAckOptions) => {
      await runParkedAck(options);
    });
}
