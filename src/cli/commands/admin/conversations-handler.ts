import chalk from 'chalk';
import { INTERNAL_TOKEN_HEADER, ensureInternalTokenSync } from '../../../lib/internal-token.js';

interface BackfillOptions {
  dryRun?: boolean;
}

interface BackfillRow {
  name: string;
  title: string;
  reason: string;
}

interface BackfillReport {
  updated: BackfillRow[];
  skipped: Array<{ name: string; reason: string }>;
  dryRun: boolean;
}

function dashboardBaseUrl(): string {
  return (process.env.OVERDECK_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011').replace(/\/$/, '');
}

export async function backfillTitlesCommand(options: BackfillOptions = {}): Promise<void> {
  const dryRun = !!options.dryRun;
  const baseUrl = dashboardBaseUrl();
  const internalToken = ensureInternalTokenSync();

  let report: BackfillReport;
  try {
    const res = await fetch(`${baseUrl}/api/admin/conversations/backfill-titles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: internalToken,
      },
      body: JSON.stringify({ dryRun }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(chalk.red(`Dashboard returned ${res.status}${body ? `: ${body}` : ''}`));
      process.exit(1);
    }

    report = (await res.json()) as BackfillReport;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Dashboard not running — start it with \`pan up\` (${msg})`));
    process.exit(1);
  }

  console.log(chalk.bold(`Backfill titles report${dryRun ? chalk.yellow(' [dry run]') : ''}\n`));

  if (report.updated.length === 0 && report.skipped.length === 0) {
    console.log('No conversations need backfill.');
    return;
  }

  for (const row of report.updated) {
    console.log(`${chalk.green('✓')} ${row.name} → ${chalk.cyan(row.title)} ${chalk.dim(`(${row.reason})`)}`);
  }

  for (const row of report.skipped) {
    console.log(`${chalk.yellow('⊘')} ${row.name} ${chalk.dim(`(${row.reason})`)}`);
  }

  console.log(`\nTotals: ${report.updated.length} updated, ${report.skipped.length} skipped`);
}
