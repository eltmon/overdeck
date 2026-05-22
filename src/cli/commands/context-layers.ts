/**
 * `pan context` — manage the layered context model (PAN-1201).
 *
 * Subcommands: list, edit, sync, diff, migrate, validate. The layered model
 * has three layers — global, project, workspace — each a single canonical
 * markdown source that `pan sync` renders into harness-specific outputs.
 *
 * (Distinct from the older agent-facing context-engineering helper in
 * `./context.ts`, which `pan show --context` uses internally.)
 */

import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';
import type { Harness } from '@panctl/contracts';
import {
  globalContextFile,
  projectContextFile,
  workspaceContextFile,
  ensureGlobalLayer,
  ensureProjectLayer,
  readLayerContent,
  renderGlobalLayer,
  renderForHarness,
  validateTemplate,
  migrateDevroot,
} from '../../lib/context-layers/index.js';
import { syncContextLayersSync } from '../../lib/sync.js';
import { isDevMode } from '../../lib/paths.js';
import { findProjectByPathSync, registerProjectSync } from '../../lib/projects.js';

type LayerName = 'global' | 'project' | 'workspace';

interface ContextOptions {
  layer?: string;
  harness?: string;
  json?: boolean;
  yes?: boolean;
}

/** Resolve the registered project whose tree contains `cwd`, or null. */
function resolveProjectRoot(cwd: string): string | null {
  const project = findProjectByPathSync(cwd);
  return project ? project.path : null;
}

/** Resolve the layer file for a layer name, relative to `cwd`. */
function resolveLayerFile(layer: LayerName, cwd: string): { file: string; note?: string } | null {
  if (layer === 'global') return { file: globalContextFile() };
  if (layer === 'project') {
    const root = resolveProjectRoot(cwd);
    if (!root) return null;
    return { file: projectContextFile(root) };
  }
  // workspace
  return {
    file: workspaceContextFile(cwd),
    note: 'workspace.md is auto-assembled at workspace creation; manual edits are rare',
  };
}

// ─── pan context list ─────────────────────────────────────────────────────

export async function contextListCommand(options: ContextOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const layers: Array<{ layer: LayerName; file: string }> = [];

  if (!options.layer || options.layer === 'global') {
    layers.push({ layer: 'global', file: globalContextFile() });
  }
  if (!options.layer || options.layer === 'project') {
    const root = resolveProjectRoot(cwd);
    if (root) layers.push({ layer: 'project', file: projectContextFile(root) });
  }
  if (!options.layer || options.layer === 'workspace') {
    const wsFile = workspaceContextFile(cwd);
    if (existsSync(wsFile)) layers.push({ layer: 'workspace', file: wsFile });
  }

  const rows = layers.map((l) => ({ ...l, exists: existsSync(l.file) }));

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(chalk.bold('Context layers:\n'));
  for (const row of rows) {
    const mark = row.exists ? chalk.green('●') : chalk.dim('○');
    const state = row.exists ? '' : chalk.dim(' (not created)');
    console.log(`  ${mark} ${chalk.cyan(row.layer.padEnd(9))} ${row.file}${state}`);
  }
  if (!options.layer && !rows.some((r) => r.layer === 'project')) {
    console.log(chalk.dim('\n  (no project layer — CWD is not inside a registered project)'));
  }
}

// ─── pan context edit ─────────────────────────────────────────────────────

export async function contextEditCommand(options: ContextOptions = {}): Promise<void> {
  const layer = (options.layer ?? 'global') as LayerName;
  const resolved = resolveLayerFile(layer, process.cwd());
  if (!resolved) {
    console.error(chalk.red(`Cannot resolve the ${layer} layer — CWD is not inside a registered project.`));
    process.exitCode = 1;
    return;
  }

  // Seed the layer with its starter if it does not exist yet.
  if (!existsSync(resolved.file)) {
    if (layer === 'global') ensureGlobalLayer();
    else if (layer === 'project') {
      const root = resolveProjectRoot(process.cwd());
      if (root) ensureProjectLayer(root);
    } else {
      mkdirSync(join(resolved.file, '..'), { recursive: true });
    }
  }

  if (resolved.note) console.log(chalk.dim(`Note: ${resolved.note}`));

  const editor = process.env.VISUAL || process.env.EDITOR || 'nano';
  const res = spawnSync(editor, [resolved.file], { stdio: 'inherit' });
  if (res.error) {
    console.error(chalk.red(`Failed to open editor (${editor}): ${res.error.message}`));
    console.log(chalk.dim(`Edit the file directly: ${resolved.file}`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.dim('Run `pan context sync` to render the change into harness outputs.'));
}

// ─── pan context sync ─────────────────────────────────────────────────────

export async function contextSyncCommand(): Promise<void> {
  const result = syncContextLayersSync();
  if (result.globalStubCreated) {
    console.log(chalk.cyan('Seeded ~/.panopticon/context/global.md with a starter template.'));
  }
  if (result.globalWritten) {
    console.log(chalk.green('✓ Rendered global layer → ~/.claude/CLAUDE.md'));
  } else {
    console.log(chalk.dim('  global layer already up to date'));
  }
  for (const name of result.projectsWritten) {
    console.log(chalk.green(`✓ Rendered project layer → ${name}/CLAUDE.md`));
  }
  for (const err of result.errors) {
    console.log(chalk.red(`  ✗ ${err}`));
  }
  if (result.errors.length > 0) process.exitCode = 1;
}

// ─── pan context diff ─────────────────────────────────────────────────────

export async function contextDiffCommand(options: ContextOptions = {}): Promise<void> {
  const harnesses: Harness[] =
    options.harness === 'claude' || options.harness === 'claude-code'
      ? ['claude-code']
      : options.harness === 'pi'
        ? ['pi']
        : ['claude-code', 'pi'];

  for (const harness of harnesses) {
    const rendered = renderGlobalLayer(harness, isDevMode());
    console.log(chalk.bold.cyan(`\n─── global layer rendered for ${harness} ───\n`));
    console.log(rendered || chalk.dim('(empty)'));
  }
  console.log('');
}

// ─── pan context validate ─────────────────────────────────────────────────

export async function contextValidateCommand(): Promise<void> {
  const cwd = process.cwd();
  const targets: Array<{ layer: LayerName; file: string }> = [{ layer: 'global', file: globalContextFile() }];
  const root = resolveProjectRoot(cwd);
  if (root) targets.push({ layer: 'project', file: projectContextFile(root) });
  const wsFile = workspaceContextFile(cwd);
  if (existsSync(wsFile)) targets.push({ layer: 'workspace', file: wsFile });

  let errors = 0;
  let warnings = 0;
  for (const { layer, file } of targets) {
    if (!existsSync(file)) continue;
    const validation = validateTemplate(readFileSync(file, 'utf-8'));
    if (validation.issues.length === 0) {
      console.log(chalk.green(`✓ ${layer.padEnd(9)} ${file}`));
      continue;
    }
    for (const issue of validation.issues) {
      if (issue.severity === 'error') errors++;
      else warnings++;
      const tag = issue.severity === 'error' ? chalk.red('error') : chalk.yellow('warning');
      console.log(`  ${tag} ${chalk.cyan(layer)}: ${issue.message}`);
    }
  }

  if (errors > 0) {
    console.log(chalk.red(`\n${errors} error(s), ${warnings} warning(s).`));
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(chalk.yellow(`\n${warnings} warning(s), 0 errors.`));
  } else {
    console.log(chalk.green('\nAll context layers valid.'));
  }
}

// ─── pan context migrate ──────────────────────────────────────────────────

export async function contextMigrateCommand(options: ContextOptions = {}): Promise<void> {
  console.log(chalk.bold('Migrating legacy devroot content to the layered context model...\n'));
  ensureGlobalLayer();
  const result = migrateDevroot();

  if (!result.detected) {
    console.log(chalk.dim(`No legacy devroot found at ${result.oldClaudeDir} — nothing to migrate.`));
  } else {
    for (const c of result.copied) console.log(chalk.green(`✓ ${c}`));
    for (const s of result.skipped) console.log(chalk.dim(`  skipped: ${s}`));
    if (result.copied.length === 0 && result.skipped.length > 0) {
      console.log(chalk.dim('  (everything already migrated — re-run is a no-op)'));
    }
  }

  // Register discovered projects.
  if (result.discoveredProjects.length > 0) {
    console.log(chalk.bold(`\nDiscovered ${result.discoveredProjects.length} project(s):`));
    const interactive = Boolean(process.stdin.isTTY) && !options.yes;
    for (const path of result.discoveredProjects) {
      const key = path.split('/').filter(Boolean).pop()!.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (findProjectByPathSync(path)) {
        console.log(chalk.dim(`  • ${path} (already registered)`));
        continue;
      }
      let register = options.yes === true;
      if (interactive) {
        const ans = await inquirer.prompt<{ register: boolean }>([
          { type: 'confirm', name: 'register', message: `Register ${path}?`, default: true },
        ]);
        register = ans.register;
      }
      if (register) {
        registerProjectSync(key, { name: key, path });
        ensureProjectLayer(path);
        console.log(chalk.green(`  ✓ registered ${key} → ${path}`));
      } else if (!interactive) {
        console.log(chalk.dim(`  • ${path} — register with: pan project add ${path}`));
      }
    }
  }

  if (result.detected) {
    console.log(
      chalk.yellow(
        `\nOld location preserved at ${result.oldClaudeDir} — ` +
          `delete it with \`rm -rf ${result.oldClaudeDir}\` once you have verified the migration.`,
      ),
    );
    console.log(chalk.dim('Set sync.devroot to null in config to silence the deprecation warning.'));
  }
  console.log(chalk.dim('\nRun `pan context sync` to render the migrated content.'));
}

// ─── dispatcher (used by `pan context` with no subcommand) ─────────────────

/** Print the `pan context` subcommand overview. */
export async function contextLayersHelp(): Promise<void> {
  console.log(chalk.bold('pan context — layered context distribution\n'));
  console.log('  pan context list      Show all three layers and their files');
  console.log('  pan context edit      Open a layer in $EDITOR (--layer global|project|workspace)');
  console.log('  pan context sync      Render the layers into harness CLAUDE.md files');
  console.log('  pan context diff      Show what each harness would receive (--harness claude|pi)');
  console.log('  pan context validate  Lint layer templates for malformed harness blocks');
  console.log('  pan context migrate   One-shot migration from the deprecated sync.devroot');
}

/** A renderer used in tests / programmatic callers. */
export function renderLayerForHarness(content: string, harness: Harness): string {
  return renderForHarness(content, harness);
}
