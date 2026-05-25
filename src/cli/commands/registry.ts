import { Command } from 'commander';
import chalk from 'chalk';
import type { FeatureRegistryEntry, FeatureRegistryListFilter, FeatureRegistryStatus } from '@panctl/contracts';
import {
  closeFeatureRegistryStorage,
  listFeatureRegistryEntries,
  showFeatureRegistryFeature,
  tagFeatureRegistryIssue,
} from '../../lib/registry/feature-registry-storage.js';

interface RegistryTagCommandOptions {
  description?: string;
  workspace?: string;
  agent?: string;
  status?: FeatureRegistryStatus;
  tag?: string[];
}

interface RegistryListCommandOptions {
  issue?: string;
  workspace?: string;
  agent?: string;
  status?: FeatureRegistryStatus;
  tag?: string[];
  limit?: number;
  json?: boolean;
}

interface RegistryShowCommandOptions {
  json?: boolean;
}

const STATUSES: readonly FeatureRegistryStatus[] = ['active', 'archived', 'merged', 'deferred'];

export function createRegistryCommand(): Command {
  const registry = new Command('registry')
    .description('Manage and inspect feature ownership records');

  registry
    .command('tag <issueId> <feature>')
    .description('Create or update a feature ownership record for an issue')
    .option('--description <text>', 'Feature description')
    .option('--workspace <id>', 'Owning workspace ID')
    .option('--agent <id>', 'Owning agent ID')
    .option('--status <status>', 'Feature status: active, archived, merged, deferred', parseStatus)
    .option('--tag <tag...>', 'Feature tags')
    .action(async (issueId: string, feature: string, options: RegistryTagCommandOptions) => withRegistryStorageClosed(async () => {
      const entry = await runRegistryTag(issueId, feature, options);
      console.log(chalk.green(`Tagged ${entry.owningIssueId} -> ${entry.featureName}`));
      for (const line of formatRegistryEntry(entry)) console.log(line);
    }));

  registry
    .command('list')
    .description('List feature ownership records')
    .option('--issue <id>', 'Owning issue ID')
    .option('--workspace <id>', 'Owning workspace ID')
    .option('--agent <id>', 'Owning agent ID')
    .option('--status <status>', 'Feature status: active, archived, merged, deferred', parseStatus)
    .option('--tag <tag...>', 'Require tag(s)')
    .option('--limit <n>', 'Maximum rows', parsePositiveInteger, 100)
    .option('--json', 'Output JSON')
    .action(async (options: RegistryListCommandOptions) => withRegistryStorageClosed(async () => {
      const entries = await runRegistryList(options);
      if (options.json) {
        console.log(JSON.stringify({ entries }, null, 2));
        return;
      }
      for (const line of formatRegistryList(entries)) console.log(line);
    }));

  registry
    .command('show <feature>')
    .description('Show one feature ownership record')
    .option('--json', 'Output JSON')
    .action(async (feature: string, options: RegistryShowCommandOptions) => withRegistryStorageClosed(async () => {
      const entry = await runRegistryShow(feature);
      if (!entry) {
        if (options.json) console.log(JSON.stringify(null, null, 2));
        else console.error(chalk.red(`Feature not found: ${feature}`));
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(entry, null, 2));
        return;
      }
      for (const line of formatRegistryEntry(entry)) console.log(line);
    }));

  return registry;
}

export async function runRegistryTag(
  issueId: string,
  featureName: string,
  options: RegistryTagCommandOptions = {},
): Promise<FeatureRegistryEntry> {
  return tagFeatureRegistryIssue({
    issueId,
    featureName,
    description: options.description,
    workspaceId: options.workspace,
    agentId: options.agent,
    status: options.status,
    tags: options.tag,
  });
}

export function runRegistryList(options: RegistryListCommandOptions = {}): Promise<FeatureRegistryEntry[]> {
  const filter: FeatureRegistryListFilter = {
    issueId: options.issue,
    workspaceId: options.workspace,
    agentId: options.agent,
    status: options.status,
    tags: options.tag,
    limit: options.limit,
  };
  return listFeatureRegistryEntries(filter);
}

export function runRegistryShow(featureName: string): Promise<FeatureRegistryEntry | null> {
  return showFeatureRegistryFeature(featureName);
}

async function withRegistryStorageClosed<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } finally {
    await closeFeatureRegistryStorage();
  }
}

export function formatRegistryList(entries: FeatureRegistryEntry[]): string[] {
  if (entries.length === 0) return [chalk.yellow('No feature registry entries found.')];
  const rows = entries.map((entry) => [
    entry.featureName,
    entry.owningIssueId ?? '—',
    entry.owningWorkspaceId ?? '—',
    entry.owningAgentId ?? '—',
    entry.status,
    entry.updatedAt,
    entry.tags.length > 0 ? entry.tags.join(',') : '—',
  ]);
  const headers = ['Feature', 'Issue', 'Workspace', 'Agent', 'Status', 'Updated', 'Tags'];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  return [
    formatRow(headers, widths),
    formatRow(widths.map((width) => '-'.repeat(width)), widths),
    ...rows.map((row) => formatRow(row, widths)),
  ];
}

export function formatRegistryEntry(entry: FeatureRegistryEntry): string[] {
  return [
    `${chalk.bold('Feature:')} ${entry.featureName}`,
    `${chalk.bold('Issue:')} ${entry.owningIssueId ?? '—'}`,
    `${chalk.bold('Workspace:')} ${entry.owningWorkspaceId ?? '—'}`,
    `${chalk.bold('Agent:')} ${entry.owningAgentId ?? '—'}`,
    `${chalk.bold('Status:')} ${entry.status}`,
    `${chalk.bold('Updated:')} ${entry.updatedAt}`,
    `${chalk.bold('Tags:')} ${entry.tags.length > 0 ? entry.tags.join(', ') : '—'}`,
    `${chalk.bold('Description:')} ${entry.description ?? '—'}`,
  ];
}

function formatRow(values: string[], widths: number[]): string {
  return values.map((value, index) => value.padEnd(widths[index])).join('  ');
}

function parseStatus(value: string): FeatureRegistryStatus {
  if ((STATUSES as readonly string[]).includes(value)) return value as FeatureRegistryStatus;
  throw new Error(`Invalid status: ${value}`);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--limit must be a positive integer');
  return parsed;
}
