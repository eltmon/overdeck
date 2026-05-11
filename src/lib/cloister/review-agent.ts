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
 * spawnReviewRoleForIssue → spawnRun(issueId, 'review'). The four
 * code-review-* sub-agents are launched as Agent-tool subagents inside that
 * Claude Code session; synthesis and the /api/review/:id/status post happen
 * inside the role itself (see roles/review.md).
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
import { join } from 'path';
import { promisify } from 'util';
import { killSessionAsync, listSessionNamesAsync, isPaneDeadAsync } from '../tmux.js';
import { emitActivityEntry } from '../activity-logger.js';
import { getReviewerSessionName, REVIEWER_ROLES } from './specialists.js';
import { buildStashMessage, createNamedStash, dropStash, getNextReviewTempSequence, listStashes } from '../stashes.js';
import { getReviewStatus, setReviewStatus } from '../review-status.js';
import { loadConfig as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { buildReviewContext } from './review-context.js';
import { REVIEW_SUB_ROLES, reviewerOutputPath } from './review-monitor.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';

const execAsync = promisify(exec);

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
 * PAN-1048 R3: Build the context-only prompt the review role agent receives
 * at spawn. Behavior — convoy launch, synthesis, /api/review/:id/status —
 * lives in roles/review.md and the .claude/agents/code-review-* sub-agent
 * definitions. This prompt only carries identifiers and a pointer to those
 * instructions, so review behavior changes are managed in role files (which
 * version-control with the repo) rather than scattered through prompt strings.
 */
type ConvoyModels = { security: string; correctness: string; performance: string; requirements: string };

function buildConvoyPrompt(opts: {
  issueId: string;
  subRole: string;
  outputPath: string;
  contextManifestPath?: string;
}): string {
  return [
    `REVIEW TASK for ${opts.issueId} — ${opts.subRole.toUpperCase()} REVIEW:`,
    '',
    `Issue: ${opts.issueId}`,
    `Sub-role: ${opts.subRole}`,
    '',
    'Output file — WRITE YOUR FULL FINDINGS HERE when done (Write tool):',
    `  ${opts.outputPath}`,
    '',
    opts.contextManifestPath
      ? [
          'Context manifest (READ THIS first — do NOT run git diff yourself):',
          `  ${opts.contextManifestPath}`,
          'The manifest contains the full diff, per-file risk ranking, and acceptance criteria.',
        ].join('\n')
      : 'No context manifest available — run git diff to obtain the branch diff.',
    '',
    `Follow .claude/agents/code-review-${opts.subRole}.md for review methodology.`,
    'When complete, write your full findings to the output file using the Write tool.',
    'The synthesis agent polls for that file — it MUST exist before you stop.',
  ].filter(Boolean).join('\n');
}

function buildReviewRolePrompt(opts: {
  issueId: string;
  workspace: string;
  branch: string;
  prUrl?: string;
  runId: string;
  reviewDir: string;
  contextManifestPath?: string;
}): string {
  const port = process.env.API_PORT || process.env.PORT || '3011';
  const subRoleFiles = REVIEW_SUB_ROLES.map(r => `  ${opts.reviewDir}/${r}.md`).join('\n');
  return [
    `REVIEW TASK for ${opts.issueId}:`,
    '',
    `Issue: ${opts.issueId}`,
    `Branch: ${opts.branch}`,
    `Workspace: ${opts.workspace}`,
    opts.prUrl ? `PR: ${opts.prUrl}` : `PR: (resolve via: gh pr view ${opts.branch})`,
    opts.contextManifestPath ? `Context manifest: ${opts.contextManifestPath}` : '',
    '',
    'Convoy reviewer output files (already running in separate sessions — poll for these):',
    subRoleFiles,
    '',
    'Follow roles/review.md exactly.',
    '',
    'When you have a verdict, post it through the review status API:',
    '',
    'APPROVED:',
    `  curl -s -X POST http://127.0.0.1:${port}/api/review/${opts.issueId}/status \\`,
    `    -H 'Content-Type: application/json' \\`,
    `    -d '{"reviewStatus":"passed"}'`,
    '',
    'CHANGES REQUESTED:',
    `  curl -s -X POST http://127.0.0.1:${port}/api/review/${opts.issueId}/status \\`,
    `    -H 'Content-Type: application/json' \\`,
    `    -d '{"reviewStatus":"blocked","reviewNotes":"<one-line summary>"}'`,
    '',
    'After posting reviewStatus=passed, reactive Cloister automatically dispatches',
    'the test role. Do NOT queue a test specialist yourself; never edit code.',
  ].filter(Boolean).join('\n');
}

/**
 * Spawn the `review` role for an issue using the unified role primitive
 * (spawnRun). The review role launches the four code-review-* sub-agents
 * via the Agent tool, synthesizes their findings, and posts the verdict to
 * /api/review/:id/status. This wrapper carries the orchestration concerns
 * the deleted dispatchParallelReview owned (idempotency check, feedback
 * archive, review-temp stash, reviewing-status flip, pipeline event).
 *
 * On failure: cleanup review-temp stash, flip status to failed with the
 * spawn error in reviewNotes so the dashboard surfaces the breakage.
 */
export async function spawnReviewRoleForIssue(
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string; model?: string },
): Promise<{ success: boolean; message: string; error?: string }> {
  const reviewSessionName = `agent-${opts.issueId.toLowerCase()}-review`;

  // Idempotency: if a review role agent for this issue already has an alive
  // tmux pane, treat the current dispatch as a no-op. spawnRun has its own
  // session-exists check but it throws — we want soft "already running"
  // semantics so callers can keep their existing success-path messaging.
  try {
    const sessions = await listSessionNamesAsync();
    if (sessions.includes(reviewSessionName)) {
      const paneDead = await isPaneDeadAsync(reviewSessionName);
      if (!paneDead) {
        console.log(`[review-agent] Idempotency guard: ${reviewSessionName} already running for ${opts.issueId} — skipping spawn`);
        return { success: true, message: `Review already in progress: ${reviewSessionName}` };
      }
      // Session exists but pane is dead — fall through and respawn.
      console.log(`[review-agent] ${reviewSessionName} pane is dead — killing and respawning`);
      await killSessionAsync(reviewSessionName).catch(() => {});
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
  // The review role posts /api/review/:id/status with the terminal verdict
  // when it finishes, which transitions reviewStatus to passed/blocked/failed
  // and fires the review.approved lifecycle event for reactive Cloister.
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
    const { spawnRun } = await import('../agents.js');
    const cfg = loadYamlConfig().config;
    const convoyModels: ConvoyModels = {
      security:     resolveModel('review', 'security',     cfg),
      correctness:  resolveModel('review', 'correctness',  cfg),
      performance:  resolveModel('review', 'performance',  cfg),
      requirements: resolveModel('review', 'requirements', cfg),
    };

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
    try {
      const manifest = await buildReviewContext({
        runId,
        issueId: opts.issueId,
        workspace: opts.workspace,
        branch: opts.branch,
      });
      contextManifestPath = manifest.manifestPath;
      console.log(`[review-agent] Context manifest built: ${contextManifestPath} (${manifest.changedFiles.length} files, truncated=${manifest.diff.truncated})`);
    } catch (ctxErr) {
      console.warn(`[review-agent] Context manifest build failed for ${opts.issueId} — reviewers will use raw git diff:`, ctxErr);
    }

    // Spawn convoy sub-role sessions first so they're running before the
    // synthesis agent starts polling for their output files (PAN-1059).
    const convoyResults = await Promise.allSettled(
      REVIEW_SUB_ROLES.map((subRole) => {
        const outputPath = reviewerOutputPath(opts.workspace, runId, subRole);
        return spawnRun(opts.issueId, 'review', {
          workspace: opts.workspace,
          subRole,
          prompt: buildConvoyPrompt({ issueId: opts.issueId, subRole, outputPath, contextManifestPath }),
          model: convoyModels[subRole],
        });
      }),
    );
    convoyResults.forEach((result, i) => {
      const subRole = REVIEW_SUB_ROLES[i];
      if (result.status === 'rejected') {
        console.warn(`[review-agent] Convoy ${subRole} spawn failed for ${opts.issueId}:`, result.reason);
      } else {
        console.log(`[review-agent] Convoy ${subRole} spawned for ${opts.issueId}: ${result.value.id}`);
      }
    });

    // Spawn synthesis last — it polls for convoy output files.
    const prompt = buildReviewRolePrompt({ ...opts, runId, reviewDir, contextManifestPath });
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      prompt,
      ...(opts.model ? { model: opts.model } : {}),
    });
    console.log(`[review-agent] Review role (synthesis) spawned for ${opts.issueId}: ${run.id}`);
    emitActivityEntry({ source: 'review', level: 'info', message: `Review role spawned for ${opts.issueId}: ${run.id}`, issueId: opts.issueId });
    return {
      success: true,
      message: `Review role spawned: ${run.id}`,
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
 * Iterates the canonical REVIEWER_ROLES set so callers don't need a
 * `ReviewAgentConfig[]` — every issue has the same five role slots.
 */
export async function killAllReviewerSessions(
  projectKey: string,
  issueId: string,
): Promise<{ killed: string[]; failed: string[] }> {
  const killed: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    REVIEWER_ROLES.map(async (role) => {
      const sessionName = getReviewerSessionName(role, projectKey, issueId);
      try {
        await killSessionAsync(sessionName);
        console.log(`[review-agent] Killed reviewer session ${sessionName}`);
        killed.push(sessionName);
      } catch (err) {
        // Session may not exist (e.g., never spawned, or already killed)
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

  let allSessions: string[];
  try {
    allSessions = await listSessionNamesAsync();
  } catch (err) {
    console.warn('[review-agent] Failed to list tmux sessions during review cleanup:', err instanceof Error ? err.message : String(err));
    return { killed, failed };
  }

  const reviewPatterns = [
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
        await killSessionAsync(sessionName);
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
