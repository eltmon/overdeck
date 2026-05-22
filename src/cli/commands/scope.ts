/**
 * pan scope — vBRIEF lifecycle manual overrides
 *
 * Commands to inspect and move scope vBRIEFs between lifecycle directories.
 * All transitions use `transitionVBriefOnMain` so they inherit idempotency,
 * branch-awareness, and background-push behavior.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Effect } from 'effect';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  findVBriefByIssue,
  transitionVBriefOnMain,
  type VBriefTransitionResult,
} from '../../lib/vbrief/lifecycle-io.js';
import { findPlan, readPlan } from '../../lib/vbrief/io.js';
import { readContinueState } from '../../lib/vbrief/continue-state.js';
import { listVBriefsEffect, readVBriefDocumentEffect } from '../../lib/vbrief/vbrief-index.js';
import { resolveProjectFromIssue, extractTeamPrefix, findProjectByTeam, listProjects } from '../../lib/projects.js';
import type { VBriefDocument } from '../../lib/vbrief/types.js';

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

function formatTransition(result: VBriefTransitionResult, _issueId: string): string {
  const lines: string[] = [];
  if (result.moved) {
    lines.push(`${chalk.green('✓')} Moved vBRIEF ${result.fromDir} → ${result.toDir}`);
  } else {
    lines.push(`${chalk.dim('→')} Already in ${result.toDir}`);
  }
  if (result.statusUpdated) {
    lines.push(`${chalk.green('✓')} Updated plan.status → ${result.toDir}`);
  }
  if (result.committed) {
    lines.push(`${chalk.green('✓')} Committed on main`);
  } else if (result.moved || result.statusUpdated) {
    lines.push(`${chalk.yellow('⚠')} On-disk state updated but not committed (not on main)`);
  }
  return lines.join('\n');
}

interface ScopeRow {
  projectKey: string;
  projectPath: string;
  lifecycle: string; // 'proposed' | 'active' | 'completed' | 'cancelled' | 'workspace'
  issueId: string;
  title: string;
  status: string;
  created: string;
  path: string;
}

function safeReadPlan(path: string): VBriefDocument | null {
  try {
    return readPlan(path);
  } catch {
    return null;
  }
}

/** Best-effort created date — prefer plan.created, fall back to filename date, then mtime. */
function rowCreatedDate(doc: VBriefDocument | null, filenameDate: string | null, fallbackPath: string): string {
  const planCreated = doc?.plan?.created;
  if (planCreated && typeof planCreated === 'string') {
    const datePart = planCreated.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  }
  if (filenameDate && /^\d{4}-\d{2}-\d{2}$/.test(filenameDate)) return filenameDate;
  try {
    const st = statSync(fallbackPath);
    return st.mtime.toISOString().slice(0, 10);
  } catch {
    return '          ';
  }
}

function collectLifecycleRows(projectKey: string, projectPath: string) {
  return Effect.gen(function* () {
    const rows: ScopeRow[] = [];
    const entries = yield* listVBriefsEffect(projectPath);
    for (const entry of entries) {
      const doc = yield* readVBriefDocumentEffect(entry.path).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      rows.push({
        projectKey,
        projectPath,
        lifecycle: entry.lifecycleDir,
        issueId: (doc?.plan?.id ?? entry.issueId).toUpperCase(),
        title: doc?.plan?.title ?? '(untitled)',
        status: doc?.plan?.status ?? (doc ? 'unknown' : 'corrupt'),
        created: rowCreatedDate(doc, entry.date, entry.path),
        path: entry.path,
      });
    }
    return rows;
  });
}

function collectInFlightRows(projectKey: string, projectPath: string): ScopeRow[] {
  const rows: ScopeRow[] = [];
  const workspacesDir = join(projectPath, 'workspaces');
  if (!existsSync(workspacesDir)) return rows;
  let dirs: string[];
  try {
    dirs = readdirSync(workspacesDir);
  } catch {
    return rows;
  }
  for (const ws of dirs) {
    if (!ws.startsWith('feature-')) continue;
    const wsPath = join(workspacesDir, ws);
    const planPath = findPlan(wsPath);
    if (!planPath) continue;
    const doc = safeReadPlan(planPath);
    const inferredId = ws.replace(/^feature-/, '').toUpperCase();
    rows.push({
      projectKey,
      projectPath,
      lifecycle: 'workspace',
      issueId: (doc?.plan?.id ?? inferredId).toUpperCase(),
      title: doc?.plan?.title ?? '(in-flight planning)',
      status: doc?.plan?.status ?? (doc ? 'unknown' : 'corrupt'),
      created: rowCreatedDate(doc, null, planPath),
      path: planPath,
    });
  }
  return rows;
}

function dedupeRows(rows: ScopeRow[]): ScopeRow[] {
  // Prefer lifecycle copy over workspace duplicate when the same issue appears
  // in both. The lifecycle copy is the canonical one.
  const byKey = new Map<string, ScopeRow>();
  const lifecycleRank: Record<string, number> = {
    proposed: 0,
    active: 1,
    completed: 2,
    cancelled: 3,
    workspace: 4,
  };
  for (const r of rows) {
    const key = `${r.projectKey}::${r.issueId}`;
    const existing = byKey.get(key);
    if (!existing || (lifecycleRank[r.lifecycle] ?? 99) < (lifecycleRank[existing.lifecycle] ?? 99)) {
      byKey.set(key, r);
    }
  }
  return Array.from(byKey.values());
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  return s + ' '.repeat(w - s.length);
}

function printRowsTable(rows: ScopeRow[]): void {
  if (rows.length === 0) {
    console.log(chalk.yellow('No scope vBRIEFs found.'));
    return;
  }
  // Column widths
  const idW = Math.max(8, ...rows.map((r) => r.issueId.length));
  const titleW = Math.min(48, Math.max(10, ...rows.map((r) => r.title.length)));
  const statusW = Math.max(7, ...rows.map((r) => r.status.length));
  const lcW = Math.max(9, ...rows.map((r) => r.lifecycle.length));
  const createdW = 10; // YYYY-MM-DD
  const projW = Math.max(7, ...rows.map((r) => r.projectKey.length));

  const sep = '  ';
  const header =
    chalk.bold(pad('ISSUE', idW)) +
    sep +
    chalk.bold(pad('TITLE', titleW)) +
    sep +
    chalk.bold(pad('STATUS', statusW)) +
    sep +
    chalk.bold(pad('LIFECYCLE', lcW)) +
    sep +
    chalk.bold(pad('CREATED', createdW)) +
    sep +
    chalk.bold(pad('PROJECT', projW));
  console.log(header);
  console.log(chalk.dim('─'.repeat(idW + titleW + statusW + lcW + createdW + projW + sep.length * 5)));

  // Sort by project, then lifecycle (proposed→active→completed→cancelled→workspace), then issueId
  const lifecycleOrder: Record<string, number> = {
    proposed: 0,
    active: 1,
    completed: 2,
    cancelled: 3,
    workspace: 4,
  };
  rows.sort((a, b) => {
    const projCmp = a.projectKey.localeCompare(b.projectKey);
    if (projCmp !== 0) return projCmp;
    const lcCmp = (lifecycleOrder[a.lifecycle] ?? 99) - (lifecycleOrder[b.lifecycle] ?? 99);
    if (lcCmp !== 0) return lcCmp;
    return a.issueId.localeCompare(b.issueId);
  });

  for (const r of rows) {
    const lifecycleStr =
      r.lifecycle === 'workspace' ? chalk.magenta(pad(r.lifecycle, lcW)) : chalk.cyan(pad(r.lifecycle, lcW));
    const statusStr = chalk.yellow(pad(r.status, statusW));
    console.log(
      chalk.cyan(pad(r.issueId, idW)) +
        sep +
        pad(r.title, titleW) +
        sep +
        statusStr +
        sep +
        lifecycleStr +
        sep +
        chalk.dim(pad(r.created, createdW)) +
        sep +
        chalk.dim(pad(r.projectKey, projW)),
    );
  }
}

async function listCommand(options: { project?: string }): Promise<void> {
  const allRows = await Effect.runPromise(Effect.gen(function* () {
    const rows: ScopeRow[] = [];
    if (options.project) {
      const path = options.project;
      const key = path.split('/').filter(Boolean).pop() ?? path;
      rows.push(...yield* collectLifecycleRows(key, path));
      rows.push(...collectInFlightRows(key, path));
    } else {
      // Enumerate ALL registered projects + their in-flight worktrees.
      const projects = listProjects();
      if (projects.length === 0) {
        console.log(
          chalk.yellow('No projects registered in projects.yaml. Pass --project <path> or add a project first.'),
        );
        return rows;
      }
      for (const { key, config } of projects) {
        if (!config.path || !existsSync(config.path)) continue;
        rows.push(...yield* collectLifecycleRows(key, config.path));
        rows.push(...collectInFlightRows(key, config.path));
      }
    }
    return rows;
  }));

  const deduped = dedupeRows(allRows);
  printRowsTable(deduped);
}

async function showCommand(issueId: string, options: { project?: string }): Promise<void> {
  const projectPath = options.project ? options.project : getProjectPath(issueId);
  const upperId = issueId.toUpperCase();
  const found = findVBriefByIssue(projectPath, upperId);
  if (!found) {
    console.log(chalk.red(`No vBRIEF found for ${upperId} in ${projectPath}`));
    process.exit(1);
  }

  const plan = found.document.plan;

  // Header
  console.log(chalk.bold(`${found.issueId} — ${plan.title}`));
  console.log(`  Lifecycle: ${chalk.cyan(found.lifecycleDir)}`);
  console.log(`  Status:    ${chalk.cyan(plan.status ?? 'unknown')}`);
  console.log(`  Sequence:  ${plan.sequence ?? 0}`);
  console.log(`  UID:       ${chalk.dim(plan.uid ?? '(none)')}`);
  console.log(`  Created:   ${chalk.dim(plan.created ?? '(unknown)')}`);
  console.log(`  Updated:   ${chalk.dim(plan.updated ?? '(unknown)')}`);
  console.log(`  File:      ${chalk.dim(found.path)}`);

  if (plan.references && plan.references.length > 0) {
    console.log();
    console.log(chalk.bold('References:'));
    for (const ref of plan.references) {
      const label = ref.label ? `${ref.label} — ` : '';
      console.log(`  • ${label}${chalk.cyan(ref.uri)}`);
    }
  }

  // Narratives — description, approach, decisions, hazards
  const narratives = plan.narratives ?? {};
  const narrativeKeys = Object.keys(narratives).filter((k) => narratives[k]);
  if (narrativeKeys.length > 0) {
    console.log();
    console.log(chalk.bold('Narratives:'));
    for (const key of narrativeKeys) {
      const value = narratives[key];
      if (!value) continue;
      console.log(`  ${chalk.cyan(key)}:`);
      const lines = String(value).split('\n');
      for (const line of lines) {
        console.log(`    ${line}`);
      }
    }
  }

  // Items — id, title, status, completed, narrative, subItems
  const items = plan.items ?? [];
  const totalSubs = items.reduce((sum, it) => sum + (it.subItems?.length ?? 0), 0);
  const completedItems = items.filter((it) => it.status === 'completed').length;
  const completedSubs = items.reduce(
    (sum, it) => sum + (it.subItems?.filter((s) => s.status === 'completed').length ?? 0),
    0,
  );
  console.log();
  console.log(
    chalk.bold(
      `Items (${completedItems}/${items.length} completed${totalSubs > 0 ? `, sub-items ${completedSubs}/${totalSubs}` : ''}):`,
    ),
  );
  if (items.length === 0) {
    console.log(chalk.dim('  (none)'));
  }
  for (const it of items) {
    const checkbox = it.status === 'completed' ? chalk.green('✓') : it.status === 'cancelled' ? chalk.dim('×') : chalk.dim('○');
    const completedAt = it.completed ? chalk.dim(` [${it.completed.slice(0, 10)}]`) : '';
    console.log(
      `  ${checkbox} ${chalk.cyan(it.id)}  ${it.title} ${chalk.dim(`(${it.status})`)}${completedAt}`,
    );
    if (it.narrative) {
      const narrativeKeysItem = Object.keys(it.narrative).filter((k) => it.narrative![k]);
      for (const k of narrativeKeysItem) {
        const v = it.narrative[k];
        if (!v) continue;
        console.log(`      ${chalk.dim(k + ':')} ${v.split('\n').join(' ')}`);
      }
    }
    if (it.subItems && it.subItems.length > 0) {
      for (const sub of it.subItems) {
        const subBox =
          sub.status === 'completed' ? chalk.green('✓') : sub.status === 'cancelled' ? chalk.dim('×') : chalk.dim('○');
        const subCompletedAt = sub.completed ? chalk.dim(` [${sub.completed.slice(0, 10)}]`) : '';
        console.log(`      ${subBox} ${chalk.dim(sub.id)}  ${sub.title} ${chalk.dim(`(${sub.status})`)}${subCompletedAt}`);
      }
    }
  }

  // Continue-state summary (last session, decisions count, hazards count)
  let cs;
  try {
    cs = readContinueState(projectPath, upperId);
  } catch (err: any) {
    console.log();
    console.log(chalk.bold('Continue State:'));
    console.log(chalk.red(`  Failed to read continue file: ${err.message}`));
    return;
  }

  console.log();
  console.log(chalk.bold('Continue State:'));
  if (!cs) {
    console.log(chalk.dim('  (no continue file found)'));
    return;
  }
  console.log(`  Decisions: ${cs.decisions.length}`);
  console.log(`  Hazards:   ${cs.hazards.length}`);
  console.log(`  Sessions:  ${cs.sessionHistory.length}`);
  if (cs.gitState && (cs.gitState.branch || cs.gitState.sha)) {
    const branch = cs.gitState.branch ? chalk.cyan(cs.gitState.branch) : chalk.dim('(none)');
    const sha = cs.gitState.sha ? chalk.dim(cs.gitState.sha) : chalk.dim('(none)');
    const dirty = cs.gitState.dirty ? chalk.yellow(' [dirty]') : '';
    console.log(`  Git:       ${branch} @ ${sha}${dirty}`);
  }
  if (cs.resumePoint?.description) {
    console.log(`  Resume:    ${cs.resumePoint.description.split('\n')[0]}`);
  }
  if (cs.sessionHistory.length > 0) {
    const last = cs.sessionHistory[cs.sessionHistory.length - 1];
    const ts = last.timestamp ? chalk.dim(last.timestamp) : '';
    const note = last.note ? `  ${last.note}` : '';
    console.log(`  Last:      ${chalk.cyan(last.reason)} ${ts}${note}`);
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
    .description('List all scope vBRIEFs across registered projects (lifecycle dirs + in-flight worktrees)')
    .option('--project <path>', 'Limit to a single project path (defaults to all registered projects)')
    .action(listCommand);

  scope
    .command('show <issueId>')
    .description('Display vBRIEF plan + items + continue-state summary')
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
