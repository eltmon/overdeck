import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { archiveWorkspace, touchWorkspaceAccessed } from '../../lib/workspaces/writer.js';
import { getWorkspaceById } from '../../lib/workspaces/resolver.js';

function resolveOrExit(ws: string) {
  const row = getWorkspaceById(ws);
  if (!row) {
    console.error(chalk.red(`✗ No workspace found with id '${ws}'`));
    return null;
  }
  return row;
}

export async function workspaceGetCommand(ws: string): Promise<void> {
  const row = resolveOrExit(ws);
  if (!row) return exitCli(1);

  console.log(chalk.bold(row.name));
  console.log(`  id:          ${row.id}`);
  console.log(`  kind:        ${row.kind}`);
  console.log(`  project:     ${row.projectId}`);
  console.log(`  path:        ${row.path}`);
  console.log(`  branch:      ${row.branchName ?? chalk.dim('(none)')}`);
  console.log(`  issue:       ${row.issueId ?? chalk.dim('(none)')}`);
  console.log(`  archived:    ${row.isArchived}`);
  console.log(`  favorite:    ${row.isFavorite}`);
  console.log(`  lastAccess:  ${new Date(row.lastAccessedAt).toISOString()}`);
}

export async function workspaceActivateCommand(ws: string): Promise<void> {
  const row = resolveOrExit(ws);
  if (!row) return exitCli(1);

  touchWorkspaceAccessed(row.id);
  console.log(chalk.green(`✓ Activated workspace '${row.name}'`));
  if (row.layoutConfig) {
    console.log(chalk.dim('  Restore its dashboard layout from layoutConfig.'));
  }
}

export async function workspaceArchiveCommand(ws: string): Promise<void> {
  const row = resolveOrExit(ws);
  if (!row) return exitCli(1);

  if (row.kind === 'main') {
    console.error(chalk.red(`✗ Cannot archive the main workspace for project '${row.projectId}'`));
    return exitCli(1);
  }

  archiveWorkspace(row.id);
  console.log(chalk.green(`✓ Archived workspace '${row.name}' (reversible)`));
}
