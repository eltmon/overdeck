/**
 * pan conversations enrich — generate AI summaries and tags for sessions (PAN-457)
 */

import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichmentTier } from '../../../lib/conversations/enrichment/index.js';

async function confirmCost(): Promise<boolean> {
  if (!input.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Proceed with enrichment? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

function formatCost(actualCost: number | null | undefined, estimatedCost: number | undefined): string {
  const cost = actualCost ?? estimatedCost ?? 0;
  return `$${cost.toFixed(4)}${actualCost == null ? ' estimated' : ''}`;
}

export async function enrichAction(
  positionalIds: string[],
  opts: Record<string, string | boolean | undefined>,
): Promise<void> {
  const deep = Boolean(opts['deep']);
  const upgrade = Boolean(opts['upgrade']);
  const full = Boolean(opts['full']);
  const modelOverride = opts['with'] as string | undefined;
  const tierRaw = deep ? (upgrade ? 2 : 3) : (full ? 3 : parseInt((opts['tier'] as string) ?? '1', 10));
  const tier = tierRaw as EnrichmentTier;
  const yes = Boolean(opts['yes']);
  const maxParallel = opts['maxParallel'] ? parseInt(opts['maxParallel'] as string, 10) : undefined;
  const skipAlreadyEnriched = !full && !upgrade;
  const force = yes;
  const limit = opts['limit'] ? parseInt(opts['limit'] as string, 10) : undefined;
  const workspace = opts['workspace'] as string | undefined;
  const since = opts['since'] as string | undefined;

  // Collect session IDs from positional args and --ids flag
  const fromPositional = positionalIds.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const fromFlag = opts['ids']
    ? (opts['ids'] as string).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    : [];
  let sessionIds: number[] | undefined =
    fromPositional.length > 0 || fromFlag.length > 0
      ? [...new Set([...fromPositional, ...fromFlag])]
      : undefined;

  // Apply --workspace / --since filters if no explicit session IDs
  if (!sessionIds && (workspace || since || limit !== undefined)) {
    const { findDiscoveredSessions } = await import('../../../lib/database/discovered-sessions-db.js');
    const { parseRelativeTime } = await import('../../../lib/conversations/search.js');
    const sessions = findDiscoveredSessions({
      workspacePath: workspace,
      since: since ? parseRelativeTime(since) : undefined,
      limit,
    });
    sessionIds = sessions.map((s) => s.id);
  }

  if (![1, 2, 3].includes(tier)) {
    console.error(chalk.red('--tier must be 1, 2, or 3'));
    process.exit(1);
  }

  console.log(chalk.bold(`Enriching sessions at tier L${tier}...`));

  let lastLine = '';

  try {
    const result = await enrichSessions({
      tier,
      sessionIds,
      maxParallel,
      skipAlreadyEnriched,
      force,
      modelOverride,
      promptSuffix: opts['prompt'] as string | undefined,
      fullTranscript: full,
      onProgress: (p) => {
        const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
        const elapsed = (p.elapsedMs / 1000).toFixed(1);
        const line = `  ${pct}% · ${p.processed}/${p.total} sessions · ${p.errors} errors · ${elapsed}s`;

        if (process.stdout.isTTY) {
          process.stdout.write(`\r${line}`);
        } else if (line !== lastLine) {
          console.log(line);
        }
        lastLine = line;
      },
    });

    if (process.stdout.isTTY && lastLine) {
      process.stdout.write('\n');
    }

    console.log();
    console.log(chalk.bold('Enrichment complete'));
    console.log(`  Enriched: ${chalk.green(result.enriched)}`);
    console.log(`  Skipped:  ${chalk.dim(result.skipped)}`);
    if (result.errors > 0) {
      console.log(`  Errors:   ${chalk.red(result.errors)}`);
    }
    console.log(`  Cost:     ${formatCost(result.actualCost, result.estimatedCost)}`);
    console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
  } catch (err) {
    if (err instanceof CostThresholdError) {
      console.log();
      console.log(chalk.yellow(`Estimated cost: $${err.estimatedCost.toFixed(4)} for ${err.sessionCount} sessions`));
      console.log(chalk.yellow(`Threshold:      $${err.threshold.toFixed(2)}`));

      if (!yes && !(await confirmCost())) {
        process.exit(1);
      }

      console.log(chalk.yellow(`Proceeding with accepted cost...`));
      const result = await enrichSessions({
        tier,
        sessionIds,
        maxParallel,
        skipAlreadyEnriched,
        modelOverride,
        promptSuffix: opts['prompt'] as string | undefined,
        fullTranscript: full,
        force: true,
      });
      console.log(`  Enriched: ${chalk.green(result.enriched)}, Errors: ${chalk.red(result.errors)}, Cost: ${formatCost(result.actualCost, result.estimatedCost)}`);
    } else {
      throw err;
    }
  }
}
