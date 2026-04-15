/**
 * pan conversations enrich — generate AI summaries and tags for sessions (PAN-457)
 */

import chalk from 'chalk';
import { enrichSessions, CostThresholdError, estimateEnrichmentCost } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichmentTier } from '../../../lib/conversations/enrichment/index.js';

export async function enrichAction(opts: Record<string, string | boolean | undefined>): Promise<void> {
  const tier = parseInt((opts['tier'] as string) ?? '1', 10) as EnrichmentTier;
  const yes = Boolean(opts['yes']);
  const maxParallel = opts['maxParallel'] ? parseInt(opts['maxParallel'] as string, 10) : undefined;

  const sessionIds = opts['ids']
    ? (opts['ids'] as string).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    : undefined;

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
      });
      console.log(`  Enriched: ${chalk.green(result.enriched)}, Errors: ${chalk.red(result.errors)}`);
    } else {
      throw err;
    }
  }
}
