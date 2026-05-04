/**
 * Feedback Writer — writes specialist feedback to workspace files.
 *
 * All specialist feedback (review, test, merge) is written to
 * .planning/feedback/ in the workspace, with a breadcrumb appended to the
 * scope continue file's sessionHistory. The work agent reads these on
 * startup or after crash recovery.
 *
 * All I/O is async (fs/promises) — never execSync.
 */

import { writeFile, mkdir, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolveProjectFromIssue } from '../projects.js';
import { appendContinueSessionEntryForIssue, appendFeedbackEntryForIssue, clearFeedbackForIssue } from '../vbrief/lifecycle-io.js';

export interface WriteFeedbackOptions {
  issueId: string;
  workspacePath?: string;
  specialist: 'verification-gate' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent' | 'merge-agent';
  outcome: string;
  summary: string;
  markdownBody: string;
}

export interface WriteFeedbackResult {
  success: boolean;
  /** Relative path from workspace root */
  relativePath?: string;
  /** Absolute path */
  filePath?: string;
  error?: string;
}

/**
 * Resolve workspace path from an issue ID.
 */
function resolveWorkspacePath(issueId: string): string | null {
  const resolved = resolveProjectFromIssue(issueId);
  if (!resolved) return null;

  const wsPath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  return existsSync(wsPath) ? wsPath : null;
}

/**
 * Get the next sequence number from existing files in the feedback directory.
 */
async function getNextSequenceNumber(feedbackDir: string): Promise<number> {
  try {
    const files = await readdir(feedbackDir);
    let max = 0;
    for (const file of files) {
      const match = file.match(/^(\d{3})-/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  } catch {
    return 1;
  }
}

/**
 * Clear existing feedback files from a previous review cycle.
 *
 * Deletes all NNN-*.md files in .planning/feedback/ (and any legacy
 * .planning/feedback/archive/ directory left over from the old archive-based
 * implementation). Feedback has no value once the work agent has consumed it
 * — there's no history we want to preserve here. See
 * docs/REVIEW-AGENT-ARCHITECTURE.md.
 */
export async function clearFeedbackFiles(workspacePath: string): Promise<void> {
  const feedbackDir = join(workspacePath, '.planning', 'feedback');

  // Also clear the continue file's feedback[] (Layer 1+).
  // Infer issueId from the workspace directory name (feature-<issue-id>).
  const base = workspacePath.split('/').pop() ?? '';
  const issueMatch = base.match(/^feature-([a-z]+-\d+)$/i);
  if (issueMatch) {
    const issueId = issueMatch[1].toUpperCase();
    const projectRoot = join(workspacePath, '..', '..');
    try {
      clearFeedbackForIssue(projectRoot, issueId);
    } catch (err: any) {
      console.error(`[feedback-writer] Failed to clear continue-file feedback[] for ${issueId}:`, err.message);
    }
  }

  if (!existsSync(feedbackDir)) return;

  const files = await readdir(feedbackDir);
  const feedbackFiles = files.filter(f => /^\d{3}-/.test(f) && f.endsWith('.md'));

  for (const file of feedbackFiles) {
    try {
      await rm(join(feedbackDir, file), { force: true });
    } catch (err: any) {
      console.error(`[feedback-writer] Failed to delete ${file}:`, err.message);
    }
  }

  // Legacy: older versions moved feedback into .planning/feedback/archive/.
  // Nuke that tree too — we no longer keep an archive.
  const legacyArchiveDir = join(feedbackDir, 'archive');
  if (existsSync(legacyArchiveDir)) {
    try {
      await rm(legacyArchiveDir, { recursive: true, force: true });
    } catch (err: any) {
      console.error(`[feedback-writer] Failed to remove legacy archive dir:`, err.message);
    }
  }

  if (feedbackFiles.length > 0) {
    console.log(`[feedback-writer] Cleared ${feedbackFiles.length} feedback file(s) from previous cycle`);
  }
}

/**
 * @deprecated Alias kept for backward compatibility with in-flight code paths.
 * Prefer `clearFeedbackFiles` directly.
 */
export const archiveFeedbackFiles = clearFeedbackFiles;

/**
 * Write specialist feedback to a file in the workspace and record a
 * breadcrumb on the scope vBRIEF's continue file.
 */
export async function writeFeedbackFile(opts: WriteFeedbackOptions): Promise<WriteFeedbackResult> {
  // Validate workspacePath — reject project roots (must contain /workspaces/ or have .planning dir)
  let providedPath = opts.workspacePath;
  if (providedPath && !existsSync(join(providedPath, '.planning')) && !providedPath.includes('/workspaces/')) {
    // Looks like a project root, not a workspace — fall back to resolution
    providedPath = undefined;
  }

  // Guard: if the provided path looks like a workspace but the issue ID doesn't match the
  // directory name, fall back to canonical resolution. This catches routing mismatches where
  // e.g. PAN-645's feedback would be written into feature-pan-647's directory.
  if (providedPath?.includes('/workspaces/feature-')) {
    const dirName = providedPath.replace(/.*\/workspaces\/feature-/, '').replace(/\/.*$/, '');
    const expectedSuffix = opts.issueId.toLowerCase();
    if (!dirName.includes(expectedSuffix) && !expectedSuffix.replace(/^[a-z]+-/, '').includes(dirName)) {
      console.error(
        `[feedback-writer] MISMATCH: issueId=${opts.issueId} but workspacePath points to feature-${dirName} — falling back to canonical resolution`
      );
      providedPath = undefined;
    }
  }

  const workspacePath = providedPath || resolveWorkspacePath(opts.issueId);
  if (!workspacePath) {
    return { success: false, error: `Workspace not found for ${opts.issueId}` };
  }

  const planningDir = join(workspacePath, '.planning');
  const feedbackDir = join(planningDir, 'feedback');

  try {
    await mkdir(feedbackDir, { recursive: true });

    const seq = await getNextSequenceNumber(feedbackDir);
    const seqStr = String(seq).padStart(3, '0');
    const filename = `${seqStr}-${opts.specialist}-${opts.outcome}.md`;
    const filePath = join(feedbackDir, filename);
    const relativePath = `.planning/feedback/${filename}`;

    const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const shortTimestamp = timestamp.replace(/:\d{2}Z$/, 'Z');

    const content = [
      '---',
      `specialist: ${opts.specialist}`,
      `issueId: ${opts.issueId}`,
      `outcome: ${opts.outcome}`,
      `timestamp: ${timestamp}`,
      '---',
      '',
      opts.markdownBody,
      '',
    ].join('\n');

    await writeFile(filePath, content, 'utf-8');

    // Write to the scope vBRIEF's continue file: structured feedback entry
    // (Layer 1+) and a sessionHistory breadcrumb for the timeline.
    const resolved = resolveProjectFromIssue(opts.issueId);
    if (resolved) {
      try {
        appendFeedbackEntryForIssue(resolved.projectPath, opts.issueId, {
          seq,
          specialist: opts.specialist,
          outcome: opts.outcome,
          timestamp,
          markdownBody: opts.markdownBody,
        });
      } catch (err: any) {
        console.error(
          `[feedback-writer] Failed to append continue-file feedback entry for ${opts.issueId}:`,
          err.message,
        );
      }
      try {
        appendContinueSessionEntryForIssue(resolved.projectPath, opts.issueId, {
          reason: 'feedback',
          note: `[${shortTimestamp}] ${opts.specialist} → ${opts.outcome.toUpperCase()} — ${relativePath}`,
        });
      } catch (err: any) {
        // Non-fatal — the markdown file is still written.
        console.error(
          `[feedback-writer] Failed to append continue-file breadcrumb for ${opts.issueId}:`,
          err.message,
        );
      }
    }

    console.log(`[feedback-writer] Wrote ${relativePath} for ${opts.issueId}`);
    return { success: true, relativePath, filePath };
  } catch (error: any) {
    console.error(`[feedback-writer] Failed to write feedback for ${opts.issueId}:`, error);
    return { success: false, error: error.message };
  }
}
