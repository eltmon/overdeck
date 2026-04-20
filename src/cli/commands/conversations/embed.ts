/**
 * pan conversations embed — generate embeddings for enriched sessions (PAN-457)
 */

import chalk from 'chalk';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import type { EmbeddingProviderName } from '../../../lib/conversations/embeddings/index.js';
import { getDiscoveredStats } from '../../../lib/database/discovered-sessions-db.js';

export async function embedAction(
  positionalIds: string[],
  opts: Record<string, string | boolean | undefined>,
): Promise<void> {
  // --status: show coverage and exit
  if (opts['status']) {
    const stats = getDiscoveredStats();
    console.log(chalk.bold('Embedding coverage'));
    console.log(`  Total sessions:   ${stats.total}`);
    console.log(`  Enriched:         ${stats.enriched}`);
    console.log(`  Embedded:         ${stats.embedded}`);
    const pct = stats.enriched > 0 ? Math.round((stats.embedded / stats.enriched) * 100) : 0;
    console.log(`  Coverage:         ${pct}%`);
    return;
  }

  // Collect session IDs from positional args
  const ids = positionalIds.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));

  const provider = opts['provider'] as EmbeddingProviderName | undefined;
  const model = opts['model'] as string | undefined;
  const maxParallel = opts['maxParallel'] ? parseInt(opts['maxParallel'] as string, 10) : undefined;
  const regenerate = Boolean(opts['regenerate']);

  if (regenerate) {
    console.log(chalk.yellow('--regenerate: will overwrite existing embeddings'));
  }

  console.log(chalk.bold('Generating embeddings...'));

  let lastLine = '';

  const result = await embedSessions({
    sessionIds: ids.length > 0 ? ids : undefined,
    provider,
    model,
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
  console.log(chalk.bold('Embedding complete'));
  console.log(`  Embedded: ${chalk.green(result.embedded)}`);
  console.log(`  Skipped:  ${chalk.dim(result.skipped)}`);
  if (result.errors > 0) {
    console.log(`  Errors:   ${chalk.red(result.errors)}`);
  }
  console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
}
