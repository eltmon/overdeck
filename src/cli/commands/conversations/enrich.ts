/**
 * pan conversations enrich — generate AI summaries and tags for sessions (PAN-457)
 */

import chalk from 'chalk';
import { enrichSessions, CostThresholdError, estimateEnrichmentCost } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichmentTier } from '../../../lib/conversations/enrichment/index.js';

export async function enrichAction(
  positionalIds: string[],
  opts: Record<string, string | boolean | undefined>,
): Promise<void> {
  // --deep is shorthand for --tier 3
  const deep = Boolean(opts['deep']);
  const tierRaw = deep ? 3 : parseInt((opts['tier'] as string) ?? '1', 10);
  const tier = tierRaw as EnrichmentTier;
  const yes = Boolean(opts['yes']);
  const maxParallel = opts['maxParallel'] ? parseInt(opts['maxParallel'] as string, 10) : undefined;
  const skipAlreadyEnriched = !Boolean(opts['full']) && !Boolean(opts['upgrade']);
  const force = Boolean(opts['full']) || Boolean(opts['upgrade']);
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
      modelOverride: opts['with'] as string | undefined,
      promptSuffix: opts['prompt'] as string | undefined,
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
    console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
  } catch (err) {
    if (err instanceof CostThresholdError) {
      console.log();
      console.log(chalk.yellow(`Estimated cost: $${err.estimatedCost.toFixed(4)} for ${err.sessionCount} sessions`));
      console.log(chalk.yellow(`Threshold:      $${err.threshold.toFixed(2)}`));

      if (!yes) {
        // In a real CLI we'd prompt interactively; for now, show the --yes flag
        console.log();
        console.log(chalk.dim('Rerun with --yes to proceed despite cost threshold.'));
        process.exit(1);
      }

      // Retry with threshold bypassed by running directly
      // (enrichSessions checks config threshold; --yes means caller accepts)
      console.log(chalk.yellow(`Proceeding anyway (--yes)...`));
      const result = await enrichSessions({
        tier,
        sessionIds,
        maxParallel,
        skipAlreadyEnriched,
        modelOverride: opts['with'] as string | undefined,
        promptSuffix: opts['prompt'] as string | undefined,
        force: true,
      });
      console.log(`  Enriched: ${chalk.green(result.enriched)}, Errors: ${chalk.red(result.errors)}`);
    } else {
      throw err;
    }
  }
}
