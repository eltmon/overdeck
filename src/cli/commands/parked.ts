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
  return new Command('parked')
    .description('List every issue parked in a stall orbit (stuck flags, gates, failed merges, zombies), oldest first, with why + release condition')
    .option('--json', 'Print the raw parked rows as JSON')
    .action(async (options: ParkedOptions) => {
      await runParked(options);
    });
}
