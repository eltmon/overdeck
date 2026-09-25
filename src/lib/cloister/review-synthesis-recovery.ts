/**
 * Synthesis recovery (#4134): re-run the synthesis step of a convoy review
 * whose four lanes all reported but whose synthesis parent died before it
 * posted a verdict. deacon-lite's stalled-review patrol is the caller.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';

import { emitActivityEntry } from '../activity-logger.js';
import { decideResumeGate, getAgentResumeGateBlockReason, getAgentState } from '../agents/agent-state.js';
import { isAlive, isConfirmedDead } from '../agents/liveness.js';
import { removeAgentStateDir } from '../agents/state-dir-removal.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR } from '../paths.js';
import { withReviewLifecycleGuard } from '../review-lifecycle-guard.js';
import { readPipelineJournal } from './pipeline-journal.js';
import { buildReviewRolePrompt, deriveReviewRunHead8, PARENT_REVIEW_TIMEOUT_MS } from './review-agent.js';
import { REVIEW_SUB_ROLES } from './review-monitor.js';
import { reviewResumeDecision } from './review-resume-decision.js';

/**
 * The addendum a recovered synthesis parent reads after the normal synthesis
 * prompt (#4134). The reviewers' REVIEWER_READY signals went to the dead
 * parent and are gone, so the STANDBY wait in `buildReviewRolePrompt` would
 * never end: tell the new parent the reports are already on disk.
 */
function buildSynthesisRecoveryAddendum(reviewDir: string): string {
  const reports = REVIEW_SUB_ROLES.map(r => `  ${join(reviewDir, `${r}.md`)}`).join('\n');
  return [
    '',
    '── RECOVERY (overrides the STANDBY instructions above) ──',
    'Every convoy reviewer already finished and wrote its report, but the previous synthesis',
    'session died before posting a verdict. No REVIEWER_* signals will arrive.',
    `Treat all ${REVIEW_SUB_ROLES.length} lanes as REVIEWER_READY now, skip the stale-signal check,`,
    'and start the synthesis immediately from these reports:',
    reports,
  ].join('\n');
}

/** Holds already logged, so a held synthesis recovery says so once, not every patrol. */
const loggedSynthesisHolds = new Set<string>();
/** Issues with a synthesis recovery in flight in this process: an overlapping caller does nothing. */
const synthesisRecoveryInFlight = new Set<string>();

/** Test seam: forget logged holds and in-flight recoveries between test cases. */
export function __resetSynthesisRecoveryForTests(): void {
  loggedSynthesisHolds.clear();
  synthesisRecoveryInFlight.clear();
}

/** Whether the operator aborted the review after its last dispatch (`pan review abort`). */
function reviewAbortedSinceDispatch(workspace: string): boolean {
  const entries = readPipelineJournal(workspace);
  const aborted = entries.findLastIndex((entry) => entry.type === 'review.aborted');
  const dispatched = entries.findLastIndex((entry) => entry.type === 'review.dispatched');
  return aborted > dispatched;
}

/**
 * Re-run the synthesis step of a convoy review whose lanes all reported but
 * whose synthesis parent died before posting a verdict (#4134). The caller
 * owns the cheap gates (every lane reported, no verdict for the run, cooldown,
 * retry cap). This re-checks everything that can change under it, inside the
 * per-issue review lifecycle guard, and acts only when all of it still holds:
 *
 *   - no other synthesis recovery for the issue is in flight in this process;
 *   - the parent's operator gates allow an AUTONOMOUS relaunch (stoppedByUser,
 *     paused, troubled and failure backoff all hold it);
 *   - the operator did not abort the review (`review.aborted` after the last
 *     `review.dispatched`);
 *   - the liveness oracle still confirms the parent dead, and the parent's
 *     saved run is still `runId`;
 *   - `runId` still names the workspace HEAD. A run for a head that moved is
 *     stale and is never synthesized (the idempotency guard's model: a stale
 *     run id is a leftover, not the review in progress).
 *
 * Resumes the saved parent session when there is one. A refused resume is
 * final: "appears healthy" means someone else already relaunched it, and a
 * gate refusal is an operator hold. Only a parent with no session to resume
 * (or a harness/model drift) gets a fresh spawn, which resets the parent's
 * own state dir and nothing else. It never launches reviewers.
 */
export async function redispatchReviewSynthesis(
  issueId: string,
  opts: { workspace: string; runId: string; source?: string },
): Promise<{ success: boolean; message: string; held?: boolean }> {
  const normalized = issueId.toUpperCase();
  const parentId = `agent-${normalized.toLowerCase()}-review`;
  if (synthesisRecoveryInFlight.has(normalized)) {
    return { success: false, held: true, message: `Synthesis recovery for ${normalized} is already in flight` };
  }
  synthesisRecoveryInFlight.add(normalized);
  try {
    return await withReviewLifecycleGuard(normalized, async () => {
      const hold = (kind: string, message: string): { success: false; held: true; message: string } => {
        const key = `${normalized}:${opts.runId}:${kind}`;
        if (!loggedSynthesisHolds.has(key)) {
          loggedSynthesisHolds.add(key);
          console.warn(`[review-agent] ${message}`);
        }
        return { success: false, held: true, message };
      };

      const saved = getAgentState(parentId);
      if (saved) {
        const gate = decideResumeGate(getAgentResumeGateBlockReason(saved), 'autonomous');
        if (gate.decision !== 'proceed') {
          return hold('gate', `Synthesis recovery for ${normalized} held: ${gate.reason}`);
        }
      }
      if (reviewAbortedSinceDispatch(opts.workspace)) {
        return hold('aborted', `Synthesis recovery for ${normalized} held: the operator aborted the review`);
      }
      if (!isConfirmedDead(await isAlive(parentId))) {
        return { success: false, held: true, message: `Synthesis recovery for ${normalized} skipped: ${parentId} is no longer confirmed dead` };
      }
      if (saved?.reviewRunId !== opts.runId) {
        return {
          success: false,
          held: true,
          message: `Synthesis recovery for ${normalized} skipped: ${parentId} now holds run ${saved?.reviewRunId ?? 'none'}, not ${opts.runId}`,
        };
      }
      const head8 = await deriveReviewRunHead8(normalized, opts.workspace);
      if (head8 === 'unknown' || `agent-${normalized.toLowerCase()}-review-${head8}` !== opts.runId) {
        return hold('stale-head', `Synthesis recovery for ${normalized} held: run ${opts.runId} is stale (workspace HEAD is ${head8}); the next review dispatch covers the current head`);
      }

      const reviewDir = join(opts.workspace, PAN_DIRNAME, 'review', opts.runId);
      const manifestPath = join(reviewDir, 'context.json');
      const prompt = buildReviewRolePrompt({
        issueId: normalized,
        workspace: opts.workspace,
        branch: `feature/${normalized.toLowerCase()}`,
        runId: opts.runId,
        reviewDir,
        ...(existsSync(manifestPath) ? { contextManifestPath: manifestPath } : {}),
      }) + buildSynthesisRecoveryAddendum(reviewDir);

      const { spawnRun, saveAgentState, getLatestSessionId, resumeAgent } = await import('../agents.js');
      const armRun = async (state: ReturnType<typeof getAgentState>): Promise<void> => {
        if (!state) return;
        state.reviewRunId = opts.runId;
        state.reviewDeadlineAt = new Date(Date.now() + PARENT_REVIEW_TIMEOUT_MS).toISOString();
        try {
          await Effect.runPromise(saveAgentState(state));
        } catch (err) {
          console.warn(`[review-agent] Could not persist reviewRunId on ${parentId}:`, err);
        }
      };

      const canResume = reviewResumeDecision({
        savedModel: saved?.model,
        savedHarness: saved?.harness,
        hasSavedState: !!saved,
        hasSavedSession: !!getLatestSessionId(parentId),
      });
      let via: 'resumed' | 'spawned';
      try {
        if (canResume) {
          const resumed = await resumeAgent(parentId, prompt);
          if (!resumed.success) {
            return { success: false, message: `Synthesis recovery for ${normalized} could not resume ${parentId}: ${resumed.error ?? 'resume refused'}` };
          }
          via = 'resumed';
          await armRun(getAgentState(parentId));
        } else {
          const { closeAgentPaneDetailed } = await import('../terminal-backends/launch.js');
          const closed = await closeAgentPaneDetailed(parentId);
          if (closed.outcome === 'failed') {
            return { success: false, message: `Synthesis recovery for ${normalized} could not close the dead parent pane: ${closed.reason}` };
          }
          // Reset the parent's own state dir only, so the fresh session does not
          // inherit a mismatched saved session id. The lanes already reported;
          // their state dirs and session indexes are not the synthesis's to wipe.
          if (saved || getLatestSessionId(parentId)) {
            try {
              await removeAgentStateDir(join(AGENTS_DIR, parentId));
            } catch (wipeErr) {
              console.warn(`[review-agent] review parent state reset before synthesis respawn failed (non-fatal): ${wipeErr instanceof Error ? wipeErr.message : String(wipeErr)}`);
            }
          }
          const run = await spawnRun(normalized, 'review', {
            workspace: opts.workspace,
            prompt,
            ...(saved?.hostOverride ? { allowHost: true } : {}),
            startedBy: 'review-agent',
          });
          // Same run, same obligation: a review the operator asked for stays
          // one (#4139). A no-op until that field exists on the parent's state.
          const operatorRequested = (saved as unknown as Record<string, unknown> | undefined)?.['reviewOperatorRequested'];
          if (operatorRequested !== undefined) {
            (run as unknown as Record<string, unknown>)['reviewOperatorRequested'] = operatorRequested;
          }
          via = 'spawned';
          await armRun(run);
        }
      } catch (err) {
        return {
          success: false,
          message: `Synthesis recovery for ${normalized} failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const message = `Synthesis recovery for ${normalized}${opts.source ? ` (${opts.source})` : ''}: ${via} ${parentId} for run ${opts.runId}`;
      console.log(`[review-agent] ${message}`);
      emitActivityEntry({ source: 'review', level: 'info', message, issueId: normalized });
      return { success: true, message };
    });
  } finally {
    synthesisRecoveryInFlight.delete(normalized);
  }
}
