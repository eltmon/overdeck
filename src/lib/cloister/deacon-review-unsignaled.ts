import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { getAgentRuntimeStateSync, getAgentStateSync, listRunningAgents } from '../agents.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { loadReviewStatuses, setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { getAllProjectSpecialistStatuses, getTmuxSessionName } from './specialists.js';
import { isPaneDead, sessionExistsSync } from '../tmux.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';

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
    // Detect active review runs: agent-<id>-review (synthesis) and
    // agent-<id>-review-<subRole> (PAN-1059 convoy).
    try {
      const { listRunningAgents } = await import('../agents.js');
      const agents = await Effect.runPromise(listRunningAgents());
      for (const agent of agents) {
        if (agent.status === 'stopped' || agent.status === 'error') continue;
        const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : null);
        if (role !== 'review') continue;
        const issueId = (agent.issueId ?? '').trim().toUpperCase();
        if (issueId) activeReviewIssues.add(issueId);
      }
    } catch {
      // Non-fatal: fall back to specialist-only detection
    }

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'reviewing') continue;
      if (!status.reviewSpawnedAt) continue;
      if (activeReviewIssues.has(issueId.toUpperCase())) continue;

      const spawnedAt = new Date(status.reviewSpawnedAt).getTime();
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

type ReviewRunContext = {
  generatedAt?: string;
  headSha?: string;
};

export function isSynthesisForActiveReviewRun(
  dirPath: string,
  status: Pick<ReviewStatus, 'reviewSpawnedAt' | 'lastVerifiedCommit'>,
  synthesisMtimeMs: number,
): boolean {
  if (!status.reviewSpawnedAt) return true;

  const spawnedAtMs = Date.parse(status.reviewSpawnedAt);
  if (!Number.isFinite(spawnedAtMs)) return true;
  if (synthesisMtimeMs < spawnedAtMs) return false;

  const contextPath = join(dirPath, 'context.json');
  if (!existsSync(contextPath)) return false;

  let context: ReviewRunContext;
  try {
    context = JSON.parse(readFileSync(contextPath, 'utf8')) as ReviewRunContext;
  } catch {
    return false;
  }

  if (context.generatedAt) {
    const generatedAtMs = Date.parse(context.generatedAt);
    if (Number.isFinite(generatedAtMs) && generatedAtMs < spawnedAtMs) return false;
  }

  if (status.lastVerifiedCommit && context.headSha && context.headSha !== status.lastVerifiedCommit) {
    return false;
  }

  return true;
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
      let latestMtime = 0;
      for (const entry of readdirSync(reviewBaseDir)) {
        if (!entry.startsWith(`agent-${issueId.toLowerCase()}-review`)) continue;
        const dirPath = join(reviewBaseDir, entry);
        const synthPath = join(dirPath, 'synthesis.md');
        if (!existsSync(synthPath)) continue;
        const mtime = statSync(synthPath).mtimeMs;
        if (!isSynthesisForActiveReviewRun(dirPath, status, mtime)) continue;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latestDir = dirPath;
        }
      }
      if (!latestDir) continue;

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

      const synthesisPath = join(latestDir, 'synthesis.md');
      let verdict: 'passed' | 'blocked' | 'failed' | null = null;
      let topBlocker = '';
      try {
        const content = readFileSync(synthesisPath, 'utf8');
        const verdictLine = content.match(/## Verdict:\s*(.+)/i);
        if (verdictLine) {
          const v = verdictLine[1].trim().toUpperCase();
          if (v === 'PASSED') verdict = 'passed';
          else if (v === 'CHANGES REQUESTED') verdict = 'blocked';
          else if (v === 'FAILED') verdict = 'failed';
        }
        const blockerMatch = content.match(/## Blocking Findings\s*\n\s*###\s*\[[^\]]+\]\s*(.+)/);
        if (blockerMatch) topBlocker = blockerMatch[1].slice(0, 120);
      } catch {
        continue;
      }
      if (!verdict) continue;

      if (sessionAlive && !paneDead) {
        // If we already nudged once and 30+ min have passed with no signal,
        // the agent is unresponsive — auto-complete so the pipeline isn't blocked.
        if (lastNudged) {
          setReviewStatusSync(issueId, {
            reviewStatus: verdict,
            reviewNotes: topBlocker || `Review auto-completed by deacon: ${verdict} (agent alive but unresponsive after nudge, synthesis exists)`,
          });
          actions.push(`Auto-completed review for ${issueId}: ${verdict} (alive but unresponsive after nudge, synthesis written ${Math.round((now - latestMtime) / 60000)}min ago)`);
          console.log(`[deacon] Auto-completed review for ${issueId}: ${verdict} (alive but unresponsive after nudge)`);
          continue;
        }

        // Agent is alive but idle — nudge it to signal completion
        const cmd = `pan admin specialists done review ${issueId} --status ${verdict}${verdict === 'blocked' || verdict === 'failed' ? ` --notes "${topBlocker || 'See synthesis.md'}"` : ''}`;
        const nudge = `Your review synthesis is already written and saved. Your ONLY remaining task is to execute this Bash command immediately — do not analyze, do not summarize, do not ask questions, just run it:\n\n${cmd}\n\nRun this command NOW. Do not write any other response before executing it.`;
        try {
          const { messageAgent } = await import('../agents.js');
          await messageAgent(reviewSession, nudge);
          unsignaledReviewNudges.set(latestDir, now);
          actions.push(`Nudged ${reviewSession} to signal ${verdict} (synthesis written ${Math.round((now - latestMtime) / 60000)}min ago)`);
          console.log(`[deacon] Nudged ${reviewSession} to signal ${verdict}`);
        } catch (err: unknown) {
          console.error(`[deacon] Failed to nudge ${reviewSession}:`, err instanceof Error ? err.message : String(err));
        }
      } else {
        // Session is dead — auto-complete so the pipeline isn't blocked
        setReviewStatusSync(issueId, {
          reviewStatus: verdict,
          reviewNotes: topBlocker || `Review auto-completed by deacon: ${verdict} (agent dead, synthesis exists)`,
        });
        actions.push(`Auto-completed review for ${issueId}: ${verdict} (dead agent, synthesis written ${Math.round((now - latestMtime) / 60000)}min ago)`);
        console.log(`[deacon] Auto-completed review for ${issueId}: ${verdict} (dead agent)`);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking completed-but-unsignaled reviews:', msg);
  }

  return actions;
}


