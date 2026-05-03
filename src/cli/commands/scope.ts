/**
 * pan scope — vBRIEF lifecycle manual overrides
 *
 * Commands to inspect and move scope vBRIEFs between lifecycle directories.
 * All transitions use `transitionVBriefOnMain` so they inherit idempotency,
 * branch-awareness, and background-push behavior.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  findVBriefByIssue,
  transitionVBriefOnMain,
  type VBriefTransitionResult,
} from '../../lib/vbrief/lifecycle-io.js';
import { readPlan } from '../../lib/vbrief/io.js';
import { resolveVBriefDir, VBRIEF_LIFECYCLE_DIRS } from '../../lib/vbrief/lifecycle.js';
import { resolveProjectFromIssue, extractTeamPrefix, findProjectByTeam } from '../../lib/projects.js';

function getProjectPath(issueId: string): string {
  const resolved = resolveProjectFromIssue(issueId);
  if (resolved?.projectPath) {
    return resolved.projectPath;
  }
  const teamPrefix = extractTeamPrefix(issueId);
  const project = teamPrefix ? findProjectByTeam(teamPrefix) : null;
  if (project?.path) {
    return project.path;
  }
  throw new Error(`Could not resolve project path for ${issueId}. Add the project to projects.yaml or pass --project.`);
}

function formatTransition(result: VBriefTransitionResult, issueId: string): string {
  const lines: string[] = [];
  if (result.moved) {
    lines.push(`${chalk.green('✓')} Moved vBRIEF ${result.fromDir} → ${result.toDir}`);
  } else {
    lines.push(`${chalk.dim('→')} Already in ${result.toDir}`);
  }
  if (result.statusUpdated) {
    lines.push(`${chalk.green('✓')} Updated plan.status → ${result.toDir}`);
  }
  if (result.movedContinue) {
    lines.push(`${chalk.green('✓')} Moved continue file`);
  }
  if (result.committed) {
    lines.push(`${chalk.green('✓')} Committed on main`);
  } else if (result.moved || result.statusUpdated) {
    lines.push(`${chalk.yellow('⚠')} On-disk state updated but not committed (not on main)`);
  }
  return lines.join('\n');
}

async function listCommand(options: { project?: string }): Promise<void> {
  const projectPath = options.project ?? process.cwd();
  const rows: Array<{ lifecycle: string; issueId: string; title: string; status: string }> = [];

  for (const dir of VBRIEF_LIFECYCLE_DIRS) {
    const dirPath = resolveVBriefDir(projectPath, dir);
    if (!existsSync(dirPath)) continue;
    const entries = readdirSync(dirPath).filter((f) => f.endsWith('.vbrief.json') && !f.startsWith('continue-'));
    for (const entry of entries) {
      try {
        const doc = readPlan(join(dirPath, entry));
        rows.push({
          lifecycle: dir,
          issueId: doc.plan.id?.toUpperCase() ?? 'UNKNOWN',
          title: doc.plan.title ?? '(untitled)',
          status: doc.plan.status ?? 'unknown',
        });
      } catch {
        rows.push({ lifecycle: dir, issueId: '???', title: entry, status: 'corrupt' });
      }
    }
  }

  if (rows.length === 0) {
    console.log(chalk.yellow('No scope vBRIEFs found in this project.'));
    return;
  }

  // Group by lifecycle dir
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.lifecycle) ?? [];
    list.push(row);
    grouped.set(row.lifecycle, list);
  }

  for (const dir of VBRIEF_LIFECYCLE_DIRS) {
    const group = grouped.get(dir);
    if (!group || group.length === 0) continue;
    console.log(chalk.bold(`\n${dir.toUpperCase()}`));
    for (const r of group) {
      console.log(`  ${chalk.cyan(r.issueId)}  ${r.title}  ${chalk.dim(`(${r.status})`)}`);
    }
  }
}

async function showCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const found = findVBriefByIssue(projectPath, issueId);
  if (!found) {
    console.log(chalk.red(`No vBRIEF found for ${issueId} in ${projectPath}`));
    process.exit(1);
  }

  console.log(chalk.bold(`${found.issueId} — ${found.document.plan.title}`));
  console.log(`  Lifecycle: ${chalk.cyan(found.lifecycleDir)}`);
  console.log(`  Status:    ${chalk.cyan(found.document.plan.status ?? 'unknown')}`);
  console.log(`  Sequence:  ${found.document.plan.sequence ?? 0}`);
  console.log(`  File:      ${found.path}`);
  const items = found.document.plan.items ?? [];
  if (items.length > 0) {
    console.log(`  Items:     ${items.length}`);
  }
}

async function proposeCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const result = await transitionVBriefOnMain(
    projectPath,
    issueId,
    'proposed',
    'proposed',
    `scope: propose ${issueId.toUpperCase()} vBRIEF`,
  );
  console.log(formatTransition(result, issueId));
}

async function approveCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const result = await transitionVBriefOnMain(
    projectPath,
    issueId,
    'active',
    'approved',
    `scope: approve ${issueId.toUpperCase()} vBRIEF`,
  );
  console.log(formatTransition(result, issueId));
}

async function completeCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const result = await transitionVBriefOnMain(
    projectPath,
    issueId,
    'completed',
    'completed',
    `scope: complete ${issueId.toUpperCase()} vBRIEF`,
  );
  console.log(formatTransition(result, issueId));
}

async function cancelCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const result = await transitionVBriefOnMain(
    projectPath,
    issueId,
    'cancelled',
    'cancelled',
    `scope: cancel ${issueId.toUpperCase()} vBRIEF`,
  );
  console.log(formatTransition(result, issueId));
}

async function restoreCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const found = findVBriefByIssue(projectPath, issueId);
  if (!found) {
    console.log(chalk.red(`No vBRIEF found for ${issueId}`));
    process.exit(1);
  }
  if (found.lifecycleDir !== 'completed' && found.lifecycleDir !== 'cancelled') {
    console.log(chalk.yellow(`vBRIEF is in ${found.lifecycleDir} — restore only works from completed/ or cancelled/`));
    process.exit(1);
  }
  const result = await transitionVBriefOnMain(
    projectPath,
    issueId,
    'active',
    'approved',
    `scope: restore ${issueId.toUpperCase()} vBRIEF`,
  );
  console.log(formatTransition(result, issueId));
}

export function registerScopeCommands(program: Command): void {
  const scope = program.command('scope').description('vBRIEF lifecycle management');

  scope
    .command('list')
    .description('List all scope vBRIEFs with lifecycle status')
    .option('--project <path>', 'Project path (defaults to cwd or resolved from issue)')
    .action(listCommand);

  scope
    .command('show <issueId>')
    .description('Display vBRIEF plan details')
    .option('--project <path>', 'Project path (defaults to resolved from issue)')
    .action(showCommand);

  scope
    .command('propose <issueId>')
    .description('Move vBRIEF to proposed/')
    .option('--project <path>', 'Project path (defaults to resolved from issue)')
    .action(proposeCommand);

  scope
    .command('approve <issueId>')
    .description('Move vBRIEF to active/ and set status approved')
    .option('--project <path>', 'Project path (defaults to resolved from issue)')
    .action(approveCommand);

  scope
    .command('complete <issueId>')
    .description('Move vBRIEF to completed/')
    .option('--project <path>', 'Project path (defaults to resolved from issue)')
    .action(completeCommand);

  scope
    .command('cancel <issueId>')
    .description('Move vBRIEF to cancelled/')
    .option('--project <path>', 'Project path (defaults to resolved from issue)')
    .action(cancelCommand);

  scope
    .command('restore <issueId>')
    .description('Restore vBRIEF from completed/ or cancelled/ to active/')
    .option('--project <path>', 'Project path (defaults to resolved from issue)')
    .action(restoreCommand);
}
