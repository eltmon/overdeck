import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'path';
import { Effect } from 'effect';
import { getAgentRuntimeStateSync, getAgentStateSync, listRunningAgents } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import type { HeadAnchor } from '../git-utils.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { loadReviewStatuses, setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { getAllProjectSpecialistStatuses, getTmuxSessionName } from './specialists.js';
import { isPaneDead, sessionExistsSync } from '../tmux.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { evaluateReviewConvoyLiveness, reviewTimestampMs } from './review-convoy-liveness.js';
import { convergeRowFromVerdictOfRecord } from './verdict-restore.js';
import { recordReviewVerdict } from './review-verdict-writer.js';
import { deliverReviewVerdictFeedback } from './review-verdict-feedback.js';
import { findVerdictReport, findVerdictReportAsync, parseVerdictReport } from './review-verdict-report.js';

// ============================================================================
// Stuck review detection (PAN-733)
// ============================================================================

/**
 * Detect issues stuck in `reviewing` status with no active review session.
 *
 * When `spawnReviewRoleForIssue` sets `reviewing` + `reviewSpawnedAt` but the
 * spawn crashes or the review agent exits without updating status, the issue
 * can remain in `reviewing` forever. This check uses `reviewSpawnedAt` as a
 * heartbeat: if it's >30 minutes old and no review session is active, reset
 * to `pending` so deacon can retry dispatch on the next patrol.
 *
 * Guards:
 *   - Only fires when reviewStatus === 'reviewing' AND reviewSpawnedAt is set
 *   - Only resets if no active review session exists for the issue
 *   - 30-minute threshold avoids resetting legitimate long-running reviews
 */
export async function checkStuckReviewing(): Promise<string[]> {
  const actions: string[] = [];
  const REVIEW_STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  try {
    const { loadReviewStatuses, setReviewStatusSync } = await import('../review-status.js');
    const statuses = loadReviewStatuses();
    const now = Date.now();

    // Build set of issues with active review sessions
    const activeReviewIssues = new Set<string>();
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning) continue;
      const rState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue && projSpec.specialistType === 'review-agent') {
        activeReviewIssues.add(rState.currentIssue.toUpperCase());
      }
    }
    // Also check global review-agent
    const globalReviewSession = getTmuxSessionName('review-agent');
    if (sessionExistsSync(globalReviewSession)) {
      const rState = getAgentRuntimeStateSync(globalReviewSession);
      if (rState?.state === 'active' && rState.currentIssue) {
        activeReviewIssues.add(rState.currentIssue.toUpperCase());
      }
    }
    // Detect active review runs through the same liveness oracle used by
    // orphan reconciliation. A row latched to `running` is not sufficient.
    let reviewAgents: Parameters<typeof evaluateReviewConvoyLiveness>[2] = [];
    try {
      reviewAgents = await Effect.runPromise(listRunningAgents());
    } catch {
      // Non-fatal: fall back to specialist-only detection
    }

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'reviewing') continue;
      if (!status.reviewSpawnedAt) continue;
      const convoy = evaluateReviewConvoyLiveness(issueId, status, reviewAgents, now);
      if (activeReviewIssues.has(issueId.toUpperCase()) || convoy.active) continue;

      const spawnedAt = reviewTimestampMs(status.reviewSpawnedAt);
      if (!Number.isFinite(spawnedAt)) continue;
      if (now - spawnedAt < REVIEW_STUCK_THRESHOLD_MS) continue;

      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        reviewNotes: `Review reset by deacon: no active review session after ${Math.round((now - spawnedAt) / 60000)}min`,
      });
      const msg = `Reset stuck reviewing status for ${issueId} (no active session for ${Math.round((now - spawnedAt) / 60000)}min)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking stuck reviewing statuses:', msg);
  }

  return actions;
}

// ============================================================================
// Completed-but-unsignaled review detection
// ============================================================================

/**
 * Detect review specialists that wrote synthesis.md but never called
 * `pan specialists done review`. The review role prompt instructs the agent
 * to signal completion after writing the synthesis, but agents occasionally
 * forget (idle at prompt with reports already on disk). This leaves the
 * issue stuck in `reviewing` status forever.
 *
 * Recovery: read the synthesis verdict and nudge the review agent to signal
 * completion. If the agent session is dead, we auto-complete by updating the
 * review status directly so the pipeline isn't permanently blocked.
 *
 * Guards:
 *   - Only fires when reviewStatus === 'reviewing'
 *   - synthesis.md must exist and be >5 min old (gives the agent time to signal)
 *   - Only nudges once per review cycle (tracked by runId in the review dir)
 */
const unsignaledReviewNudges = new Map<string, number>();
const pendingVerdictNudges = new Map<string, number>();

type ReviewRunContext = {
  generatedAt?: string;
  headSha?: string;
  repos?: Array<{
    repoKey?: string;
    headSha?: string;
  }>;
};

function reviewAnchorFromContext(context: ReviewRunContext): string | undefined {
  if (context.repos) {
    if (context.repos.length === 0) return undefined;
    const heads: string[] = [];
    for (const repo of context.repos) {
      if (!repo.repoKey?.trim() || !repo.headSha?.trim()) return undefined;
      heads.push(`${repo.repoKey.trim()}@${repo.headSha.trim()}`);
    }
    return heads.join(' ');
  }
  return context.headSha?.trim() || undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildReviewCompletionCommand(
  issueId: string,
  verdict: 'passed' | 'blocked' | 'failed',
  notes: string,
  runId: string,
): string {
  let command = `pan admin specialists done review ${shellQuote(issueId)} --status ${shellQuote(verdict)}`;
  if (verdict === 'blocked' || verdict === 'failed') {
    command += ` --notes ${shellQuote(notes)}`;
  }
  return `${command} --run-id ${shellQuote(runId)}`;
}

function isReviewContextForActiveRun(
  context: ReviewRunContext,
  status: Pick<ReviewStatus, 'reviewSpawnedAt' | 'lastVerifiedCommit'>,
  reportMtimeMs: number,
): boolean {
  if (!status.reviewSpawnedAt) return true;

  const spawnedAtMs = reviewTimestampMs(status.reviewSpawnedAt);
  if (!Number.isFinite(spawnedAtMs)) return true;
  if (reportMtimeMs < spawnedAtMs) return false;

  if (context.generatedAt) {
    const generatedAtMs = Date.parse(context.generatedAt);
    if (Number.isFinite(generatedAtMs) && generatedAtMs < spawnedAtMs) return false;
  }

  const reviewedAnchor = reviewAnchorFromContext(context);
  return !status.lastVerifiedCommit
    || !reviewedAnchor
    || reviewedAnchor === status.lastVerifiedCommit;
}

export function isSynthesisForActiveReviewRun(
  dirPath: string,
  status: Pick<ReviewStatus, 'reviewSpawnedAt' | 'lastVerifiedCommit'>,
  synthesisMtimeMs: number,
): boolean {
  if (!status.reviewSpawnedAt) return true;
  const contextPath = join(dirPath, 'context.json');
  if (!existsSync(contextPath)) return false;

  try {
    const context = JSON.parse(readFileSync(contextPath, 'utf8')) as ReviewRunContext;
    return isReviewContextForActiveRun(context, status, synthesisMtimeMs);
  } catch {
    return false;
  }
}

/**
 * Apply settled review verdicts that reached disk after their runtime status
 * was reset to pending. The live review parent gets one chance to signal the
 * verdict itself; a dead parent, or one still unsignaled after 30 minutes, is
 * reconciled directly through the review-status and feedback write doors.
 */
export async function reconcileUnappliedReviewVerdicts(): Promise<string[]> {
  const actions: string[] = [];
  const VERDICT_SETTLE_MS = 5 * 60 * 1000;
  const NUDGE_GRACE_MS = 30 * 60 * 1000;

  try {
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if ((status.reviewStatus !== 'pending' && status.reviewStatus !== 'reviewing') || !status.reviewSpawnedAt) continue;

      try {
        const resolved = resolveProjectFromIssueSync(issueId);
        if (!resolved) continue;
        const wsPath = findWorkspacePath(resolved.projectPath, issueId.toLowerCase());
        if (!wsPath) continue;

        const reviewBaseDir = join(wsPath, '.pan', 'review');
        let reviewEntries: string[];
        try {
          reviewEntries = await readdir(reviewBaseDir);
        } catch {
          continue;
        }

        let latestDir: string | null = null;
        let latestReport: Awaited<ReturnType<typeof findVerdictReportAsync>> = null;
        let latestContext: ReviewRunContext | null = null;
        let latestMtime = 0;
        for (const entry of reviewEntries) {
          if (!entry.startsWith(`agent-${issueId.toLowerCase()}-review`)) continue;
          const dirPath = join(reviewBaseDir, entry);
          try {
            const report = await findVerdictReportAsync(dirPath);
            if (!report) continue;
            const [reportStat, contextContent] = await Promise.all([
              stat(report.path),
              readFile(join(dirPath, 'context.json'), 'utf8'),
            ]);
            const context = JSON.parse(contextContent) as ReviewRunContext;
            if (!isReviewContextForActiveRun(context, status, reportStat.mtimeMs)) continue;
            if (reportStat.mtimeMs > latestMtime) {
              latestDir = dirPath;
              latestReport = report;
              latestContext = context;
              latestMtime = reportStat.mtimeMs;
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[deacon] Error reading review run ${dirPath}:`, msg);
          }
        }
        if (!latestDir || !latestReport || !latestContext) continue;
        if (now - latestMtime < VERDICT_SETTLE_MS) continue;

        const requestedAtMs = status.reviewRequestedAt ? Date.parse(status.reviewRequestedAt) : Number.NaN;
        if (Number.isFinite(requestedAtMs) && requestedAtMs > latestMtime) continue;

        let currentHead: HeadAnchor | undefined;
        let reviewedHead: HeadAnchor | undefined;
        try {
          const { rehydrateHeadAnchor, snapshotWorkspaceHeadsPromise } = await import('../git-utils.js');
          currentHead = await snapshotWorkspaceHeadsPromise(issueId, wsPath);
          const persistedAnchor = reviewAnchorFromContext(latestContext);
          reviewedHead = persistedAnchor ? rehydrateHeadAnchor(persistedAnchor) : undefined;
        } catch {
          continue;
        }
        if (!reviewedHead || currentHead !== reviewedHead) continue;

        let parsed: ReturnType<typeof parseVerdictReport>;
        try {
          parsed = parseVerdictReport(await readFile(latestReport.path, 'utf8'));
        } catch {
          continue;
        }
        if (!parsed) continue;

        const reviewSession = `agent-${issueId.toLowerCase()}-review`;
        const sessionAlive = sessionExistsSync(reviewSession);
        const paneDead = sessionAlive ? await Effect.runPromise(isPaneDead(reviewSession)).catch(() => true) : true;
        if (sessionAlive && !paneDead) {
          const lastNudged = pendingVerdictNudges.get(latestDir);
          if (!lastNudged) {
            const notes = parsed.topBlocker || `See ${latestReport.filename}`;
            const cmd = buildReviewCompletionCommand(
              issueId,
              parsed.verdict,
              notes,
              basename(latestDir),
            );
            const nudge = `Your review verdict is already written on disk but review status is still pending. Your ONLY remaining task is to execute this Bash command immediately — do not analyze, do not summarize, do not ask questions, just run it:\n\n${cmd}\n\nRun this command NOW. Do not write any other response before executing it.`;
            try {
              const { messageAgent } = await import('../agents.js');
              await messageAgent(reviewSession, nudge);
              pendingVerdictNudges.set(latestDir, now);
              const action = `Nudged ${reviewSession} to apply pending ${parsed.verdict} verdict from ${latestReport.filename}`;
              actions.push(action);
              console.log(`[deacon] ${action}`);
            } catch (err: unknown) {
              console.error(`[deacon] Failed to nudge ${reviewSession}:`, err instanceof Error ? err.message : String(err));
            }
            continue;
          }
          if (now - lastNudged < NUDGE_GRACE_MS) continue;
        }

        const attribution = `applied by deacon sweep from on-disk ${latestReport.filename}`;
        const reviewNotes = parsed.topBlocker
          ? `${parsed.topBlocker} — ${attribution}`
          : `Review ${parsed.verdict} ${attribution}`;
        const convergence = await convergeRowFromVerdictOfRecord(issueId, {
          runId: basename(latestDir),
          workspacePath: wsPath,
          writer: 'unsignaled-recovery',
          notes: reviewNotes,
        });
        if (!convergence.converged) continue;

        if (parsed.verdict === 'blocked') {
          try {
            await Effect.runPromise(deliverReviewVerdictFeedback({
              issueId,
              verdict: 'blocked',
              notes: parsed.topBlocker || reviewNotes,
              workspacePath: wsPath,
              prUrl: status.prUrl,
              runId: basename(latestDir),
            }));
          } catch (err: unknown) {
            console.error(`[deacon] Failed to deliver reconciled review verdict for ${issueId}:`, err instanceof Error ? err.message : String(err));
          }
        }

        pendingVerdictNudges.delete(latestDir);
        const action = `reconcileUnappliedReviewVerdicts deacon sweep applied ${parsed.verdict} for ${issueId} from ${latestReport.filename}`;
        actions.push(action);
        emitActivityEntrySync({ source: 'cloister', level: 'warn', message: action, issueId });
        console.log(`[deacon] ${action}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[deacon] Error reconciling unapplied review verdict for ${issueId}:`, msg);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error reconciling unapplied review verdicts:', msg);
  }

  return actions;
}

export async function checkCompletedButUnsignaledReviews(): Promise<string[]> {
  const actions: string[] = [];
  const SYNTHESIS_SETTLE_MS = 5 * 60 * 1000; // 5 minutes

  try {
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'reviewing') continue;

      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) continue;
      const wsPath = findWorkspacePath(resolved.projectPath, issueId.toLowerCase());
      if (!wsPath) continue;

      const reviewBaseDir = join(wsPath, '.pan', 'review');
      if (!existsSync(reviewBaseDir)) continue;

      // Find the most recently modified review run directory
      let latestDir: string | null = null;
      let latestReport: ReturnType<typeof findVerdictReport> = null;
      let latestMtime = 0;
      for (const entry of readdirSync(reviewBaseDir)) {
        if (!entry.startsWith(`agent-${issueId.toLowerCase()}-review`)) continue;
        const dirPath = join(reviewBaseDir, entry);
        const report = findVerdictReport(dirPath);
        if (!report) continue;
        const mtime = statSync(report.path).mtimeMs;
        if (!isSynthesisForActiveReviewRun(dirPath, status, mtime)) continue;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latestDir = dirPath;
          latestReport = report;
        }
      }
      if (!latestDir || !latestReport) continue;

      // Wait for synthesis to settle before intervening
      if (now - latestMtime < SYNTHESIS_SETTLE_MS) continue;

      // Deduplicate: only nudge once per directory (one review cycle)
      const lastNudged = unsignaledReviewNudges.get(latestDir);
      if (lastNudged && now - lastNudged < 30 * 60 * 1000) continue;

      const reviewSession = `agent-${issueId.toLowerCase()}-review`;
      const sessionAlive = sessionExistsSync(reviewSession);
      const paneDead = sessionAlive ? await Effect.runPromise(isPaneDead(reviewSession)).catch(() => true) : true;
      const activeReviewState = sessionAlive && !paneDead ? getAgentStateSync(reviewSession) : null;
      if (activeReviewState?.reviewRunId && latestDir !== join(reviewBaseDir, activeReviewState.reviewRunId)) {
        continue;
      }

      let parsed: ReturnType<typeof parseVerdictReport>;
      try {
        parsed = parseVerdictReport(readFileSync(latestReport.path, 'utf8'));
      } catch {
        continue;
      }
      if (!parsed) continue;
      const { verdict, topBlocker } = parsed;

      if (sessionAlive && !paneDead) {
        // If we already nudged once and 30+ min have passed with no signal,
        // the agent is unresponsive — auto-complete so the pipeline isn't blocked.
        if (lastNudged) {
          const notes = topBlocker || `Review auto-completed by deacon: ${verdict} (agent alive but unresponsive after nudge, ${latestReport.filename} exists)`;
          const outcome = await recordReviewVerdict(issueId, { verdict, notes, writer: 'unsignaled-recovery' });
          if (!outcome.landed) { actions.push(`Auto-complete for ${issueId} not recorded (${outcome.reason})`); continue; }
          actions.push(`Auto-completed review for ${issueId}: ${verdict} (alive but unresponsive after nudge, ${latestReport.filename} written ${Math.round((now - latestMtime) / 60000)}min ago)`);
          console.log(`[deacon] Auto-completed review for ${issueId}: ${verdict} (alive but unresponsive after nudge)`);
          continue;
        }

        // Agent is alive but idle — nudge it to signal completion
        const cmd = buildReviewCompletionCommand(
          issueId,
          verdict,
          topBlocker || `See ${latestReport.filename}`,
          basename(latestDir),
        );
        const nudge = `Your review verdict in ${latestReport.filename} is already written and saved. Your ONLY remaining task is to execute this Bash command immediately — do not analyze, do not summarize, do not ask questions, just run it:\n\n${cmd}\n\nRun this command NOW. Do not write any other response before executing it.`;
        try {
          const { messageAgent } = await import('../agents.js');
          await messageAgent(reviewSession, nudge);
          unsignaledReviewNudges.set(latestDir, now);
          actions.push(`Nudged ${reviewSession} to signal ${verdict} (${latestReport.filename} written ${Math.round((now - latestMtime) / 60000)}min ago)`);
          console.log(`[deacon] Nudged ${reviewSession} to signal ${verdict}`);
        } catch (err: unknown) {
          console.error(`[deacon] Failed to nudge ${reviewSession}:`, err instanceof Error ? err.message : String(err));
        }
      } else {
        // Session is dead — auto-complete so the pipeline isn't blocked
        const notes = topBlocker || `Review auto-completed by deacon: ${verdict} (agent dead, ${latestReport.filename} exists)`;
        const outcome = await recordReviewVerdict(issueId, { verdict, notes, writer: 'unsignaled-recovery' });
        if (!outcome.landed) { actions.push(`Auto-complete for ${issueId} not recorded (${outcome.reason})`); continue; }
        actions.push(`Auto-completed review for ${issueId}: ${verdict} (dead agent, ${latestReport.filename} written ${Math.round((now - latestMtime) / 60000)}min ago)`);
        console.log(`[deacon] Auto-completed review for ${issueId}: ${verdict} (dead agent)`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking completed-but-unsignaled reviews:', msg);
  }

  return actions;
}
