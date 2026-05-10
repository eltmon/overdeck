/**
 * Review Agent - Automatic code review using Claude Code
 */

import { existsSync } from 'fs';
import { readFile, writeFile, unlink, mkdir, appendFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parse as parseYaml } from 'yaml';
import { loadCloisterConfig, type ReviewAgentConfig } from './config.js';
import { createSessionAsync, killSessionAsync, sessionExistsAsync, sendKeysAsync, sendRawKeystrokeAsync, listSessionNamesAsync, capturePaneAsync, setOptionAsync, isPaneDeadAsync, listPaneValuesAsync, detectTerminalApiError, type TerminalApiError, buildTmuxCommandString } from '../tmux.js';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { getAgentRuntimeBaseCommand, getProviderAuthMode, getProviderExportsForModel } from '../agents.js';
import { getSpecialistHarness } from './router.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { loadConfig as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { AGENTS_DIR, CACHE_AGENTS_DIR, CACHE_REVIEW_PROMPTS_DIR, PANOPTICON_HOME, packageRoot } from '../paths.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { emitActivityEntry, emitActivityTts } from '../activity-logger.js';
import { resolveProjectFromIssue } from '../projects.js';
import { getReviewerSessionName, REVIEWER_ROLES, type ReviewerRole } from './specialists.js';
import { buildStashMessage, createNamedStash, dropStash, getNextReviewTempSequence, listStashes } from '../stashes.js';
import { getReviewStatus, setReviewStatus } from '../review-status.js';

const execAsync = promisify(exec);

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const REVIEW_HISTORY_DIR = join(SPECIALISTS_DIR, 'review-agent');
const REVIEW_HISTORY_FILE = join(REVIEW_HISTORY_DIR, 'history.jsonl');

async function buildReviewBaseCommand(model: string, sessionName: string): Promise<string> {
  const { canUseHarness } = await import('../harness-policy.js');
  const requestedHarness = getSpecialistHarness('review-agent');
  const authMode = await getProviderAuthMode(model);
  const decision = canUseHarness(requestedHarness, model, authMode);
  const harness = decision.allowed ? requestedHarness : 'claude-code';
  if (!decision.allowed) {
    console.warn(
      `[review-agent] canUseHarness(${requestedHarness},${model},${authMode}) blocked — ${decision.reason}. Falling back to claude-code.`,
    );
  }
  return getAgentRuntimeBaseCommand(model, sessionName, 'pan-review-agent', harness);
}

/**
 * Context for a code review request
 */
export interface ReviewContext {
  projectPath: string;
  prUrl: string;
  issueId: string;
  branch: string;
  workspace?: string;
  filesChanged?: string[];
}

/**
 * Result of review agent execution
 */
export interface ReviewResult {
  success: boolean;
  reviewResult: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  filesReviewed?: string[];
  securityIssues?: string[];
  performanceIssues?: string[];
  notes?: string;
  output?: string;
}

/**
 * Review history entry
 */
interface ReviewHistoryEntry {
  timestamp: string;
  issueId: string;
  prUrl: string;
  branch: string;
  filesChanged?: string[];
  result: ReviewResult;
  sessionId?: string;
}

/**
 * Timeout for review agent in milliseconds (30 minutes).
 * Performance reviewers of large PRs can need 20+ minutes of analysis time.
 */
const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_REVIEWER_TIMEOUT_RETRIES = 2;
const REVIEWER_TIMEOUT_RETRY_BACKOFF_MS = [2_000, 5_000];

function reviewerRetryBackoffMs(attempt: number): number {
  return REVIEWER_TIMEOUT_RETRY_BACKOFF_MS[Math.min(attempt - 1, REVIEWER_TIMEOUT_RETRY_BACKOFF_MS.length - 1)] ?? 5_000;
}

function isRetryableReviewerFailure(reason?: ReviewerFailureReason): boolean {
  return reason === 'timeout' || reason === 'pane_dead';
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Default reviewer agents used when specialists.review_agents is not configured.
 */
const DEFAULT_REVIEW_AGENTS: ReviewAgentConfig[] = [
  { name: 'correctness', focus: ['logic', 'edge cases', 'null handling', 'type safety'] },
  { name: 'security', focus: ['OWASP Top 10', 'injection', 'auth', 'secrets'] },
  { name: 'performance', focus: ['algorithms', 'N+1 queries', 'memory leaks'] },
  { name: 'requirements', focus: ['acceptance criteria', 'vBRIEF coverage', 'missing functionality'] },
];

// PAN-1048 R5: getActiveParallelReviewIssues removed. The legacy review
// session naming patterns (review-<id>-<ts>-<role>, review-coordinator-<id>-<ts>)
// no longer exist — the review role primitive uses agent-<id>-review.
// Callers (deacon, service startup recovery) now scan listRunningAgentsAsync
// for role==='review' agents directly.

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
function buildReviewRolePrompt(opts: {
  issueId: string;
  workspace: string;
  branch: string;
  prUrl?: string;
}): string {
  const port = process.env.API_PORT || process.env.PORT || '3011';
  return [
    `REVIEW TASK for ${opts.issueId}:`,
    '',
    `Issue: ${opts.issueId}`,
    `Branch: ${opts.branch}`,
    `Workspace: ${opts.workspace}`,
    opts.prUrl ? `PR: ${opts.prUrl}` : 'PR: (resolve via gh pr view ${branch})',
    '',
    'Follow roles/review.md exactly. The four convoy reviewers are launched',
    'via Agent tool calls (subagent_type: code-review-{security,correctness,',
    'performance,requirements}). Synthesis is your job — there is no separate',
    'synthesis sub-agent.',
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
    `    -d '{"reviewStatus":"blocked","reviewNotes":"<one-line summary; full details go through /send-feedback-to-agent>"}'`,
    '',
    'After posting reviewStatus=passed, reactive Cloister automatically dispatches',
    'the test role from the resulting review.approved lifecycle event. Do NOT',
    'queue a test specialist yourself; do NOT run gh pr merge; never edit code.',
  ].join('\n');
}

/**
 * PAN-1048 R3 / C1 / C2: Spawn the `review` role for an issue using the
 * unified role primitive (spawnRun) instead of the legacy detached
 * `pan review run` coordinator. Wraps the same orchestration concerns
 * dispatchParallelReview owned (idempotency check, feedback archive,
 * review-temp stash, reviewing-status flip, pipeline event) but the review
 * itself runs as a Claude Code session that loads roles/review.md and uses
 * the Agent tool to fan out to the four code-review-* sub-agents.
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
  // session-exists check but it throws — we want the soft "already running"
  // semantics dispatchParallelReview had, so callers can keep their existing
  // success-path messaging.
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
    const prompt = buildReviewRolePrompt(opts);
    const run = await spawnRun(opts.issueId, 'review', {
      workspace: opts.workspace,
      prompt,
      ...(opts.model ? { model: opts.model } : {}),
    });
    console.log(`[review-agent] Review role spawned for ${opts.issueId}: ${run.id}`);
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
 * Returns the list of enabled reviewer agents from config, falling back to defaults.
 */
export function getReviewAgents(): ReviewAgentConfig[] {
  try {
    const config = loadCloisterConfig();
    const configured = config.specialists?.review_agents;
    if (configured && configured.length > 0) {
      const active = configured.filter(a => a.enabled !== false);
      return active.length > 0 ? active : DEFAULT_REVIEW_AGENTS;
    }
  } catch {
    // Config load failure → use defaults
  }
  return DEFAULT_REVIEW_AGENTS;
}

/**
 * Get files changed in PR using gh CLI (non-blocking)
 */
export async function getFilesChangedFromPR(
  prUrl: string,
  projectPath: string,
  { execFn = execAsync }: { execFn?: typeof execAsync } = {},
): Promise<string[]> {
  try {
    const { stdout } = await execFn(`gh pr view ${prUrl} --json files --jq '.files[].path'`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    return (stdout as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    console.error('Failed to get files changed from PR:', error);
    return [];
  }
}

/**
 * Parse result markers from agent output
 */
function parseAgentOutput(output: string): ReviewResult {
  const lines = output.split('\n');

  let reviewResult: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | null = null;
  let filesReviewed: string[] = [];
  let securityIssues: string[] = [];
  let performanceIssues: string[] = [];
  let notes = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Match REVIEW_RESULT
    if (trimmed.startsWith('REVIEW_RESULT:')) {
      const value = trimmed.substring('REVIEW_RESULT:'.length).trim();
      if (value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'COMMENTED') {
        reviewResult = value;
      }
    }

    // Match FILES_REVIEWED
    if (trimmed.startsWith('FILES_REVIEWED:')) {
      const value = trimmed.substring('FILES_REVIEWED:'.length).trim();
      filesReviewed = value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    }

    // Match SECURITY_ISSUES
    if (trimmed.startsWith('SECURITY_ISSUES:')) {
      const value = trimmed.substring('SECURITY_ISSUES:'.length).trim();
      if (value !== 'none') {
        securityIssues = value
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0);
      }
    }

    // Match PERFORMANCE_ISSUES
    if (trimmed.startsWith('PERFORMANCE_ISSUES:')) {
      const value = trimmed.substring('PERFORMANCE_ISSUES:'.length).trim();
      if (value !== 'none') {
        performanceIssues = value
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0);
      }
    }

    // Match NOTES
    if (trimmed.startsWith('NOTES:')) {
      notes = trimmed.substring('NOTES:'.length).trim();
    }
  }

  // Build result
  if (reviewResult) {
    return {
      success: true,
      reviewResult,
      filesReviewed,
      securityIssues: securityIssues.length > 0 ? securityIssues : undefined,
      performanceIssues: performanceIssues.length > 0 ? performanceIssues : undefined,
      notes,
      output,
    };
  } else {
    // No result markers found - assume failure
    return {
      success: false,
      reviewResult: 'COMMENTED',
      notes: 'Agent did not report result in expected format',
      output,
    };
  }
}

/**
 * Builds the markdown body for the feedback file written to the work agent.
 * Exported for testing so the resubmit command contract can be verified.
 */
export function buildReviewFeedbackBody(issueId: string, result: ReviewResult): string {
  const actionBlock = result.reviewResult === 'CHANGES_REQUESTED'
    ? `\n## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill\n\n1. Read each blocking issue carefully\n2. Fix the code for EVERY issue listed\n3. Run tests locally to verify your fixes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.\n`
    : result.reviewResult === 'APPROVED'
      ? `\n## ✅ CODE APPROVED — YOUR WORK IS COMPLETE\n\n**Do NOT make any more changes.**\n**Do NOT run \`pan done\` again.**\n**Do NOT run \`pan review request\`.**\n\nThe specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.\n`
      : '';

  if (result.output) {
    const synthesisBody = result.output
      .replace(/\n(?=(?:REVIEW_RESULT|FILES_REVIEWED|SECURITY_ISSUES|PERFORMANCE_ISSUES|NOTES):)[^\n]*/g, '')
      .trim();
    return synthesisBody + '\n' + actionBlock;
  }

  let body = `# Review: ${result.reviewResult}\n\n`;
  body += `## Summary\n\n${result.notes || 'No details provided.'}\n`;

  if (result.securityIssues && result.securityIssues.length > 0) {
    body += `\n## Security Issues\n\n${result.securityIssues.map(i => `- ${i}`).join('\n')}\n`;
  }

  if (result.performanceIssues && result.performanceIssues.length > 0) {
    body += `\n## Performance Issues\n\n${result.performanceIssues.map(i => `- ${i}`).join('\n')}\n`;
  }

  body += actionBlock;
  return body;
}

/** Minimal parsed agent template (frontmatter + body) */
interface ReviewerTemplate {
  model: string;
  content: string;
}

export async function parseReviewerTemplate(templatePath: string): Promise<ReviewerTemplate> {
  if (!existsSync(templatePath)) {
    throw new Error(`Reviewer template not found: ${templatePath}`);
  }
  const raw = await readFile(templatePath, 'utf-8');
  const match = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid template format (missing frontmatter): ${templatePath}`);
  }
  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  return {
    model: typeof frontmatter.model === 'string' ? frontmatter.model : 'sonnet',
    content: match[2].trim(),
  };
}

/**
 * Resolve shorthand aliases (opus/sonnet/haiku) that can appear in agent
 * definition frontmatter through the review role. The role model config is the
 * single source of truth after the legacy WorkType router removal.
 */
function resolveClaudeAlias(model: string): string {
  if (!['opus', 'sonnet', 'haiku'].includes(model)) return model;
  try {
    return resolveModel('review', undefined, loadYamlConfig().config);
  } catch {
    return model;
  }
}

/** Map reviewer role name to the review sub-role used for model routing. */
function reviewRoleToSubRole(role: string): string | undefined {
  const map: Record<string, string> = {
    correctness: 'correctness',
    security: 'security',
    performance: 'performance',
    requirements: 'requirements',
  };
  return map[role];
}

/** Resolve the model to use for a reviewer, preferring agent-level override then role routing. */
export function resolveReviewerModel(agent: ReviewAgentConfig, defaultModel: string): string {
  const envOverride = process.env.PANOPTICON_REVIEW_MODEL_OVERRIDE;
  if (envOverride) return resolveClaudeAlias(envOverride);
  if (agent.model) return resolveClaudeAlias(agent.model);

  try {
    return resolveModel('review', reviewRoleToSubRole(agent.name), loadYamlConfig().config);
  } catch {
    return defaultModel;
  }
}

/** Spawn a single reviewer tmux session and send its prompt.
 *  Runs from the workspace (projectPath) so relative paths and git commands
 *  resolve to the correct checkout. The workspace is a git worktree, so it
 *  shares .claude/rules/ and CLAUDE.md with the main repo.
 */
export async function spawnSingleReviewer(
  sessionName: string,
  model: string,
  promptFile: string,
  projectPath: string,
): Promise<void> {
  // PAN-982 + PAN-636: emit 'claude --agent pan-review-agent --name <sessionName>'
  // on the claude-code path, or fall back to Pi when configured. The harness
  // routing + ToS gate are local now that the legacy specialist router helper is gone.
  const claudeCmd = await buildReviewBaseCommand(model, sessionName);
  const providerExports = await getProviderExportsForModel(model);

  // Pre-generate the Claude session UUID and persist it to the canonical reviewer
  // agent directory BEFORE Claude starts. Without this, jsonl-resolver has nothing
  // to look up: session.id is missing, sessions.json hasn't been written yet (the
  // heartbeat hook only fires after a tool use), and the runtime-state mirror is
  // empty. The Conversation/Activity tabs would render no transcript.
  //
  // The resolver lookup order in jsonl-resolver.ts is:
  //   1. ~/.panopticon/agents/<sessionName>/session.id
  //   2. sessions.json (heartbeat hook output)
  //   3. runtime-state mirror
  //
  // Pre-writing session.id wins on the first lookup, and the heartbeat hook will
  // later append the same UUID to sessions.json (because PANOPTICON_AGENT_ID is
  // pinned to the canonical session name below).
  const claudeSessionId = randomUUID();
  const reviewerAgentDir = join(AGENTS_DIR, sessionName);
  await mkdir(reviewerAgentDir, { recursive: true });
  await writeFile(join(reviewerAgentDir, 'session.id'), claudeSessionId, 'utf-8');

  // Write a launcher script that unsets all stale provider env vars and re-exports
  // the correct ones for the target model before exec-ing the agent runtime.
  // Using a script (rather than tmux -e flags) ensures that stale ANTHROPIC_BASE_URL
  // from the parent tmux server env is always cleared — even for Anthropic models
  // whose env map is empty, so tmux -e flags would add nothing and the parent
  // session's ANTHROPIC_BASE_URL pointing at a proxy would leak through.
  const launcherPath = join(tmpdir(), `pan-reviewer-${sessionName}.sh`);
  const launcherContent = generateLauncherScript({
    role: 'review',
    workingDir: projectPath,
    setPipefail: true,
    setTerminalEnv: true,
    unsetPanopticonEnv: true,
    panopticonEnv: { agentId: sessionName },
    providerExports: providerExports.trimEnd(),
    baseCommand: claudeCmd,
    sessionId: claudeSessionId,
  });
  await writeFile(launcherPath, launcherContent, { mode: 0o755 });

  console.log(`[claude-invoke] purpose=review-agent | model=${model} | source=review-agent.ts:spawnReviewer | session=${sessionName} | claudeSessionId=${claudeSessionId} | launcher=${launcherPath}`);
  console.log(`[review-agent] Launcher content:\n${launcherContent}`);

  // Build the same env that createSessionAsync would have passed
  const sessionEnv = {
    ...BLANKED_PROVIDER_ENV,
    TERM: 'xterm-256color',
    PANOPTICON_AGENT_ID: sessionName,
    PANOPTICON_ISSUE_ID: '',
    PANOPTICON_SESSION_TYPE: '',
  };

  // Build tmux -e flags for environment variables (same logic as specialists.ts buildTmuxEnvFlags)
  let envFlags = '';
  for (const [key, value] of Object.entries(sessionEnv)) {
    envFlags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
  }

  // Kill stale session first to prevent "duplicate session" error (matches review launcher pattern)
  await killSessionAsync(sessionName).catch(() => {});
  // Use the same atomic spawn pattern as review launcher: new-session + bash launcher in one execAsync call.
  // createSessionAsync only created the session — it never executed the launcher, so the bash/claude
  // process never started and sendKeysAsync had no process to deliver keys to (PAN-1034).
  await execAsync(
    `${buildTmuxCommandString(['new-session', '-d', '-s', sessionName, '-c', projectPath])}${envFlags} "bash '${launcherPath}'"`,
    { encoding: 'utf-8' }
  );

  // Pin remain-on-exit IMMEDIATELY after new-session, before claude has a chance
  // to exit. Without this, a fast-failing launcher (auth error, model unreachable,
  // OOM) makes the session vanish in <100ms, which manifests downstream as
  // "exited without output after Nms" and aborts the entire review even though
  // the specialist's claude process briefly ran and logged thousands of lines.
  // The caller used to set this much later in runParallelReview — too late.
  // PAN-1030 reproduced this: all 4 specialists vanished in 16s while their
  // claude logs grew to 1.7k–2.3k lines.
  try {
    await setOptionAsync(sessionName, 'remain-on-exit', 'on');
  } catch (err) {
    console.warn(`[review-agent] Failed to pin remain-on-exit on ${sessionName}: ${err instanceof Error ? err.message : err}`);
  }

  // Pipe all pane output to a log file so connection errors and Claude output are
  // captured even after the session exits.
  const claudeLogFile = join(dirname(promptFile), `${sessionName.split('-').pop()}-claude.log`);
  try {
    await execAsync(`tmux pipe-pane -o -t "${sessionName}" 'cat >> "${claudeLogFile}"'`);
    console.log(`[review-agent] Claude output logging → ${claudeLogFile}`);
  } catch (err) {
    console.warn(`[review-agent] Failed to start pane logging for ${sessionName}: ${err}`);
  }

  // Wait for Claude to start
  await new Promise(resolve => setTimeout(resolve, 1500));

  const prompt = await readFile(promptFile, 'utf-8');
  await sendKeysAsync(sessionName, prompt, 'spawnReviewer');
}

/**
 * Failure reasons for a reviewer wait. `terminal_api_error` means the upstream
 * provider returned a non-recoverable error (quota exhausted, login required,
 * 401/403) — auto-respawn won't help. The other three are existing legacy modes.
 */
export type ReviewerFailureReason =
  | 'session_exited'
  | 'pane_dead'
  | 'timeout'
  | 'terminal_api_error';

export type ReviewerWaitResult =
  | { status: 'completed' }
  | { status: 'failed'; reason: ReviewerFailureReason; apiError?: TerminalApiError };

/**
 * Poll until the output file is written (or the session exits), then kill the session.
 *
 * For synthesis sessions: a `requireMarker` predicate may be passed to defeat a race
 * where the agent writes synthesis.md in two stages (body first, tail markers appended
 * seconds later). Without the predicate, parser fires on the incomplete first write
 * and rejects valid output as "did not report result in expected format".
 *
 * On every poll cycle we also scan the pane for terminal upstream-API errors
 * (quota exhausted, auth failed, login required). Without this check, an API
 * 403 from the reviewer's model provider sits silently at the prompt for the
 * full 30-minute timeout — Claude Code doesn't exit on API errors, it just
 * prints the error and returns to the input prompt, so sessionExists and
 * pane_dead both keep returning true. Detecting via pane content is the only
 * reliable signal for this failure mode.
 */
export async function waitForReviewer(
  sessionName: string,
  outputFile: string,
  timeoutMs: number,
  {
    sessionExists = sessionExistsAsync,
    fileExists = existsSync,
    killSession = killSessionAsync,
    capturePane = (name: string) => capturePaneAsync(name, 500),
    requireMarker,
  }: {
    sessionExists?: (name: string) => Promise<boolean>;
    fileExists?: (path: string) => boolean;
    killSession?: (name: string) => Promise<void>;
    capturePane?: (sessionName: string) => Promise<string>;
    requireMarker?: string;
  } = {},
): Promise<ReviewerWaitResult> {
  const outputDir = dirname(outputFile);
  const role = sessionName.split('-').pop() ?? 'unknown';
  const tmuxLogFile = join(outputDir, `${role}-tmux.log`);
  const errorFile = join(outputDir, `${role}-error.json`);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  const writePaneCapture = async (label: string, pane: string): Promise<void> => {
    try {
      if (pane) await writeFile(tmuxLogFile, pane, { flag: 'a' });
      console.error(`[review-agent] ${label} capture written to ${tmuxLogFile}`);
    } catch (err) {
      console.error(`[review-agent] Failed to write pane capture for ${sessionName}:`, err);
    }
  };

  while (Date.now() < deadline) {
    // Output file is the primary completion signal — Claude sessions don't auto-exit.
    // Keep the session alive so the dashboard can show reviewer tabs after completion.
    if (fileExists(outputFile)) {
      if (requireMarker) {
        try {
          const content = await readFile(outputFile, 'utf-8');
          if (content.includes(requireMarker)) {
            console.log(`[review-agent] Reviewer ${sessionName} completed (marker '${requireMarker}' present) in ${Date.now() - startedAt}ms`);
            return { status: 'completed' };
          }
          // File exists but marker not yet written — keep polling.
        } catch (err) {
          console.warn(`[review-agent] Failed to read ${outputFile} while checking marker:`, err);
        }
      } else {
        console.log(`[review-agent] Reviewer ${sessionName} completed in ${Date.now() - startedAt}ms`);
        return { status: 'completed' };
      }
    }
    if (!await sessionExists(sessionName)) {
      // Session exited without writing output — capture pane for diagnosis
      const elapsed = Date.now() - startedAt;
      console.error(`[review-agent] Reviewer ${sessionName} exited without output after ${elapsed}ms — capturing pane`);
      try {
        const pane = await capturePane(sessionName);
        await writePaneCapture('Pane', pane);
      } catch (err) {
        console.error(`[review-agent] Failed to capture pane for ${sessionName}:`, err);
      }
      return { status: 'failed', reason: 'session_exited' };
    }

    // Capture pane once per cycle so we can run BOTH the pane-dead check and
    // the terminal API error scan from the same capture — half the tmux forks.
    let pane = '';
    try { pane = await capturePane(sessionName); } catch { /* non-fatal */ }

    // Terminal upstream-API error (quota exhausted / auth / login required).
    // Pane stays alive after these because Claude Code returns to its prompt;
    // without this check we'd burn the full timeout on a failure that's
    // already permanent.
    const apiError = detectTerminalApiError(pane);
    if (apiError) {
      const elapsed = Date.now() - startedAt;
      console.error(`[review-agent] Reviewer ${sessionName} hit terminal API error after ${elapsed}ms: ${apiError.summary}`);
      await writePaneCapture('Terminal-API-error', pane);
      try {
        await writeFile(errorFile, JSON.stringify({ sessionName, apiError, detectedAt: new Date().toISOString() }, null, 2));
      } catch (err) {
        console.error(`[review-agent] Failed to write error file ${errorFile}:`, err);
      }
      try { await killSession(sessionName); } catch { /* non-fatal */ }
      return { status: 'failed', reason: 'terminal_api_error', apiError };
    }

    // PAN-912 follow-up: detect dead panes even when remain-on-exit keeps the session alive.
    // Without this check a pane that dies (e.g. API auth error → status 143) burns the full
    // 30-minute timeout because sessionExistsAsync still returns true.
    if (await isPaneDeadAsync(sessionName)) {
      const elapsed = Date.now() - startedAt;
      console.error(`[review-agent] Reviewer ${sessionName} pane is dead after ${elapsed}ms — capturing pane`);
      await writePaneCapture('Dead-pane', pane);
      return { status: 'failed', reason: 'pane_dead' };
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Timeout — capture pane, kill, report failed
  const elapsed = Date.now() - startedAt;
  console.error(`[review-agent] Reviewer ${sessionName} timed out after ${elapsed}ms — capturing pane`);
  try {
    const pane = await capturePane(sessionName);
    await writePaneCapture('Pane', pane);
  } catch (err) {
    console.error(`[review-agent] Failed to capture pane for ${sessionName}:`, err);
  }
  try { await killSession(sessionName); } catch (err) {
    console.error(`[review-agent] Failed to kill timed-out reviewer session ${sessionName}:`, err);
  }
  return { status: 'failed', reason: 'timeout' };
}

/**
 * Kill all canonical reviewer and synthesis sessions for an issue.
 *
 * PAN-915: this is no longer called per-round. Canonical reviewer sessions
 * persist across review rounds via PAN-830's `remain-on-exit on` so each round
 * resumes the same Claude process via `sendKeysAsync` — preserving the
 * reviewer's accumulated context (codebase patterns, prior findings, decisions
 * made during earlier rounds). This function is now invoked from terminal
 * lifecycle events: merge complete, reset, cancel, deep-wipe, and explicit
 * `pan review abort`.
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
 *   - review-coordinator-<issueId>-<timestamp>
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

type ReviewerOutcome = {
  role: string;
  status: 'completed' | 'failed';
  outputFile: string;
  sessionName?: string;
  /** Why the reviewer failed; only set when status === 'failed'. */
  failureReason?: ReviewerFailureReason;
  /** Specific upstream-API failure surfaced from the pane, if any. */
  apiError?: TerminalApiError;
};

/**
 * Returns completed reviewer outputs, or null if any reviewer failed.
 * Synthesis must not run on partial reviewer input — caller must treat null as a hard failure.
 */
export function selectCompletedReviewers(
  results: ReviewerOutcome[],
): Array<{ role: string; outputFile: string }> | null {
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length > 0) return null;
  return results.map(r => ({ role: r.role, outputFile: r.outputFile }));
}

/**
 * Resolve the prompt template path for a review agent.
 *
 * Reviewer/synthesis prompts are Claude agent definitions under
 * `.claude/agents/<promptName>.md`. Older cache locations are retained only
 * as fallbacks for already-synced installs.
 *
 * Review prompts run from the main Panopticon codebase, so they must use
 * templates from the main repo/cache — never from a workspace's agents/ directory.
 */
export function resolvePromptTemplatePath(promptName: string, _projectPath: string): string {
  const repoAgentDefinition = join(packageRoot, '.claude', 'agents', `${promptName}.md`);
  if (existsSync(repoAgentDefinition)) return repoAgentDefinition;
  const cachedTemplate = join(CACHE_REVIEW_PROMPTS_DIR, `${promptName}.prompt-template.md`);
  if (existsSync(cachedTemplate)) return cachedTemplate;
  return join(CACHE_AGENTS_DIR, `${promptName}.md`);
}

/** @deprecated Use resolvePromptTemplatePath. Kept for backward compatibility. */
export const resolveTemplatePath = resolvePromptTemplatePath;


/**
 * Round metadata persisted to `~/.panopticon/agents/<canonical-session>/round-N.json`
 * for each canonical reviewer pane (correctness, security, performance,
 * requirements, synthesis). Replaces the old destructive
 * `cleanupReviewerStateDirs` from PAN-821 — state dirs now persist across
 * the issue's full lifetime so Command Deck can show every round's history
 * (PAN-830).
 */
export interface ReviewerRoundArtifact {
  round: number;
  role: string;
  issueId: string;
  projectKey: string;
  reviewId: string;
  outputDir: string;
  outputFile: string;
  status: 'completed' | 'failed' | 'unknown';
  reviewResult: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  success: boolean;
  archivedAt: string;
  /** Wall-clock start of the round (set by runParallelReview before spawning reviewers). */
  startedAt: string;
  /** Wall-clock end of the round (= archivedAt; kept distinct so the frontend can render
   *  duration without coupling to "archived" semantics). */
  endedAt: string;
  /** Round duration in seconds, or null when timestamps are missing/invalid. */
  durationSec: number | null;
  /** Count of findings reported by this round's synthesis (security + performance issues).
   *  Per-role artifacts inherit the synthesis count so the frontend has a non-null number
   *  to render on every reviewer card; cost is omitted intentionally — accurate per-round
   *  cost tracking requires session-level cost attribution which is not yet wired through. */
  findings?: number;
  /** Round cost in USD (omitted when not yet tracked — see findings comment above). */
  cost?: number;
}

/**
 * Append a round-N.json artifact inside each canonical reviewer's state dir.
 * The N is derived from the count of existing round-*.json files. Non-fatal:
 * any individual write failure is logged but does not throw.
 *
 * Exported so unit tests can exercise the archive path against a temporary
 * agents dir without spinning up a full review.
 */
export async function archiveReviewerRound(opts: {
  projectKey: string;
  issueId: string;
  agents: ReviewAgentConfig[];
  reviewId: string;
  outputDir: string;
  reviewerResults: Array<{ role: string; status: 'completed' | 'failed'; outputFile: string }>;
  result: ReviewResult;
  /** Wall-clock start of this round (captured at runParallelReview entry). */
  startedAt: string;
  /** Override the agents dir root. Defaults to AGENTS_DIR — only tests should pass this. */
  agentsDirOverride?: string;
}): Promise<void> {
  const { projectKey, issueId, agents, reviewId, outputDir, reviewerResults, result, startedAt } = opts;
  const agentsDir = opts.agentsDirOverride ?? AGENTS_DIR;
  const roles: ReviewerRole[] = [
    ...agents.map(a => a.name as ReviewerRole),
    'synthesis',
  ];
  const archivedAt = new Date().toISOString();
  // endedAt is the moment we archive (= synthesis completed). Kept distinct from
  // archivedAt so the frontend can render durations without coupling to "archived".
  const endedAt = archivedAt;
  // Compute duration; guard NaN from invalid timestamps the same way reviewer-tree.ts does.
  let durationSec: number | null = null;
  if (startedAt) {
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    if (Number.isFinite(ms)) durationSec = Math.floor(ms / 1000);
  }
  // Findings count = parsed-synthesis security + performance issues. This is a
  // floor (the synthesis emits richer counts in its appendix prose), but it's a
  // non-null number we can actually trust without re-parsing markdown here.
  const findings =
    (result.securityIssues?.length ?? 0) + (result.performanceIssues?.length ?? 0);
  // Parallelize round artifact writes — each role targets a different directory
  // so there is no contention (PAN-847).
  const archiveTasks = roles.map(async (role) => {
    const sessionName = getReviewerSessionName(role, projectKey, issueId);
    const dirPath = join(agentsDir, sessionName);
    if (!existsSync(dirPath)) return false;

    let nextN = 1;
    try {
      const entries = await readdir(dirPath);
      const roundFiles = entries.filter(f => /^round-\d+\.json$/.test(f));
      nextN = roundFiles.length + 1;
    } catch {
      // dir unreadable — fall back to 1; the write will surface any real error.
    }

    const reviewerStatus =
      role === 'synthesis'
        ? (result.success ? 'completed' : 'failed')
        : (reviewerResults.find(r => r.role === role)?.status ?? 'unknown');
    const outputFile =
      role === 'synthesis'
        ? join(outputDir, 'synthesis.md')
        : join(outputDir, `${role}.md`);

    const artifact: ReviewerRoundArtifact = {
      round: nextN,
      role,
      issueId,
      projectKey,
      reviewId,
      outputDir,
      outputFile,
      status: reviewerStatus,
      reviewResult: result.reviewResult,
      success: result.success,
      archivedAt,
      startedAt,
      endedAt,
      durationSec,
      findings,
    };

    try {
      await writeFile(
        join(dirPath, `round-${nextN}.json`),
        JSON.stringify(artifact, null, 2),
      );
      return true;
    } catch (err) {
      console.error(`[review-agent] Failed to write round-${nextN}.json for ${sessionName}:`, err instanceof Error ? err.message : err);
      return false;
    }
  });

  const archiveResults = await Promise.all(archiveTasks);
  const archived = archiveResults.filter(Boolean).length;
  if (archived > 0) {
    console.log(`[review-agent] Archived round artifacts for ${archived} reviewer pane(s) (review ${reviewId})`);
  }
}

/**
 * Parse synthesis output and individual reviewer files into a ReviewResult.
 */
export async function parseReviewSynthesis(
  reviewOutputDir: string,
  agents?: ReviewAgentConfig[],
): Promise<ReviewResult> {
  const synthesisPath = join(reviewOutputDir, 'synthesis.md');

  if (!existsSync(synthesisPath)) {
    return {
      success: false,
      reviewResult: 'COMMENTED',
      notes: 'Review did not produce synthesis output',
    };
  }

  const synthesisContent = await readFile(synthesisPath, 'utf-8');
  const result = parseAgentOutput(synthesisContent);

  // Collect file references from reviewer outputs.
  // Use provided agents list when available; otherwise scan directory for *.md
  // files (excluding synthesis.md) so parse stays independent of current config.
  let reviewerFiles: string[];
  if (agents) {
    reviewerFiles = agents.map(a => `${a.name}.md`);
  } else {
    const entries = await readdir(reviewOutputDir);
    reviewerFiles = entries.filter(f => f.endsWith('.md') && f !== 'synthesis.md');
  }

  const filesReviewed: string[] = [];
  await Promise.all(reviewerFiles.map(async filename => {
    const filePath = join(reviewOutputDir, filename);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, 'utf-8');
      const matches = content.match(/\b[\w/\-.]+\.(ts|js|tsx|jsx|py|java|go|rs)\b/g);
      if (matches) filesReviewed.push(...matches);
    }
  }));

  result.filesReviewed = [...new Set(filesReviewed)];
  return result;
}

/**
 * Map a ReviewResult outcome to the reviewStatus value written after parallel review.
 * CHANGES_REQUESTED → 'blocked' (not 'pending') so the deacon does not immediately
 * re-dispatch the review before the work agent has a chance to address the feedback.
 *
 * COMMENTED with success=true means the review completed but found no blockers
 * (PAN-869) — this should surface as 'passed' so the PR enters the Awaiting Merge
 * column. COMMENTED with success=false means synthesis/protocol failure — keep as
 * 'failed' so the deacon can retry.
 */
export function reviewResultToReviewStatus(
  result: ReviewResult,
): 'passed' | 'blocked' | 'failed' {
  if (result.reviewResult === 'APPROVED') return 'passed';
  if (result.reviewResult === 'CHANGES_REQUESTED') return 'blocked';
  // COMMENTED with success=true → review completed, no blockers found (PAN-869)
  if (result.reviewResult === 'COMMENTED' && result.success) return 'passed';
  // COMMENTED with success=false → synthesis/protocol failure, retry
  return 'failed';
}

// PAN-1048 review feedback 006 (REQ-17): the legacy review pipeline has been
// retired. dispatchParallelReview, spawnReviewCoordinatorSession, and
// runParallelReview were the bash/tmux coordinator path that ran reviewer
// agents as detached `pan review run`-driven sessions writing to
// .pan/review/<reviewId>/. Convoy reviewers now run as Agent-tool subagents
// inside the review role launched by spawnReviewRoleForIssue →
// spawnRun(issueId, 'review'). The new code-review-* sub-agent definitions
// are read-only (no Write tool) and return findings as their agent response
// rather than writing to an Output file, which made runParallelReview's
// file-wait protocol structurally incompatible.
//
// All entry-point callers (POST /api/review/:issueId/trigger, the reactive
// scheduler's review branch, dashboard kanban "Review again", etc.) call
// spawnReviewRoleForIssue. The exported helpers archiveReviewerRound,
// parseReviewSynthesis, selectCompletedReviewers, waitForReviewer,
// spawnSingleReviewer, and reviewResultToReviewStatus remain alongside
// their pinned tests as a stop-over until follow-up cleanup decommissions
// them; they have no production callers.
