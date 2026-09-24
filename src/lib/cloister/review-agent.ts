/**
 * Review role entry point.
 *
 * PAN-1048 review feedback 007: every legacy convoy helper has been retired.
 * The bash/tmux coordinator path (dispatchParallelReview /
 * spawnReviewCoordinatorSession / runParallelReview) was deleted in R6, and
 * the round-7 cleanup additionally removed the supporting cast that the
 * coordinator used to drive — spawnSingleReviewer, waitForReviewer,
 * archiveReviewerRound, parseReviewSynthesis, parseAgentOutput,
 * selectCompletedReviewers, getReviewAgents, getFilesChangedFromPR,
 * buildReviewFeedbackBody, parseReviewerTemplate, resolvePromptTemplatePath
 * (and the resolveTemplatePath alias), resolveReviewerModel,
 * reviewResultToReviewStatus, reviewerRetryBackoffMs,
 * isRetryableReviewerFailure, the ReviewContext / ReviewResult /
 * ReviewerTemplate / ReviewerRoundArtifact / ReviewerOutcome /
 * ReviewerWaitResult / ReviewerFailureReason / ReviewHistoryEntry types,
 * and DEFAULT_REVIEW_AGENTS / REVIEW_TIMEOUT_MS / MAX_REVIEWER_TIMEOUT_RETRIES
 * / REVIEWER_TIMEOUT_RETRY_BACKOFF_MS / REVIEW_HISTORY_DIR / REVIEW_HISTORY_FILE
 * / SPECIALISTS_DIR constants. None of these had any production caller after R6;
 * their tests went with them.
 *
 * Every active review surface — POST /api/review/:issueId/trigger, the
 * reactive scheduler review branch, and the dashboard kanban "Review again"
 * button — flows through
 * spawnReviewRoleForIssue → spawnRun(issueId, 'review'). The review role
 * runs a combined quick review or receives four server-launched specialist
 * reports in full mode. Dispatch owns mode-specific workflow; roles/review.md
 * supplies shared evidence, coverage, and verdict standards.
 *
 * Surface area kept:
 *   - spawnReviewRoleForIssue       — the only review entry point
 *   - killAllReviewerSessions       — kill the canonical reviewer sessions
 *                                     for one issue (merge-agent +
 *                                     dashboard cancel/abort routes)
 *   - killAllReviewSessions         — kill ALL review sessions on shutdown
 *                                     (pan down)
 */

import { exec } from 'child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { killSession, listSessionNames, isPaneDead } from '../tmux.js';
import { emitActivityEntry } from '../activity-logger.js';
import { removeAgent } from '../agents/removal.js';
import { listAgentIdsByPrefix } from '../overdeck/agents.js';
import { loadConfigSync as loadYamlConfig, type ReviewMode } from '../config-yaml.js';
import { buildReviewContext, formatTier1Summary, type ReviewContextManifest } from './review-context.js';
import { buildRealConflictGateDeps, getCachedConflictGateMergeability, resolveConflictGate } from './conflict-gate.js';
import { createPromiseCoalescer } from './in-flight-guard.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';
import { reviewResumeDecision } from './review-resume-decision.js';
import { isReviewSessionForIssue } from './specialists-registry.js';
import {
  recoverMissingConvoyReviewers,
  launchConvoyReviewers,
} from './review-convoy.js';
import { shouldSkipDispatchAsMerged } from './merge-verification.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR, packageRoot } from '../paths.js';
import { sessionFilePath } from '../runtimes/storage/claude-code.js';
import { decideResumeGate, getAgentResumeGateBlockReason, getAgentState } from '../agents/agent-state.js';
import { isAlive, isConfirmedDead } from '../agents/liveness.js';
import { removeAgentStateDir } from '../agents/state-dir-removal.js';
import type { RuntimeName } from '../runtimes/types.js';
import { withReviewLifecycleGuard } from '../review-lifecycle-guard.js';
import { readPipelineJournal } from './pipeline-journal.js';

const execAsync = promisify(exec);
// PAN-1531: review-temp stash helpers removed.

// PAN-2584: liveness budget for the review PARENT (discovery + convoy + synthesis).
// Sub-reviewers get their own 20-minute deadlines in review-convoy.ts; the parent
// needs headroom for all three phases. Enforced by checkStalledReviewParents.
const PARENT_REVIEW_TIMEOUT_MS = 45 * 60 * 1000;
// Review now runs against the committed diff only. The dirty-worktree gate
// at pan done time (and the same gate added to /api/review/:id/request)
// guarantees the worktree is clean before specialists see the diff.

const reviewSynthesisPath = (reviewDir: string): string => join(reviewDir, 'synthesis.md');
const selfReviewReportPath = (reviewDir: string): string => join(reviewDir, 'review.md');

async function deriveReviewRunHead8(issueId: string, workspace: string): Promise<string> {
  try {
    const { resolvePrimaryWorkspaceRepoDir, resolveWorkspaceRepoRoots } = await import('../project-repos.js');
    const roots = resolveWorkspaceRepoRoots(issueId, workspace);
    if (roots.some(root => root.isPolyrepo)) {
      const { snapshotWorkspaceHeads } = await import('../git-utils.js');
      const anchor = await snapshotWorkspaceHeads(issueId, workspace);
      return anchor
        ? createHash('sha1').update(anchor).digest('hex').substring(0, 8)
        : 'unknown';
    }

    // PAN-3037: the primary code repo is resolved through the shared helper —
    // the polyrepo wrapper's HEAD never moves, so a wrapper-derived runId would
    // mismatch every live run and kill a healthy convoy on each dispatch.
    const probeDir = resolvePrimaryWorkspaceRepoDir(issueId, workspace);
    const { stdout } = await execAsync(['git', 'rev-parse', '--short=8', 'HEAD'].join(' '), {
      cwd: probeDir,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function buildReviewRolePrompt(opts: {
  issueId: string;
  workspace: string;
  branch: string;
  prUrl?: string;
  runId: string;
  reviewDir: string;
  contextManifestPath?: string;
  tier1Summary?: string;
}): string {
  const subRoleFiles = REVIEW_SUB_ROLES.map(r => `  ${join(opts.reviewDir, `${r}.md`)}`).join('\n');
  const expectedSignals = REVIEW_SUB_ROLES.map(r => `  REVIEWER_READY ${r} <outputPath> or REVIEWER_FAILED ${r} <reason> or REVIEWER_TIMEOUT ${r} <reason>`).join('\n');
  const synthesisPath = reviewSynthesisPath(opts.reviewDir);
  const runningDesc = 'the four convoy reviewers (security, correctness, performance, requirements)';
  const prompt = [
    `STANDBY — REVIEW SYNTHESIS for ${opts.issueId}`,
    '',
    `Do NOT do anything yet. The Overdeck server has already spawned ${runningDesc}`,
    'and they are running in parallel right now. Your work begins only once they finish.',
    '',
    `You will receive exactly one \`pan tell\` signal per RUNNING sub-role as each`,
    'reviewer finishes — these are delivered to you as user messages:',
    expectedSignals,
    '',
    `Until all ${REVIEW_SUB_ROLES.length} terminal signal(s) have arrived: do nothing. Do not read the`,
    'reviewer output files, do not run git, do not inspect tmux sessions, do not',
    'poll anything. Just wait — the reviewers notify you when they finish, and',
    'Deacon is the failsafe if one never starts or never completes. Acting early',
    'wastes tokens reviewing nothing.',
    'Operator-requested early reads may summarize one completed report, but do not',
    'lift the all-signals gate. Failed or timed-out lanes, or missing/empty/unreadable',
    'reports after READY, block approval. Keep waiting for the other terminal signals.',
    'Record each lane, signal, report path, and blocker count in the synthesis.',
    '',
    'STALE-SIGNAL GUARD (PAN-3549): terminal signals from a dead prior attempt of',
    'this same branch can replay into your session when you resume — every signal',
    'carries its deadline in its text. A signal is current only if its deadline is',
    "NEWER than this dispatch's context manifest. Before counting any",
    'REVIEWER_TIMEOUT or REVIEWER_FAILED signal, compare: run',
    '`stat -c %y <manifest path>` and discard any signal whose deadline is older.',
    'Stale signals describe lanes that no longer exist; the current lanes are',
    'still running and their signals arrive later.',
    '',
    `Once you have all ${REVIEW_SUB_ROLES.length} terminal signal(s), follow roles/review.md exactly to`,
    'read the reports, synthesize the verdict,',
    'write the synthesis report, and signal the status.',
    '',
    '── Review context ──',
    `Issue: ${opts.issueId}`,
    `Branch: ${opts.branch}`,
    `Workspace: ${opts.workspace}`,
    opts.prUrl ? `PR: ${opts.prUrl}` : `PR: (resolve via: gh pr view ${opts.branch})`,
    `Run ID: ${opts.runId}`,
    `Review directory: ${opts.reviewDir}`,
    `Synthesis output file: ${synthesisPath}`,
    '',
    opts.tier1Summary
      ? [
          'Shared review context:',
          '─────────────────────────────────────────────────────────────',
          opts.tier1Summary,
          '─────────────────────────────────────────────────────────────',
          '',
          opts.contextManifestPath ? `Full manifest: ${opts.contextManifestPath}` : '',
        ].join('\n')
      : opts.contextManifestPath
        ? `Context manifest: ${opts.contextManifestPath}`
        : 'Context manifest: (missing — block review per roles/review.md)',
    '',
    'Convoy reviewer output files (read each one ONLY after its REVIEWER_READY signal):',
    subRoleFiles,
    '',
    'After writing the synthesis report, signal the verdict with Overdeck CLI:',
    `  pan admin specialists done review ${opts.issueId} --status passed --notes "<one-line summary>" --run-id "${opts.runId}"`,
    `  pan admin specialists done review ${opts.issueId} --status blocked --notes "<one-line top blocker>" --run-id "${opts.runId}"`,
    '',
    `Your final chat message is exactly this shape: first line \`✓ Review verdict: APPROVED for ${opts.issueId}.\` or \`✗ Review verdict: CHANGES REQUESTED for ${opts.issueId}.\`, then one or two sentences saying why, then the report path.`,
    '',
    // PAN-2007: do NOT tell the agent to `exit`. The session is kept alive through
    // the pipeline (KEEP_SPECIALIST_SESSIONS_ALIVE) so it can be reused for the next
    // review cycle without a cold re-spawn. Exiting before the signal command is
    // what stranded reviews mid-convoy.
    'After running the signal command above, STOP and wait — do not exit, do not run',
    'any further commands. The session stays open for the next review cycle.',
    '',
    'Reactive Cloister dispatches the test role after review passes. Never queue tests yourself and never edit code.',
  ].filter(Boolean).join('\n');

  const sizeBytes = Buffer.byteLength(prompt, 'utf-8');
  console.log(`[review-agent] Synthesis prompt for ${opts.issueId}: ${sizeBytes} bytes`);
  return prompt;
}

// Quick review receives no convoy workflow; the shared role supplies all four checklists.
function buildSelfReviewPrompt(opts: {
  issueId: string;
  workspace: string;
  branch: string;
  prUrl?: string;
  runId: string;
  reviewDir: string;
  contextManifestPath?: string;
  tier1Summary?: string;
}): string {
  const reviewReportPath = selfReviewReportPath(opts.reviewDir);
  const prompt = [
    `CODE REVIEW for ${opts.issueId} — you are the sole reviewer; review the change yourself.`,
    '',
    'Review the diff for this branch yourself, across ALL dimensions in one pass:',
    'correctness/logic, security, requirements/acceptance-criteria, and performance.',
    'Do NOT spawn or wait for any sub-reviewers — there is no convoy; you do the',
    'whole review yourself and emit the verdict.',
    '',
    '── Review context ──',
    `Issue: ${opts.issueId}`,
    `Branch: ${opts.branch}`,
    `Workspace: ${opts.workspace}`,
    opts.prUrl ? `PR: ${opts.prUrl}` : `PR: (resolve via: gh pr view ${opts.branch})`,
    `Run ID: ${opts.runId}`,
    `Review directory: ${opts.reviewDir}`,
    `Review output file: ${reviewReportPath}`,
    '',
    opts.tier1Summary
      ? [
          'Shared review context (risk-ranked changed files + acceptance criteria):',
          '─────────────────────────────────────────────────────────────',
          opts.tier1Summary,
          '─────────────────────────────────────────────────────────────',
          '',
          opts.contextManifestPath ? `Full manifest: ${opts.contextManifestPath}` : '',
        ].join('\n')
      : opts.contextManifestPath
        ? `Context manifest: ${opts.contextManifestPath}`
        : 'Context manifest: (missing — report the missing scope/requirements and block review)',
    '',
    'How to review:',
    '1. Review every changed file, starting with the manifest risk ranking; trace',
    '   actual callers, validators, defaults, and overrides as needed.',
    '2. Evaluate correctness, security, requirements/AC, and performance. Use the',
    '   complete checklists, evidence classification, and verdict rules in roles/review.md.',
    '   Finish all dimensions even after finding blockers; do a second coverage pass.',
    `3. Write your findings, changed-file ledger, AC evidence, and check results to ${reviewReportPath}.`,
    '',
    'Then signal the verdict with the Overdeck CLI (exactly one):',
    `  pan admin specialists done review ${opts.issueId} --status passed --notes "<one-line summary>" --run-id "${opts.runId}"`,
    `  pan admin specialists done review ${opts.issueId} --status blocked --notes "<one-line top blocker>" --run-id "${opts.runId}"`,
    '',
    `Your final chat message is exactly this shape: first line \`✓ Review verdict: APPROVED for ${opts.issueId}.\` or \`✗ Review verdict: CHANGES REQUESTED for ${opts.issueId}.\`, then one or two sentences saying why, then the report path.`,
    '',
    // PAN-2007: do NOT tell the agent to `exit`. The session is kept alive through
    // the pipeline (KEEP_SPECIALIST_SESSIONS_ALIVE) so it can be reused for the next
    // review cycle without a cold re-spawn. Exiting before the signal command is
    // what stranded reviews mid-convoy.
    'After running the signal command above, STOP and wait — do not exit, do not run',
    'any further commands. The session stays open for the next review cycle.',
    '',
    'Reactive Cloister dispatches the test role after review passes. Never queue tests yourself and never edit code.',
  ].filter(Boolean).join('\n');

  const sizeBytes = Buffer.byteLength(prompt, 'utf-8');
  console.log(`[review-agent] Self-review prompt for ${opts.issueId}: ${sizeBytes} bytes`);
  return prompt;
}
async function spawnReviewRoleForIssueBody(
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string; harness?: RuntimeName; force?: boolean; allowHost?: boolean; reviewMode?: ReviewMode },
): Promise<{ success: boolean; message: string; error?: string; gated?: boolean }> {
  const dispatchStartedAtMs = Date.now();
  const reviewSessionName = `agent-${opts.issueId.toLowerCase()}-review`;
  // A mode chosen for this request (the dashboard's Full/Quick/None menu) wins
  // over config for this run only. Nothing stores it: the next dispatch
  // resolves `roles.review.mode` again.
  const reviewMode = opts.reviewMode ?? resolveReviewMode(opts.issueId);

  // PAN-2420: GitHub-authoritative guard. Do not waste time on conflict-gate
  // checks or context builds for a PR that GitHub already reports merged.
  const mergedGuard = await shouldSkipDispatchAsMerged(opts.issueId);
  if (mergedGuard.skip) {
    const message = `[review-agent] Skipping review dispatch for ${opts.issueId} — ${mergedGuard.reason}`;
    console.log(message);
    emitActivityEntry({ source: 'cloister', level: 'info', message, issueId: opts.issueId });
    return { success: false, message };
  }

  // PAN-1862 (FR-14): review mode 'none' — skip the AI review entirely. This sits at
  // the single review entry point so the trigger route, host auto-dispatch, and every
  // Deacon re-dispatch site all honor it without per-call-site logic. The pre-review
  // verification gate (typecheck/lint/test floor) has already run by the time any
  // caller reaches here — 'none' skips only the AI review, never the quality floor.
  // PAN-3917: nothing is stamped. Skipping the AI review leaves the PR
  // unreviewed, which is exactly what the forge then reports.
  if (reviewMode === 'none') {
    const message = opts.reviewMode === 'none'
      ? `Review skipped for ${opts.issueId} (mode=none) — AI review skipped for this run by request; the verification gate still applies`
      : `Review skipped for ${opts.issueId} (mode=none) — AI review disabled by configuration; the verification gate still applies`;
    console.log(`[review-agent] ${message}`);
    emitActivityEntry({ source: 'review', level: 'info', message, issueId: opts.issueId });
    return { success: true, message };
  }

  // Idempotency: if a review role agent for this issue already has an alive
  // tmux pane, treat the current dispatch as a no-op. spawnRun has its own
  // session-exists check but it throws — we want soft "already running"
  // semantics so callers can keep their existing success-path messaging.
  //
  // Force mode (human override from dashboard) kills the old session and
  // respawns so the review runs against current HEAD, not stale state.
  if (opts.force) {
    const stopped = await killAllReviewerSessions(undefined, opts.issueId);
    if (stopped.failed.length > 0) {
      return {
        success: false,
        message: `Review replacement aborted — could not stop ${stopped.failed.join(', ')}`,
        error: `Review sessions still live: ${stopped.failed.join(', ')}`,
      };
    }
  }

  try {
    const sessions = opts.force ? [] : await Effect.runPromise(listSessionNames());
    if (sessions.includes(reviewSessionName)) {
      const paneDead = await Effect.runPromise(isPaneDead(reviewSessionName));

      // A synthesis agent that has finished its verdict does NOT terminate:
      // its role prompt tells it to "exit", but it runs `Bash(exit)` which
      // only exits a subshell — the Claude process stays idle-alive with a
      // live pane. So "pane alive" does NOT mean "actively reviewing", and the
      // old guard would skip re-dispatch forever, jamming the issue at
      // review=reviewing with no convoy actually running (PAN-1131).
      //
      // Disambiguate via the run id: every review run is keyed to a HEAD sha
      // (runId = agent-<issue>-review-<head8>). If the existing synthesis
      // session was started for a different HEAD than the one we are about to
      // review, it is a stale leftover — kill the convoy and respawn. Only a
      // session whose runId matches the *current* HEAD is genuinely the
      // review-in-progress we should defer to.
      let staleRunId = false;
      let currentRunId: string | undefined;
      if (!paneDead && !opts.force) {
        try {
          const head8 = await deriveReviewRunHead8(opts.issueId, opts.workspace);
          if (head8 === 'unknown') throw new Error('workspace HEAD unavailable');
          currentRunId = `agent-${opts.issueId.toLowerCase()}-review-${head8}`;
          const synthReviewRunId = getAgentState(reviewSessionName)?.reviewRunId;
          // A missing identity cannot prove that the live pane covers the
          // current obligation, so legacy/unknown sessions are stale too.
          if (!synthReviewRunId || synthReviewRunId !== currentRunId) {
            staleRunId = true;
            console.log(
              `[review-agent] ${reviewSessionName} is stale — runId ${synthReviewRunId ?? 'missing'} != current ${currentRunId}; killing convoy and respawning`,
            );
          }
        } catch (probeErr) {
          console.warn(
            `[review-agent] Could not probe ${reviewSessionName} runId, falling back to pane-alive idempotency:`,
            probeErr,
          );
        }
      }

      // PAN-1131 residual / PAN-2579, re-pointed by PAN-3917: a runId-matching
      // live pane is only "actively reviewing" until this run's report lands on
      // disk. The round artifacts are the verdict of record — once
      // `.pan/review/<runId>/` holds a report or a synthesis, the session is
      // warm-idle and a fresh dispatch must fall through to the respawn path,
      // which kills the convoy tmux and resumes the saved session with its
      // context intact. There is no stored review row to consult any more.
      let finishedIdle = false;
      if (!paneDead && !opts.force && !staleRunId && currentRunId) {
        try {
          const reviewDir = join(opts.workspace, PAN_DIRNAME, 'review', currentRunId);
          finishedIdle = existsSync(selfReviewReportPath(reviewDir))
            || existsSync(reviewSynthesisPath(reviewDir));
          if (finishedIdle) {
            console.log(
              `[review-agent] ${reviewSessionName} already wrote its report for run ${currentRunId} — warm-reusing for the new review cycle`,
            );
          }
        } catch (probeErr) {
          console.warn(`[review-agent] Could not probe review artifacts for ${opts.issueId}:`, probeErr);
        }
      }

      if (!paneDead && !opts.force && !staleRunId && !finishedIdle) {
        console.log(`[review-agent] Idempotency guard: ${reviewSessionName} already running for ${opts.issueId} — skipping spawn`);
        return { success: false, message: `Review dispatch skipped — already running: ${reviewSessionName}` };
      }
      // Session pane is dead, force mode, stale runId, or finished-idle — kill the
      // convoy tmux and respawn (the spawn path resumes the saved session, so a
      // warm reviewer keeps its context).
      const reason = opts.force ? 'force-killed for re-review'
        : paneDead ? 'pane is dead'
        : staleRunId ? 'stale runId'
        : 'finished-idle (warm reuse for new cycle)';
      console.log(`[review-agent] ${reviewSessionName} ${reason} — respawning convoy`);
      const stopped = await killAllReviewerSessions(undefined, opts.issueId);
      if (stopped.failed.length > 0) {
        return {
          success: false,
          message: `Review replacement aborted — could not stop ${stopped.failed.join(', ')}`,
          error: `Review sessions still live: ${stopped.failed.join(', ')}`,
        };
      }
    }
  } catch (err) {
    console.warn(`[review-agent] Idempotency check failed for ${opts.issueId}, proceeding:`, err);
  }

  // Fast synchronous cache check for the gated case. If the probe cache says
  // the branch has conflicts (or we cannot verify mergeability), fail fast
  // without shelling out to git on the awaited request path.
  const cachedMergeability = getCachedConflictGateMergeability(opts.issueId);
  if (cachedMergeability === 'conflicts' || cachedMergeability === 'unknown') {
    const targetBranch = 'main';
    const reason = cachedMergeability === 'conflicts'
      ? `merge conflict with ${targetBranch} must be resolved before review dispatch`
      : `mergeability against ${targetBranch} could not be verified; deferring review conservatively`;
    const message = `Review dispatch deferred: ${reason}`;
    return { success: false, gated: true, message };
  }

  const gate = await resolveConflictGate(
    opts.issueId,
    opts.workspace,
    'main',
    buildRealConflictGateDeps(),
  );
  if (gate.gated) {
    const message = `Review dispatch deferred: ${gate.reason ?? 'merge conflict must be resolved first'}`;
    return { success: false, gated: true, message };
  }

  // Clear feedback from any previous review cycle so the work agent only
  // sees current-cycle feedback when it reads .pan/feedback/.
  try {
    const { clearFeedbackFiles } = await import('./feedback-writer.js');
    await clearFeedbackFiles(opts.workspace);
  } catch {
    // Non-fatal: archiving is best-effort
  }

  // PAN-1531: review-temp stash machinery removed. Reviewers see only the
  // committed diff because the dirty-worktree gate refuses pan done /
  // pan review request before reaching here. If callers somehow bypass the
  // gate, uncommitted scratch becomes visible in the review — that's the
  // correct fail-loud behavior, not a reason to silently stash.
  try {
    const { notifyPipeline } = await import('../pipeline-notifier.js');
    notifyPipeline({ type: 'task_queued', specialist: 'review-agent', issueId: opts.issueId });
  } catch {
    // Non-fatal
  }

  try {
    const { spawnRun, saveAgentState, getAgentState, getLatestSessionId, resumeAgent, wipeAgentStateDirs } = await import('../agents.js');
    const workAgentState = getAgentState(`agent-${opts.issueId.toLowerCase()}`);
    const allowHost = opts.allowHost === true || workAgentState?.hostOverride === true;

    // Build the shared context manifest before spawning so all reviewers
    // read one pre-built diff+AC object instead of each running git diff
    // independently (PAN-1059).
    //
    // Include the shared workspace-head digest in runId so re-reviews of the
    // same issue get separate directories. Monorepos retain their short HEAD;
    // polyrepos hash the full composite anchor so any sub-repo move changes it.
    const head8 = await deriveReviewRunHead8(opts.issueId, opts.workspace);
    const runId = head8 !== 'unknown'
      ? `agent-${opts.issueId.toLowerCase()}-review-${head8}`
      : `agent-${opts.issueId.toLowerCase()}-review`;
    const reviewDir = join(opts.workspace, PAN_DIRNAME, 'review', runId);
    let contextManifestPath: string | undefined;
    let tier1Summary: string | undefined;
    try {
      const manifest = await buildReviewContext({
        runId,
        issueId: opts.issueId,
        workspace: opts.workspace,
        branch: opts.branch,
      });
      contextManifestPath = manifest.manifestPath;
      tier1Summary = formatTier1Summary(manifest);
      console.log(`[review-agent] Context manifest built: ${contextManifestPath} (${manifest.changedFiles.length} files)`);
    } catch (ctxErr) {
      console.warn(`[review-agent] Context manifest build failed for ${opts.issueId} — reviewers will block on missing shared context:`, ctxErr);
    }

    const fullReview = reviewMode === 'full';

    const prompt = fullReview
      ? buildReviewRolePrompt({ ...opts, runId, reviewDir, contextManifestPath, tier1Summary })
      : buildSelfReviewPrompt({ ...opts, runId, reviewDir, contextManifestPath, tier1Summary });

    const spawnConvoyReviewers = (synthesisAgentId: string) =>
      launchConvoyReviewers({
        issueId: opts.issueId,
        workspace: opts.workspace,
        runId,
        synthesisAgentId,
        contextManifestPath,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.harness ? { harness: opts.harness } : {}),
        allowHost,
      });

    // PAN-1862: RESUME the saved review session by default. The review agent keeps the prior
    // review's context (the files it read, the findings it raised), so a re-review checks the
    // fix instead of re-researching the entire diff from scratch — the token-cost problem this
    // was set out to fix. Fresh-spawn ONLY when the harness/model actually changed (it's a
    // different agent then) or there is no resumable saved session. The resume delivery is
    // resilient (supervisor → tmux fallback, PAN-1988).
    const reviewAgentId = `agent-${opts.issueId.toLowerCase()}-review`;
    const savedReview = getAgentState(reviewAgentId);
    const canResumeReview = reviewResumeDecision({
      requestedModel: opts.model,
      requestedHarness: opts.harness,
      savedModel: savedReview?.model,
      savedHarness: savedReview?.harness,
      hasSavedState: !!savedReview,
      hasSavedSession: !!getLatestSessionId(reviewAgentId),
    });
    if (canResumeReview) {
      console.log(`[review-agent] Resuming saved review session for ${opts.issueId} — model/harness unchanged, preserving context (PAN-1862)`);
      const resumeResult = await resumeAgent(reviewAgentId, prompt);
      if (resumeResult.success) {
        try {
          // Keep the idempotency guard's HEAD-staleness detection honest for the resumed run.
          const resumed = getAgentState(reviewAgentId);
          if (resumed) {
            resumed.reviewRunId = runId;
            // PAN-2584: arm the parent's liveness deadline for this cycle.
            resumed.reviewDeadlineAt = new Date(Date.now() + PARENT_REVIEW_TIMEOUT_MS).toISOString();
            await Effect.runPromise(saveAgentState(resumed));
          }
        } catch { /* non-fatal */ }
        if (fullReview) {
          if (savedReview?.reviewRunId === runId) {
            // PAN-3368: this is recovery of the current run, not a new review cycle.
            // Re-dispatch only lanes with neither a live session nor a report; completed
            // siblings stay intact and the synthesis parent can proceed immediately.
            const recovery = await recoverMissingConvoyReviewers(opts.issueId, {
              source: 'same-run parent resume',
              ...(opts.model ? { model: opts.model } : {}),
              ...(opts.harness ? { harness: opts.harness } : {}),
            });
            if (!recovery.success) {
              return {
                success: false,
                message: `Convoy review resumed, but missing reviewer recovery failed: ${recovery.message}`,
                error: recovery.message,
              };
            }
          } else {
            await spawnConvoyReviewers(reviewAgentId);
          }
          return { success: true, message: `Convoy review resumed (session preserved): ${reviewAgentId}` };
        }
        return { success: true, message: `Review resumed (session preserved): ${reviewAgentId}` };
      }
      console.warn(`[review-agent] Review resume failed for ${reviewAgentId}; falling back to a fresh session: ${resumeResult.error}`);
    }
    // Fresh review: wipe any stale review state (harness/model changed, or the resume above
    // failed) so the new session does not inherit a mismatched saved session id.
    if (savedReview || getLatestSessionId(reviewAgentId)) {
      try { await wipeAgentStateDirs(opts.issueId, { rolePrefix: 'review' }); }
      catch (wipeErr) { console.warn(`[review-agent] review state wipe before fresh spawn failed (non-fatal): ${wipeErr instanceof Error ? wipeErr.message : String(wipeErr)}`); }
    }
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      prompt,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.harness ? { harness: opts.harness } : {}),
      ...(allowHost ? { allowHost: true } : {}),
      startedBy: 'review-agent',
    });
    // Persist the runId on the synthesis agent's own state so the idempotency
    // guard above can tell a genuinely-running review (runId matches current
    // HEAD) from a finished-but-idle leftover (runId from an older HEAD) — see
    // PAN-1131. Sub-reviewers already persist this; the synthesis agent did not.
    run.reviewRunId = runId;
    // PAN-2584: arm the parent's liveness deadline for this cycle.
    run.reviewDeadlineAt = new Date(Date.now() + PARENT_REVIEW_TIMEOUT_MS).toISOString();
    try {
      await Effect.runPromise(saveAgentState(run));
    } catch (saveErr) {
      console.warn(`[review-agent] Could not persist reviewRunId on ${run.id}:`, saveErr);
    }
    if (fullReview) {
      await spawnConvoyReviewers(run.id);
      console.log(`[review-agent] Review role (convoy synthesis) spawned for ${opts.issueId}: ${run.id}`);
      emitActivityEntry({ source: 'review', level: 'info', message: `Convoy review spawned for ${opts.issueId}: ${run.id}`, issueId: opts.issueId });
      return {
        success: true,
        message: `Convoy review spawned: ${run.id}`,
      };
    }

    console.log(`[review-agent] Review role (self-review) spawned for ${opts.issueId}: ${run.id}`);
    emitActivityEntry({ source: 'review', level: 'info', message: `Self-review spawned for ${opts.issueId}: ${run.id}`, issueId: opts.issueId });

    return {
      success: true,
      message: `Self-review spawned: ${run.id}`,
    };
  } catch (err) {
    console.error(`[review-agent] Failed to spawn review role for ${opts.issueId}:`, err);
    // PAN-3674: tear down the half-started runtime this dispatch created so a
    // later resume does not attach to a wedge — on 2026-08-13 the PAN-3668
    // orchestrator's app-server host sat alive-but-socketless in its pane for
    // 5h after a readiness timeout, invisible to every liveness reader (its
    // state row still said 'starting'). Only tear down what THIS dispatch
    // created: an older startedAt means a pre-existing session that must not
    // be killed here.
    try {
      const orphan = getAgentState(reviewSessionName);
      const orphanStartedMs = orphan?.startedAt ? Date.parse(orphan.startedAt) : Number.NaN;
      const createdByThisDispatch = orphan !== null && orphan !== undefined
        && Number.isFinite(orphanStartedMs) && orphanStartedMs >= dispatchStartedAtMs - 5_000;
      if (createdByThisDispatch) {
        const sessions = await Effect.runPromise(listSessionNames()).catch(() => [] as string[]);
        if (sessions.includes(reviewSessionName)) {
          await Effect.runPromise(killSession(reviewSessionName)).catch(() => {});
        }
        orphan.status = 'error';
        const { saveAgentState } = await import('../agents.js');
        await Effect.runPromise(saveAgentState(orphan)).catch(() => {});
      }
    } catch { /* teardown is best-effort; the status write below still lands */ }
    return {
      success: false,
      message: 'Failed to spawn review role',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { isReviewSessionForIssue };

/**
 * Kill all canonical reviewer sessions for one issue.
 *
 * PAN-915: this is no longer called per-round. Canonical reviewer sessions
 * persist across review rounds via PAN-830's `remain-on-exit on` so each
 * round resumes the same Claude process via `sendKeysAsync` — preserving
 * the reviewer's accumulated context (codebase patterns, prior findings,
 * decisions made during earlier rounds). This function is now invoked from
 * terminal lifecycle events: merge complete, reset, cancel, deep-wipe, and
 * explicit `pan review abort`.
 *
 * Matches the parent review role, convoy children, and legacy coordinator
 * sessions so callers do not need to know which review phase has started.
 * Session-kill failures are aggregated into `failed`; this never rejects.
 */
export async function killAllReviewerSessions(
  projectKey: string | undefined,
  issueId: string,
): Promise<{ killed: string[]; failed: string[] }> {
  const killed: string[] = [];
  const failed: string[] = [];
  let allSessions: readonly string[];

  try {
    allSessions = await Effect.runPromise(listSessionNames());
  } catch (err) {
    console.warn('[review-agent] Failed to list tmux sessions during reviewer cleanup:', err instanceof Error ? err.message : String(err));
    return {
      killed,
      failed: [`agent-${issueId.toLowerCase()}-review`],
    };
  }

  const sessionsToKill = allSessions.filter(s => isReviewSessionForIssue(s, projectKey, issueId));
  await Promise.all(
    sessionsToKill.map(async (sessionName) => {
      try {
        await Effect.runPromise(killSession(sessionName));
        console.log(`[review-agent] Killed reviewer session ${sessionName}`);
        killed.push(sessionName);
      } catch (err) {
        console.log(`[review-agent] Session ${sessionName} already gone or failed to kill: ${err instanceof Error ? err.message : String(err)}`);
        failed.push(sessionName);
      }
    }),
  );
  return { killed, failed };
}

/**
 * Kill every review session (any issue) during shutdown. Session-kill failures
 * are aggregated into `failed`; this never rejects.
 */
export async function killAllReviewSessions(): Promise<{ killed: string[]; failed: string[] }> {
  const killed: string[] = [];
  const failed: string[] = [];

  let allSessions: readonly string[];
  try {
    allSessions = await Effect.runPromise(listSessionNames());
  } catch (err) {
    console.warn('[review-agent] Failed to list tmux sessions during review cleanup:', err instanceof Error ? err.message : String(err));
    return { killed, failed };
  }

  const reviewPatterns = [
    /^agent-[a-z0-9-]+-review(?:-(?:security|correctness|performance|requirements))?$/i,
    /^review-coordinator-/,
    /^specialist-.+-review-/,
    /^review-[A-Z0-9]+-\d+-\d+/, // legacy: review-PAN-999-1713456789000-correctness
  ];

  const sessionsToKill = allSessions.filter(s => reviewPatterns.some(p => p.test(s)));
  if (sessionsToKill.length === 0) {
    return { killed, failed };
  }

  console.log(`[review-agent] Killing ${sessionsToKill.length} review session(s) during shutdown`);

  await Promise.all(
    sessionsToKill.map(async (sessionName) => {
      try {
        await Effect.runPromise(killSession(sessionName));
        console.log(`[review-agent] Killed review session ${sessionName}`);
        killed.push(sessionName);
      } catch (err) {
        console.log(`[review-agent] Session ${sessionName} already gone or failed to kill: ${err instanceof Error ? err.message : String(err)}`);
        failed.push(sessionName);
      }
    }),
  );

  return { killed, failed };
}

// ─── Effect API ──────────────────────────────────────────────────────────────

// PAN-2695: dispatch has multiple legitimate callers (request route, deacon
// reconcile, dispatch reconcile) that can fire near-simultaneously. An
// uncoalesced second invocation sees the first's milliseconds-old agent state,
// takes the PAN-1862 resume path against a parent that is still booting, and
// kills it with the synthesis kickoff undelivered. Coalesce per issue: a
// concurrent caller awaits the in-flight dispatch's result instead of re-entering.
const reviewDispatchCoalescer = createPromiseCoalescer<{ success: boolean; message: string; error?: string; gated?: boolean }>();

export const spawnReviewRoleForIssue = (
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string; harness?: RuntimeName; force?: boolean; allowHost?: boolean; reviewMode?: ReviewMode },
): Effect.Effect<{ success: boolean; message: string; error?: string; gated?: boolean }> =>
  Effect.promise(() => {
    const key = opts.issueId.toUpperCase();
    if (reviewDispatchCoalescer.isInFlight(key)) {
      console.log(`[review-agent] Review dispatch already in flight for ${key} — coalescing concurrent dispatch (PAN-2695)`);
    }
    return reviewDispatchCoalescer.run(
      key,
      () => withReviewLifecycleGuard(key, () => spawnReviewRoleForIssueBody(opts)),
    );
  });

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

// PAN-1862 resume-vs-fresh decision lives in its own pure module (review-resume-decision.ts) so
// it is unit-testable without importing this heavy file. Re-exported for external callers.
export { reviewResumeDecision } from './review-resume-decision.js';
// PAN-1862: convoy machinery lives in review-convoy.ts; re-exported here so the
// deacon modules, tests, and the CLI keep one stable import surface.
export {
  buildConvoyPrompt,
  spawnReviewSubRoleForIssue,
  recoverMissingConvoyReviewers,
} from './review-convoy.js';

/**
 * PAN-3917: the per-issue record override is gone with the record. Review mode
 * is project/global configuration; a one-off run passes its own `reviewMode`
 * to `spawnReviewRoleForIssue`, which applies to that run only.
 */
export function resolveReviewMode(_issueId?: string): ReviewMode {
  const configMode = loadYamlConfig().config.roles?.review?.mode;
  return configMode === 'full' || configMode === 'none' ? configMode : 'quick';
}

/**
 * Is EXTENDED (convoy) review enabled for this issue?
 *
 * `resolveReviewMode` is the single source of truth: merged project/global
 * config, with quick as the default.
 */
export function isExtendedReviewEnabled(issueId?: string): boolean {
  return resolveReviewMode(issueId) === 'full';
}

/**
 * Tear down an issue's entire review fleet — the `agent-<id>-review` parent plus any
 * extended-mode sub-reviewers. Kills every review tmux session, then removes each agent
 * through the canonical transcript-preserving removal path. Does NOT reset review_status —
 * the caller composes that (see the
 * POST /api/review/:id/purge route). Returns what was killed and removed.
 */
export async function purgeReviewAgentsForIssue(
  projectKey: string | undefined,
  issueId: string,
): Promise<{ killed: string[]; removed: string[] }> {
  const killResult = await killAllReviewerSessions(projectKey, issueId);
  const removed: string[] = [];
  for (const agentId of listAgentIdsByPrefix(`agent-${issueId.toLowerCase()}-review`)) {
    await removeAgent(agentId);
    removed.push(agentId);
  }
  return { killed: killResult.killed, removed };
}
