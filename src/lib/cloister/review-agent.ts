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
 * then writes the report and signals the verdict via Panopticon's CLI inside
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
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import { loadConfigSync as loadYamlConfig, resolveModel, resolveReReviewScope } from '../config-yaml.js';
import { buildReviewContext, formatTier1Summary, type ReviewContextManifest } from './review-context.js';
import { buildRealConflictGateDeps, getCachedConflictGateMergeability, resolveConflictGate } from './conflict-gate.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';
import { reviewersToRerun } from './reviewers-to-rerun.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR, packageRoot } from '../paths.js';
import { getAgentState, getLatestSessionIdSync, messageAgent, saveAgentState, spawnRun } from '../agents.js';
import type { RuntimeName } from '../runtimes/types.js';

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
    'when you finish your turn with the report written, Panopticon detects it',
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
  discoveryMode?: boolean;
}): string {
  const subRoleFiles = REVIEW_SUB_ROLES.map(r => `  ${join(opts.reviewDir, `${r}.md`)}`).join('\n');
  const expectedSignals = REVIEW_SUB_ROLES.map(r => `  REVIEWER_READY ${r} <outputPath> or REVIEWER_FAILED ${r} <reason> or REVIEWER_TIMEOUT ${r} <reason>`).join('\n');
  const synthesisPath = join(opts.reviewDir, 'synthesis.md');

  const openingBlock = opts.discoveryMode
    ? [
        `REVIEW — DISCOVERY AND SYNTHESIS for ${opts.issueId}`,
        '',
        'Your role has two phases. Start on Phase 1 immediately.',
        '',
        '## Phase 1 — Discovery (do this NOW)',
        '',
        'Follow roles/review.md §0 exactly: read the PR diff and the high-risk changed',
        'files into your context. The four convoy reviewers will be forked from your',
        'session once you signal ready, so they inherit your warm prompt-cache context',
        'instead of each re-reading the same diff at full cost.',
        '',
        'When your discovery reads are complete, signal ready:',
        '',
        `  pan admin specialists discovery-ready review ${opts.issueId}`,
        '',
        'Then stop and wait. Do NOT proceed to Phase 2 until you receive all four',
        'REVIEWER_READY (or REVIEWER_FAILED / REVIEWER_TIMEOUT) signals — one per sub-role.',
        '',
        '## Phase 2 — Synthesis (begins only after all four signals arrive)',
        '',
        'You will receive exactly one signal per sub-role as each reviewer finishes:',
        expectedSignals,
        '',
        'Until all four terminal signals have arrived: do nothing. Do not read the',
        'reviewer output files, do not run git, do not inspect tmux sessions. Just',
        'wait — the reviewers notify you, and Deacon is the failsafe.',
        '',
        'Once all four signals are in, follow roles/review.md exactly to read the',
        'reports, synthesize the verdict, write the synthesis report, and signal.',
      ]
    : [
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
      ];

  const prompt = [
    ...openingBlock,
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

async function spawnReviewSubRoleForIssuePromise(opts: {
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
  /** When set, the reviewer is spawned with `--resume <forkSessionId>` to inherit the parent's cache. */
  forkSessionId?: string;
}): Promise<{ success: boolean; message: string; error?: string; sessionId?: string }> {
  try {
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

    const prompt = await Effect.runPromise(buildConvoyPrompt({
      issueId: opts.issueId,
      subRole: opts.subRole,
      outputPath,
      synthesisAgentId,
      contextManifestPath: opts.contextManifestPath,
      tier1Summary,
    }));
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
      // PAN-1862: when forked from the parent's session, resume the forked JSONL
      // so the reviewer inherits the parent's warm prompt-cache context.
      ...(opts.forkSessionId ? { resumeSessionId: opts.forkSessionId } : {}),
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
}

/**
 * PAN-1862: Re-review resume path.
 *
 * When a re-review is triggered by a stale runId (new commits since last review),
 * resume in-scope reviewer sessions instead of killing the whole convoy.
 * Out-of-scope reviewers with prior 'passed' verdicts are carried forward.
 * Falls back to fresh spawn for in-scope reviewers whose session is gone.
 *
 * Returns a result object if the resume succeeds (caller should return it),
 * or null if we should fall through to the kill-all-and-respawn path.
 */
async function tryResumeConvoyReviewers(
  opts: { issueId: string; workspace: string; branch: string; model?: string; harness?: RuntimeName; allowHost?: boolean },
): Promise<{ success: boolean; message: string; error?: string } | null> {
  try {
    // Load config to resolve re-review scope.
    const { config } = loadYamlConfig();
    const scope = resolveReReviewScope(config);

    // Get changed files since the last reviewed commit.
    const existingStatus = getReviewStatusSync(opts.issueId);
    const reviewedAtCommit = existingStatus?.reviewedAtCommit;
    let changedFiles: string[] = [];
    if (reviewedAtCommit) {
      try {
        const { stdout } = await execAsync(
          `git diff --name-only ${reviewedAtCommit} HEAD`,
          { cwd: opts.workspace, encoding: 'utf-8' },
        );
        changedFiles = stdout.split('\n').map(f => f.trim()).filter(Boolean);
      } catch (err) {
        console.warn('[review-agent] Could not compute changed files for re-review scope, including all reviewers:', err);
        // Fail-safe: include all reviewers.
      }
    }

    const priorVerdicts = existingStatus?.reviewerVerdicts ?? {};
    const inScope = reviewersToRerun(scope, changedFiles, priorVerdicts);
    const outOfScope = REVIEW_SUB_ROLES.filter(sr => !inScope.includes(sr));

    console.log(
      `[review-agent] Re-review scope=${scope}: in-scope=[${inScope.join(',')}] carried=[${outOfScope.join(',')}]`,
    );

    // Get the alive reviewer sessions.
    const allSessions = await Effect.runPromise(listSessionNames());
    const issueKey = opts.issueId.toLowerCase();
    const synthesisSessionName = `agent-${issueKey}-review`;

    const resumed: string[] = [];
    const deadFallback: ReviewSubRole[] = [];

    // Build a context manifest for the re-review message.
    let tier1Summary: string | undefined;
    try {
      const { stdout: headSha } = await execAsync('git rev-parse --short=8 HEAD', { cwd: opts.workspace, encoding: 'utf-8' });
      const runId = `agent-${issueKey}-review-${headSha.trim()}`;
      const manifest = await Effect.runPromise(buildReviewContext({ runId, issueId: opts.issueId, workspace: opts.workspace, branch: opts.branch }));
      tier1Summary = formatTier1Summary(manifest);
    } catch {
      // Non-fatal — reviewers will re-read context themselves.
    }

    for (const subRole of inScope) {
      const reviewerSessionName = `agent-${issueKey}-review-${subRole}`;
      const sessionAlive = allSessions.includes(reviewerSessionName)
        && !(await Effect.runPromise(isPaneDead(reviewerSessionName)));

      if (sessionAlive) {
        // Resume: deliver the new diff summary + re-review instruction.
        const priorFindings = priorVerdicts[subRole];
        const priorStatus = priorFindings?.status ?? 'unknown';
        const priorPath = priorFindings?.findingsPath ? `\nYour prior findings are at: ${priorFindings.findingsPath}` : '';
        const diffSection = tier1Summary ? `\n\n## New diff summary\n${tier1Summary}` : '';
        const resumeMsg = [
          `RE-REVIEW: New commits have been pushed since your last review (prior verdict: ${priorStatus}).`,
          diffSection,
          priorPath,
          '\nPlease re-read the updated diff and re-run your review. Write your findings to your output file and signal the verdict as before.',
        ].join('');

        try {
          await messageAgent(reviewerSessionName, resumeMsg, 're-review:resume');
          resumed.push(subRole);
          console.log(`[review-agent] Resumed ${reviewerSessionName} for re-review`);
        } catch (err) {
          console.warn(`[review-agent] Failed to resume ${reviewerSessionName}, will fresh-spawn:`, err);
          deadFallback.push(subRole);
        }
      } else {
        console.log(`[review-agent] ${reviewerSessionName} not alive, will fresh-spawn for re-review`);
        deadFallback.push(subRole);
      }
    }

    // Carry out-of-scope reviewers' prior 'passed' verdicts forward in ReviewStatus.
    if (outOfScope.length > 0) {
      const carried: typeof priorVerdicts = {};
      for (const sr of outOfScope) {
        if (priorVerdicts[sr]) carried[sr] = priorVerdicts[sr];
      }
      if (Object.keys(carried).length > 0) {
        try {
          setReviewStatusSync(opts.issueId, { reviewerVerdicts: { ...priorVerdicts, ...carried } });
        } catch (err) {
          console.warn('[review-agent] Could not persist carried verdicts:', err);
        }
      }
    }

    // Re-arm synthesis: notify it of which sub-roles are running and which are carried.
    if (allSessions.includes(synthesisSessionName)) {
      const carriableVerdicts = outOfScope
        .filter(sr => priorVerdicts[sr]?.status === 'passed')
        .map(sr => `${sr}:passed`)
        .join(',');
      const synthMsg = [
        `RE-REVIEW: New commits pushed. Await terminal signals only from: ${inScope.join(',')}.`,
        carriableVerdicts ? ` Carried-forward verdicts: ${carriableVerdicts}.` : '',
        ' Re-synthesize after receiving signals from all in-scope reviewers.',
      ].join('');
      try {
        await messageAgent(synthesisSessionName, synthMsg, 're-review:rearm-synthesis');
        console.log(`[review-agent] Re-armed synthesis for cycle with in-scope=[${inScope.join(',')}]`);
      } catch (err) {
        console.warn('[review-agent] Failed to re-arm synthesis session:', err);
      }
    }

    // If there are reviewers needing fresh spawn, fall through for them after returning.
    // For now: if ANY reviewer was resumed, report success.
    // Dead-fallback reviewers will be handled by the caller via fresh spawn.
    if (resumed.length > 0 || deadFallback.length === 0) {
      return {
        success: true,
        message: `Re-review: resumed=[${resumed.join(',')}] carried=[${outOfScope.join(',')}]${deadFallback.length > 0 ? ` (fresh-spawn needed: [${deadFallback.join(',')}])` : ''}`,
      };
    }

    // All in-scope reviewers need fresh spawn — fall through to kill-all path.
    return null;
  } catch (err) {
    console.warn('[review-agent] Re-review resume failed, falling back to kill-all respawn:', err);
    return null;
  }
}

async function spawnReviewRoleForIssuePromise(
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

      // PAN-1862: stale-runId re-review path — resume in-scope reviewer sessions
      // instead of killing the whole convoy. Terminal lifecycle events (force mode,
      // dead pane) still kill-all and respawn.
      if (!paneDead && !opts.force && staleRunId) {
        const resumeResult = await tryResumeConvoyReviewers(opts);
        if (resumeResult) {
          return resumeResult;
        }
        // tryResumeConvoyReviewers returned null — all in-scope reviewers need
        // fresh spawn; fall through to the kill-all-and-respawn path below.
      }

      // Session pane is dead or force mode — kill the whole convoy and respawn.
      const reason = opts.force ? 'force-killed for re-review' : paneDead ? 'pane is dead' : 'stale runId (all reviewers need fresh spawn)';
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

    // PAN-1862: discovery mode — parent does a shared discovery pass, then the
    // server forks its session into convoy reviewers on a discovery-ready signal.
    // Only applicable for claude-code harness (fork-cache is cc-specific); non-cc
    // harnesses use the old inline-spawn path (decision D9).
    // Check the explicit harness option; undefined → cc default → discovery mode.
    const discoveryMode = opts.harness !== 'pi' && opts.harness !== 'codex';

    const prompt = buildReviewRolePrompt({ ...opts, runId, reviewDir, contextManifestPath, tier1Summary, discoveryMode });
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
    console.log(`[review-agent] Review role (synthesis) spawned for ${opts.issueId}: ${run.id}`);
    emitActivityEntrySync({ source: 'review', level: 'info', message: `Review role spawned for ${opts.issueId}: ${run.id}`, issueId: opts.issueId });

    if (discoveryMode) {
      // Discovery mode: parent will signal pan admin specialists discovery-ready
      // after reading the diff; the server then forks the session for each reviewer.
      console.log(`[review-agent] Discovery mode: ${run.id} will signal ready after discovery phase`);
      return {
        success: true,
        message: `Review role (discovery) spawned: ${run.id}; convoy will be forked after discovery phase`,
      };
    }

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
  forkSessionId?: string;
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

/**
 * Handle a `pan admin specialists discovery-ready review <issueId>` signal.
 *
 * Called by the parent synthesis agent after completing its discovery phase.
 * Forks the parent's session into four convoy reviewer sessions (claude-code only)
 * and delivers the per-sub-role kickoff prompts. For non-cc parents, falls back
 * to the old independent-read inline spawn. Idempotent on convoyLaunchedAt.
 *
 * PAN-1862
 */
export async function handleDiscoveryReady(
  issueId: string,
  workspace: string,
): Promise<{ success: boolean; message: string; noOp?: boolean; error?: string }> {
  const parentAgentId = `agent-${issueId.toLowerCase()}-review`;

  const { sessionFilePath } = await import('../paths.js');

  // Load parent synthesis agent state
  let parentState = await Effect.runPromise(getAgentState(parentAgentId));
  if (!parentState) {
    return { success: false, message: `Parent review agent not found: ${parentAgentId}` };
  }

  // Idempotency: if convoy already launched (e.g. duplicate signal), return no-op
  if (parentState.convoyLaunchedAt) {
    console.log(`[review-agent] handleDiscoveryReady: convoy already launched for ${issueId} (convoyLaunchedAt=${parentState.convoyLaunchedAt}) — no-op`);
    return { success: true, message: 'Convoy already launched (idempotent no-op)', noOp: true };
  }

  // Stamp discoveryReadyAt before doing any spawning
  parentState.discoveryReadyAt = new Date().toISOString();
  await Effect.runPromise(saveAgentState(parentState));

  const runId = parentState.reviewRunId ?? parentAgentId;
  const contextManifestPath = join(workspace, PAN_DIRNAME, 'review', runId, 'context.json');

  // Non-cc harness fallback (D9): fork is a claude-code-only optimization
  if (parentState.harness && parentState.harness !== 'claude-code') {
    console.log(`[review-agent] handleDiscoveryReady: harness=${parentState.harness} — independent-read path`);
    const reviewerResults = await Promise.all(REVIEW_SUB_ROLES.map(subRole =>
      spawnReviewSubRoleForIssuePromise({
        issueId,
        workspace,
        subRole,
        runId,
        contextManifestPath,
        synthesisAgentId: parentAgentId,
        allowHost: parentState!.hostOverride ?? false,
      })
    ));

    for (let i = 0; i < reviewerResults.length; i++) {
      if (!reviewerResults[i].success) {
        try {
          await messageAgent(parentAgentId, `REVIEWER_FAILED ${REVIEW_SUB_ROLES[i]} ${reviewerResults[i].error ?? reviewerResults[i].message}`);
        } catch { /* non-fatal */ }
      }
    }

    parentState = { ...parentState, convoyLaunchedAt: new Date().toISOString() };
    await Effect.runPromise(saveAgentState(parentState));
    const ok = reviewerResults.filter(r => r.success).length;
    return { success: true, message: `Convoy launched (independent-read): ${ok}/${REVIEW_SUB_ROLES.length}` };
  }

  // CC path: get parent JSONL and fork into each reviewer
  const parentSessionId = getLatestSessionIdSync(parentAgentId);
  if (!parentSessionId) {
    return { success: false, message: `Could not resolve session ID for ${parentAgentId}`, error: 'session ID missing' };
  }

  const parentJSONL = sessionFilePath(workspace, parentSessionId);
  const { forkSession } = await import('../conversations/fork-session.js');

  const reviewerResults = await Promise.all(REVIEW_SUB_ROLES.map(async (subRole) => {
    try {
      const { sessionId: forkedId } = await forkSession({
        sourceSessionFile: parentJSONL,
        destCwd: workspace,
        fullHistory: true,
      });
      return await spawnReviewSubRoleForIssuePromise({
        issueId,
        workspace,
        subRole,
        runId,
        contextManifestPath,
        synthesisAgentId: parentAgentId,
        forkSessionId: forkedId,
        allowHost: parentState!.hostOverride ?? false,
      });
    } catch (err) {
      return {
        success: false,
        message: `Failed to fork+spawn ${subRole}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }));

  // Signal REVIEWER_FAILED to parent for any sub-role that didn't spawn
  for (let i = 0; i < reviewerResults.length; i++) {
    if (!reviewerResults[i].success) {
      try {
        await messageAgent(parentAgentId, `REVIEWER_FAILED ${REVIEW_SUB_ROLES[i]} ${reviewerResults[i].error ?? reviewerResults[i].message}`);
      } catch { /* non-fatal */ }
    }
  }

  parentState = { ...parentState, convoyLaunchedAt: new Date().toISOString() };
  await Effect.runPromise(saveAgentState(parentState));

  const ok = reviewerResults.filter(r => r.success).length;
  console.log(`[review-agent] Convoy forked+spawned for ${issueId}: ${ok}/${REVIEW_SUB_ROLES.length}`);
  return { success: true, message: `Convoy launched (fork path): ${ok}/${REVIEW_SUB_ROLES.length} reviewers forked+spawned` };
}
