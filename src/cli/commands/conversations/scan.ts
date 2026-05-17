/**
 * pan conversations scan — scan ~/.claude/projects/ for JSONL sessions (PAN-457)
 */

import chalk from 'chalk';
import { scan } from '../../../lib/conversations/scanner.js';
import type { ScanProgress } from '../../../lib/conversations/scanner.js';
import { getConversationsConfig } from '../../../lib/config-yaml.js';

export async function scanAction(opts: {
  mode?: string;
  dryRun?: boolean;
  dirs?: string[];
  maxParallel?: string;
}): Promise<void> {
  const mode = (opts.mode ?? 'system') as 'system' | 'watched' | 'targeted';

  if (mode === 'targeted' && (!opts.dirs || opts.dirs.length === 0)) {
    console.error(chalk.red('--mode targeted requires --dir <path> to be specified'));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(chalk.yellow('Dry-run mode — no database writes'));
  }

  console.log(chalk.bold(`Scanning sessions (mode: ${mode})...`));

  let lastLine = '';

  function renderProgress(p: ScanProgress): void {
    const pct = p.dirsTotal > 0 ? Math.round((p.dirsProcessed / p.dirsTotal) * 100) : 0;
    const bar = buildBar(pct, 30);
    const elapsed = (p.elapsedMs / 1000).toFixed(1);
    const line = `${bar} ${p.dirsProcessed}/${p.dirsTotal} dirs | ${p.sessionsFound} sessions found | ${elapsed}s`;

    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line}`);
    } else if (line !== lastLine) {
      console.log(line);
    }
    lastLine = line;
  }

  const result = await scan({
    mode,
    dirs: opts.dirs,
    watchDirs: getConversationsConfig().watchDirs,
    dryRun: opts.dryRun,
    maxParallel: opts.maxParallel ? parseInt(opts.maxParallel, 10) : undefined,
    onProgress: renderProgress,
  });

  if (process.stdout.isTTY && lastLine) {
    process.stdout.write('\n');
  }

  console.log();
  console.log(chalk.bold('Scan complete'));
  console.log(`  Inserted: ${chalk.green(result.inserted)}`);
  console.log(`  Updated:  ${chalk.cyan(result.updated)}`);
  console.log(`  Skipped:  ${chalk.dim(result.skipped)}`);
  if (result.errors > 0) {
    console.log(`  Errors:   ${chalk.red(result.errors)}`);
  }
  if (result.warnings?.length) {
    for (const warning of result.warnings) {
      console.warn(chalk.yellow(`  Warning:  ${warning}`));
    }
  }
  console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
}

function buildBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${chalk.green('█'.repeat(filled))}${chalk.dim('░'.repeat(empty))}]`;
}
