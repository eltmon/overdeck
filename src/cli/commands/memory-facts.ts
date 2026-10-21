/** `pan memory add|edit|show|list|retire` (PAN-3957): curated repo-owned fact CRUD. */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  defaultFactTitle,
  isActiveFact,
  machineMemoryDir,
  matchMemoryFacts,
  MEMORY_FACT_TYPES,
  type MemoryFact,
  type MemoryFactScope,
  type MemoryFactType,
  projectMemoryDir,
  readMemoryFactsSync,
  removeMemoryFact,
  userMemoryDir,
  writeMemoryFact,
} from '../../lib/memory/facts/store.js';
import { findProjectByPath, getProjectSync } from '../../lib/projects.js';
import { resolvePlanHome } from '../../lib/pan-dir/paths.js';
import { exitCli } from '../exit.js';

const execFileAsync = promisify(execFile);
const PROJECT_MEMORY_RELATIVE = '.overdeck/memory';

/** D11: refuse writing into a gitignored project store; resolve means ignored. */
export async function defaultCheckIgnored(root: string, relativePath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', root, 'check-ignore', '-q', relativePath]);
    return true;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return false;
    console.error(chalk.yellow(`warning: git check-ignore failed on ${root}; proceeding`));
    return false;
  }
}

export interface FactTargetFlags {
  project?: string;
  user?: boolean;
  machine?: boolean;
  here?: boolean;
}

export interface FactTarget {
  scope: MemoryFactScope;
  dir: string;
  root: string | null;
}

/** Resolve a fact store from `--project|--user|--machine|--here` flags (D4, PAN-4578 D12). */
export function resolveFactTarget(flags: FactTargetFlags, mode: 'read' | 'write'): FactTarget {
  const flagCount = [flags.project !== undefined, flags.user === true, flags.machine === true, flags.here === true]
    .filter(Boolean).length;
  if (flagCount > 1) throw new Error('--project, --user, --machine and --here are mutually exclusive');
  if (mode === 'write' && flags.here) throw new Error('--here is not valid for this command');

  if (flags.user) return { scope: 'user', dir: userMemoryDir(), root: null };
  if (flags.machine) return { scope: 'machine', dir: machineMemoryDir(), root: null };

  if (flags.project !== undefined) {
    const project = getProjectSync(flags.project);
    if (!project) throw new Error(`unknown project "${flags.project}"`);
    return { scope: 'project', dir: projectMemoryDir(project.path), root: resolvePlanHome(project.path) };
  }

  const project = findProjectByPath(process.cwd());
  if (!project) throw new Error('not inside a registered project; pass --project <key> or --user');

  const path = mode === 'write' || flags.here ? process.cwd() : project.path;
  return { scope: 'project', dir: projectMemoryDir(path), root: resolvePlanHome(path) };
}

export interface MemoryFactShowOptions extends FactTargetFlags {}

export async function memoryFactShowCommand(id: string, options: MemoryFactShowOptions): Promise<void> {
  let target: FactTarget;
  try {
    target = resolveFactTarget(options, 'read');
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const file = join(target.dir, `${id}.md`);
  if (!existsSync(file)) {
    console.error(chalk.red(`no fact "${id}" in ${target.dir}`));
    return exitCli(1);
  }
  console.log(`Source: ${file}`);
  console.log(readFileSync(file, 'utf8'));
}

export interface MemoryFactListOptions extends FactTargetFlags {
  type?: MemoryFactType;
  query?: string;
  review?: boolean;
  json?: boolean;
}

export async function memoryFactListCommand(options: MemoryFactListOptions): Promise<void> {
  let target: FactTarget;
  try {
    target = resolveFactTarget(options, 'read');
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const { facts: allFacts, problems } = readMemoryFactsSync(target.dir, target.scope);
  let facts = allFacts;
  if (options.type) facts = facts.filter((fact) => fact.type === options.type);
  if (options.query) facts = matchMemoryFacts(facts, options.query);
  facts = options.review ? facts.filter((fact) => !isActiveFact(fact)) : facts.filter(isActiveFact);

  if (options.json) {
    console.log(JSON.stringify({ scope: target.scope, dir: target.dir, facts, problems }, null, 2));
  } else {
    for (const fact of facts) console.log(`${fact.type}/${fact.id}  ${fact.description}`);
    if (problems.length > 0) {
      console.log(chalk.red('Problems:'));
      for (const problem of problems) console.log(chalk.red(`  ${problem.file}: ${problem.reason}`));
    }
  }

  if (problems.length > 0) return exitCli(1);
}

export interface MemoryFactAddOptions extends FactTargetFlags {
  type: MemoryFactType;
  title?: string;
  description: string;
  body?: string;
  bodyFile?: string;
  tags?: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real `git check-ignore` call (D11). */
  checkIgnored?: (root: string, relativePath: string) => Promise<boolean>;
}

function parseTags(tags: string | undefined): string[] {
  return tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
}

export async function memoryFactAddCommand(id: string, options: MemoryFactAddOptions): Promise<void> {
  if (options.type === 'user' && !options.user && !options.machine) {
    console.error(chalk.red('user facts go in the operator store: add --user (or --machine for this machine only)'));
    return exitCli(1);
  }
  if (options.body !== undefined && options.bodyFile !== undefined) {
    console.error(chalk.red('--body and --body-file are mutually exclusive'));
    return exitCli(1);
  }

  let target: FactTarget;
  try {
    target = resolveFactTarget(options, 'write');
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  if (target.scope === 'project') {
    const checkIgnored = options.checkIgnored ?? defaultCheckIgnored;
    const ignored = await checkIgnored(target.root as string, `${PROJECT_MEMORY_RELATIVE}/${id}.md`);
    if (ignored) {
      console.error(chalk.red(
        `${PROJECT_MEMORY_RELATIVE}/${id}.md is git-ignored; add "!${PROJECT_MEMORY_RELATIVE}/" to ${target.root}/.gitignore`,
      ));
      return exitCli(1);
    }
  }

  const body = options.body ?? (options.bodyFile ? await readFile(options.bodyFile, 'utf8') : '');
  let file: string;
  try {
    file = await writeMemoryFact(target.dir, target.scope, {
      id,
      type: options.type,
      title: options.title ?? defaultFactTitle(id),
      description: options.description,
      tags: parseTags(options.tags),
      updated: new Date().toISOString().slice(0, 10),
      source: null,
      review: [],
      body,
    });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ file }, null, 2));
    return;
  }
  console.log(chalk.green(`✓ Wrote ${file}`));
  if (target.scope === 'project') console.log(`  Commit it: git -C ${target.root} add ${PROJECT_MEMORY_RELATIVE}/${id}.md`);
}

export interface MemoryFactEditOptions extends FactTargetFlags {
  type?: MemoryFactType;
  title?: string;
  description?: string;
  body?: string;
  bodyFile?: string;
  tags?: string;
  clearReview?: boolean;
  json?: boolean;
}

export async function memoryFactEditCommand(id: string, options: MemoryFactEditOptions): Promise<void> {
  if (options.body !== undefined && options.bodyFile !== undefined) {
    console.error(chalk.red('--body and --body-file are mutually exclusive'));
    return exitCli(1);
  }

  const hasChange = options.type !== undefined || options.title !== undefined || options.description !== undefined
    || options.body !== undefined || options.bodyFile !== undefined || options.tags !== undefined || options.clearReview === true;
  if (!hasChange) {
    console.error(chalk.red('nothing to change; pass a field flag or edit <path> directly'));
    return exitCli(1);
  }

  let target: FactTarget;
  try {
    target = resolveFactTarget(options, 'write');
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const { facts } = readMemoryFactsSync(target.dir, target.scope);
  const existing = facts.find((fact) => fact.id === id);
  if (!existing) {
    console.error(chalk.red(`no fact "${id}"`));
    return exitCli(1);
  }

  const body = options.body ?? (options.bodyFile ? await readFile(options.bodyFile, 'utf8') : existing.body);
  const tags = options.tags !== undefined ? parseTags(options.tags) : existing.tags;

  let file: string;
  try {
    file = await writeMemoryFact(target.dir, target.scope, {
      id,
      type: options.type ?? existing.type,
      title: options.title ?? existing.title,
      description: options.description ?? existing.description,
      tags,
      updated: new Date().toISOString().slice(0, 10),
      source: existing.source,
      review: options.clearReview ? [] : existing.review,
      body,
    }, { overwrite: true });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  if (options.json) console.log(JSON.stringify({ file }, null, 2));
  else console.log(chalk.green(`✓ Wrote ${file}`));
}

export interface MemoryFactRetireOptions extends FactTargetFlags {
  json?: boolean;
}

export async function memoryFactRetireCommand(id: string, options: MemoryFactRetireOptions): Promise<void> {
  let target: FactTarget;
  try {
    target = resolveFactTarget(options, 'write');
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  let file: string;
  try {
    file = await removeMemoryFact(target.dir, id);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ file }, null, 2));
    return;
  }
  console.log(chalk.green(`✓ Removed ${file}`));
  if (target.scope === 'project') {
    console.log(
      `  Commit it: git -C ${target.root} rm --cached --ignore-unmatch ${PROJECT_MEMORY_RELATIVE}/${id}.md ` +
      `&& git -C ${target.root} commit -m "docs(memory): retire ${id}"`,
    );
  }
}

const MATCHING_FACTS_LIMIT = 5;

/**
 * `pan memory search` prints fact matches before observation hits (D13). Resolves
 * the project store the same way `resolveFactTarget(…, 'read')` does, but never
 * errors — outside a project (or with an unknown `--project`) it silently skips
 * the project store.
 */
export function printMatchingFacts(query: string, flags: { project?: string }): void {
  let projectFacts: MemoryFact[] = [];
  try {
    const target = resolveFactTarget(flags, 'read');
    if (target.scope === 'project') {
      const { facts } = readMemoryFactsSync(target.dir, 'project');
      projectFacts = matchMemoryFacts(facts.filter(isActiveFact), query).slice(0, MATCHING_FACTS_LIMIT);
    }
  } catch {
    // Not inside a registered project, or an unknown --project key: no project matches.
  }

  const { facts: userFactsAll } = readMemoryFactsSync(userMemoryDir(), 'user');
  const operatorFacts = matchMemoryFacts(userFactsAll.filter(isActiveFact), query).slice(0, MATCHING_FACTS_LIMIT);
  const { facts: machineFactsAll } = readMemoryFactsSync(machineMemoryDir(), 'machine');
  const machineFacts = matchMemoryFacts(machineFactsAll.filter(isActiveFact), query).slice(0, MATCHING_FACTS_LIMIT);

  if (projectFacts.length > 0) {
    console.log(chalk.bold('Project memory:'));
    for (const fact of projectFacts) console.log(`  ${fact.type}/${fact.id}: ${fact.description}`);
  }
  if (operatorFacts.length > 0) {
    console.log(chalk.bold('Operator memory:'));
    for (const fact of operatorFacts) console.log(`  ${fact.type}/${fact.id}: ${fact.description}`);
  }
  if (machineFacts.length > 0) {
    console.log(chalk.bold('Machine memory:'));
    for (const fact of machineFacts) console.log(`  ${fact.type}/${fact.id}: ${fact.description}`);
  }
}

export function registerMemoryFactCommands(memory: Command): void {
  memory
    .command('show <id>')
    .description('Print a curated memory fact')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'Read from the operator store (travels with you; synced when set up)')
    .option('--machine', 'Read from the machine store (this machine only)')
    .option('--here', "Read from the cwd checkout's store instead of the primary checkout")
    .action(memoryFactShowCommand);

  memory
    .command('list')
    .description('List curated memory facts')
    .option('--type <type>', `Filter by fact type (${MEMORY_FACT_TYPES.join('|')})`)
    .option('--query <q>', 'Filter by a fact-matching query (see pan memory search)')
    .option('--review', 'Show only facts carrying a review marker (default: active facts only)')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'List the operator store (travels with you; synced when set up)')
    .option('--machine', 'List the machine store (this machine only)')
    .option('--here', "List the cwd checkout's store instead of the primary checkout")
    .option('--json', 'Output JSON')
    .action(memoryFactListCommand);

  memory
    .command('add <id>')
    .description('Add a curated memory fact')
    .requiredOption('--type <type>', `Fact type (${MEMORY_FACT_TYPES.join('|')})`)
    .requiredOption('--description <text>', 'One-line index description (<= 200 chars)')
    .option('--title <text>', 'Fact title (defaults to the id, dashes as spaces, capitalized)')
    .option('--body <text>', 'Fact body')
    .option('--body-file <path>', 'Read the fact body from a file')
    .option('--tags <a,b>', 'Comma-separated tags')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'Write to the operator store (travels with you; synced when set up)')
    .option('--machine', 'Write to the machine store (this machine only)')
    .option('--json', 'Output JSON')
    .action(memoryFactAddCommand);

  memory
    .command('edit <id>')
    .description('Edit a curated memory fact')
    .option('--type <type>', `Fact type (${MEMORY_FACT_TYPES.join('|')})`)
    .option('--title <text>', 'Fact title')
    .option('--description <text>', 'One-line index description (<= 200 chars)')
    .option('--body <text>', 'Fact body')
    .option('--body-file <path>', 'Read the fact body from a file')
    .option('--tags <a,b>', 'Comma-separated tags')
    .option('--clear-review', 'Remove the review marker, re-activating the fact')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'Edit the operator store (travels with you; synced when set up)')
    .option('--machine', 'Edit the machine store (this machine only)')
    .option('--json', 'Output JSON')
    .action(memoryFactEditCommand);

  memory
    .command('retire <id>')
    .description('Remove a curated memory fact (git history is the archive)')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'Retire from the operator store (travels with you; synced when set up)')
    .option('--machine', 'Retire from the machine store (this machine only)')
    .option('--json', 'Output JSON')
    .action(memoryFactRetireCommand);
}
