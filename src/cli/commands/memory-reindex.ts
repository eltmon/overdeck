/** `pan memory reindex [--project <key>] [--json]` (PAN-5358 FR-14): refresh fact vectors for every store. */
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfigSync } from '../../lib/config-yaml.js';
import { isActiveFact, machineMemoryDir, readMemoryFactsSync, userMemoryDir, type MemoryFactScope } from '../../lib/memory/facts/store.js';
import { refreshFactVectors } from '../../lib/memory/facts/vectors.js';
import { exitCli } from '../exit.js';
import { resolveFactTarget } from './memory-facts.js';

export interface MemoryReindexOptions {
  project?: string;
  json?: boolean;
  refresh?: typeof refreshFactVectors;
}

interface ReindexStoreResult {
  scope: MemoryFactScope;
  dir: string;
  embedded: number;
  reused: number;
}

function resolveReindexStores(project: string | undefined): { stores: Array<{ dir: string; scope: MemoryFactScope }>; skippedProjectNote: string | null } {
  const stores: Array<{ dir: string; scope: MemoryFactScope }> = [];
  let skippedProjectNote: string | null = null;

  try {
    const target = resolveFactTarget({ project }, 'read');
    stores.push({ dir: target.dir, scope: target.scope });
  } catch (err) {
    if (project !== undefined) throw err;
    skippedProjectNote = 'project: skipped (cwd owns no project; pass --project <key> to include one)';
  }

  stores.push({ dir: userMemoryDir(), scope: 'user' });
  stores.push({ dir: machineMemoryDir(), scope: 'machine' });
  return { stores, skippedProjectNote };
}

export async function memoryReindexCommand(options: MemoryReindexOptions): Promise<void> {
  let stores: Array<{ dir: string; scope: MemoryFactScope }>;
  let skippedProjectNote: string | null;
  try {
    ({ stores, skippedProjectNote } = resolveReindexStores(options.project));
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const refresh = options.refresh ?? refreshFactVectors;
  const config = loadConfigSync().config.docs.embedding;

  const results: ReindexStoreResult[] = [];
  for (const store of stores) {
    const { facts } = readMemoryFactsSync(store.dir, store.scope);
    try {
      const { embedded, reused } = await refresh({ facts: facts.filter(isActiveFact), config });
      results.push({ scope: store.scope, dir: store.dir, embedded, reused });
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      return exitCli(1);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ stores: results }, null, 2));
    return;
  }

  if (skippedProjectNote) console.log(skippedProjectNote);
  for (const result of results) {
    console.log(`${result.scope}: ${result.embedded} embedded, ${result.reused} reused`);
  }
}

export function registerMemoryReindexCommand(memory: Command): void {
  memory
    .command('reindex')
    .description('Refresh the fact vector cache for the project, operator and machine stores')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--json', 'Output JSON')
    .action((options: MemoryReindexOptions) => memoryReindexCommand(options));
}
