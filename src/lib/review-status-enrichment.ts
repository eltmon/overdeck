import { existsSync } from 'fs';
import { join } from 'path';
import { listSessionNamesAsync } from './tmux.js';
import { resolveProjectFromIssue } from './projects.js';
import type { ReviewStatus } from './review-status.js';

export interface EnrichedReviewStatus extends ReviewStatus {
  reviewCoordinatorSessionName?: string;
  reviewSessionNames?: string[];
  reviewSubStatuses?: Record<string, 'running' | 'done'>;
}

function parseTrailingTimestamp(prefix: string, sessionName: string): number | null {
  if (!sessionName.startsWith(prefix)) return null;
  const value = Number(sessionName.slice(prefix.length));
  return Number.isFinite(value) ? value : null;
}

function parseReviewerTimestamp(prefix: string, sessionName: string): number | null {
  if (!sessionName.startsWith(prefix)) return null;
  const rest = sessionName.slice(prefix.length);
  const dashIdx = rest.indexOf('-');
  if (dashIdx <= 0) return null;
  const value = Number(rest.slice(0, dashIdx));
  return Number.isFinite(value) ? value : null;
}

function mostRecentByTimestamp(
  sessionNames: string[],
  parseTimestamp: (sessionName: string) => number | null,
): string | undefined {
  let latest: { name: string; timestamp: number } | undefined;
  for (const name of sessionNames) {
    const timestamp = parseTimestamp(name);
    if (timestamp === null) continue;
    if (!latest || timestamp > latest.timestamp) {
      latest = { name, timestamp };
    }
  }
  return latest?.name;
}

/**
 * Discover active parallel review tmux sessions for an issue and, for each,
 * check whether the reviewer's output file has been written (done) or not (running).
 * Used at both REST-endpoint response time and domain-event emission time so the
 * frontend Zustand store carries the session list for the TerminalTabs component.
 */
export async function enrichReviewStatus(
  issueId: string,
  status: ReviewStatus,
): Promise<EnrichedReviewStatus> {
  let allSessions: string[] = [];
  try {
    allSessions = await listSessionNamesAsync();
  } catch {
    return status;
  }
  return enrichReviewStatusFromSessions(issueId, status, allSessions);
}

/**
 * Batch variant — caller supplies the tmux session list (one tmux call for N issues).
 * Used by the snapshot bootstrap to avoid per-issue tmux calls on client connect.
 *
 * PAN-915 — defensive fallback only. Event-driven reducers (`review.reviewer_started`
 * / `review.reviewer_completed` / `review.coordinator_started`) are now the
 * primary source of `reviewSubStatuses` and `reviewSessionNames`. This function
 * runs during snapshot rebuild to backfill state for sessions that pre-date
 * the events (e.g. server restart with reviewers already running).
 *
 * Recognizes two reviewer session naming schemes:
 *   - PAN-830 canonical:  `specialist-<projectKey>-<issueId>-review-<role>`
 *   - Legacy (timestamped): `review-<issueId>-<timestamp>-<role>`
 */
export function enrichReviewStatusFromSessions(
  issueId: string,
  status: ReviewStatus,
  allSessions: string[],
): EnrichedReviewStatus {
  const normalizedIssueId = issueId.toUpperCase();
  const legacyReviewerPrefix = `review-${normalizedIssueId}-`;
  const coordinatorPrefix = `review-coordinator-${normalizedIssueId}-`;
  const reviewCoordinatorSessionName = mostRecentByTimestamp(
    allSessions.filter(s => s.startsWith(coordinatorPrefix)),
    (sessionName) => parseTrailingTimestamp(coordinatorPrefix, sessionName),
  );

  // PAN-830 canonical pattern: specialist-<projectKey>-<issueId>-review-<role>
  // (issueId case is preserved from caller — match case-insensitively)
  const resolved = resolveProjectFromIssue(issueId);
  const projectKey = resolved?.projectKey ?? null;
  const canonicalSessions = projectKey
    ? allSessions.filter(s => {
        const lower = s.toLowerCase();
        const expectedPrefix = `specialist-${projectKey.toLowerCase()}-${issueId.toLowerCase()}-review-`;
        return lower.startsWith(expectedPrefix);
      })
    : [];

  // Legacy pattern (PAN-821 and earlier): review-<issueId>-<timestamp>-<role>
  // Filter by coordinator-excluded prefix and pick only the most recent round.
  let legacySessions = allSessions
    .filter(s => s.startsWith(legacyReviewerPrefix))
    .filter(s => !s.startsWith(coordinatorPrefix));
  if (legacySessions.length > 0) {
    const latestReviewerSession = mostRecentByTimestamp(
      legacySessions,
      (sessionName) => parseReviewerTimestamp(legacyReviewerPrefix, sessionName),
    );
    const latestTs = latestReviewerSession
      ? parseReviewerTimestamp(legacyReviewerPrefix, latestReviewerSession)
      : null;
    if (latestTs !== null) {
      legacySessions = legacySessions.filter(
        s => parseReviewerTimestamp(legacyReviewerPrefix, s) === latestTs,
      );
    }
  }

  const reviewSessionNames = [...canonicalSessions, ...legacySessions];
  if (reviewSessionNames.length === 0 && !reviewCoordinatorSessionName) return { ...status };

  let reviewSubStatuses: Record<string, 'running' | 'done'> | undefined;
  try {
    if (resolved) {
      const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
      reviewSubStatuses = {};
      // Canonical sessions: role is the last `-review-<role>` segment. Output
      // file location for canonical sessions can't be derived here (it's keyed
      // by the per-round reviewId), so we treat presence-without-event as
      // 'running' and rely on the event reducer to flip it to 'done'.
      for (const sessionName of canonicalSessions) {
        const idx = sessionName.lastIndexOf('-review-');
        const role = idx >= 0 ? sessionName.slice(idx + '-review-'.length) : 'review';
        // Don't clobber a 'done' state already set by the event reducer.
        const existing = (status as EnrichedReviewStatus).reviewSubStatuses?.[role];
        reviewSubStatuses[role] = existing === 'done' ? 'done' : 'running';
      }
      // Legacy sessions: derive output file from session name and check existence.
      for (const sessionName of legacySessions) {
        const parts = sessionName.split('-');
        const role = parts[parts.length - 1] || 'review';
        const reviewRunId = parts.slice(0, -1).join('-');
        const outputFile = join(workspacePath, '.pan', 'review', reviewRunId, `${role}.md`);
        reviewSubStatuses[role] = existsSync(outputFile) ? 'done' : 'running';
      }
    }
  } catch {
    // non-fatal
  }

  return {
    ...status,
    reviewCoordinatorSessionName: reviewCoordinatorSessionName ?? (status as EnrichedReviewStatus).reviewCoordinatorSessionName,
    reviewSessionNames: reviewSessionNames.length > 0 ? reviewSessionNames : undefined,
    reviewSubStatuses,
  };
}
