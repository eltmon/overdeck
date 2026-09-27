/**
 * `pan doctor github-quota` (PAN-4264) — this machine's GitHub API quota use,
 * read from the local ledger under `~/.overdeck/github-quota/`:
 *
 *   1. callers in the last hour (GraphQL and REST points, calls, estimated?)
 *   2. the latest `/rate_limit` sample per pool and bucket
 *   3. the active pause, if any
 *   4. projects membership refresh skips for having no tracker
 *   5. repos where the GitHub App is not installed
 *
 * It reads files only and makes no GitHub call. `--json` prints the same data.
 * Exit code 0.
 */
import chalk from 'chalk';
import type { GitHubQuotaCallerUsage, GitHubQuotaPause, GitHubQuotaSample } from '@overdeck/contracts';

import { aggregateLedger, readLedgerWindow } from '../../lib/github-quota/ledger.js';
import { readActivePause } from '../../lib/github-quota/pause-gate.js';
import { readAppMissingRepos, type AppMissingRepo } from '../../lib/github-quota/repo-notes.js';
import { readSkippedProjects, type SkippedProjectRecord } from '../../lib/github-quota/skipped-projects.js';
import { callerUsage, latestSamples, unattributedPoints } from '../../lib/github-quota/snapshot.js';

export interface GitHubQuotaReport {
  callers: GitHubQuotaCallerUsage[];
  unattributed: number;
  samples: GitHubQuotaSample[];
  pause: GitHubQuotaPause[];
  skippedProjects: SkippedProjectRecord[];
  appMissingRepos: AppMissingRepo[];
}

export function collectGitHubQuotaReport(nowMs: number = Date.now()): GitHubQuotaReport {
  const entries = readLedgerWindow(nowMs);
  const aggregate = aggregateLedger(entries);
  return {
    callers: callerUsage(aggregate),
    unattributed: unattributedPoints(aggregate, entries),
    samples: latestSamples(aggregate),
    pause: readActivePause(nowMs),
    skippedProjects: readSkippedProjects(),
    appMissingRepos: readAppMissingRepos(nowMs),
  };
}

function localTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

function printReport(report: GitHubQuotaReport): void {
  console.log(chalk.bold('\nGitHub API quota (this machine)\n'));

  console.log(chalk.bold('Callers, last hour'));
  if (report.callers.length === 0) {
    console.log(chalk.dim('  (no metered GitHub calls in the last hour)'));
  } else {
    console.log(chalk.dim(`  ${'caller'.padEnd(22)}${'GraphQL pts'.padStart(12)}${'REST pts'.padStart(10)}${'calls'.padStart(8)}  estimated?`));
    for (const usage of report.callers) {
      const calls = usage.graphql.calls + usage.rest.calls;
      console.log(`  ${usage.caller.padEnd(22)}${String(usage.graphql.points).padStart(12)}${String(usage.rest.points).padStart(10)}${String(calls).padStart(8)}  ${usage.estimated ? 'yes' : 'no'}`);
    }
  }
  console.log(`  ${'unattributed'.padEnd(22)}${String(report.unattributed).padStart(12)}`);

  console.log(chalk.bold('\nLatest samples'));
  if (report.samples.length === 0) console.log(chalk.dim('  (no /rate_limit sample in the last hour)'));
  for (const sample of report.samples) {
    console.log(`  ${`${sample.pool} ${sample.bucket}`.padEnd(14)} ${sample.remaining}/${sample.limit} remaining · resets ${localTime(sample.resetAt)} · sampled ${localTime(sample.ts)}`);
  }

  console.log(chalk.bold('\nActive pause'));
  if (report.pause.length === 0) console.log('  none');
  for (const pause of report.pause) {
    const line = `  ${pause.pool} ${pause.bucket}: ${pause.kind} limit, non-essential callers paused until ${localTime(pause.until)} (started by ${pause.caller})`;
    console.log(chalk.yellow(line));
  }

  console.log(chalk.bold('\nProjects skipped for tracker config'));
  if (report.skippedProjects.length === 0) console.log('  none');
  for (const project of report.skippedProjects) console.log(`  ${project.name} (${project.path})`);

  console.log(chalk.bold('\nRepos where the GitHub App is not installed'));
  if (report.appMissingRepos.length === 0) console.log('  none');
  for (const repo of report.appMissingRepos) {
    console.log(`  ${repo.repo} (issue listings use the gh user token until ${localTime(repo.expiresAt)})`);
  }
  console.log('');
}

export async function doctorGithubQuotaCommand(options: { json?: boolean } = {}): Promise<void> {
  const report = collectGitHubQuotaReport();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}
