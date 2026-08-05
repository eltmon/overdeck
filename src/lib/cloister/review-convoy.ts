/**
 * PAN-1862: the review CONVOY — sub-reviewer prompts and spawning, plus
 * missing-reviewer recovery.
 *
 * Split out of review-agent.ts (which keeps the review entry point, the
 * synthesis/self-review prompts, mode resolution, and session teardown).
 * This module must NEVER import review-agent.ts — review-agent imports (and
 * re-exports) from here, and a reverse edge would close a cycle.
 *
 * The four convoy sub-roles are security, correctness, performance, and
 * requirements (REVIEW_SUB_ROLES, review-monitor.ts); the synthesis parent is
 * the fifth review role. See docs/REVIEW-AGENT-ARCHITECTURE.md.
 */

import { mkdir, readFile, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { Effect } from 'effect';
import { listSessionNames } from '../tmux.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { formatTier1Summary, type ReviewContextManifest } from './review-context.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';
import { reviewResumeDecision } from './review-resume-decision.js';
import { readIssueRecordSync, resolveProjectForIssue } from '../pan-dir/record.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR, packageRoot } from '../paths.js';
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



const REVIEWER_TIMEOUT_MS = 20 * 60 * 1000;
const REVIEWER_SPAWN_BACKOFF_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

function reviewerAgentId(issueId: string, subRole: ReviewSubRole): string {
  return `agent-${issueId.toLowerCase()}-review-${subRole}`;
}

function isReviewerStateWriteContention(error: unknown, agentId: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`agents-db:${agentId}`)
    && /database is locked|SQLITE_BUSY/i.test(message);
}

async function reviewerSessionIsLive(agentId: string): Promise<boolean> {
  try {
    return (await Effect.runPromise(listSessionNames())).includes(agentId);
  } catch {
    return false;
  }
}

function reviewerAgentOutputPath(workspace: string, runId: string, subRole: ReviewSubRole): string {
  return join(workspace, PAN_DIRNAME, 'review', runId, `${subRole}.md`);
}



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
}): Promise<{ success: boolean; message: string; error?: string; sessionId?: string }> {
  try {
    const { saveAgentState, spawnRun, getAgentStateSync, getLatestSessionIdSync, resumeAgent, stopAgent } = await import('../agents.js');
    const cfg = loadYamlConfig().config;
    const outputPath = opts.outputPath ?? reviewerAgentOutputPath(opts.workspace, opts.runId, opts.subRole);
    const synthesisAgentId = opts.synthesisAgentId ?? `agent-${opts.issueId.toLowerCase()}-review`;
    const model = opts.model ?? resolveModel('review', opts.subRole, cfg, opts.subRole ? undefined : `review:${opts.issueId}`);
    const reviewerDir = join(AGENTS_DIR, reviewerAgentId(opts.issueId, opts.subRole));

    await mkdir(dirname(outputPath), { recursive: true });
    // These are named runtime marker files below the agent-dir deletion door.
    await rm(outputPath, { force: true }); // PAN-3357: not a dir removal
    await rm(join(reviewerDir, 'reviewer-signaled'), { force: true }); // PAN-3357: not a dir removal
    await rm(join(reviewerDir, 'reviewer-launcher.pid'), { force: true }); // PAN-3357: not a dir removal

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
      if (resumeResult.success && resumeResult.messageDelivered !== false) {
        try {
          const resumed = getAgentStateSync(reviewerAgent);
          if (resumed) {
            resumed.reviewSubRole = opts.subRole;
            resumed.reviewRunId = opts.runId;
            resumed.reviewOutputPath = outputPath;
            resumed.reviewSynthesisAgentId = synthesisAgentId;
            resumed.reviewDeadlineAt = new Date(Date.now() + REVIEWER_TIMEOUT_MS).toISOString();
            delete resumed.reviewMonitorSignaled;
            delete resumed.reviewRetryAttempt;
            await Effect.runPromise(saveAgentState(resumed));
          }
        } catch { /* non-fatal */ }
        return { success: true, message: `Review ${opts.subRole} resumed (session preserved): ${reviewerAgent}`, sessionId: reviewerAgent };
      }
      const resumeError = resumeResult.messageDelivered === false
        ? 'continue prompt was not confirmed in the resumed session'
        : resumeResult.error;
      console.warn(`[review-agent] Convoy sub-reviewer ${opts.subRole} resume failed; falling back to a fresh session: ${resumeError}`);
      // PAN-2743: Codex reviewers intentionally remain alive at their prompt after
      // finishing a cycle. A successful process resume whose prompt did not land is
      // also live but unusable. Stop either live collision before the fresh spawn;
      // other resume failures already imply no live session and need no teardown.
      if (resumeResult.messageDelivered === false || resumeResult.error?.includes('it appears healthy')) {
        await Effect.runPromise(stopAgent(reviewerAgent));
      }
    }

    const reviewDeadlineAt = new Date(Date.now() + REVIEWER_TIMEOUT_MS).toISOString();
    const spawnOptions = {
      workspace: opts.workspace,
      subRole: opts.subRole,
      prompt,
      model,
      harness: opts.harness,
      // Persist every signal-routing field before tmux launch. A later
      // running-state cache write may contend, but the reviewer can still
      // finish and the Stop-hook can still deliver REVIEWER_READY.
      reviewRunId: opts.runId,
      reviewSynthesisAgentId: synthesisAgentId,
      reviewOutputPath: outputPath,
      reviewDeadlineAt,
      allowHost: opts.allowHost ?? false,
      startedBy: 'review-convoy' as const,
    };
    const agentId = reviewerAgentId(opts.issueId, opts.subRole);
    let run: Awaited<ReturnType<typeof spawnRun>>;
    for (let attempt = 0; ; attempt += 1) {
      try {
        run = await spawnRun(opts.issueId, 'review', spawnOptions);
        break;
      } catch (err) {
        if (!isReviewerStateWriteContention(err, agentId)) throw err;
        if (await reviewerSessionIsLive(agentId)) {
          console.warn(
            `[review-agent] ${agentId} launched but its running-state cache write was contended; `
            + 'waiting for its report instead of emitting REVIEWER_FAILED',
          );
          return {
            success: true,
            message: `Review ${opts.subRole} launched with deferred cache reconciliation: ${agentId}`,
            sessionId: agentId,
          };
        }
        const delay = REVIEWER_SPAWN_BACKOFF_DELAYS_MS[attempt];
        if (delay === undefined) throw err;
        console.warn(
          `[review-agent] ${agentId} state write was contended before launch; retrying in ${delay}ms`,
        );
        await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
      }
    }
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


export interface ConvoyLaunchParams {
  issueId: string;
  workspace: string;
  runId: string;
  synthesisAgentId: string;
  /** Recovery provides only lanes with no report and no live session. */
  subRoles?: ReviewSubRole[];
  contextManifestPath?: string;
  model?: string;
  harness?: RuntimeName;
  allowHost?: boolean;
}

/** Launch all four independent reviewers for one review run. */
export async function launchConvoyReviewersPromise(params: ConvoyLaunchParams): Promise<Array<{ success: boolean; message: string }>> {
  const reviewerResults = await Promise.all((params.subRoles ?? REVIEW_SUB_ROLES).map(async (subRole) => {
    const outputPath = reviewerAgentOutputPath(params.workspace, params.runId, subRole);

    const result = await Effect.runPromise(spawnReviewSubRoleForIssue({
      issueId: params.issueId,
      workspace: params.workspace,
      subRole,
      runId: params.runId,
      outputPath,
      contextManifestPath: params.contextManifestPath,
      synthesisAgentId: params.synthesisAgentId,
      ...(params.model ? { model: params.model } : {}),
      ...(params.harness ? { harness: params.harness } : {}),
      allowHost: params.allowHost ?? false,
    }));
    if (!result.success) {
      try {
        const { messageAgent } = await import('../agents.js');
        await messageAgent(params.synthesisAgentId, `REVIEWER_FAILED ${subRole} ${result.error ?? result.message}`);
      } catch (signalErr) {
        console.warn(`[review-agent] Failed to signal ${subRole} spawn failure to ${params.synthesisAgentId}:`, signalErr);
      }
    }
    return result;
  }));

  const failedReviewers = reviewerResults.filter(r => !r.success);
  if (failedReviewers.length > 0) {
    console.warn(`[review-agent] Convoy launched for ${params.issueId}, but ${failedReviewers.length} reviewer(s) failed to spawn`);
  }
  return reviewerResults;
}



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


/**
 * Re-launch only convoy lanes whose report and session are both absent for the
 * current parent run. It is idempotent, so a repeated recovery request is a no-op.
 */
export async function recoverMissingConvoyReviewers(
  issueId: string,
  opts: { source?: string; model?: string; harness?: RuntimeName } = {},
): Promise<{ success: boolean; message: string; launched?: number }> {
  const normalized = issueId.toUpperCase();
  const parentId = `agent-${normalized.toLowerCase()}-review`;
  const { saveAgentState, getAgentStateSync } = await import('../agents.js');
  const parentState = getAgentStateSync(parentId);
  if (!parentState) {
    return { success: false, message: `No review parent state for ${normalized} — cannot recover reviewers` };
  }

  let parent: typeof parentState | null;
  try {
    const { resolveReviewParentRunState } = await import('./review-run-recovery.js');
    parent = await resolveReviewParentRunState(parentState, { persistCurrent: true });
  } catch (error) {
    return {
      success: false,
      message: `Could not persist active review run state for ${normalized}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!parent?.workspace || !parent.reviewRunId) {
    return { success: false, message: `Review parent for ${normalized} is missing workspace/runId state — cannot launch the convoy` };
  }
  const workspace = parent.workspace;
  const runId = parent.reviewRunId;

  // Reviewer evidence is per lane: one completed report or live session never
  // proves that a sibling reviewer launched.
  let sessions = new Set<string>();
  let livenessProbeOk = true;
  try {
    sessions = new Set(await Effect.runPromise(listSessionNames()));
  } catch {
    // Liveness probe failed — tmux cannot answer, so the state row's live claim
    // is the only signal left and keeps its conservative vote below.
    livenessProbeOk = false;
  }

  const { existsSync } = await import('node:fs');
  const reviewersToLaunch: ReviewSubRole[] = [];
  for (const subRole of REVIEW_SUB_ROLES) {
    const reviewerId = reviewerAgentId(normalized, subRole);
    const reviewer = getAgentStateSync(reviewerId);
    const stateClaimsLive = reviewer?.status === 'running' || reviewer?.status === 'starting';
    if (existsSync(reviewerAgentOutputPath(workspace, runId, subRole))) continue;
    if (sessions.has(reviewerId)) continue;
    // tmux is the liveness oracle (docs/AGENT-STATE-PLANES.md): a probe that
    // answered "no session" outranks a state.json row still claiming
    // running/starting. Rows go stale whenever liveness reconciliation cannot
    // run (deacon freeze, boot --no-resume) or a reviewer exits without a
    // stopped event; trusting the claim no-oped the convoy launch and stranded
    // the synthesis parent waiting for reviewers that would never exist
    // (PAN-3545; PAN-3511 cycle 3, 2026-08-04). Heal the stale row here, at the
    // signal — event-driven, no patrol required. Probe failure keeps the row's
    // conservative vote: better a skipped launch than a duplicate reviewer.
    if (stateClaimsLive) {
      if (!livenessProbeOk) continue;
      try {
        const { markAgentStoppedState } = await import('../agents/agent-state.js');
        await Effect.runPromise(saveAgentState(markAgentStoppedState(reviewer!, 'system')));
      } catch { /* best-effort heal — the launch must not fail over bookkeeping */ }
    }
    reviewersToLaunch.push(subRole);
  }
  if (reviewersToLaunch.length === 0) {
    return { success: true, message: `Convoy already launched for ${normalized} run ${runId} — no-op` };
  }

  // The per-issue review-model override has to be re-read here: this path is entered from a
  // signal, not from the parent's spawn opts, so nothing carries `model` in. Read the record
  // rather than `parent.model` — that is the parent's *resolved* model, and forwarding it
  // would override each sub-role's own configured model even with no override set.
  const project = resolveProjectForIssue(normalized);
  const issueReviewModel = project ? readIssueRecordSync(project, normalized)?.reviewModel : undefined;
  const reviewModel = opts.model ?? issueReviewModel;
  const results = await launchConvoyReviewersPromise({
    issueId: normalized,
    workspace,
    runId,
    synthesisAgentId: parentId,
    subRoles: reviewersToLaunch,
    contextManifestPath: parent.reviewContextManifestPath,
    ...(reviewModel ? { model: reviewModel } : {}),
    ...(opts.harness ? { harness: opts.harness } : {}),
    allowHost: parent.hostOverride ?? false,
  });

  const launched = results.filter(r => r.success).length;
  const message = `Convoy recovery for ${normalized}${opts.source ? ` (${opts.source})` : ''}: launched ${launched}/${reviewersToLaunch.length} missing reviewer(s)`;
  console.log(`[review-agent] ${message}`);
  emitActivityEntrySync({ source: 'review', level: 'info', message, issueId: normalized });
  return { success: launched === reviewersToLaunch.length, message, launched };
}
