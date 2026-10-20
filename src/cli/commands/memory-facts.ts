/** `pan memory add|edit|show|list|retire` (PAN-3957): curated repo-owned fact CRUD. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  isActiveFact,
  matchMemoryFacts,
  MEMORY_FACT_TYPES,
  type MemoryFactScope,
  type MemoryFactType,
  projectMemoryDir,
  readMemoryFactsSync,
  userMemoryDir,
} from '../../lib/memory/facts/store.js';
import { findProjectByPath, getProjectSync } from '../../lib/projects.js';
import { resolvePlanHome } from '../../lib/pan-dir/paths.js';
import { exitCli } from '../exit.js';

export interface FactTargetFlags {
  project?: string;
  user?: boolean;
  here?: boolean;
}

export interface FactTarget {
  scope: MemoryFactScope;
  dir: string;
  root: string | null;
}

/** Resolve a fact store from `--project|--user|--here` flags (D4). */
export function resolveFactTarget(flags: FactTargetFlags, mode: 'read' | 'write'): FactTarget {
  const flagCount = [flags.project !== undefined, flags.user === true, flags.here === true].filter(Boolean).length;
  if (flagCount > 1) throw new Error('--project, --user and --here are mutually exclusive');
  if (mode === 'write' && flags.here) throw new Error('--here is not valid for this command');

  if (flags.user) return { scope: 'user', dir: userMemoryDir(), root: null };

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

export function registerMemoryFactCommands(memory: Command): void {
  memory
    .command('show <id>')
    .description('Print a curated memory fact')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'Read from the operator (per-machine) store')
    .option('--here', "Read from the cwd checkout's store instead of the primary checkout")
    .action(memoryFactShowCommand);

  memory
    .command('list')
    .description('List curated memory facts')
    .option('--type <type>', `Filter by fact type (${MEMORY_FACT_TYPES.join('|')})`)
    .option('--query <q>', 'Filter by a fact-matching query (see pan memory search)')
    .option('--review', 'Show only facts carrying a review marker (default: active facts only)')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'List the operator (per-machine) store')
    .option('--here', "List the cwd checkout's store instead of the primary checkout")
    .option('--json', 'Output JSON')
    .action(memoryFactListCommand);
}
