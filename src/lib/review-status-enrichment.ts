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
 */
export function enrichReviewStatusFromSessions(
  issueId: string,
  status: ReviewStatus,
  allSessions: string[],
): EnrichedReviewStatus {
  const normalizedIssueId = issueId.toUpperCase();
  const reviewerPrefix = `review-${normalizedIssueId}-`;
  const coordinatorPrefix = `review-coordinator-${normalizedIssueId}-`;
  const reviewCoordinatorSessionName = mostRecentByTimestamp(
    allSessions.filter(s => s.startsWith(coordinatorPrefix)),
    (sessionName) => parseTrailingTimestamp(coordinatorPrefix, sessionName),
  );

  let reviewSessionNames = allSessions.filter(s => s.startsWith(reviewerPrefix));
  if (reviewSessionNames.length > 0) {
    const latestReviewerSession = mostRecentByTimestamp(
      reviewSessionNames,
      (sessionName) => parseReviewerTimestamp(reviewerPrefix, sessionName),
    );
    const latestTs = latestReviewerSession
      ? parseReviewerTimestamp(reviewerPrefix, latestReviewerSession)
      : null;
    if (latestTs !== null) {
      reviewSessionNames = reviewSessionNames.filter(
        s => parseReviewerTimestamp(reviewerPrefix, s) === latestTs,
      );
    }
  }
  if (reviewSessionNames.length === 0 && !reviewCoordinatorSessionName) return { ...status };

  let reviewSubStatuses: Record<string, 'running' | 'done'> | undefined;
  try {
    const resolved = resolveProjectFromIssue(issueId);
    if (resolved) {
      const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
      reviewSubStatuses = {};
      for (const sessionName of reviewSessionNames) {
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
    reviewCoordinatorSessionName,
    reviewSessionNames: reviewSessionNames.length > 0 ? reviewSessionNames : undefined,
    reviewSubStatuses,
  };
}
