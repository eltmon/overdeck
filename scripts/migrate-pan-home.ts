#!/usr/bin/env tsx
/**
 * Thin CLI wrapper around `src/lib/pan-dir/migrate-plan-home.ts` (PAN-3917,
 * D8, w1-plan-home). The migration logic lives in the library; this script
 * is only argv parsing plus the `--open-issues <file>` contract (no tracker
 * dependency, for use in odd/offline setups and tests). For the day-to-day
 * verb, with a live tracker call for the open-issue list, use:
 *
 *   pan admin migrate-plan-home <project-key> [--commit] [--dry-run]
 *
 * Usage:
 *   tsx scripts/migrate-pan-home.ts --project <key> --open-issues <file> [--commit]
 *   tsx scripts/migrate-pan-home.ts --state-root <dir> --plan-home <dir> --open-issues <file>
 */
import {
  migratePanHome,
  readOpenIssuesFile,
  resolveMigrationTargets,
} from '../src/lib/pan-dir/migrate-plan-home.js';

export {
  MIGRATION_COMMIT_SUBJECT,
  destinationName,
  issueIdForArtifact,
  migratePanHome,
  readOpenIssuesFile,
} from '../src/lib/pan-dir/migrate-plan-home.js';

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const openIssuesPath = argValue(argv, '--open-issues');
  if (!openIssuesPath) {
    process.stderr.write('migrate-pan-home: --open-issues <file> is required (one issue id per line)\n');
    return 2;
  }

  let stateRoot: string;
  let planHome: string;
  try {
    ({ stateRoot, planHome } = resolveMigrationTargets({
      project: argValue(argv, '--project'),
      stateRoot: argValue(argv, '--state-root'),
      planHome: argValue(argv, '--plan-home'),
    }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const result = await migratePanHome({
    stateRoot,
    planHome,
    openIssues: readOpenIssuesFile(openIssuesPath),
    commit: argv.includes('--commit'),
  });

  process.stdout.write(
    `copied ${result.copied.length}, unchanged ${result.unchanged}, `
    + `skipped ${result.skippedClosed} closed-issue file(s), ${result.remaining} remaining, `
    + `progress copied for ${result.progressUpdated.length} issue(s)`
    + `${result.committed ? ', committed' : ''}\n`,
  );
  return result.remaining === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('migrate-pan-home.ts')) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
