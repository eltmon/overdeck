/**
 * Feedback Writer — writes specialist feedback to the scope vBRIEF continue
 * file and mirrors it into workspace `.pan/feedback/` for agent consumption.
 *
 * All I/O is async (fs/promises) — never execSync.
 */

import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { resolveProjectFromIssue } from '../projects.js';
import { clearFeedback, getWorkspacePanPaths, readFeedback, writeFeedback } from '../pan-dir/index.js';
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
 * Deletes all NNN-*.md files in workspace `.pan/feedback/`.
 */
export async function clearFeedbackFiles(workspacePath: string): Promise<void> {
  const { feedbackDir } = getWorkspacePanPaths(workspacePath);

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

  let clearedCount = 0;
  if (existsSync(feedbackDir)) {
    const feedbackFiles = readFeedback(workspacePath).filter(f => /^\d{3}-/.test(f.filename) && f.filename.endsWith('.md'));
    try {
      clearFeedback(workspacePath);
      clearedCount += feedbackFiles.length;
    } catch (err: any) {
      console.error(`[feedback-writer] Failed to clear .pan/feedback for ${workspacePath}:`, err.message);
    }
  }


  if (clearedCount > 0) {
    console.log(`[feedback-writer] Cleared ${clearedCount} feedback file(s) from previous cycle`);
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
 * (Layer 3+) with workspace mirrors in `.pan/feedback/`.
 */
export async function writeFeedbackFile(opts: WriteFeedbackOptions): Promise<WriteFeedbackResult> {
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const shortTimestamp = timestamp.replace(/:\d{2}Z$/, 'Z');

  const resolved = resolveProjectFromIssue(opts.issueId);
  if (!resolved) {
    return { success: false, error: `Project not found for ${opts.issueId}` };
  }

  // Derive sequence number from continue-file feedback first, then keep the
  // workspace mirror numbering aligned if feedback files already exist.
  let seq = 1;
  try {
    const existing = readContinueStateForIssue(resolved.projectPath, opts.issueId);
    seq = (existing?.feedback?.length ?? 0) + 1;
  } catch { /* fall back to 1 */ }

  const workspacePath = opts.workspacePath || resolveWorkspacePath(opts.issueId);
  if (workspacePath) {
    const { feedbackDir } = getWorkspacePanPaths(workspacePath);
    if (existsSync(feedbackDir)) {
      const fsSeq = await getNextSequenceNumber(feedbackDir);
      if (fsSeq > seq) seq = fsSeq;
    }
  }

  const seqStr = String(seq).padStart(3, '0');
  const filename = `${seqStr}-${opts.specialist}-${opts.outcome}.md`;
  const relativePath = `.pan/feedback/${filename}`;
  const filePath = workspacePath ? join(getWorkspacePanPaths(workspacePath).feedbackDir, filename) : undefined;

  // Write to the scope vBRIEF's continue file (primary store, Layer 3+).
  //
  // Best-effort: if a single malformed vBRIEF on main (e.g. one missing a
  // valid root status) makes appendFeedbackEntryForIssue throw, do NOT abort
  // the whole feedback delivery. The workspace mirror at .pan/feedback/NNN-*.md
  // is what the agent reads, and the messageAgent call is what nudges it to
  // read. Aborting here on a continue-state error blocks feedback for every
  // issue in the project just because one unrelated spec is malformed
  // (observed PAN-977 cycle: PAN-1015 spec was bad → review CHANGES_REQUESTED
  // never reached the work agent → agent sat idle waiting).
  let continueStateWritten = false;
  try {
    appendFeedbackEntryForIssue(resolved.projectPath, opts.issueId, {
      seq,
      specialist: opts.specialist,
      outcome: opts.outcome,
      timestamp,
      markdownBody: opts.markdownBody,
    });
    continueStateWritten = true;
  } catch (err: any) {
    console.error(
      `[feedback-writer] Failed to append continue-file feedback entry for ${opts.issueId} (non-fatal — will still write workspace mirror):`,
      err.message,
    );
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

  if (workspacePath) {
    try {
      writeFeedback(workspacePath, filename, opts.markdownBody);
    } catch (err: any) {
      console.error(`[feedback-writer] Failed to mirror feedback file for ${opts.issueId}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  console.log(
    `[feedback-writer] Wrote feedback seq ${seq} for ${opts.issueId} (${opts.specialist} → ${opts.outcome})${continueStateWritten ? '' : ' [continue-state skipped]'}`,
  );
  return { success: true, relativePath, filePath };
}
