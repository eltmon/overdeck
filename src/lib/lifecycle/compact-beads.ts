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
import type { LifecycleContext, StepResult } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';

const execAsync = promisify(exec);

/** Options for beads compaction */
export interface CompactBeadsOptions {
  /** Number of days to keep closed beads. Default: 30 */
  days?: number;
}

/**
 * Compact closed beads older than N days.
 * Idempotent — returns skip if no beads to compact.
 */
export async function compactBeads(
  ctx: LifecycleContext,
  opts: CompactBeadsOptions = {},
): Promise<StepResult> {
  const { days = 30 } = opts;
  const step = 'compact-beads';

  // Check if bd CLI is available
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return stepSkipped(step, ['bd CLI not available']);
  }

  // Check if .beads directory exists
  const beadsDir = join(ctx.projectPath, '.beads');
  if (!existsSync(beadsDir)) {
    return stepSkipped(step, ['No .beads directory in project']);
  }

  // Count old closed beads
  try {
    const { stdout: countOutput } = await execAsync(
      `bd list --status closed --json 2>/dev/null | jq '[.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > (${days} * 24 * 60 * 60))] | length' 2>/dev/null || echo "0"`,
      { cwd: ctx.projectPath, encoding: 'utf-8' },
    );

    const count = parseInt(countOutput.trim(), 10) || 0;
    if (count === 0) {
      return stepSkipped(step, ['No closed beads older than ' + days + ' days']);
    }

    // Run compaction
    await execAsync(`bd admin compact --days ${days}`, {
      cwd: ctx.projectPath,
      encoding: 'utf-8',
    });

    // Beads are ephemeral (derived from vBRIEF) — no git commit needed
    return stepOk(step, [`Compacted ${count} closed beads`]);
  } catch (err) {
    return stepFailed(step, `Beads compaction failed: ${(err as Error).message}`);
  }
}
