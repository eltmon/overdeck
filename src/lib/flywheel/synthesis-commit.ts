/**
 * Synthesis commit + push helper (PAN-709, bead 5v4)
 *
 * After synthesis finishes (issues filed, report appended, retros archived),
 * commits the diff to main and pushes. Skips cleanly if working tree is unchanged.
 *
 * Commit message: `flywheel: run N — <count> issues filed, <count> watchlisted`
 */

import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';

const execFileAsync = promisify(execFile);

const DOCS_DIR = join(homedir(), 'docs');

export interface SynthesisCommitOptions {
  runNumber: number;
  issuesFiled: number;
  watchlisted: number;
  /** Override the docs directory (for testing). Default: ~/docs */
  docsDir?: string;
}

export interface SynthesisCommitResult {
  committed: boolean;
  pushed: boolean;
  commitSha?: string;
  message?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Commit and push the synthesis diff.
 *
 * Adds all changes to docs/flywheel/ and docs/FLYWHEEL-REPORT.md,
 * commits with a canonical message, and pushes to origin.
 * If the working tree is unchanged, skips cleanly with skipped=true.
 */
export async function commitSynthesisRun(options: SynthesisCommitOptions): Promise<SynthesisCommitResult> {
  const docsDir = options.docsDir ?? DOCS_DIR;
  const { runNumber, issuesFiled, watchlisted } = options;

  const commitMessage = `flywheel: run ${runNumber} — ${issuesFiled} issue${issuesFiled === 1 ? '' : 's'} filed, ${watchlisted} watchlisted`;

  // Check if there are any changes to commit
  const { stdout: statusOut } = await execFileAsync('git', [
    '-C', docsDir,
    'status', '--porcelain',
    'flywheel/', 'FLYWHEEL-REPORT.md',
  ]).catch(() => ({ stdout: '' }));

  if (!statusOut.trim()) {
    return {
      committed: false,
      pushed: false,
      skipped: true,
      skipReason: 'Working tree is unchanged — synthesis is a no-op',
    };
  }

  try {
    // Stage flywheel changes + FLYWHEEL-REPORT.md
    await execFileAsync('git', [
      '-C', docsDir,
      'add',
      'flywheel/',
      'FLYWHEEL-REPORT.md',
    ]);

    // Commit
    const { stdout: commitOut } = await execFileAsync('git', [
      '-C', docsDir,
      'commit', '-m', commitMessage,
    ]);

    const shaMatch = commitOut.match(/\[.*?\s+([0-9a-f]{7,40})\]/);
    const commitSha = shaMatch ? shaMatch[1] : undefined;

    // Push
    let pushed = false;
    try {
      await execFileAsync('git', ['-C', docsDir, 'push', 'origin', 'HEAD']);
      pushed = true;
    } catch (pushErr: any) {
      console.warn(`[synthesis-commit] Push failed (non-fatal): ${pushErr?.message}`);
    }

    return {
      committed: true,
      pushed,
      commitSha,
      message: commitMessage,
    };
  } catch (err: any) {
    throw new Error(`Synthesis commit failed: ${err?.message}`);
  }
}
