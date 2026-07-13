import chalk from 'chalk';
import { Schema } from 'effect';
import { HygieneReport as HygieneReportSchema, type HygieneReport } from '@overdeck/contracts';
import { collectHygieneReport } from '../../lib/hygiene.js';

export interface HygieneCommandOptions {
  json?: boolean;
  strict?: boolean;
  skip?: string[];
  since?: string;
  fixSafe?: boolean;
  fixDiskPressureFloor?: string;
}

function lines(title: string, values: readonly string[], clean = 'clean'): string[] {
  return [`## ${title}`, '', ...(values.length ? values.map((value) => `- ${value}`) : [`- ${clean}`]), ''];
}

export function formatHygieneReport(report: HygieneReport): string {
  const output = [
    '# Overdeck hygiene', '',
    `Status: ${report.needsAttention ? 'needs attention' : 'clean'}`,
    `Root: ${report.root}`, '',
    ...lines('Push state', report.push.commits, 'no commits ahead of origin/main'),
    ...lines('Working tree', report.tree.files, 'clean'),
    ...lines('Pull requests', report.prs.map((pr) => `[#${pr.number}](${pr.url}) ${pr.branch} — ${pr.blocking}`), 'none open'),
    ...lines('Agent problems', report.agents.problems.map((item) => `${item.id}: ${item.summary}`), 'none'),
    ...lines('Zombie sessions', report.sessions.zombies, 'none'),
    ...lines('Stale merged branches', report.branches.stale, 'none'),
    ...lines('Stale workspaces', report.workspaces.stale, 'none'),
    '## Disk', '',
    `- ${report.disk.availableGb} GB available; ${report.disk.thresholdGb} GB floor${report.disk.urgent ? ' — URGENT' : ''}`, '',
  ];
  if (report.fixes.branchesDeleted.length || report.fixes.workspacesRemoved.length || report.fixes.errors.length) {
    output.push(...lines('Safe fixes', [
      ...report.fixes.branchesDeleted.map((branch) => `deleted merged branch ${branch}`),
      ...report.fixes.workspacesRemoved.map((workspace) => `removed stale workspace ${workspace.path} (${workspace.freedBytes} bytes freed)`),
      ...report.fixes.errors.map((error) => `ERROR: ${error}`),
    ]));
  }
  return output.join('\n').trimEnd();
}

export async function hygieneCommand(options: HygieneCommandOptions): Promise<void> {
  const floor = options.fixDiskPressureFloor === undefined
    ? undefined
    : Number(options.fixDiskPressureFloor);
  if (floor !== undefined && (!Number.isFinite(floor) || floor <= 0)) {
    throw new Error('--fix-disk-pressure-floor must be a positive number of GB');
  }
  const report = await collectHygieneReport({
    root: process.cwd(),
    skip: options.skip,
    since: options.since,
    fixSafe: options.fixSafe,
    diskFloorGb: floor,
  });
  const validated = Schema.decodeUnknownSync(HygieneReportSchema)(report);
  if (options.json) console.log(JSON.stringify(validated, null, 2));
  else console.log(formatHygieneReport(validated));
  if (options.strict && validated.needsAttention) {
    console.error(chalk.red('Hygiene findings require attention.'));
    process.exitCode = 1;
  }
}
