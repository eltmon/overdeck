/**
 * PAN-1862: the review CONVOY — sub-reviewer prompts and spawning, selective
 * re-review scope, warm-parent fork, and the discovery-ready orchestration.
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

import { exec } from 'child_process';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { listSessionNames } from '../tmux.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { formatTier1Summary, type ReviewContextManifest } from './review-context.js';
import { REVIEW_SUB_ROLES, type ReviewSubRole } from './review-monitor.js';
import { reviewResumeDecision } from './review-resume-decision.js';
import { reviewersToRerun, type ReviewerVerdictsMap, type ReReviewScope } from './review-rerun-scope.js';
import { readIssueRecordSync, resolveProjectForIssue } from '../pan-dir/record.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { AGENTS_DIR, packageRoot, sessionFilePath } from '../paths.js';
import type { RuntimeName } from '../runtimes/types.js';

const execAsync = promisify(exec);

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

function reviewerAgentId(issueId: string, subRole: ReviewSubRole): string {
  return `agent-${issueId.toLowerCase()}-review-${subRole}`;
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
  /**
   * PAN-1862 Phase A: a session id FORKED from the synthesis parent's discovery
   * session. When set, the reviewer launches with `claude --resume <id>` so its
   * first request replays the parent's byte-identical prefix and reads the warm
   * prompt cache instead of re-reading the diff and files at full price.
   */
  forkedSessionId?: string;
}): Promise<{ success: boolean; message: string; error?: string; sessionId?: string }> {
  try {
    const { saveAgentState, spawnRun, getAgentStateSync, getLatestSessionIdSync, resumeAgent, stopAgent } = await import('../agents.js');
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
    // A forked first-cycle spawn (forkedSessionId) bypasses the saved-resume decision entirely:
    // there is no prior lane context, and the fork IS the context.
    const reviewerAgent = reviewerAgentId(opts.issueId, opts.subRole);
    const savedReviewer = opts.forkedSessionId ? null : getAgentStateSync(reviewerAgent);
    const canResumeReviewer = !opts.forkedSessionId && reviewResumeDecision({
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
      // PAN-2743: Codex reviewers intentionally remain alive at their prompt after
      // finishing a cycle. resumeAgent correctly refuses to "resume" that healthy
      // process, but spawnRun cannot replace it while its tmux session still exists.
      // Stop only this explicit healthy-idle collision before the fresh spawn; other
      // resume failures already imply no live session and need no teardown.
      if (resumeResult.error?.includes('it appears healthy')) {
        await Effect.runPromise(stopAgent(reviewerAgent));
      }
    }

    const forkedPreface = opts.forkedSessionId
      ? [
          'SHARED DISCOVERY CONTEXT (PAN-1862): this session was forked from the review',
          'parent AFTER it completed a shared discovery pass — the diff, the high-risk',
          'changed files, and their surrounding code are already in your history above.',
          'That pass exists for cost (forked reviewers reuse the warm prompt cache instead',
          'of four full-price re-reads) and for consistency (every reviewer sees the same',
          'curated context). BUILD ON IT: do not re-run a broad git diff and do not',
          're-read the files already shown above; read further code only where your',
          'sub-role needs deeper detail.',
          '',
        ].join('\n')
      : '';
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      subRole: opts.subRole,
      prompt: forkedPreface + prompt,
      model,
      harness: opts.harness,
      ...(opts.forkedSessionId ? { resumeSessionId: opts.forkedSessionId } : {}),
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
    if (opts.forkedSessionId) run.reviewForkedFromParent = true;
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
 * PAN-1862: selective re-review scope for one dispatch — which convoy reviewers
 * run this cycle and which carry their prior passed verdict forward. Shared by
 * the inline dispatch path and the discovery-ready fork handler.
 */
export async function computeConvoyScope(issueId: string, workspace: string): Promise<{
  inScope: ReviewSubRole[];
  carried: Array<{ subRole: ReviewSubRole; atCommit?: string }>;
  scope: ReReviewScope;
}> {
  let inScope: ReviewSubRole[] = [...REVIEW_SUB_ROLES];
  let carried: Array<{ subRole: ReviewSubRole; atCommit?: string }> = [];
  let scope: ReReviewScope = 'changed';
  try {
    // Dynamic import: review-status.ts reaches back into cloister via review-agent,
    // so a static edge here would close a module cycle (lint:circular).
    const { getReviewStatusSync } = await import('../review-status.js');
    scope = resolveReReviewScope(issueId);
    const priorVerdicts = getReviewStatusSync(issueId)?.reviewerVerdicts as ReviewerVerdictsMap | undefined;
    let changedFiles: string[] | undefined;
    const anchors = new Set(
      Object.values(priorVerdicts ?? {}).map(v => v?.atCommit).filter((c): c is string => !!c),
    );
    if (anchors.size === 1) {
      try {
        const { stdout } = await execAsync(`git diff --name-only ${[...anchors][0]}..HEAD`, {
          cwd: workspace, encoding: 'utf-8', timeout: 15_000,
        });
        changedFiles = stdout.split('\n').map(l => l.trim()).filter(Boolean);
      } catch { /* anchor unreachable (rebase) -> unknown drift -> all run */ }
    }
    inScope = reviewersToRerun({ scope, priorVerdicts, changedFiles });
    carried = REVIEW_SUB_ROLES
      .filter(r => !inScope.includes(r))
      .map(r => ({ subRole: r, atCommit: priorVerdicts?.[r]?.atCommit }));
    if (carried.length > 0) {
      console.log(`[review-agent] Selective re-review for ${issueId} (scope=${scope}): re-running [${inScope.join(', ')}], carrying forward [${carried.map(c => c.subRole).join(', ')}]`);
    }
  } catch (scopeErr) {
    console.warn(`[review-agent] Selective re-review scope resolution failed for ${issueId} — running the full convoy:`, scopeErr);
    inScope = [...REVIEW_SUB_ROLES];
    carried = [];
  }
  return { inScope, carried, scope };
}

/**
 * PAN-1862 Phase A: fork the synthesis parent's Claude session JSONL to a fresh
 * session id so a convoy reviewer can `--resume` it and inherit the discovery
 * context (and its warm, content-addressed prompt cache). Returns null when the
 * fork is not possible — caller degrades to a fresh independent spawn (NFR-2).
 * The source JSONL is copied, never modified.
 */
async function forkParentSessionForReviewer(parentAgentId: string, workspace: string): Promise<string | null> {
  try {
    const { getLatestSessionIdSync } = await import('../agents.js');
    const parentSessionId = getLatestSessionIdSync(parentAgentId);
    if (!parentSessionId) return null;
    const src = sessionFilePath(workspace, parentSessionId);
    const { existsSync } = await import('fs');
    if (!existsSync(src)) return null;
    const { reserveForkSession, copySessionForFork } = await import('../conversations/session-fork.js');
    const reserved = await reserveForkSession(workspace);
    await copySessionForFork(src, reserved.sessionFile, { fullHistory: true });
    return reserved.sessionId;
  } catch (err) {
    console.warn(`[review-agent] Fork from ${parentAgentId} failed (degrading to independent spawn): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface ConvoyLaunchParams {
  issueId: string;
  workspace: string;
  runId: string;
  synthesisAgentId: string;
  inScope: ReviewSubRole[];
  carried: Array<{ subRole: ReviewSubRole; atCommit?: string }>;
  scope: ReReviewScope;
  contextManifestPath?: string;
  model?: string;
  harness?: RuntimeName;
  allowHost?: boolean;
  /** PAN-1862 Phase A: fork each eligible first-cycle reviewer from the parent's session. */
  forkFromParent?: boolean;
}

/**
 * Launch the review convoy for one run: write carried-forward stub reports, then
 * spawn (or fork-resume) each in-scope sub-reviewer. Shared by the inline
 * dispatch path (no fork) and the discovery-ready handler (fork).
 */
export async function launchConvoyReviewersPromise(params: ConvoyLaunchParams): Promise<Array<{ success: boolean; message: string }>> {
  const reviewDir = join(params.workspace, PAN_DIRNAME, 'review', params.runId);
  // PAN-1862 (FR-8): materialize carried-forward verdicts as stub reports in the
  // NEW run directory so synthesis and the deacon fallback still see one report
  // per sub-role, exactly as when every reviewer runs. Blocking-findings
  // extraction on a stub finds none -> the sub-role reads as passed.
  if (params.carried.length > 0) {
    await mkdir(reviewDir, { recursive: true });
    for (const c of params.carried) {
      const stubPath = reviewerAgentOutputPath(params.workspace, params.runId, c.subRole);
      const anchorNote = c.atCommit ? ` at commit ${c.atCommit.slice(0, 8)}` : '';
      await writeFile(stubPath, [
        `# ${c.subRole} review — VERDICT CARRIED FORWARD`,
        '',
        '## Verdict: APPROVED (carried forward — reviewer not re-run this cycle)',
        '',
        `This reviewer passed the prior cycle${anchorNote} and no files in its domain`,
        `changed since (reReviewScope=${params.scope}, PAN-1862 selective re-review).`,
        'Its prior findings report remains the report of record for that verdict.',
        '',
        '## Findings',
        '',
        'None.',
        '',
      ].join('\n'), 'utf-8');
    }
  }

  const cfg = loadYamlConfig().config;
  const { getAgentStateSync } = await import('../agents.js');
  const parentState = getAgentStateSync(params.synthesisAgentId);
  const reviewerResults = await Promise.all(params.inScope.map(async (subRole) => {
    const outputPath = reviewerAgentOutputPath(params.workspace, params.runId, subRole);

    // PAN-1862 Phase A fork decision, per reviewer: fork only when (a) fork mode is
    // on, (b) the parent runs claude-code (the fork machinery is Claude's --resume),
    // (c) the reviewer resolves to the SAME model as the parent (the cache is
    // per-model — a mismatched fork would replay the history at full price and the
    // Settings banner is the operator surface for that), and (d) the reviewer has
    // no resumable prior-cycle session of its own (its OWN context beats a re-fork —
    // PRD decision 3). Every failure degrades to today's independent spawn (NFR-2).
    let forkedSessionId: string | undefined;
    if (params.forkFromParent && parentState?.harness === 'claude-code' && !params.harness) {
      try {
        const { getLatestSessionIdSync } = await import('../agents.js');
        const reviewerModel = params.model ?? resolveModel('review', subRole, cfg);
        const hasOwnSession = !!getLatestSessionIdSync(reviewerAgentId(params.issueId, subRole));
        if (!hasOwnSession && reviewerModel === parentState.model) {
          forkedSessionId = (await forkParentSessionForReviewer(params.synthesisAgentId, params.workspace)) ?? undefined;
          if (forkedSessionId) {
            console.log(`[review-agent] Forked ${subRole} reviewer for ${params.issueId} from ${params.synthesisAgentId}'s discovery session (PAN-1862)`);
          }
        }
      } catch { /* degrade to independent spawn */ }
    }

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
      ...(forkedSessionId ? { forkedSessionId } : {}),
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
 * PAN-1862 Phase A (FR-2/FR-3/FR-4, NFR-5): handle the parent's discovery-ready
 * signal — fork the parent's session into the convoy reviewers and launch them.
 * Idempotent: a repeat signal (or a signal after the convoy already launched)
 * is a no-op. The parent survives unmodified and resumes its synthesis role;
 * the CLI (`pan admin specialists discovery-ready review <id>`) and the deacon
 * stalled-discovery backstop both land here.
 */
export async function handleReviewDiscoveryReady(
  issueId: string,
  opts: { source?: string } = {},
): Promise<{ success: boolean; message: string; launched?: number }> {
  const normalized = issueId.toUpperCase();
  const parentId = `agent-${normalized.toLowerCase()}-review`;
  const { saveAgentState, getAgentStateSync } = await import('../agents.js');
  const parent = getAgentStateSync(parentId);
  if (!parent) {
    return { success: false, message: `No review parent state for ${normalized} — nothing to fork` };
  }
  const workspace = parent.workspace;
  const runId = parent.reviewRunId;
  if (!workspace || !runId) {
    return { success: false, message: `Review parent for ${normalized} is missing workspace/runId state — cannot launch the convoy` };
  }

  // PAN-2585: the signal is AUTHORITATIVE. `reviewDiscoveryPending` is persisted only
  // in state.json and is invisible through the DB-backed agent reader, so it must not
  // gate the launch — gating on it left parents standing by forever for reviewers that
  // were never forked. Idempotency comes from evidence instead: a live reviewer
  // session, or a reviewer output already written for the CURRENT run, means the
  // convoy launched — no-op. No evidence means launch, flag or no flag.
  try {
    const sessions = await Effect.runPromise(listSessionNames());
    // PAN-2697: match ONLY the four convoy sub-role sessions. Prefix matching
    // also caught the always-on review supervisor (agent-<id>-review-supervisor),
    // which no-op'd every discovery-ready signal and stranded the convoy.
    const reviewerSessionNames = new Set(
      REVIEW_SUB_ROLES.map((subRole) => `agent-${normalized.toLowerCase()}-review-${subRole}`),
    );
    if (sessions.some(name => reviewerSessionNames.has(name))) {
      parent.reviewDiscoveryPending = false;
      await Effect.runPromise(saveAgentState(parent));
      return { success: true, message: `Convoy already launched for ${normalized} — no-op` };
    }
  } catch { /* liveness probe failure — proceed; spawnRun's own guards hold */ }
  try {
    const { existsSync } = await import('node:fs');
    const hasRunOutput = REVIEW_SUB_ROLES.some(subRole =>
      existsSync(reviewerAgentOutputPath(workspace, runId, subRole)),
    );
    if (hasRunOutput) {
      parent.reviewDiscoveryPending = false;
      await Effect.runPromise(saveAgentState(parent));
      return { success: true, message: `Convoy for ${normalized} run ${runId} already produced reviewer output — no-op` };
    }
  } catch { /* output probe failure — proceed */ }

  // Clear the pending flag BEFORE launching so a concurrent duplicate signal
  // short-circuits on the check above / the flag here.
  parent.reviewDiscoveryPending = false;
  parent.reviewDiscoveryReadyAt = new Date().toISOString();
  await Effect.runPromise(saveAgentState(parent));

  const { inScope, carried, scope } = await computeConvoyScope(normalized, workspace);
  const results = await launchConvoyReviewersPromise({
    issueId: normalized,
    workspace,
    runId,
    synthesisAgentId: parentId,
    inScope,
    carried,
    scope,
    contextManifestPath: parent.reviewContextManifestPath,
    allowHost: parent.hostOverride ?? false,
    forkFromParent: true,
  });

  const refreshed = getAgentStateSync(parentId);
  if (refreshed) {
    refreshed.reviewConvoyForkedAt = new Date().toISOString();
    await Effect.runPromise(saveAgentState(refreshed));
  }

  const launched = results.filter(r => r.success).length;
  const message = `Discovery-ready for ${normalized}${opts.source ? ` (${opts.source})` : ''}: launched ${launched}/${inScope.length} convoy reviewer(s)${carried.length ? `, carried [${carried.map(c => c.subRole).join(', ')}]` : ''}`;
  console.log(`[review-agent] ${message}`);
  emitActivityEntrySync({ source: 'review', level: 'info', message, issueId: normalized });
  return { success: launched > 0 || inScope.length === 0, message, launched };
}



/** PAN-1862 (FR-7): resolved re-review scope — merged config, default 'changed'. */
export function resolveReReviewScope(issueId?: string): ReReviewScope {
  // PAN-1874: per-issue record override beats merged project/global config
  // (same resolution shape as resolveReviewMode in review-agent.ts).
  if (issueId) {
    try {
      const project = resolveProjectForIssue(issueId);
      const issueScope = project ? readIssueRecordSync(project, issueId)?.reReviewScope : undefined;
      if (issueScope === 'all' || issueScope === 'changed' || issueScope === 'blockers') return issueScope;
    } catch { /* fall through to config */ }
  }
  const scope = loadYamlConfig().config.roles?.review?.reReviewScope;
  return scope === 'all' || scope === 'blockers' ? scope : 'changed';
}

