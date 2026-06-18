import { Command } from 'commander';
import chalk from 'chalk';
import { getComplianceStatus, type ComplianceStatusResult } from '../../lib/compliance/status.js';

interface ComplianceStatusCommandOptions {
  project?: string;
  workspace?: string;
  issue?: string;
  session?: string;
  sinceHours?: number;
  json?: boolean;
}

export function createComplianceCommand(): Command {
  const compliance = new Command('compliance')
    .description('Inspect memory-first compliance state');

  compliance
    .command('status')
    .description('Show compliance mode and recent compliance misses')
    .option('--project <id>', 'Project ID', 'overdeck')
    .option('--workspace <id>', 'Workspace ID')
    .option('--issue <id>', 'Issue ID')
    .option('--session <id>', 'Session ID')
    .option('--since-hours <n>', 'Hours to count recent misses', parsePositiveNumber, 24)
    .option('--json', 'Output JSON')
    .action(async (options: ComplianceStatusCommandOptions) => {
      const status = await getComplianceStatus(options);
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      for (const line of formatComplianceStatus(status)) console.log(line);
    });

  return compliance;
}

export function formatComplianceStatus(status: ComplianceStatusResult): string[] {
  const lines = [
    `${chalk.bold('Compliance mode:')} ${formatMode(status.mode)}`,
    `${chalk.bold('Recent compliance.miss observations:')} ${status.recentMissCount}`,
    `${chalk.dim('Since:')} ${status.since}`,
    `${chalk.dim('Project:')} ${status.projectId}`,
  ];
  if (status.workspaceId) lines.push(`${chalk.dim('Workspace:')} ${status.workspaceId}`);
  if (status.issueId) lines.push(`${chalk.dim('Issue:')} ${status.issueId}`);
  if (status.sessionId) lines.push(`${chalk.dim('Session:')} ${status.sessionId}`);
  return lines;
}

function formatMode(mode: ComplianceStatusResult['mode']): string {
  if (mode === 'off') return chalk.gray(mode);
  if (mode === 'enforcing') return chalk.red(mode);
  return chalk.yellow(mode);
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--since-hours must be a positive number');
  return parsed;
}
