/**
 * Feedback Writer — writes specialist feedback to the scope vBRIEF continue
 * file and (for backward compat) cleans up legacy .planning/feedback/ files.
 *
 * All I/O is async (fs/promises) — never execSync.
 */

import { readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolveProjectFromIssue } from '../projects.js';
import { appendContinueSessionEntryForIssue, appendFeedbackEntryForIssue, clearFeedbackForIssue, readContinueStateForIssue } from '../vbrief/lifecycle-io.js';

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
 * Write specialist feedback to the scope vBRIEF continue file and record a
 * sessionHistory breadcrumb. The primary data store is the continue file
 * (Layer 3+); .planning/feedback/*.md files are no longer written.
 */
export async function writeFeedbackFile(opts: WriteFeedbackOptions): Promise<WriteFeedbackResult> {
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const shortTimestamp = timestamp.replace(/:\d{2}Z$/, 'Z');

  const resolved = resolveProjectFromIssue(opts.issueId);
  if (!resolved) {
    return { success: false, error: `Project not found for ${opts.issueId}` };
  }

  // Derive sequence number from continue file (primary), synced with any
  // legacy filesystem files for consistent numbering during transition.
  let seq = 1;
  try {
    const existing = readContinueStateForIssue(resolved.projectPath, opts.issueId);
    seq = (existing?.feedback?.length ?? 0) + 1;
  } catch { /* fall back to 1 */ }

  const workspacePath = opts.workspacePath || resolveWorkspacePath(opts.issueId);
  if (workspacePath) {
    const feedbackDir = join(workspacePath, '.planning', 'feedback');
    if (existsSync(feedbackDir)) {
      const fsSeq = await getNextSequenceNumber(feedbackDir);
      if (fsSeq > seq) seq = fsSeq;
    }
  }

  const seqStr = String(seq).padStart(3, '0');
  const filename = `${seqStr}-${opts.specialist}-${opts.outcome}.md`;
  const relativePath = `.planning/feedback/${filename}`;

  // Write to the scope vBRIEF's continue file (primary store, Layer 3+).
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
    return { success: false, error: err.message };
  }
  try {
    appendContinueSessionEntryForIssue(resolved.projectPath, opts.issueId, {
      reason: 'feedback',
      note: `[${shortTimestamp}] ${opts.specialist} → ${opts.outcome.toUpperCase()} — seq ${seq}`,
    });
  } catch (err: any) {
    console.error(
      `[feedback-writer] Failed to append continue-file breadcrumb for ${opts.issueId}:`,
      err.message,
    );
  }

  console.log(`[feedback-writer] Wrote feedback seq ${seq} for ${opts.issueId} (${opts.specialist} → ${opts.outcome})`);
  return { success: true, relativePath };
}
