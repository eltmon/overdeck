import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'path';
import { Effect } from 'effect';
import { getAgentRuntimeStateSync, listRunningAgents } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import {
  rehydrateHeadAnchor,
  snapshotWorkspaceHeadsPromise,
} from '../git-utils.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { getReviewArtifactProvenanceSync } from '../overdeck/agent-review-provenance.js';
import { loadReviewStatuses, type ReviewStatus } from '../review-status.js';
import { getAllProjectSpecialistStatuses, getTmuxSessionName } from './specialists.js';
import { sessionExistsSync } from '../tmux.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { evaluateReviewConvoyLiveness, reviewTimestampMs } from './review-convoy-liveness.js';
import { deliverReviewVerdictFeedback } from './review-verdict-feedback.js';
import {
  attestReviewReport,
  verifyReviewContextManifest,
} from './review-artifact-attestation.js';
import { findBlockingFindings } from '../review-findings.js';
import { REVIEW_SUB_ROLES } from './review-monitor.js';
import { recordReviewVerdict, type VerdictWriter } from './review-verdict-writer.js';
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

async function applySettledReviewReport(options: {
  issueId: string;
  runId: string;
  workspacePath: string;
  report: NonNullable<ReturnType<typeof findVerdictReport>>;
  prUrl?: string;
  writer: VerdictWriter;
  attribution: string;
}): Promise<boolean> {
  const content = await readFile(options.report.path, 'utf8');
  const parsed = parseVerdictReport(content);
  if (!parsed) return false;

  const runDir = join(options.workspacePath, '.pan', 'review', options.runId);
  const context = verifyReviewContextManifest(runDir, options.issueId, options.runId);
  if (!context) return false;
  const currentHead = await snapshotWorkspaceHeadsPromise(options.issueId, options.workspacePath);
  if (!currentHead || currentHead !== context.reviewedHead) return false;

  const attested = attestReviewReport({
    issueId: options.issueId,
    runId: options.runId,
    workspacePath: options.workspacePath,
    expectedVerdict: parsed.verdict,
  });
  const evidenceHead = attested.reviewedHead
    ? rehydrateHeadAnchor(attested.reviewedHead)
    : undefined;

  const reviewerVerdicts: NonNullable<ReviewStatus['reviewerVerdicts']> = {};
  if (options.report.filename === 'synthesis.md') {
    for (const subRole of REVIEW_SUB_ROLES) {
      const findingsPath = join(runDir, `${subRole}.md`);
      try {
        const findings = await readFile(findingsPath, 'utf8');
        reviewerVerdicts[subRole] = {
          status: findBlockingFindings(findings).length > 0 ? 'blocked' : 'passed',
          findingsPath,
          ...(evidenceHead ? { atCommit: evidenceHead } : {}),
        };
      } catch {
        // Selective re-review runs omit carried-forward sub-roles. The review
        // status writer merges this partial map with their prior verdicts.
      }
    }
  }

  const reviewNotes = parsed.topBlocker
    ? `${parsed.topBlocker} — ${options.attribution}`
    : `Review ${parsed.verdict} ${options.attribution}`;
  const outcome = await recordReviewVerdict(options.issueId, {
    verdict: parsed.verdict,
    notes: reviewNotes,
    evidenceHead,
    ...(Object.keys(reviewerVerdicts).length > 0 ? { reviewerVerdicts } : {}),
    extra: {
      ...(evidenceHead ? { reviewedAtCommit: evidenceHead } : {}),
      ...(parsed.verdict === 'passed'
        ? {
            verificationStatus: 'passed',
            verificationNotes: 'Host-attested review report preserved the completed verification gate',
          }
        : {}),
    },
    runId: options.runId,
    writer: options.writer,
  });
  if (!outcome.landed) return false;

  if (parsed.verdict === 'blocked' || parsed.verdict === 'failed') {
    await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: options.issueId,
      verdict: parsed.verdict,
      notes: parsed.topBlocker || reviewNotes,
      workspacePath: options.workspacePath,
      prUrl: options.prUrl,
      runId: options.runId,
    }));
  }
  return true;
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
 * was reset to pending. The host waits for the report to settle, verifies its
 * signed context against the current workspace HEAD, attests the exact report
 * bytes, and applies the verdict through the canonical write door.
 */
export async function reconcileUnappliedReviewVerdicts(): Promise<string[]> {
  const actions: string[] = [];
  const VERDICT_SETTLE_MS = 5 * 60 * 1000;

  try {
    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'pending' || !status.reviewSpawnedAt) continue;

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

        const applied = await applySettledReviewReport({
          issueId,
          runId: basename(latestDir),
          workspacePath: wsPath,
          report: latestReport,
          prUrl: status.prUrl,
          writer: 'unsignaled-recovery',
          attribution: `applied by deacon sweep from on-disk ${latestReport.filename}`,
        });
        if (!applied) continue;

        const parsed = parseVerdictReport(await readFile(latestReport.path, 'utf8'));
        if (!parsed) continue;
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
  const REPORT_SETTLE_MS = 5_000;

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

      // The report is the only agent-authored input. No review process receives
      // a bearer token or an endpoint that can request host attestation.
      if (now - latestMtime < REPORT_SETTLE_MS) continue;

      const reviewAgentId = `agent-${issueId.toLowerCase()}-review`;
      const provenance = getReviewArtifactProvenanceSync(reviewAgentId);
      if (!provenance || latestDir !== join(reviewBaseDir, provenance.reviewRunId)) {
        continue;
      }

      const applied = await applySettledReviewReport({
        issueId,
        runId: provenance.reviewRunId,
        workspacePath: provenance.workspace,
        report: latestReport,
        prUrl: status.prUrl,
        writer: latestReport.filename === 'synthesis.md' ? 'coordinator' : 'quick-signal',
        attribution: `host-attested from settled ${latestReport.filename}`,
      });
      if (!applied) continue;

      const parsed = parseVerdictReport(readFileSync(latestReport.path, 'utf8'));
      if (!parsed) continue;
      const action = `Host-attested ${parsed.verdict} review for ${issueId} from settled ${latestReport.filename}`;
      actions.push(action);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message: action, issueId });
      console.log(`[deacon] ${action}`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking completed-but-unsignaled reviews:', msg);
  }

  return actions;
}
