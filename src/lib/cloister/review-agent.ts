/**
 * Review Agent - Automatic code review using Claude Code
 */

import { existsSync } from 'fs';
import { readFile, writeFile, unlink, mkdir, appendFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parse as parseYaml } from 'yaml';
import { loadCloisterConfig, type ReviewAgentConfig } from './config.js';
import { createSessionAsync, killSessionAsync, sessionExistsAsync, sendKeysAsync, listSessionNamesAsync } from '../tmux.js';
import { getProviderExportsForModel, getAgentRuntimeBaseCommand } from '../agents.js';
import { getModelId } from '../work-type-router.js';
import { CACHE_AGENTS_DIR, PANOPTICON_HOME, packageRoot } from '../paths.js';
import { writeFeedbackFile } from './feedback-writer.js';

const execAsync = promisify(exec);

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const REVIEW_HISTORY_DIR = join(SPECIALISTS_DIR, 'review-agent');
const REVIEW_HISTORY_FILE = join(REVIEW_HISTORY_DIR, 'history.jsonl');

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
 * Timeout for review agent in milliseconds (20 minutes)
 */
const REVIEW_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Default reviewer agents used when specialists.review_agents is not configured.
 */
const DEFAULT_REVIEW_AGENTS: ReviewAgentConfig[] = [
  { name: 'correctness', focus: ['logic', 'edge cases', 'null handling', 'type safety'] },
  { name: 'security', focus: ['OWASP Top 10', 'injection', 'auth', 'secrets'] },
  { name: 'performance', focus: ['algorithms', 'N+1 queries', 'memory leaks'] },
  { name: 'requirements', focus: ['acceptance criteria', 'vBRIEF coverage', 'missing functionality'] },
];

/**
 * Extracts issue IDs from ad-hoc parallel review tmux session names.
 * Sessions spawned by dispatchParallelReview follow the pattern:
 *   review-<issueId>-<timestamp>-<role>
 * e.g. review-PAN-540-1713456789000-correctness
 */
export function getActiveParallelReviewIssues(sessionNames: string[]): Set<string> {
  const active = new Set<string>();
  for (const name of sessionNames) {
    const match = name.match(/^review-([A-Z0-9]+-\d+)-\d+-/);
    if (match) {
      active.add(match[1].toUpperCase());
    }
  }
  return active;
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
 * Send review feedback to the work agent.
 * Writes feedback to .planning/feedback/ in the workspace, updates STATE.md,
 * and sends a short reference via tmux.
 */
/**
 * Builds the markdown body for the feedback file written to the work agent.
 * Exported for testing so the resubmit command contract can be verified.
 */
export function buildReviewFeedbackBody(issueId: string, result: ReviewResult): string {
  let body = `# Review: ${result.reviewResult}\n\n`;
  body += `## Summary\n\n${result.notes || 'No details provided.'}\n`;

  if (result.securityIssues && result.securityIssues.length > 0) {
    body += `\n## Security Issues\n\n${result.securityIssues.map(i => `- ${i}`).join('\n')}\n`;
  }

  if (result.performanceIssues && result.performanceIssues.length > 0) {
    body += `\n## Performance Issues\n\n${result.performanceIssues.map(i => `- ${i}`).join('\n')}\n`;
  }

  if (result.reviewResult === 'CHANGES_REQUESTED') {
    body += `\n## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill\n\n1. Read each blocking issue carefully\n2. Fix the code for EVERY issue listed\n3. Run tests locally to verify your fixes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.\n`;
  } else if (result.reviewResult === 'APPROVED') {
    body += `\n## Next Steps\n\nCode approved. It will proceed to testing.\n`;
  }

  return body;
}

async function sendFeedbackToWorkAgent(
  context: ReviewContext,
  result: ReviewResult
): Promise<void> {
  const agentSession = `agent-${context.issueId.toLowerCase()}`;
  const outcome = result.reviewResult.toLowerCase().replace(/_/g, '-');

  const body = buildReviewFeedbackBody(context.issueId, result);

  // Write feedback file to workspace (use workspace path, not project root)
  const fileResult = await writeFeedbackFile({
    issueId: context.issueId,
    workspacePath: context.workspace,
    specialist: 'review-agent',
    outcome,
    summary: `Review ${result.reviewResult}: ${(result.notes || '').slice(0, 80)}`,
    markdownBody: body,
  });

  if (!fileResult.success) {
    console.error(`[review-agent] Failed to write feedback file for ${context.issueId}: ${fileResult.error}`);
    return;
  }

  // Send short reference pointing to the file
  try {
    const { messageAgent } = await import('../agents.js');
    const msg = `SPECIALIST FEEDBACK: review-agent reported ${result.reviewResult} for ${context.issueId}.\nRead and address: ${fileResult.relativePath}`;
    await messageAgent(agentSession, msg);
    console.log(`[review-agent] Sent feedback to ${agentSession}`);
  } catch (error) {
    // Agent may be gone — feedback file is still in the workspace for crash recovery
    console.error(`[review-agent] Failed to send feedback to ${agentSession}:`, error);
  }
}

/**
 * Log review to history
 */
async function logReviewHistory(
  context: ReviewContext,
  result: ReviewResult,
  sessionId?: string
): Promise<void> {
  if (!existsSync(REVIEW_HISTORY_DIR)) {
    await mkdir(REVIEW_HISTORY_DIR, { recursive: true });
  }

  const entry: ReviewHistoryEntry = {
    timestamp: new Date().toISOString(),
    issueId: context.issueId,
    prUrl: context.prUrl,
    branch: context.branch,
    filesChanged: context.filesChanged,
    result: {
      ...result,
      output: undefined, // Don't store full output in history
    },
    sessionId,
  };

  await appendFile(REVIEW_HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Post a GitHub PR review (approve or request-changes) based on the review result.
 * Non-fatal: logs errors but does not throw.
 */
async function postGitHubPRReview(
  context: ReviewContext,
  result: ReviewResult,
  outputDir: string,
): Promise<void> {
  if (!context.prUrl) return;

  try {
    // Extract PR number from URL
    const prMatch = context.prUrl.match(/\/pull\/(\d+)/);
    if (!prMatch) {
      console.warn(`[review-agent] Cannot post GitHub review: invalid PR URL ${context.prUrl}`);
      return;
    }
    const prNumber = prMatch[1];

    // Read synthesis body for the review comment
    let reviewBody = result.notes || 'Automated review by Panopticon review-agent.';
    const synthesisPath = join(outputDir, 'synthesis.md');
    if (existsSync(synthesisPath)) {
      const synthesis = await readFile(synthesisPath, 'utf-8');
      // Truncate to 65,000 chars (GitHub PR review body limit is 65,536)
      reviewBody = synthesis.slice(0, 65000);
    }

    // Write body to temp file to avoid shell escaping issues
    const bodyFile = join(tmpdir(), `pan-review-body-${context.issueId}-${Date.now()}.md`);
    await writeFile(bodyFile, reviewBody, 'utf-8');

    try {
      let event: string;
      if (result.reviewResult === 'APPROVED') {
        event = 'approve';
      } else if (result.reviewResult === 'CHANGES_REQUESTED') {
        event = 'request-changes';
      } else {
        event = 'comment';
      }
      await execAsync(
        `gh pr review ${prNumber} --${event} --body-file "${bodyFile}"`,
        { cwd: context.projectPath, encoding: 'utf-8' },
      );
      console.log(`[review-agent] Posted GitHub PR review (${event}) for PR #${prNumber}`);
    } finally {
      unlink(bodyFile).catch(() => {});
    }
  } catch (err: any) {
    console.warn(`[review-agent] Failed to post GitHub PR review: ${err.message}`);
  }
}

// ============================================================================
// Parallel Review Runner
// ============================================================================

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
 * template frontmatter to concrete model IDs via the work-type router.
 * Using getModelId ensures provider-correct routing (Anthropic, MiniMax, etc.)
 * rather than hard-coding Anthropic model IDs — if Anthropic is disabled,
 * aliases resolve to the best available model from enabled providers.
 */
const CLAUDE_ALIAS_WORK_TYPE: Record<string, Parameters<typeof getModelId>[0]> = {
  opus: 'specialist-review-agent',
  sonnet: 'review:correctness',
  haiku: 'review:lightweight',
};

function resolveClaudeAlias(model: string): string {
  const workType = CLAUDE_ALIAS_WORK_TYPE[model];
  if (!workType) return model;
  try {
    return getModelId(workType);
  } catch {
    return model;
  }
}

/** Map reviewer role name to the work-type ID used for model routing */
function reviewRoleToWorkType(role: string): Parameters<typeof getModelId>[0] | null {
  const map: Record<string, Parameters<typeof getModelId>[0]> = {
    correctness: 'review:correctness',
    security: 'review:security',
    performance: 'review:performance',
    requirements: 'review:requirements',
    synthesis: 'review:synthesis',
  };
  return map[role] ?? null;
}

/** Resolve the model to use for a reviewer, preferring agent-level override then work-type routing */
export function resolveReviewerModel(agent: ReviewAgentConfig, defaultModel: string): string {
  let model: string;
  if (agent.model) {
    model = agent.model;
  } else {
    const workType = reviewRoleToWorkType(agent.name);
    if (workType) {
      try {
        model = getModelId(workType);
      } catch {
        model = defaultModel;
      }
    } else {
      model = defaultModel;
    }
  }
  // Resolve shorthand aliases (haiku/sonnet/opus) via the work-type router so
  // provider-correct model IDs are used regardless of which providers are active.
  return resolveClaudeAlias(model);
}

/** Spawn a single reviewer tmux session and send its prompt.
 *  Runs from the main Panopticon codebase (packageRoot), not the workspace,
 *  so reviewers use main's .claude/rules/ and CLAUDE.md instead of the workspace's.
 *  The workspace path is passed in the prompt so the reviewer knows where to read files.
 */
async function spawnReviewer(
  sessionName: string,
  model: string,
  promptFile: string,
  projectPath: string,
): Promise<void> {
  const claudeCmd = getAgentRuntimeBaseCommand(model);
  const providerExports = getProviderExportsForModel(model);

  // Write a launcher script that unsets all stale provider env vars and re-exports
  // the correct ones for the target model before exec-ing the agent runtime.
  // Using a script (rather than tmux -e flags) ensures that stale ANTHROPIC_BASE_URL
  // from the parent tmux server env is always cleared — even for Anthropic models
  // whose env map is empty, so tmux -e flags would add nothing and the parent
  // session's ANTHROPIC_BASE_URL pointing at a proxy would leak through.
  const launcherPath = join(tmpdir(), `pan-reviewer-${sessionName}.sh`);
  const launcherContent = [
    '#!/bin/bash',
    'set -o pipefail',
    `cd "${packageRoot}"`,
    providerExports.trimEnd(),
    `exec ${claudeCmd}`,
    '',
  ].join('\n');
  await writeFile(launcherPath, launcherContent, { mode: 0o755 });

  await createSessionAsync(sessionName, packageRoot, `bash ${launcherPath}`);

  const deadline = Date.now() + 5000;
  while (!(await sessionExistsAsync(sessionName))) {
    if (Date.now() >= deadline) {
      throw new Error(`Reviewer session did not start: ${sessionName}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Wait for Claude to start
  await new Promise(resolve => setTimeout(resolve, 1500));

  const prompt = await readFile(promptFile, 'utf-8');
  await sendKeysAsync(sessionName, prompt, 'spawnReviewer');
}

/** Poll until the output file is written (or the session exits), then kill the session */
export async function waitForReviewer(
  sessionName: string,
  outputFile: string,
  timeoutMs: number,
  {
    sessionExists = sessionExistsAsync,
    fileExists = existsSync,
    killSession = killSessionAsync,
  }: {
    sessionExists?: (name: string) => Promise<boolean>;
    fileExists?: (path: string) => boolean;
    killSession?: (name: string) => Promise<void>;
  } = {},
): Promise<'completed' | 'failed'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Output file is the primary completion signal — Claude sessions don't auto-exit.
    if (fileExists(outputFile)) {
      try { await killSession(sessionName); } catch (err) {
        console.error(`[review-agent] Failed to kill completed reviewer session ${sessionName}:`, err);
      }
      return 'completed';
    }
    if (!await sessionExists(sessionName)) {
      // Session exited without writing output
      return 'failed';
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  // Timeout — kill and report failed
  try { await killSession(sessionName); } catch (err) {
    console.error(`[review-agent] Failed to kill timed-out reviewer session ${sessionName}:`, err);
  }
  return 'failed';
}

type ReviewerOutcome = { role: string; status: 'completed' | 'failed'; outputFile: string };

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
 * Resolve the template path for a reviewer subagent.
 * Workspace agents/ directory takes precedence over the global cache so that
 * branch changes to agent definitions are picked up immediately.
 */
/** Resolve infrastructure reviewer template path (main cache only).
 *  Infrastructure reviewers run from the main Panopticon codebase, so they must
 *  use templates from the main cache — never from a workspace's agents/ directory.
 */
export function resolveTemplatePath(subagentName: string, _projectPath: string): string {
  return join(CACHE_AGENTS_DIR, `${subagentName}.md`);
}

type RunParallelReviewDeps = {
  spawnFn?: (session: string, model: string, promptFile: string, cwd: string) => Promise<void>;
  waitFn?: (session: string, outputFile: string, timeoutMs: number) => Promise<'completed' | 'failed'>;
  parseSynthesisFn?: typeof parseReviewSynthesis;
  postReviewFn?: typeof postGitHubPRReview;
  resolveTemplateFn?: (subagentName: string, _projectPath: string) => string;
};

/**
 * Run parallel code review using N reviewer agents followed by a synthesis agent.
 *
 * Writes outputs to .pan/review/<reviewId>/.
 * Synthesis rules:
 *   - Any reviewer CHANGES_REQUESTED → overall CHANGES_REQUESTED
 *   - Security issues from any reviewer always surfaced
 *   - Findings attributed to source reviewer
 */
export async function runParallelReview(
  context: ReviewContext,
  filesChanged: string[],
  agents: ReviewAgentConfig[],
  {
    spawnFn = spawnReviewer,
    waitFn = (session, outputFile, timeoutMs) => waitForReviewer(session, outputFile, timeoutMs),
    parseSynthesisFn = parseReviewSynthesis,
    postReviewFn = postGitHubPRReview,
    resolveTemplateFn = resolveTemplatePath,
  }: RunParallelReviewDeps = {},
): Promise<{ result: ReviewResult; reviewId: string }> {
  // Clean up any stale review sessions for this issue before starting a new review run.
  // Review sessions are named review-<issueId>-<timestamp>-<role>; a new timestamp
  // is generated on every retry, so old sessions accumulate and leak.
  try {
    const allSessions = await listSessionNamesAsync();
    const reviewRegex = new RegExp(`^review-${context.issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+`);
    const staleSessions = allSessions.filter(s => reviewRegex.test(s));
    for (const session of staleSessions) {
      try {
        await killSessionAsync(session);
        console.log(`[review-agent] Killed stale review session: ${session}`);
      } catch (err) {
        console.error(`[review-agent] Failed to kill stale review session ${session}:`, err);
      }
    }
  } catch (err) {
    console.error(`[review-agent] Failed to list sessions during stale review cleanup:`, err);
  }

  const reviewId = `review-${context.issueId}-${Date.now()}`;

  // Guard: fail fast if no reviewers are enabled
  if (agents.length === 0) {
    return {
      result: {
        success: false,
        reviewResult: 'COMMENTED',
        notes: 'Review aborted: no reviewers are enabled.',
        output: `Review ${reviewId}`,
      },
      reviewId,
    };
  }

  // Guard: validate all reviewer templates exist before spawning any sessions
  for (const agent of agents) {
    const subagentName = `code-review-${agent.name}`;
    const templatePath = resolveTemplateFn(subagentName, context.projectPath);
    if (!existsSync(templatePath)) {
      return {
        result: {
          success: false,
          reviewResult: 'COMMENTED',
          notes: `Review aborted: no template found for reviewer '${agent.name}'. Built-in names: correctness, security, performance, requirements.`,
          output: `Review ${reviewId}`,
        },
        reviewId,
      };
    }
  }

  const outputDir = join(context.projectPath, '.pan', 'review', reviewId);
  await mkdir(outputDir, { recursive: true });

  // ── Phase 1: Spawn all reviewers in parallel ──────────────────────────────
  // Reviewers run from the main Panopticon codebase, so file paths must be
  // absolute (or explicitly relative to the workspace) for them to locate files.
  const absoluteFilesChanged = filesChanged.map(f =>
    f.startsWith('/') ? f : join(context.projectPath, f),
  );

  const reviewerContext = [
    `**Pull Request**: ${context.prUrl}`,
    `**Issue ID**: ${context.issueId}`,
    `**Workspace Path**: ${context.projectPath}`,
    absoluteFilesChanged.length > 0 ? `**Files changed**: ${absoluteFilesChanged.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const reviewerSessions: Array<{ sessionName: string; outputFile: string; role: string }> = [];

  await Promise.all(agents.map(async agent => {
    const subagentName = `code-review-${agent.name}`;
    const templatePath = resolveTemplateFn(subagentName, context.projectPath);
    const template = await parseReviewerTemplate(templatePath);
    const model = resolveReviewerModel(agent, template.model);
    const outputFile = join(outputDir, `${agent.name}.md`);
    const sessionName = `${reviewId}-${agent.name}`;

    const contextHeader = `# Review Context\n\n${reviewerContext}\n**Output file**: ${outputFile}\n\n---\n\n`;
    const prompt = contextHeader + template.content;

    const promptFile = join(outputDir, `${agent.name}-prompt.md`);
    await writeFile(promptFile, prompt);

    reviewerSessions.push({ sessionName, outputFile, role: agent.name });
    await spawnFn(sessionName, model, promptFile, context.projectPath);
  }));

  console.log(`[review-agent] Spawned ${reviewerSessions.length} reviewer sessions for review ${reviewId}`);

  // ── Phase 2: Wait for all reviewers ───────────────────────────────────────
  const reviewerResults = await Promise.all(
    reviewerSessions.map(({ sessionName, outputFile, role }) =>
      waitFn(sessionName, outputFile, REVIEW_TIMEOUT_MS)
        .then(status => ({ role, status, outputFile })),
    ),
  );

  // ── Phase 3: Synthesis ────────────────────────────────────────────────────
  const completedReviewers = selectCompletedReviewers(reviewerResults);
  if (!completedReviewers) {
    const failed = reviewerResults.filter(r => r.status === 'failed').map(r => r.role);
    console.warn(`[review-agent] Aborting synthesis — reviewer(s) failed or timed out: ${failed.join(', ')}`);
    return {
      result: {
        success: false,
        reviewResult: 'COMMENTED',
        notes: `Review aborted: reviewer(s) failed or timed out (${failed.join(', ')}). Resubmit to retry.`,
        output: `Review ${reviewId}`,
      },
      reviewId,
    };
  }

  const synthTemplatePath = resolveTemplateFn('code-review-synthesis', context.projectPath);
  const synthTemplate = await parseReviewerTemplate(synthTemplatePath);
  const synthModel = resolveReviewerModel({ name: 'synthesis' }, synthTemplate.model);
  const synthOutputFile = join(outputDir, 'synthesis.md');
  const synthSessionName = `${reviewId}-synthesis`;

  // Build synthesis context with paths to all reviewer outputs
  const reviewerOutputsList = completedReviewers
    .map(r => `- **${r.role}**: ${r.outputFile}`)
    .join('\n');

  const synthContextHeader = [
    `# Synthesis Context\n`,
    reviewerContext,
    `**Output file**: ${synthOutputFile}`,
    `\n## Reviewer Output Files\n${reviewerOutputsList}`,
    `\n---\n`,
  ].join('\n');

  const synthPrompt = synthContextHeader + synthTemplate.content;
  const synthPromptFile = join(outputDir, 'synthesis-prompt.md');
  await writeFile(synthPromptFile, synthPrompt);

  await spawnFn(synthSessionName, synthModel, synthPromptFile, context.projectPath);
  await waitFn(synthSessionName, synthOutputFile, REVIEW_TIMEOUT_MS);

  // ── Phase 4: Parse result ─────────────────────────────────────────────────
  const result = await parseSynthesisFn(outputDir, agents);
  result.output = `Review ${reviewId}`;

  await postReviewFn(context, result, outputDir);

  return { result, reviewId };
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
 */
export function reviewResultToReviewStatus(
  reviewResult: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED',
): 'passed' | 'blocked' | 'failed' {
  if (reviewResult === 'APPROVED') return 'passed';
  if (reviewResult === 'CHANGES_REQUESTED') return 'blocked';
  // COMMENTED signals a synthesis/protocol failure — surface as 'failed' so
  // deacon does not re-queue it in an infinite retry loop.
  return 'failed';
}

/**
 * Dispatch a parallel code review asynchronously (fire-and-forget).
 *
 * Replaces `spawnEphemeralSpecialist('review-agent', ...)` — returns immediately
 * with `{ success: true }` while the review runs in the background.
 * All reviewStatus transitions (pending → reviewing → passed/blocked/failed)
 * are managed exclusively inside this function. Callers must NOT write reviewStatus.
 */
export async function dispatchParallelReview(
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string },
  { spawnFn = spawnReviewAgent }: { spawnFn?: typeof spawnReviewAgent } = {},
): Promise<{ success: boolean; message: string; error?: string }> {
  const { getReviewStatus, setReviewStatus } = await import('../review-status.js');
  const prUrl = opts.prUrl || getReviewStatus(opts.issueId)?.prUrl || '';
  const context: ReviewContext = {
    projectPath: opts.workspace,
    prUrl,
    issueId: opts.issueId,
    branch: opts.branch,
    workspace: opts.workspace,
  };

  // Set reviewing here so callers don't race against the async .catch that resets
  // to pending on spawn failure. All reviewStatus transitions live in this function.
  setReviewStatus(opts.issueId, { reviewStatus: 'reviewing' });

  spawnFn(context)
    .then(result => {
      setReviewStatus(opts.issueId, {
        reviewStatus: reviewResultToReviewStatus(result.reviewResult),
        reviewNotes: result.notes,
      });
      console.log(`[review-agent] dispatchParallelReview finished for ${opts.issueId}: ${result.reviewResult}`);
    })
    .catch(err => {
      console.error(`[review-agent] dispatchParallelReview failed for ${opts.issueId}:`, err);
      setReviewStatus(opts.issueId, { reviewStatus: 'pending' });
    });

  return { success: true, message: `Parallel review dispatched for ${opts.issueId}` };
}

/**
 * Spawn review-agent to review a pull request using parallel specialized reviewers.
 *
 * @param context - Review context
 * @returns Promise that resolves with review result
 */
export async function spawnReviewAgent(context: ReviewContext): Promise<ReviewResult> {
  const reviewAgents = getReviewAgents();
  console.log(`[review-agent] Starting parallel code review for ${context.issueId} (${context.prUrl})`);
  console.log(`[review-agent] Reviewers: ${reviewAgents.map(a => a.name).join(', ')}`);

  try {
    // Get files changed from PR if not provided
    let filesChanged = context.filesChanged || [];
    if (filesChanged.length === 0) {
      filesChanged = await getFilesChangedFromPR(context.prUrl, context.projectPath);
    }

    console.log(`[review-agent] Starting parallel review with ${filesChanged.length} files and ${reviewAgents.length} reviewers`);

    // runParallelReview spawns N reviewer tmux sessions in parallel, runs synthesis,
    // posts the GitHub PR review, and returns the parsed ReviewResult.
    const { result, reviewId } = await runParallelReview(context, filesChanged, reviewAgents);

    // Log to history
    await logReviewHistory(context, result, reviewId);

    // Send feedback to work agent
    await sendFeedbackToWorkAgent(context, result);

    return result;
  } catch (error: any) {
    console.error(`[review-agent] Parallel review failed:`, error);

    const result: ReviewResult = {
      success: false,
      reviewResult: 'COMMENTED',
      notes: error.message || 'Parallel review failed',
    };

    await logReviewHistory(context, result);

    // Send feedback even on failure
    await sendFeedbackToWorkAgent(context, result);

    return result;
  }
}
