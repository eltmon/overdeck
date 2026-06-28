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
 * launches four isolated review sub-role sessions via `pan review spawn-reviewer`,
 * then writes the report and signals the verdict via Overdeck's CLI inside
 * the role itself (see roles/review.md).
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
import { mkdir, readFile, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { killSession, listSessionNames, isPaneDead } from '../tmux.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { removeAgentSync, listAgentIdsByPrefixSync } from '../overdeck/agents.js';
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import { loadConfigSync as loadYamlConfig, resolveModel, type ReviewMode } from '../config-yaml.js';
import { buildReviewContext, formatTier1Summary, type ReviewContextManifest } from './review-context.js';
import { buildRealConflictGateDeps, getCachedConflictGateMergeability, resolveConflictGate } from './conflict-gate.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';
import { reviewResumeDecision } from './review-resume-decision.js';
import { readIssueRecordSync, resolveProjectForIssue } from '../pan-dir/record.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR, packageRoot } from '../paths.js';
import { getAgentStateSync } from '../agents.js';
import type { RuntimeName } from '../runtimes/types.js';

/**
 * Read a convoy sub-role prompt template from the overdeck install.
 *
 * Sub-role prompts are harness-agnostic templates owned by Overdeck. The
 * orchestrator reads them from its own install (packageRoot/roles/) and
 * inlines the body into the spawn message — they never live in the agent's
 * workspace, and they are never loaded via the Claude-specific `--agent` flag.
 * That keeps the same prompt content driving Claude Code, Pi, Codex, or any
 * future harness, and prevents a work agent from ambiently discovering its
 * own reviewer prompts in the workspace tree.
 */
async function readConvoySubRoleTemplate(subRole: string): Promise<string> {
  const path = join(packageRoot, 'roles', `review-${subRole}.md`);
  return readFile(path, 'utf-8');
}

const execAsync = promisify(exec);
const REVIEWER_TIMEOUT_MS = 20 * 60 * 1000;

function reviewerAgentId(issueId: string, subRole: ReviewSubRole): string {
  return `agent-${issueId.toLowerCase()}-review-${subRole}`;
}

function reviewerAgentOutputPath(workspace: string, runId: string, subRole: ReviewSubRole): string {
  return join(workspace, PAN_DIRNAME, 'review', runId, `${subRole}.md`);
}

// PAN-1531: review-temp stash helpers removed.
// Review now runs against the committed diff only. The dirty-worktree gate
// at pan done time (and the same gate added to /api/review/:id/request)
// guarantees the worktree is clean before specialists see the diff.

async function buildConvoyPromptPromise(opts: {
  issueId: string;
  subRole: string;
  outputPath: string;
  synthesisAgentId: string;
  contextManifestPath?: string;
  tier1Summary?: string;
}): Promise<string> {
  const template = await readConvoySubRoleTemplate(opts.subRole);
  const prompt = [
    `REVIEW TASK for ${opts.issueId} — ${opts.subRole.toUpperCase()} REVIEW:`,
    '',
    `Issue: ${opts.issueId}`,
    `Sub-role: ${opts.subRole}`,
    '',
    'Output file — write your full findings here when done:',
    `  ${opts.outputPath}`,
    '',
    opts.tier1Summary
      ? [
          'Shared review context (read this first; do not run git diff yourself):',
          '─────────────────────────────────────────────────────────────',
          opts.tier1Summary,
          '─────────────────────────────────────────────────────────────',
          '',
          opts.contextManifestPath
            ? `Full manifest (read on demand for additional detail): ${opts.contextManifestPath}`
            : '',
        ].join('\n')
      : opts.contextManifestPath
        ? [
            'Context manifest (read this first; do not run git diff yourself):',
            `  ${opts.contextManifestPath}`,
            'The manifest contains per-file risk ranking and acceptance criteria.',
          ].join('\n')
        : 'No context manifest available. Write a blocked reviewer report explaining that the shared review context is missing.',
    '',
    '─────────────────────────────────────────────────────────────',
    'REVIEW METHODOLOGY (inlined from roles/review-' + opts.subRole + '.md):',
    '─────────────────────────────────────────────────────────────',
    '',
    template.trim(),
    '',
    '─────────────────────────────────────────────────────────────',
    '',
    'Write exactly one final report to the output file shown above, then stop',
    'and wait. You do NOT need to signal synthesis or run any pan command —',
    'when you finish your turn with the report written, Overdeck detects it',
    'and signals the synthesis agent REVIEWER_READY automatically. Your only',
    'job is to write the report file, then stop.',
    'Only the output file is consumed by synthesis; your chat response is not the review report.',
  ].filter(Boolean).join('\n');

  const sizeBytes = Buffer.byteLength(prompt, 'utf-8');
  console.log(`[review-agent] Convoy prompt for ${opts.issueId}/${opts.subRole}: ${sizeBytes} bytes`);
  return prompt;
}

function buildReviewRolePrompt(opts: {
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
  const synthesisPath = join(opts.reviewDir, 'synthesis.md');
  const prompt = [
    `STANDBY — REVIEW SYNTHESIS for ${opts.issueId}`,
    '',
    'Do NOT do anything yet. The Overdeck server has already spawned the four',
    'convoy reviewers (security, correctness, performance, requirements) and they',
    'are running in parallel right now. Your work begins only once they finish.',
    '',
    'You will receive exactly one `pan tell` signal per sub-role as each reviewer',
    'finishes — these are delivered to you as user messages:',
    expectedSignals,
    '',
    'Until all four terminal signals have arrived: do nothing. Do not read the',
    'reviewer output files, do not run git, do not inspect tmux sessions, do not',
    'poll anything. Just wait — the reviewers notify you when they finish, and',
    'Deacon is the failsafe if one never starts or never completes. Acting early',
    'wastes tokens reviewing nothing.',
    '',
    'Once you have all four terminal signals, follow roles/review.md exactly to',
    'read the reports, synthesize the verdict, write the synthesis report, and',
    'signal the status.',
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
    `  pan admin specialists done review ${opts.issueId} --status passed --notes "<one-line summary>"`,
    `  pan admin specialists done review ${opts.issueId} --status blocked --notes "<one-line top blocker>"`,
    '',
    // PAN-2007: do NOT tell the agent to `exit`. The session is kept alive through
    // the pipeline (KEEP_SPECIALIST_SESSIONS_ALIVE) so it can be reused for the next
    // review cycle without a cold re-spawn. Exiting before the signal command is
    // what stranded reviews at reviewStatus=reviewing.
    'After running the signal command above, STOP and wait — do not exit, do not run',
    'any further commands. The session stays open for the next review cycle.',
    '',
    'Reactive Cloister dispatches the test role after review passes. Never queue tests yourself and never edit code.',
  ].filter(Boolean).join('\n');

  const sizeBytes = Buffer.byteLength(prompt, 'utf-8');
  console.log(`[review-agent] Synthesis prompt for ${opts.issueId}: ${sizeBytes} bytes`);
  return prompt;
}

// PAN-1981 (quick path to production): the review role agent reviews the diff
// ITSELF — no convoy, no synthesis. `buildReviewRolePrompt` above (the synthesis
// "stand by, wait for the convoy" prompt) is kept for when we restore the convoy
// as an opt-in (#1982 fast-follow); for now the review agent gets this self-review
// prompt instead. We will decide convoy-vs-self-review (and better per-harness
// message transmission) in the fast-follow.
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
  const reviewReportPath = join(opts.reviewDir, 'review.md');
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
        : 'Context manifest: (missing — inspect the diff directly: git diff origin/main...HEAD)',
    '',
    'How to review:',
    '1. Read the diff — use the manifest risk ranking, `git diff` the high-risk files,',
    '   and read the surrounding code as needed.',
    '2. Evaluate correctness, security, requirements/AC, and performance. Use the',
    '   severity + verdict vocabulary in roles/review.md.',
    `3. Write your findings to ${reviewReportPath}.`,
    '',
    'Then signal the verdict with the Overdeck CLI (exactly one):',
    `  pan admin specialists done review ${opts.issueId} --status passed --notes "<one-line summary>"`,
    `  pan admin specialists done review ${opts.issueId} --status blocked --notes "<one-line top blocker>"`,
    '',
    // PAN-2007: do NOT tell the agent to `exit`. The session is kept alive through
    // the pipeline (KEEP_SPECIALIST_SESSIONS_ALIVE) so it can be reused for the next
    // review cycle without a cold re-spawn. Exiting before the signal command is
    // what stranded reviews at reviewStatus=reviewing.
    'After running the signal command above, STOP and wait — do not exit, do not run',
    'any further commands. The session stays open for the next review cycle.',
    '',
    'Reactive Cloister dispatches the test role after review passes. Never queue tests yourself and never edit code.',
  ].filter(Boolean).join('\n');

  const sizeBytes = Buffer.byteLength(prompt, 'utf-8');
  console.log(`[review-agent] Self-review prompt for ${opts.issueId}: ${sizeBytes} bytes`);
  return prompt;
}async function spawnReviewSubRoleForIssuePromise(opts: {
  issueId: string;
  workspace: string;
  subRole: ReviewSubRole;
  runId: string;
  outputPath?: string;
  contextManifestPath?: string;
  synthesisAgentId?: string;
  model?: string;
  harness?: RuntimeName;
  allowHost?: boolean;
}): Promise<{ success: boolean; message: string; error?: string; sessionId?: string }> {
  try {
    const { saveAgentState, spawnRun, getAgentStateSync, getLatestSessionIdSync, resumeAgent } = await import('../agents.js');
    const cfg = loadYamlConfig().config;
    const outputPath = opts.outputPath ?? reviewerAgentOutputPath(opts.workspace, opts.runId, opts.subRole);
    const synthesisAgentId = opts.synthesisAgentId ?? `agent-${opts.issueId.toLowerCase()}-review`;
    const model = opts.model ?? resolveModel('review', opts.subRole, cfg, opts.subRole ? undefined : `review:${opts.issueId}`);
    const reviewerDir = join(AGENTS_DIR, reviewerAgentId(opts.issueId, opts.subRole));

    await mkdir(dirname(outputPath), { recursive: true });
    await rm(outputPath, { force: true });
    await rm(join(reviewerDir, 'reviewer-signaled'), { force: true });
    await rm(join(reviewerDir, 'reviewer-launcher.pid'), { force: true });

    // Build Tier-1 inline summary from manifest when available (PAN-1125)
    let tier1Summary: string | undefined;
    if (opts.contextManifestPath) {
      try {
        const manifestRaw = await readFile(opts.contextManifestPath, 'utf-8');
        const manifest = JSON.parse(manifestRaw) as ReviewContextManifest;
        tier1Summary = formatTier1Summary(manifest);
      } catch (manifestErr) {
        console.warn(`[review-agent] Failed to read manifest for Tier-1 summary (${opts.issueId}/${opts.subRole}):`, manifestErr);
      }
    }

    const prompt = await Effect.runPromise(buildConvoyPrompt({
      issueId: opts.issueId,
      subRole: opts.subRole,
      outputPath,
      synthesisAgentId,
      contextManifestPath: opts.contextManifestPath,
      tier1Summary,
    }));

    // PAN-1862: convoy sub-reviewers RESUME by default too — same rule as quick review. Each
    // lane keeps its prior round's context so a re-review checks the fix instead of re-reading
    // the whole diff. Fresh-spawn only on a harness/model change or when no session exists.
    const reviewerAgent = reviewerAgentId(opts.issueId, opts.subRole);
    const savedReviewer = getAgentStateSync(reviewerAgent);
    const canResumeReviewer = reviewResumeDecision({
      requestedModel: opts.model ?? model,
      requestedHarness: opts.harness,
      savedModel: savedReviewer?.model,
      savedHarness: savedReviewer?.harness,
      hasSavedState: !!savedReviewer,
      hasSavedSession: !!getLatestSessionIdSync(reviewerAgent),
    });
    if (canResumeReviewer) {
      console.log(`[review-agent] Resuming convoy sub-reviewer ${opts.subRole} for ${opts.issueId} — preserving context (PAN-1862)`);
      const resumeResult = await resumeAgent(reviewerAgent, prompt);
      if (resumeResult.success) {
        try {
          const resumed = getAgentStateSync(reviewerAgent);
          if (resumed) {
            resumed.reviewSubRole = opts.subRole;
            resumed.reviewRunId = opts.runId;
            resumed.reviewOutputPath = outputPath;
            resumed.reviewSynthesisAgentId = synthesisAgentId;
            resumed.reviewDeadlineAt = new Date(Date.now() + REVIEWER_TIMEOUT_MS).toISOString();
            await Effect.runPromise(saveAgentState(resumed));
          }
        } catch { /* non-fatal */ }
        return { success: true, message: `Review ${opts.subRole} resumed (session preserved): ${reviewerAgent}`, sessionId: reviewerAgent };
      }
      console.warn(`[review-agent] Convoy sub-reviewer ${opts.subRole} resume failed; falling back to a fresh session: ${resumeResult.error}`);
    }

    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      subRole: opts.subRole,
      prompt,
      model,
      harness: opts.harness,
      // PAN-977: thread the synthesis wiring up front so the generated launcher
      // owns the REVIEWER_READY/FAILED/TIMEOUT signal deterministically.
      reviewSynthesisAgentId: synthesisAgentId,
      reviewOutputPath: outputPath,
      allowHost: opts.allowHost ?? false,
    });
    run.reviewSubRole = opts.subRole;
    run.reviewRunId = opts.runId;
    run.reviewOutputPath = outputPath;
    run.reviewSynthesisAgentId = synthesisAgentId;
    run.reviewDeadlineAt = new Date(Date.now() + REVIEWER_TIMEOUT_MS).toISOString();
    await Effect.runPromise(saveAgentState(run));
    try {
      const { notifyPipelineSync } = await import('../pipeline-notifier.js');
      notifyPipelineSync({ type: 'reviewer_started', issueId: opts.issueId, role: opts.subRole, sessionName: run.id });
    } catch {
      // Non-fatal
    }
    return { success: true, message: `Review ${opts.subRole} spawned: ${run.id}`, sessionId: run.id };
  } catch (err) {
    return {
      success: false,
      message: `Failed to spawn review ${opts.subRole}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}async function spawnReviewRoleForIssuePromise(
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string; harness?: RuntimeName; force?: boolean; allowHost?: boolean },
): Promise<{ success: boolean; message: string; error?: string; gated?: boolean }> {
  const reviewSessionName = `agent-${opts.issueId.toLowerCase()}-review`;

  // Idempotency: if a review role agent for this issue already has an alive
  // tmux pane, treat the current dispatch as a no-op. spawnRun has its own
  // session-exists check but it throws — we want soft "already running"
  // semantics so callers can keep their existing success-path messaging.
  //
  // Force mode (human override from dashboard) kills the old session and
  // respawns so the review runs against current HEAD, not stale state.
  try {
    const sessions = await Effect.runPromise(listSessionNames());
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
      if (!paneDead && !opts.force) {
        try {
          const { stdout } = await execAsync('git rev-parse --short=8 HEAD', {
            cwd: opts.workspace,
            encoding: 'utf-8',
          });
          const currentRunId = `agent-${opts.issueId.toLowerCase()}-review-${stdout.trim()}`;
          const synthReviewRunId = getAgentStateSync(reviewSessionName)?.reviewRunId;
          // Stale when the existing session carries a runId that does not match
          // the current HEAD. If it carries no runId at all (legacy session
          // from before this field was persisted), stay conservative and keep
          // the "skip" behaviour so we never kill a genuinely-running review.
          if (synthReviewRunId && synthReviewRunId !== currentRunId) {
            staleRunId = true;
            console.log(
              `[review-agent] ${reviewSessionName} is stale — runId ${synthReviewRunId} != current ${currentRunId}; killing convoy and respawning`,
            );
          }
        } catch (probeErr) {
          console.warn(
            `[review-agent] Could not probe ${reviewSessionName} runId, falling back to pane-alive idempotency:`,
            probeErr,
          );
        }
      }

      if (!paneDead && !opts.force && !staleRunId) {
        console.log(`[review-agent] Idempotency guard: ${reviewSessionName} already running for ${opts.issueId} — skipping spawn`);
        return { success: true, message: `Review already in progress: ${reviewSessionName}` };
      }
      // Session pane is dead, force mode, or stale runId — kill the whole convoy and respawn.
      const reason = opts.force ? 'force-killed for re-review' : paneDead ? 'pane is dead' : 'stale runId';
      console.log(`[review-agent] ${reviewSessionName} ${reason} — respawning convoy`);
      await Effect.runPromise(
        killAllReviewerSessions(undefined, opts.issueId).pipe(
          Effect.catch(() => Effect.succeed({ killed: [], failed: [] })),
        ),
      );
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
    setReviewStatusSync(opts.issueId, {
      reviewStatus: 'pending',
      reviewNotes: message,
    });
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
    setReviewStatusSync(opts.issueId, {
      reviewStatus: 'pending',
      reviewNotes: message,
    });
    return { success: false, gated: true, message };
  }

  // Clear feedback from any previous review cycle so the work agent only
  // sees current-cycle feedback when it reads .pan/feedback/.
  try {
    const { archiveFeedbackFiles } = await import('./feedback-writer.js');
    await Effect.runPromise(archiveFeedbackFiles(opts.workspace));
  } catch {
    // Non-fatal: archiving is best-effort
  }

  // PAN-1531: review-temp stash machinery removed. Reviewers see only the
  // committed diff because the dirty-worktree gate refuses pan done /
  // pan review request before reaching here. If callers somehow bypass the
  // gate, uncommitted scratch becomes visible in the review — that's the
  // correct fail-loud behavior, not a reason to silently stash.
  try {
    setReviewStatusSync(opts.issueId, {
      reviewStatus: 'reviewing',
      reviewSpawnedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[review-agent] Failed to set reviewing status for ${opts.issueId}:`, err);
    return {
      success: false,
      message: 'Failed to initialize review status',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const { notifyPipelineSync } = await import('../pipeline-notifier.js');
    notifyPipelineSync({ type: 'task_queued', specialist: 'review-agent', issueId: opts.issueId });
  } catch {
    // Non-fatal
  }

  try {
    const { spawnRun, saveAgentState, getAgentState, getAgentStateSync, getLatestSessionIdSync, resumeAgent, wipeAgentStateDirs } = await import('../agents.js');
    const workAgentState = await Effect.runPromise(getAgentState(`agent-${opts.issueId.toLowerCase()}`));
    const allowHost = opts.allowHost === true || workAgentState?.hostOverride === true;

    // Build the shared context manifest before spawning so all reviewers
    // read one pre-built diff+AC object instead of each running git diff
    // independently (PAN-1059).
    //
    // Include HEAD SHA in runId so re-reviews of the same issue get their own
    // directory and don't overwrite round-1 files (collision prevention).
    let headSha = 'unknown';
    try {
      const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: opts.workspace, encoding: 'utf-8' });
      headSha = stdout.trim();
    } catch { /* non-fatal — fall back to static runId */ }
    const runId = headSha !== 'unknown'
      ? `agent-${opts.issueId.toLowerCase()}-review-${headSha}`
      : `agent-${opts.issueId.toLowerCase()}-review`;
    const reviewDir = join(opts.workspace, PAN_DIRNAME, 'review', runId);
    let contextManifestPath: string | undefined;
    let tier1Summary: string | undefined;
    try {
      const manifest = await Effect.runPromise(buildReviewContext({
        runId,
        issueId: opts.issueId,
        workspace: opts.workspace,
        branch: opts.branch,
      }));
      contextManifestPath = manifest.manifestPath;
      tier1Summary = formatTier1Summary(manifest);
      console.log(`[review-agent] Context manifest built: ${contextManifestPath} (${manifest.changedFiles.length} files)`);
    } catch (ctxErr) {
      console.warn(`[review-agent] Context manifest build failed for ${opts.issueId} — reviewers will block on missing shared context:`, ctxErr);
    }

    // PAN-1981 (quick path to production): self-review — the review agent reviews
    // the diff itself. The convoy prompt builder + the four-reviewer spawn below
    // are kept (commented out, not deleted) to restore later as an opt-in; #1982.
    // const prompt = buildReviewRolePrompt({ ...opts, runId, reviewDir, contextManifestPath, tier1Summary });
    const prompt = buildSelfReviewPrompt({ ...opts, runId, reviewDir, contextManifestPath, tier1Summary });

    // PAN-1862: RESUME the saved review session by default. The review agent keeps the prior
    // review's context (the files it read, the findings it raised), so a re-review checks the
    // fix instead of re-researching the entire diff from scratch — the token-cost problem this
    // was set out to fix. Fresh-spawn ONLY when the harness/model actually changed (it's a
    // different agent then) or there is no resumable saved session. The resume delivery is
    // resilient (supervisor → tmux fallback, PAN-1988).
    const reviewAgentId = `agent-${opts.issueId.toLowerCase()}-review`;
    const savedReview = getAgentStateSync(reviewAgentId);
    const canResumeReview = reviewResumeDecision({
      requestedModel: opts.model,
      requestedHarness: opts.harness,
      savedModel: savedReview?.model,
      savedHarness: savedReview?.harness,
      hasSavedState: !!savedReview,
      hasSavedSession: !!getLatestSessionIdSync(reviewAgentId),
    });
    if (canResumeReview) {
      console.log(`[review-agent] Resuming saved review session for ${opts.issueId} — model/harness unchanged, preserving context (PAN-1862)`);
      const resumeResult = await resumeAgent(reviewAgentId, prompt);
      if (resumeResult.success) {
        try {
          // Keep the idempotency guard's HEAD-staleness detection honest for the resumed run.
          const resumed = getAgentStateSync(reviewAgentId);
          if (resumed) { resumed.reviewRunId = runId; await Effect.runPromise(saveAgentState(resumed)); }
        } catch { /* non-fatal */ }
        return { success: true, message: `Review resumed (session preserved): ${reviewAgentId}` };
      }
      console.warn(`[review-agent] Review resume failed for ${reviewAgentId}; falling back to a fresh session: ${resumeResult.error}`);
    }
    // Fresh review: wipe any stale review state (harness/model changed, or the resume above
    // failed) so the new session does not inherit a mismatched saved session id.
    if (savedReview || getLatestSessionIdSync(reviewAgentId)) {
      try { await wipeAgentStateDirs(opts.issueId, { rolePrefix: 'review' }); }
      catch (wipeErr) { console.warn(`[review-agent] review state wipe before fresh spawn failed (non-fatal): ${wipeErr instanceof Error ? wipeErr.message : String(wipeErr)}`); }
    }
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      prompt,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.harness ? { harness: opts.harness } : {}),
      ...(allowHost ? { allowHost: true } : {}),
    });
    // Persist the runId on the synthesis agent's own state so the idempotency
    // guard above can tell a genuinely-running review (runId matches current
    // HEAD) from a finished-but-idle leftover (runId from an older HEAD) — see
    // PAN-1131. Sub-reviewers already persist this; the synthesis agent did not.
    run.reviewRunId = runId;
    try {
      await Effect.runPromise(saveAgentState(run));
    } catch (saveErr) {
      console.warn(`[review-agent] Could not persist reviewRunId on ${run.id}:`, saveErr);
    }
    console.log(`[review-agent] Review role (self-review) spawned for ${opts.issueId}: ${run.id}`);
    emitActivityEntrySync({ source: 'review', level: 'info', message: `Self-review spawned for ${opts.issueId}: ${run.id}`, issueId: opts.issueId });

    // PAN-1981 (quick path to production): the convoy is DISABLED — the review
    // agent self-reviews (see buildSelfReviewPrompt) and signals the verdict
    // directly via `pan admin specialists done review`. The four-reviewer fan-out
    // below is commented out, NOT deleted, to restore later as an opt-in. We'll
    // decide convoy-vs-self-review policy (and better per-harness transmission) in
    // the #1982 fast-follow; for now self-review is the only behavior.
    /*
    const reviewerResults = await Promise.all(REVIEW_SUB_ROLES.map(async (subRole) => {
      const outputPath = reviewerAgentOutputPath(opts.workspace, runId, subRole);
      const result = await Effect.runPromise(spawnReviewSubRoleForIssue({
        issueId: opts.issueId,
        workspace: opts.workspace,
        subRole,
        runId,
        outputPath,
        contextManifestPath,
        synthesisAgentId: run.id,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.harness ? { harness: opts.harness } : {}),
        allowHost,
      }));
      if (!result.success) {
        try {
          const { messageAgent } = await import('../agents.js');
          await messageAgent(run.id, `REVIEWER_FAILED ${subRole} ${result.error ?? result.message}`);
        } catch (signalErr) {
          console.warn(`[review-agent] Failed to signal ${subRole} spawn failure to ${run.id}:`, signalErr);
        }
      }
      return result;
    }));

    const failedReviewers = reviewerResults.filter(r => !r.success);
    if (failedReviewers.length > 0) {
      console.warn(`[review-agent] Review role spawned for ${opts.issueId}, but ${failedReviewers.length} reviewer(s) failed to spawn`);
    }
    */

    return {
      success: true,
      message: `Self-review spawned: ${run.id}`,
    };
  } catch (err) {
    console.error(`[review-agent] Failed to spawn review role for ${opts.issueId}:`, err);
    setReviewStatusSync(opts.issueId, {
      reviewStatus: 'failed',
      reviewNotes: `Review role spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      success: false,
      message: 'Failed to spawn review role',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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
 */
export function isReviewSessionForIssue(sessionName: string, projectKey: string | undefined, issueId: string): boolean {
  const session = sessionName.toLowerCase();
  const issue = issueId.toLowerCase();
  const project = projectKey?.toLowerCase();

  // Belt-and-suspenders: a user conversation session (`conv-*`) must never be
  // classified as a reviewer session and swept into reviewer cleanup/kill.
  if (session.startsWith('conv-')) return false;

  if (session === `agent-${issue}-review` || session.startsWith(`agent-${issue}-review-`)) return true;
  if (session.startsWith(`review-${issue}-`) || session.startsWith(`review-coordinator-${issue}-`)) return true;
  if (!project) return false;
  if (session === `specialist-${project}-${issue}-review-agent`) return true;
  return session.startsWith(`specialist-${project}-${issue}-review-`);
}async function killAllReviewerSessionsPromise(
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
    return { killed, failed };
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
}async function killAllReviewSessionsPromise(): Promise<{ killed: string[]; failed: string[] }> {
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

// ─── Effect variants (PAN-1249) ──────────────────────────────────────────────

/**
 * Effect variant of {@link buildConvoyPrompt}. Template reads are the only
 * fallible step; any failure here is fatal and propagates via Effect's defect
 * channel through `Effect.promise`.
 */
export const buildConvoyPrompt = (opts: {
  issueId: string;
  subRole: string;
  outputPath: string;
  synthesisAgentId: string;
  contextManifestPath?: string;
  tier1Summary?: string;
}): Effect.Effect<string> => Effect.promise(() => buildConvoyPromptPromise(opts));

/**
 * Effect variant of {@link spawnReviewSubRoleForIssue}. The Promise version
 * already aggregates errors into the structured result shape, so the Effect
 * form lifts via `Effect.promise`.
 */
export const spawnReviewSubRoleForIssue = (opts: {
  issueId: string;
  workspace: string;
  subRole: ReviewSubRole;
  runId: string;
  outputPath?: string;
  contextManifestPath?: string;
  synthesisAgentId?: string;
  model?: string;
  harness?: RuntimeName;
  allowHost?: boolean;
}): Effect.Effect<{ success: boolean; message: string; error?: string; sessionId?: string }> =>
  Effect.promise(() => spawnReviewSubRoleForIssuePromise(opts));

/**
 * Effect variant of {@link spawnReviewRoleForIssue}. The Promise version
 * returns a structured result instead of throwing, so the Effect form lifts
 * via `Effect.promise`.
 */
export const spawnReviewRoleForIssue = (
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string; harness?: RuntimeName; force?: boolean; allowHost?: boolean },
): Effect.Effect<{ success: boolean; message: string; error?: string; gated?: boolean }> =>
  Effect.promise(() => spawnReviewRoleForIssuePromise(opts));

/**
 * Effect variant of {@link killAllReviewerSessions}. Session-kill failures are
 * already aggregated into the `failed` array — this wrapper preserves that
 * contract.
 */
export const killAllReviewerSessions = (
  projectKey: string | undefined,
  issueId: string,
): Effect.Effect<{ killed: string[]; failed: string[] }> =>
  Effect.promise(() => killAllReviewerSessionsPromise(projectKey, issueId));

/**
 * Effect variant of {@link killAllReviewSessions}. Same aggregation semantics
 * as the Promise version.
 */
export const killAllReviewSessions = (): Effect.Effect<{ killed: string[]; failed: string[] }> =>
  Effect.promise(() => killAllReviewSessionsPromise());

// PAN-1862 resume-vs-fresh decision lives in its own pure module (review-resume-decision.ts) so
// it is unit-testable without importing this heavy file. Re-exported for external callers.
export { reviewResumeDecision } from './review-resume-decision.js';

/**
 * Is the issue carrying leftover EXTENDED-review (convoy) sub-reviewer agents from a
 * prior cycle? Quick-review — the current hardcoded mode — only ever creates the single
 * `agent-<id>-review` parent, so any `agent-<id>-review-<subRole>` is a stale ghost
 * (e.g. PAN-1866's `-correctness/-security/-performance/-requirements` from an old run).
 *
 * Seam for when extended review returns: this becomes a reviewRunId-mismatch check — a
 * sub-reviewer is stale only when its run differs from the active review run.
 */
export function isReviewStaleSync(issueId: string): boolean {
  return listAgentIdsByPrefixSync(`agent-${issueId.toLowerCase()}-review-`).length > 0;
}

export function resolveReviewMode(issueId?: string): ReviewMode {
  if (issueId) {
    const project = resolveProjectForIssue(issueId);
    const issueMode = project ? readIssueRecordSync(project, issueId)?.reviewMode : undefined;
    if (issueMode === 'quick' || issueMode === 'full') {
      return issueMode;
    }
  }

  const configMode = loadYamlConfig().config.roles?.review?.mode;
  return configMode === 'full' ? 'full' : 'quick';
}

/**
 * Is EXTENDED (convoy) review enabled for this issue?
 *
 * `resolveReviewMode` is the single source of truth: per-issue record override
 * beats merged project/global config, and quick remains the default.
 */
export function isExtendedReviewEnabled(issueId?: string): boolean {
  return resolveReviewMode(issueId) === 'full';
}

/**
 * Tear down an issue's entire review fleet — the `agent-<id>-review` parent plus any
 * extended-mode sub-reviewers. Kills every review tmux session, then removes each agent
 * via the canonical removeAgentSync (overdeck.db row + state dir, never the JSONL
 * transcript). Does NOT reset review_status — the caller composes that (see the
 * POST /api/review/:id/purge route). Returns what was killed and removed.
 */
export async function purgeReviewAgentsForIssue(
  projectKey: string | undefined,
  issueId: string,
): Promise<{ killed: string[]; removed: string[] }> {
  const killResult = await killAllReviewerSessionsPromise(projectKey, issueId);
  const removed: string[] = [];
  for (const agentId of listAgentIdsByPrefixSync(`agent-${issueId.toLowerCase()}-review`)) {
    removeAgentSync(agentId);
    removed.push(agentId);
  }
  return { killed: killResult.killed, removed };
}
