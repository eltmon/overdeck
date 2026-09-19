/**
 * Shared workspace state reset logic for issue reopen.
 *
 * Called by both the CLI `pan reopen` command and the dashboard
 * `POST /api/issues/:id/reopen` endpoint to ensure consistent behavior.
 *
 * PAN-3917: reopening used to rewrite a `review_status` row back to `pending`
 * across a dozen mirrored fields. Every one of those fields is now derived from
 * the tracker and the PR, and reopening the tracker issue (plus closing the old
 * PR) is what changes them. What is left here is the state Overdeck does own:
 * the issue-closed cache and the scope xBRIEF's continue-file breadcrumb.
 *
 * All filesystem I/O uses fs/promises so this is safe on the dashboard event loop.
 */

import { Data, Effect } from 'effect';
import { appendContinueSessionEntryForIssue } from './xbrief/lifecycle-io.js';
import { resolveProjectFromIssueSync } from './projects.js';
import { clearIssueClosedCache } from './cloister/issue-closed.js';

export interface ReopenResult {
  /** True when a `reason: 'resume'` entry was appended to the continue file. */
  continueFileUpdated: boolean;
  reason?: string;
}

export interface ReopenOptions {
  reason?: string;
  trackerContext?: string;
}

async function reopenWorkspaceStatePromise(
  issueId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspacePath: string | null,
  options: ReopenOptions = {}
): Promise<ReopenResult> {
  const result: ReopenResult = {
    continueFileUpdated: false,
    reason: options.reason,
  };

  clearIssueClosedCache(issueId);

  const resolved = resolveProjectFromIssueSync(issueId);
  if (resolved) {
    try {
      const noteParts: string[] = [`Reopened on ${new Date().toISOString().slice(0, 10)}`];
      if (options.reason) noteParts.push(`reason: ${options.reason}`);
      if (options.trackerContext) noteParts.push('tracker context attached');

      appendContinueSessionEntryForIssue(resolved.projectPath, issueId, {
        reason: 'resume',
        note: noteParts.join('; '),
      });
      result.continueFileUpdated = true;
    } catch {
      // Non-fatal — the issue-closed cache was still cleared above.
    }
  }

  return result;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for reopen Effect variants. */
export class ReopenError extends Data.TaggedError('ReopenError')<{
  readonly issueId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `reopenWorkspaceState`. */
export const reopenWorkspaceState = (
  issueId: string,
  workspacePath: string | null,
  options: ReopenOptions = {},
): Effect.Effect<ReopenResult, ReopenError> =>
  Effect.tryPromise({
    try: () => reopenWorkspaceStatePromise(issueId, workspacePath, options),
    catch: (cause) =>
      new ReopenError({
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
