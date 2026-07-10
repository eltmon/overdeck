/**
 * compact-beads — Beads compaction + git commit/push.
 *
 * Extracted from merge-agent.ts conditionalBeadsCompaction().
 * Compacts closed beads older than 30 days and commits the result.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import type { LifecycleContext, StepResult } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';

const execAsync = promisify(exec);

/** Options for beads compaction */
export interface CompactBeadsOptions {
  /** Number of days to keep closed beads. Default: 30 */
  days?: number;
  /** Push commits to remote. Default: true */
  pushToRemote?: boolean;
}

/**
 * Compact closed beads older than N days.
 * Idempotent — returns skip if no beads to compact.
 */
export function compactBeads(
  ctx: LifecycleContext,
  opts: CompactBeadsOptions = {},
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => compactBeadsImpl(ctx, opts),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('compact-beads', `Beads compaction failed: ${(err as Error).message}`)),
    ),
  );
}

async function compactBeadsImpl(
  ctx: LifecycleContext,
  opts: CompactBeadsOptions,
): Promise<StepResult> {
  const { days = 30, pushToRemote = true } = opts;
  const step = 'compact-beads';

  // Check if bd CLI is available
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return stepSkipped(step, ['bd CLI not available']);
  }

  // Check if .beads directory exists
  const stateHome = resolveStateReadHomeSync({ name: ctx.projectName ?? ctx.projectPath, path: ctx.projectPath });
  const operationRoot = stateHome.root;
  const beadsDir = join(operationRoot, '.beads');
  if (!existsSync(beadsDir)) {
    return stepSkipped(step, ['No .beads directory in project']);
  }

  // Count old closed beads
  const { stdout: countOutput } = await execAsync(
    `bd list --status closed --json 2>/dev/null | jq '[.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > (${days} * 24 * 60 * 60))] | length' 2>/dev/null || echo "0"`,
    { cwd: operationRoot, encoding: 'utf-8' },
  );

  const count = parseInt(countOutput.trim(), 10) || 0;
  if (count === 0) {
    return stepSkipped(step, ['No closed beads older than ' + days + ' days']);
  }

  // Run compaction
  await execAsync(`bd admin compact --days ${days}`, {
    cwd: operationRoot,
    encoding: 'utf-8',
  });

  if (stateHome.migrated) {
    const { flushAutoCommits, queueBeadsAutoCommit } = await import('../pan-dir/auto-commit.js');
    queueBeadsAutoCommit(ctx.projectPath);
    const result = await Effect.runPromise(flushAutoCommits(ctx.projectPath));
    return result.committed
      ? stepOk(step, [`Compacted ${count} closed beads and committed through overdeck-state`])
      : stepFailed(step, `Compacted beads but state write door refused commit: ${result.reason ?? 'unknown'}`);
  }

  // Legacy compatibility: pre-migration projects still commit on main.
  await execAsync('git add .beads/', { cwd: ctx.projectPath, encoding: 'utf-8' });

  // Check if there are changes to commit
  try {
    await execAsync('git diff --cached --quiet', { cwd: ctx.projectPath, encoding: 'utf-8' });
    // No changes after compaction
    return stepOk(step, [`Compacted ${count} beads (no git changes)`]);
  } catch {
    // There are staged changes — commit them
    await execAsync(
      `git commit -m "chore: compact beads (remove closed issues > ${days} days)"`,
      { cwd: ctx.projectPath, encoding: 'utf-8' },
    );
    if (pushToRemote) {
      await execAsync('git push', { cwd: ctx.projectPath, encoding: 'utf-8' });
    }
    return stepOk(step, [`Compacted ${count} closed beads and committed`]);
  }
}
