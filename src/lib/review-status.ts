import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { notifyPipeline } from './pipeline-notifier.js';
import {
  upsertReviewStatus as dbUpsert,
  deleteReviewStatus as dbDelete,
  getReviewStatusFromDb,
  getAllReviewStatusesFromDb,
} from './database/review-status-db.js';
import { normalizeReviewStatus } from './review-status-normalize.js';

export interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge' | 'inspect' | 'uat';
  status: string;
  timestamp: string;
  notes?: string;
}

export interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed';
  inspectNotes?: string;
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  uatNotes?: string;
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  mergeNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  prUrl?: string;
  history?: StatusHistoryEntry[];
  /** HEAD commit SHA at the time review passed — used to detect new commits after review */
  reviewedAtCommit?: string;
}

const DEFAULT_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

export function loadReviewStatuses(filePath = DEFAULT_STATUS_FILE): Record<string, ReviewStatus> {
  // Prefer SQLite when using the default path
  if (filePath === DEFAULT_STATUS_FILE) {
    try {
      return getAllReviewStatusesFromDb();
    } catch {
      // Fall through to JSON on DB error
    }
  }

  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load review statuses:', err);
  }
  return {};
}

export function saveReviewStatuses(statuses: Record<string, ReviewStatus>, filePath = DEFAULT_STATUS_FILE): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(statuses, null, 2));
  } catch (err) {
    console.error('Failed to save review statuses:', err);
  }
}

export function setReviewStatus(
  issueId: string,
  update: Partial<ReviewStatus>,
  filePath = DEFAULT_STATUS_FILE,
): ReviewStatus {
  const statuses = loadReviewStatuses(filePath);
  const existing = statuses[issueId] || {
    issueId,
    reviewStatus: 'pending' as const,
    testStatus: 'pending' as const,
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
  };

  // Guard: reject reviewStatus regression from 'passed' to 'reviewing' unless the caller
  // is explicitly resetting the merge lifecycle (update includes mergeStatus).
  // This is belt-and-suspenders — endpoint-level guards should catch this first.
  if (update.reviewStatus === 'reviewing' && existing.reviewStatus === 'passed' && update.mergeStatus === undefined) {
    console.warn(`[review-status] Rejecting reviewStatus regression from 'passed' to 'reviewing' for ${issueId} (mergeStatus not being reset)`);
    return existing as ReviewStatus;
  }

  const merged = { ...existing, ...update };

  // Track status transitions in history (last 10 entries)
  const history = [...(existing.history || [])];
  const now = new Date().toISOString();
  if (update.reviewStatus && update.reviewStatus !== existing.reviewStatus) {
    history.push({ type: 'review', status: update.reviewStatus, timestamp: now, notes: update.reviewNotes });
  }
  if (update.testStatus && update.testStatus !== existing.testStatus) {
    history.push({ type: 'test', status: update.testStatus, timestamp: now, notes: update.testNotes });
  }
  if (update.uatStatus && update.uatStatus !== existing.uatStatus) {
    history.push({ type: 'uat', status: update.uatStatus, timestamp: now, notes: update.uatNotes });
  }
  if (update.mergeStatus && update.mergeStatus !== existing.mergeStatus) {
    history.push({ type: 'merge', status: update.mergeStatus, timestamp: now });
  }
  while (history.length > 10) history.shift();

  // readyForMerge is true when all required gates pass.
  // If uatStatus exists (UAT specialist has been involved), it must also be 'passed'.
  // verificationStatus must not be 'failed' — verification catches pre-existing test breakage
  // that scoped test runs (e2e/dashboard) may miss.
  const readyForMerge = update.readyForMerge !== undefined
    ? update.readyForMerge
    : (
        merged.reviewStatus === 'passed' &&
        merged.testStatus === 'passed' &&
        merged.verificationStatus !== 'failed' &&
        merged.mergeStatus !== 'merged' &&
        // If UAT has been initiated, it must pass too
        (merged.uatStatus === undefined || merged.uatStatus === 'passed')
      );

  const updated: ReviewStatus = normalizeReviewStatus({
    ...merged,
    issueId,
    updatedAt: now,
    readyForMerge,
    history,
  });

  // Report commit statuses to GitHub when readyForMerge transitions to true (PAN-536)
  if (readyForMerge && !existing.readyForMerge && updated.prUrl) {
    (async () => {
      try {
        const { isGitHubAppConfigured, reportCommitStatus } = await import('./github-app.js');
        if (!isGitHubAppConfigured()) return;
        const prMatch = updated.prUrl!.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
        if (!prMatch) return;
        const [, owner, repo] = prMatch;
        // Get HEAD SHA of the PR branch
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(
          `gh pr view ${updated.prUrl!.match(/\/pull\/(\d+)/)?.[1]} --json headRefOid --jq .headRefOid`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        const sha = stdout.trim();
        if (sha) {
          await reportCommitStatus(owner, repo, sha, 'success', 'panopticon/review', 'Review passed');
          await reportCommitStatus(owner, repo, sha, 'success', 'panopticon/test', 'Tests passed');
          console.log(`[review-status] Reported commit statuses for ${issueId} (${sha.slice(0, 8)})`);
        }
      } catch (err: any) {
        console.warn(`[review-status] Failed to report commit status: ${err.message}`);
      }
    })();
  }

  // SQLite first — it is the authoritative store (reads prefer SQLite)
  if (filePath === DEFAULT_STATUS_FILE) {
    try {
      dbUpsert(updated);
    } catch (err) {
      console.error('[review-status] SQLite write failed (continuing with JSON):', err);
    }
  }

  // JSON second — legacy fallback for tools that read review-status.json directly
  statuses[issueId] = updated;
  saveReviewStatuses(statuses, filePath);

  notifyPipeline({ type: 'status_changed', issueId, status: updated });

  // Queue test-agent when review transitions to 'passed'.
  // This fires regardless of how setReviewStatus() is called (API or direct import),
  // ensuring test-agent is queued even when review-agent bypasses the specialist
  // dispatch endpoint. Idempotent — if test-agent is already queued, pushToHook
  // deduplicates by issueId.
  if (
    update.reviewStatus === 'passed' &&
    existing.reviewStatus !== 'passed' &&
    existing.testStatus === 'pending'
  ) {
    (async () => {
      try {
        const { submitToSpecialistQueue } = await import('./cloister/specialists.js');
        const workAgentId = `agent-${issueId.toLowerCase()}`;
        const workStateFile = join(homedir(), '.panopticon', 'agents', workAgentId, 'state.json');
        let workspace: string | undefined;
        let branch: string | undefined;
        if (existsSync(workStateFile)) {
          try {
            const workState = JSON.parse(readFileSync(workStateFile, 'utf-8'));
            workspace = workState.workspace;
            branch = workState.branch || `feature/${issueId.toLowerCase()}`;
          } catch {}
        }
        submitToSpecialistQueue('test-agent', {
          priority: 'high',
          source: 'review-agent-auto',
          issueId,
          workspace,
          branch,
        });
        console.log(`[review-status] Queued test-agent for ${issueId} after review passed`);
      } catch (err: any) {
        console.warn(`[review-status] Failed to queue test-agent for ${issueId}: ${err.message}`);
      }
    })();
  }

  // Auto-deliver feedback to work agent when review blocks or tests fail.
  // This ensures feedback reaches the agent regardless of whether status was
  // set via the dashboard API or directly (e.g., bun -e import). See PAN-586.
  if (
    (update.reviewStatus === 'blocked' || update.testStatus === 'failed') &&
    (update.reviewStatus !== existing.reviewStatus || update.testStatus !== existing.testStatus)
  ) {
    const agentSession = `agent-${issueId.toLowerCase()}`;
    (async () => {
      try {
        const { sessionExists } = await import('./tmux.js');
        if (!sessionExists(agentSession)) return;

        const statusType = update.reviewStatus === 'blocked' ? 'REVIEW BLOCKED' : 'TESTS FAILED';
        const notes = update.reviewNotes || update.testNotes || 'No details provided.';
        const msg = `SPECIALIST FEEDBACK: ${statusType} for ${issueId}.\n\n${notes}\n\nFix the issues, then run: pan work done ${issueId}`;

        const { messageAgent } = await import('./agents.js');
        await messageAgent(agentSession, msg);
        console.log(`[review-status] Auto-delivered ${statusType} feedback to ${agentSession}`);
      } catch (err: any) {
        console.warn(`[review-status] Failed to auto-deliver feedback to ${agentSession}: ${err.message}`);
      }
    })();
  }

  return updated;
}

export function getReviewStatus(issueId: string, filePath = DEFAULT_STATUS_FILE): ReviewStatus | null {
  // Prefer SQLite when using the default path
  if (filePath === DEFAULT_STATUS_FILE) {
    try {
      const fromDb = getReviewStatusFromDb(issueId);
      if (fromDb) return fromDb;
    } catch {
      // Fall through to JSON on DB error
    }
  }
  const statuses = loadReviewStatuses(filePath);
  return statuses[issueId] || null;
}

/**
 * On server startup, clear any mergeStatus stuck at 'merging'.
 * Pending merge operations are in-memory only — they don't survive a restart.
 * Any 'merging' status after boot is definitionally stuck (PAN-490).
 */
export function clearStuckMergeStatuses(): void {
  const statuses = loadReviewStatuses();
  // Don't clear 'queued' — the SQLite merge queue handles that (PAN-632).
  // Only clear truly stuck transient states.
  const stuck = Object.values(statuses).filter(s =>
    s.mergeStatus === 'merging' || s.mergeStatus === 'verifying'
  );
  if (stuck.length === 0) return;
  console.log(`[review-status] Clearing ${stuck.length} stuck merge status(es) on startup (merging/verifying)`);
  for (const s of stuck) {
    // Reset to pending so MERGE button reappears — the in-memory queue was lost on restart.
    // Preserve readyForMerge if review+test both passed — the merge just needs to be retried.
    const shouldBeReady = s.reviewStatus === 'passed' && (s.testStatus === 'passed' || s.testStatus === 'skipped');
    setReviewStatus(s.issueId, {
      mergeStatus: 'pending',
      ...(shouldBeReady ? { readyForMerge: true } : {}),
    });
  }
}

export function clearReviewStatus(issueId: string, filePath = DEFAULT_STATUS_FILE): void {
  const statuses = loadReviewStatuses(filePath);
  delete statuses[issueId];
  saveReviewStatuses(statuses, filePath);

  // Dual-delete from SQLite when using the default path
  if (filePath === DEFAULT_STATUS_FILE) {
    try {
      dbDelete(issueId);
    } catch (err) {
      console.error('[review-status] SQLite delete failed (continuing with JSON):', err);
    }
  }
}
