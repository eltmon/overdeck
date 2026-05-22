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
 * reactive scheduler review branch, the dashboard kanban "Review again"
 * button, postMergeLifecycle's review-temp stash drop — flows through
 * spawnReviewRoleForIssue → spawnRun(issueId, 'review'). The review role
 * launches four isolated review sub-role sessions via `pan review spawn-reviewer`,
 * then writes the report and signals the verdict via Panopticon's CLI inside
 * the role itself (see roles/review.md).
 *
 * Surface area kept:
 *   - spawnReviewRoleForIssue       — the only review entry point
 *   - cleanupReviewTempStash        — drop the review-temp stash on terminal
 *                                     lifecycle events (postMergeLifecycle,
 *                                     workspaces.ts review-reset paths)
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
import { killSessionAsyncEffect, listSessionNamesAsyncEffect, isPaneDeadAsyncEffect } from '../tmux.js';
import { emitActivityEntry } from '../activity-logger.js';
import { buildStashMessage, createNamedStash, dropStash, getNextReviewTempSequence, listStashes } from '../stashes.js';
import { getReviewStatus, setReviewStatus } from '../review-status.js';
import { loadConfig as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { buildReviewContext, formatTier1Summary, type ReviewContextManifest } from './review-context.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR, packageRoot } from '../paths.js';

/**
 * Read a convoy sub-role prompt template from the panopticon-cli install.
 *
 * Sub-role prompts are harness-agnostic templates owned by Panopticon. The
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

async function ensureReviewTempStash(issueId: string, workspace: string): Promise<{ ref: string; message: string; sequence: number } | null> {
  // Drop any prior cycle's review-temp stash before creating a new one. Without
  // this, accumulated stashes from previous rounds leak — PAN-1030 left ten
  // review-temp:PAN-1030:1..10 stashes behind because each round's cleanup
  // drops the *current* ref but `setReviewStatus` overwrites the ref before
  // cleanup runs, so the prior round's ref gets orphaned. Drop-then-create is
  // the only ordering that guarantees no orphans.
  const priorStatus = getReviewStatus(issueId);
  if (priorStatus?.reviewTempStashRef) {
    try {
      await dropStash(workspace, priorStatus.reviewTempStashRef);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/not found|does not exist/i.test(message)) {
        console.error(`[review-agent] Failed to drop prior review-temp stash for ${issueId} (non-fatal):`, err);
      }
    }
  }

  const { stdout } = await execAsync('git status --porcelain', {
    cwd: workspace,
    encoding: 'utf-8',
  });
  if (!stdout.trim()) return null;

  const existingEntries = await listStashes(workspace);
  const sequence = getNextReviewTempSequence(existingEntries, issueId);
  const message = buildStashMessage('review-temp', issueId, sequence);
  // We read porcelain status immediately before stashing and rely on review orchestration being
  // single-threaded per workspace; if another actor clears the dirtiness window before stash push,
  // createNamedStash can legitimately return null and the review should just continue without one.
  const ref = await createNamedStash(workspace, message, true);
  if (!ref) return null;

  return { ref, message, sequence };
}

export async function cleanupReviewTempStash(issueId: string, workspace: string): Promise<void> {
  const status = getReviewStatus(issueId);
  if (!status?.reviewTempStashRef) return;

  try {
    await dropStash(workspace, status.reviewTempStashRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|does not exist/i.test(message)) {
      throw error;
    }
  }

  setReviewStatus(issueId, {
    reviewTempStashRef: undefined,
    reviewTempStashMessage: undefined,
    reviewTempStashSequence: undefined,
  });
}

/**
 * Build the spawn message for one convoy sub-role reviewer.
 *
 * The body of `roles/review-<subRole>.md` is the harness-agnostic prompt
 * template Panopticon owns. The orchestrator reads it and inlines it here
 * so every harness (Claude Code, Pi, Codex) receives the same instructions
 * as the first user message. No `--agent` flag, no workspace file lookup,
 * no auto-discovered subagent — the prompt arrives through the workflow.
 *
 * The wrapper around the body supplies the per-run identifiers the template
 * references abstractly: the assigned output file path and the shared
 * context manifest path.
 */
export async function buildConvoyPrompt(opts: {
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
    'Write exactly one final report to the output file shown above, then stop.',
    'You do NOT need to signal synthesis or run any pan command. The Panopticon',
    'launcher that started you detects your completion on process exit and signals',
    'the synthesis agent automatically — REVIEWER_READY when the output file was',
    'written, REVIEWER_FAILED otherwise. Your only job is to write the report file.',
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
    'Do NOT do anything yet. The Panopticon server has already spawned the four',
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
    'After writing the synthesis report, signal the verdict with Panopticon CLI:',
    `  pan admin specialists done review ${opts.issueId} --status passed --notes "<one-line summary>"`,
    `  pan admin specialists done review ${opts.issueId} --status blocked --notes "<one-line top blocker>"`,
    '',
    'After signaling the verdict, exit Claude Code cleanly so the tmux session ends:',
    '  exit',
    '',
    'Reactive Cloister dispatches the test role after review passes. Never queue tests yourself and never edit code.',
  ].filter(Boolean).join('\n');

  const sizeBytes = Buffer.byteLength(prompt, 'utf-8');
  console.log(`[review-agent] Synthesis prompt for ${opts.issueId}: ${sizeBytes} bytes`);
  return prompt;
}

/**
 * Spawn the `review` role for an issue using the unified role primitive
 * (spawnRun). The review role launches the four review sub-role sessions,
 * synthesizes their findings, and signals the verdict through
 * `pan specialists done review`. This wrapper carries the lifecycle concerns
 * the deleted dispatchParallelReview owned (idempotency check, feedback
 * archive, review-temp stash, reviewing-status flip, pipeline event).
 *
 * On failure: cleanup review-temp stash, flip status to failed with the
 * spawn error in reviewNotes so the dashboard surfaces the breakage.
 */
export async function spawnReviewSubRoleForIssue(opts: {
  issueId: string;
  workspace: string;
  subRole: ReviewSubRole;
  runId: string;
  outputPath?: string;
  contextManifestPath?: string;
  synthesisAgentId?: string;
  model?: string;
  allowHost?: boolean;
}): Promise<{ success: boolean; message: string; error?: string; sessionId?: string }> {
  try {
    const { saveAgentStateEffect, spawnRun } = await import('../agents.js');
    const cfg = loadYamlConfig().config;
    const outputPath = opts.outputPath ?? reviewerAgentOutputPath(opts.workspace, opts.runId, opts.subRole);
    const synthesisAgentId = opts.synthesisAgentId ?? `agent-${opts.issueId.toLowerCase()}-review`;
    const model = opts.model ?? resolveModel('review', opts.subRole, cfg);
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

    const prompt = await buildConvoyPrompt({
      issueId: opts.issueId,
      subRole: opts.subRole,
      outputPath,
      synthesisAgentId,
      contextManifestPath: opts.contextManifestPath,
      tier1Summary,
    });
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      subRole: opts.subRole,
      prompt,
      model,
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
    await Effect.runPromise(saveAgentStateEffect(run));
    try {
      const { notifyPipeline } = await import('../pipeline-notifier.js');
      notifyPipeline({ type: 'reviewer_started', issueId: opts.issueId, role: opts.subRole, sessionName: run.id });
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
}

export async function spawnReviewRoleForIssue(
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string; force?: boolean; allowHost?: boolean },
): Promise<{ success: boolean; message: string; error?: string }> {
  const reviewSessionName = `agent-${opts.issueId.toLowerCase()}-review`;

  // Idempotency: if a review role agent for this issue already has an alive
  // tmux pane, treat the current dispatch as a no-op. spawnRun has its own
  // session-exists check but it throws — we want soft "already running"
  // semantics so callers can keep their existing success-path messaging.
  //
  // Force mode (human override from dashboard) kills the old session and
  // respawns so the review runs against current HEAD, not stale state.
  try {
    const sessions = await Effect.runPromise(listSessionNamesAsyncEffect());
    if (sessions.includes(reviewSessionName)) {
      const paneDead = await Effect.runPromise(isPaneDeadAsyncEffect(reviewSessionName));

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
          const synthStatePath = join(AGENTS_DIR, reviewSessionName, 'state.json');
          const synthState = JSON.parse(await readFile(synthStatePath, 'utf-8')) as { reviewRunId?: string };
          // Stale when the existing session carries a runId that does not match
          // the current HEAD. If it carries no runId at all (legacy session
          // from before this field was persisted), stay conservative and keep
          // the "skip" behaviour so we never kill a genuinely-running review.
          if (synthState.reviewRunId && synthState.reviewRunId !== currentRunId) {
            staleRunId = true;
            console.log(
              `[review-agent] ${reviewSessionName} is stale — runId ${synthState.reviewRunId} != current ${currentRunId}; killing convoy and respawning`,
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
      await killAllReviewerSessions(undefined, opts.issueId).catch(() => ({ killed: [], failed: [] }));
    }
  } catch (err) {
    console.warn(`[review-agent] Idempotency check failed for ${opts.issueId}, proceeding:`, err);
  }

  // Clear feedback from any previous review cycle so the work agent only
  // sees current-cycle feedback when it reads .pan/feedback/.
  try {
    const { archiveFeedbackFiles } = await import('./feedback-writer.js');
    await archiveFeedbackFiles(opts.workspace);
  } catch {
    // Non-fatal: archiving is best-effort
  }

  let reviewTempStash: Awaited<ReturnType<typeof ensureReviewTempStash>> = null;
  try {
    reviewTempStash = await ensureReviewTempStash(opts.issueId, opts.workspace);
  } catch (err) {
    console.error(`[review-agent] Failed to create review-temp stash for ${opts.issueId}:`, err);
    return {
      success: false,
      message: 'Failed to create review-temp stash',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Set reviewing here so callers don't race against the async role spawn.
  // The review role signals the terminal verdict with Panopticon's CLI, which
  // transitions reviewStatus to passed/blocked/failed and fires the review.approved
  // lifecycle event for reactive Cloister.
  try {
    setReviewStatus(opts.issueId, {
      reviewStatus: 'reviewing',
      reviewSpawnedAt: new Date().toISOString(),
      reviewTempStashRef: reviewTempStash?.ref,
      reviewTempStashMessage: reviewTempStash?.message,
      reviewTempStashSequence: reviewTempStash?.sequence,
    });
  } catch (err) {
    console.error(`[review-agent] Failed to set reviewing status for ${opts.issueId}:`, err);
    if (reviewTempStash) {
      try { await dropStash(opts.workspace, reviewTempStash.ref); } catch {}
    }
    return {
      success: false,
      message: 'Failed to initialize review status',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const { notifyPipeline } = await import('../pipeline-notifier.js');
    notifyPipeline({ type: 'task_queued', specialist: 'review-agent', issueId: opts.issueId });
  } catch {
    // Non-fatal
  }

  try {
    const { spawnRun, saveAgentStateEffect, getAgentStateEffect } = await import('../agents.js');
    const workAgentState = await Effect.runPromise(getAgentStateEffect(`agent-${opts.issueId.toLowerCase()}`));
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

    const prompt = buildReviewRolePrompt({ ...opts, runId, reviewDir, contextManifestPath, tier1Summary });
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      prompt,
      ...(opts.model ? { model: opts.model } : {}),
      ...(allowHost ? { allowHost: true } : {}),
    });
    // Persist the runId on the synthesis agent's own state so the idempotency
    // guard above can tell a genuinely-running review (runId matches current
    // HEAD) from a finished-but-idle leftover (runId from an older HEAD) — see
    // PAN-1131. Sub-reviewers already persist this; the synthesis agent did not.
    run.reviewRunId = runId;
    try {
      await Effect.runPromise(saveAgentStateEffect(run));
    } catch (saveErr) {
      console.warn(`[review-agent] Could not persist reviewRunId on ${run.id}:`, saveErr);
    }
    console.log(`[review-agent] Review role (synthesis) spawned for ${opts.issueId}: ${run.id}`);
    emitActivityEntry({ source: 'review', level: 'info', message: `Review role spawned for ${opts.issueId}: ${run.id}`, issueId: opts.issueId });

    const reviewerResults = await Promise.all(REVIEW_SUB_ROLES.map(async (subRole) => {
      const outputPath = reviewerAgentOutputPath(opts.workspace, runId, subRole);
      const result = await spawnReviewSubRoleForIssue({
        issueId: opts.issueId,
        workspace: opts.workspace,
        subRole,
        runId,
        outputPath,
        contextManifestPath,
        synthesisAgentId: run.id,
        allowHost,
      });
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

    return {
      success: true,
      message: `Review role spawned: ${run.id}; convoy reviewers started: ${reviewerResults.length - failedReviewers.length}/${REVIEW_SUB_ROLES.length}`,
    };
  } catch (err) {
    console.error(`[review-agent] Failed to spawn review role for ${opts.issueId}:`, err);
    try {
      await cleanupReviewTempStash(opts.issueId, opts.workspace);
    } catch (cleanupError) {
      console.error(`[review-agent] Failed to clean review-temp stash for ${opts.issueId}:`, cleanupError);
    }
    setReviewStatus(opts.issueId, {
      reviewStatus: 'failed',
      reviewNotes: `Review role spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      reviewTempStashRef: undefined,
      reviewTempStashMessage: undefined,
      reviewTempStashSequence: undefined,
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
}

export async function killAllReviewerSessions(
  projectKey: string | undefined,
  issueId: string,
): Promise<{ killed: string[]; failed: string[] }> {
  const killed: string[] = [];
  const failed: string[] = [];
  let allSessions: readonly string[];

  try {
    allSessions = await Effect.runPromise(listSessionNamesAsyncEffect());
  } catch (err) {
    console.warn('[review-agent] Failed to list tmux sessions during reviewer cleanup:', err instanceof Error ? err.message : String(err));
    return { killed, failed };
  }

  const sessionsToKill = allSessions.filter(s => isReviewSessionForIssue(s, projectKey, issueId));
  await Promise.all(
    sessionsToKill.map(async (sessionName) => {
      try {
        await Effect.runPromise(killSessionAsyncEffect(sessionName));
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
 * Kill ALL review-related tmux sessions on the panopticon socket.
 *
 * Called by `pan down` to prevent stale coordinator/reviewer sessions from
 * surviving a dashboard restart and blocking new review dispatch (PAN-931).
 *
 * Targets:
 *   - agent-<issueId>-review and agent-<issueId>-review-<role> (current role primitive)
 *   - review-coordinator-<issueId>-<timestamp> (legacy coordinator naming
 *     from the deleted dispatchParallelReview path; pattern kept so we
 *     reap leftover sessions from systems running pre-R6 builds)
 *   - specialist-<projectKey>-<issueId>-review-<role> (canonical PAN-830)
 *   - review-<issueId>-<timestamp>-<role> (legacy PAN-821)
 *
 * Returns the list of sessions killed and any that failed to kill.
 */
export async function killAllReviewSessions(): Promise<{ killed: string[]; failed: string[] }> {
  const killed: string[] = [];
  const failed: string[] = [];

  let allSessions: readonly string[];
  try {
    allSessions = await Effect.runPromise(listSessionNamesAsyncEffect());
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
        await Effect.runPromise(killSessionAsyncEffect(sessionName));
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
 * Effect variant of {@link cleanupReviewTempStash}. The Promise version swallows
 * its own errors (stash listing / drop failures), so the Effect form mirrors
 * that contract.
 */
export const cleanupReviewTempStashEffect = (
  issueId: string,
  workspace: string,
): Effect.Effect<void> =>
  Effect.promise(() => cleanupReviewTempStash(issueId, workspace));

/**
 * Effect variant of {@link buildConvoyPrompt}. Template reads are the only
 * fallible step; any failure here is fatal and propagates via Effect's defect
 * channel through `Effect.promise`.
 */
export const buildConvoyPromptEffect = (opts: {
  issueId: string;
  subRole: string;
  outputPath: string;
  synthesisAgentId: string;
  contextManifestPath?: string;
  tier1Summary?: string;
}): Effect.Effect<string> => Effect.promise(() => buildConvoyPrompt(opts));

/**
 * Effect variant of {@link spawnReviewSubRoleForIssue}. The Promise version
 * already aggregates errors into the structured result shape, so the Effect
 * form lifts via `Effect.promise`.
 */
export const spawnReviewSubRoleForIssueEffect = (opts: {
  issueId: string;
  workspace: string;
  subRole: ReviewSubRole;
  runId: string;
  outputPath?: string;
  contextManifestPath?: string;
  synthesisAgentId?: string;
  model?: string;
  allowHost?: boolean;
}): Effect.Effect<{ success: boolean; message: string; error?: string; sessionId?: string }> =>
  Effect.promise(() => spawnReviewSubRoleForIssue(opts));

/**
 * Effect variant of {@link spawnReviewRoleForIssue}. The Promise version
 * returns a structured result instead of throwing, so the Effect form lifts
 * via `Effect.promise`.
 */
export const spawnReviewRoleForIssueEffect = (
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string; force?: boolean; allowHost?: boolean },
): Effect.Effect<{ success: boolean; message: string; error?: string }> =>
  Effect.promise(() => spawnReviewRoleForIssue(opts));

/**
 * Effect variant of {@link killAllReviewerSessions}. Session-kill failures are
 * already aggregated into the `failed` array — this wrapper preserves that
 * contract.
 */
export const killAllReviewerSessionsEffect = (
  projectKey: string | undefined,
  issueId: string,
): Effect.Effect<{ killed: string[]; failed: string[] }> =>
  Effect.promise(() => killAllReviewerSessions(projectKey, issueId));

/**
 * Effect variant of {@link killAllReviewSessions}. Same aggregation semantics
 * as the Promise version.
 */
export const killAllReviewSessionsEffect = (): Effect.Effect<{ killed: string[]; failed: string[] }> =>
  Effect.promise(() => killAllReviewSessions());
