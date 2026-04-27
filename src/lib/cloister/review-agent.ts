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
import { createSessionAsync, killSessionAsync, sessionExistsAsync, sendKeysAsync, listSessionNamesAsync, capturePaneAsync, setOptionAsync } from '../tmux.js';
import { getProviderExportsForModel, getAgentRuntimeBaseCommand } from '../agents.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { getModelId, hasOverride } from '../work-type-router.js';
import { AGENTS_DIR, CACHE_AGENTS_DIR, CACHE_REVIEW_PROMPTS_DIR, PANOPTICON_HOME, packageRoot } from '../paths.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { emitActivityEntry, emitActivityTts } from '../activity-logger.js';
import { resolveProjectFromIssue } from '../projects.js';
import { getReviewerSessionName, type ReviewerRole } from './specialists.js';
import { buildStashMessage, createNamedStash, dropStash, getNextReviewTempSequence, listStashes } from '../stashes.js';
import { getReviewStatus, setReviewStatus } from '../review-status.js';

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
 * Timeout for review agent in milliseconds (30 minutes).
 * Performance reviewers of large PRs can need 20+ minutes of analysis time.
 */
const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

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
    // Coordinator sessions are also active review work (PAN-830)
    const coordMatch = name.match(/^review-coordinator-([A-Z0-9]+-\d+)-\d+/);
    if (coordMatch) {
      active.add(coordMatch[1].toUpperCase());
    }
  }
  return active;
}

async function ensureReviewTempStash(issueId: string, workspace: string): Promise<{ ref: string; message: string; sequence: number } | null> {
  const { stdout } = await execAsync('git status --porcelain', {
    cwd: workspace,
    encoding: 'utf-8',
  });
  if (!stdout.trim()) return null;

  const existingEntries = await listStashes(workspace);
  const sequence = getNextReviewTempSequence(existingEntries, issueId);
  const message = buildStashMessage('review-temp', issueId, sequence);
  const ref = await createNamedStash(workspace, message, true);
  if (!ref) return null;

  return { ref, message, sequence };
}

async function cleanupReviewTempStash(issueId: string, workspace: string): Promise<void> {
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

  // Send a short, explicit message with the ABSOLUTE path. Agents may have cd'd
  // into subdirectories during their session — a relative path will not resolve.
  try {
    const { messageAgent } = await import('../agents.js');
    const summary = result.reviewResult === 'CHANGES_REQUESTED'
      ? `${result.notes || 'Issues found'}.`
      : result.reviewResult === 'APPROVED'
        ? 'Code approved — no action needed.'
        : `Review result: ${result.reviewResult}.`;
    const msg = `SPECIALIST FEEDBACK: review-agent reported ${result.reviewResult} for ${context.issueId}.\n${summary}\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix ALL issues. Do NOT stop at the prompt — keep working until every blocking issue is resolved and you have invoked /rebase-and-submit.`;
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
  sonnet: 'specialist-review-agent',
  haiku: 'specialist-review-agent',
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
    if (workType && hasOverride(workType)) {
      // Only use role-specific work type when explicitly overridden in config.
      // Without an override, smart selection can pick unsupported models (e.g. gpt-5.5
      // when CLIProxy isn't configured for it), causing 502 errors in every reviewer.
      try {
        model = getModelId(workType);
      } catch {
        model = getModelId('specialist-review-agent');
      }
    } else {
      // No role-specific override — fall back to specialist-review-agent which is
      // always configured and uses a known-good model.
      try {
        model = getModelId('specialist-review-agent');
      } catch {
        model = defaultModel;
      }
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
    agentType: 'review',
    workingDir: packageRoot,
    setPipefail: true,
    unsetPanopticonEnv: true,
    panopticonEnv: { agentId: sessionName },
    providerExports: providerExports.trimEnd(),
    baseCommand: claudeCmd,
    sessionId: claudeSessionId,
  });
  await writeFile(launcherPath, launcherContent, { mode: 0o755 });

  console.log(`[review-agent] Spawning reviewer ${sessionName}: model=${model}, claudeSessionId=${claudeSessionId}, launcher=${launcherPath}`);
  console.log(`[review-agent] Launcher content:\n${launcherContent}`);

  await createSessionAsync(sessionName, packageRoot, `bash ${launcherPath}`, {
    env: {
      // Mirror the launcher's PANOPTICON_AGENT_ID into the tmux session env so
      // the value is visible to processes that inspect the env-from-tmux path
      // (not just the launcher exec chain).
      PANOPTICON_AGENT_ID: sessionName,
      PANOPTICON_ISSUE_ID: '',
      PANOPTICON_SESSION_TYPE: '',
    },
  });

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
 * Poll until the output file is written (or the session exits), then kill the session.
 *
 * For synthesis sessions: a `requireMarker` predicate may be passed to defeat a race
 * where the agent writes synthesis.md in two stages (body first, tail markers appended
 * seconds later). Without the predicate, parser fires on the incomplete first write
 * and rejects valid output as "did not report result in expected format".
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
): Promise<'completed' | 'failed'> {
  const outputDir = dirname(outputFile);
  const role = sessionName.split('-').pop() ?? 'unknown';
  const tmuxLogFile = join(outputDir, `${role}-tmux.log`);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  while (Date.now() < deadline) {
    // Output file is the primary completion signal — Claude sessions don't auto-exit.
    // Keep the session alive so the dashboard can show reviewer tabs after completion.
    if (fileExists(outputFile)) {
      if (requireMarker) {
        try {
          const content = await readFile(outputFile, 'utf-8');
          if (content.includes(requireMarker)) {
            console.log(`[review-agent] Reviewer ${sessionName} completed (marker '${requireMarker}' present) in ${Date.now() - startedAt}ms`);
            return 'completed';
          }
          // File exists but marker not yet written — keep polling.
        } catch (err) {
          console.warn(`[review-agent] Failed to read ${outputFile} while checking marker:`, err);
        }
      } else {
        console.log(`[review-agent] Reviewer ${sessionName} completed in ${Date.now() - startedAt}ms`);
        return 'completed';
      }
    }
    if (!await sessionExists(sessionName)) {
      // Session exited without writing output — capture pane for diagnosis
      const elapsed = Date.now() - startedAt;
      console.error(`[review-agent] Reviewer ${sessionName} exited without output after ${elapsed}ms — capturing pane`);
      try {
        const pane = await capturePane(sessionName);
        if (pane) await writeFile(tmuxLogFile, pane, { flag: 'a' });
        console.error(`[review-agent] Pane capture written to ${tmuxLogFile}`);
      } catch (err) {
        console.error(`[review-agent] Failed to capture pane for ${sessionName}:`, err);
      }
      return 'failed';
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Timeout — capture pane, kill, report failed
  const elapsed = Date.now() - startedAt;
  console.error(`[review-agent] Reviewer ${sessionName} timed out after ${elapsed}ms — capturing pane`);
  try {
    const pane = await capturePane(sessionName);
    if (pane) await writeFile(tmuxLogFile, pane, { flag: 'a' });
    console.error(`[review-agent] Pane capture written to ${tmuxLogFile}`);
  } catch (err) {
    console.error(`[review-agent] Failed to capture pane for ${sessionName}:`, err);
  }
  try { await killSession(sessionName); } catch (err) {
    console.error(`[review-agent] Failed to kill timed-out reviewer session ${sessionName}:`, err);
  }
  return 'failed';
}

/**
 * Kill all canonical reviewer and synthesis sessions for an issue.
 * Called in a `finally` block so cleanup always runs regardless of outcome.
 */
async function killAllReviewerSessions(
  projectKey: string,
  issueId: string,
  agents: ReviewAgentConfig[],
): Promise<void> {
  const roles: ReviewerRole[] = [
    ...agents.map(a => a.name as ReviewerRole),
    'synthesis',
  ];
  await Promise.all(
    roles.map(async (role) => {
      const sessionName = getReviewerSessionName(role, projectKey, issueId);
      try {
        await killSessionAsync(sessionName);
        console.log(`[review-agent] Killed reviewer session ${sessionName}`);
      } catch (err) {
        // Session may not exist (e.g., never spawned, or already killed on timeout)
        console.log(`[review-agent] Session ${sessionName} already gone or failed to kill: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
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
 * Resolve the prompt template path for a review agent.
 *
 * Reviewer/synthesis prompts are primitives — they live at
 * `src/lib/cloister/prompts/review/<promptName>.prompt-template.md` in the Panopticon repo,
 * synced to `CACHE_REVIEW_PROMPTS_DIR` (~/.panopticon/review-prompts/).
 *
 * Falls back to the legacy location (`CACHE_AGENTS_DIR` with `.md` suffix) for
 * backward compatibility with pre-refactor installs. See
 * docs/REVIEW-AGENT-ARCHITECTURE.md for the naming convention.
 *
 * Review prompts run from the main Panopticon codebase, so they must use
 * templates from the main cache — never from a workspace's agents/ directory.
 */
export function resolvePromptTemplatePath(promptName: string, _projectPath: string): string {
  const newPath = join(CACHE_REVIEW_PROMPTS_DIR, `${promptName}.prompt-template.md`);
  if (existsSync(newPath)) return newPath;
  // Legacy fallback: `<name>.md` under CACHE_AGENTS_DIR (pre-refactor layout)
  return join(CACHE_AGENTS_DIR, `${promptName}.md`);
}

/** @deprecated Use resolvePromptTemplatePath. Kept for backward compatibility. */
export const resolveTemplatePath = resolvePromptTemplatePath;

type RunParallelReviewDeps = {
  spawnFn?: (session: string, model: string, promptFile: string, cwd: string) => Promise<void>;
  waitFn?: (session: string, outputFile: string, timeoutMs: number) => Promise<'completed' | 'failed'>;
  waitSynthesisFn?: (session: string, outputFile: string, timeoutMs: number) => Promise<'completed' | 'failed'>;
  parseSynthesisFn?: typeof parseReviewSynthesis;
  postReviewFn?: typeof postGitHubPRReview;
  /** Injectable prompt-template resolver (see resolvePromptTemplatePath). */
  resolvePromptTemplateFn?: (promptName: string, _projectPath: string) => string;
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
    waitSynthesisFn = (session, outputFile, timeoutMs) => waitForReviewer(session, outputFile, timeoutMs, { requireMarker: 'REVIEW_RESULT:' }),
    parseSynthesisFn = parseReviewSynthesis,
    postReviewFn = postGitHubPRReview,
    resolvePromptTemplateFn = resolvePromptTemplatePath,
  }: RunParallelReviewDeps = {},
): Promise<{ result: ReviewResult; reviewId: string }> {
  // PAN-830: Reviewer sessions now use canonical naming
  // (specialist-<projectKey>-<issueId>-review-<role>) and persist across all
  // review rounds for an issue. Round 2+ resumes the existing pane with a
  // follow-up prompt; legacy timestamp-based sessions from PAN-821 are killed
  // here so they don't pile up alongside the canonical ones.
  // Only kill legacy sessions whose coordinator is gone — never kill reviewers
  // belonging to an active coordinator.
  const resolvedProject = resolveProjectFromIssue(context.issueId);
  const projectKey = resolvedProject?.projectKey ?? 'unknown';
  try {
    const allSessions = await listSessionNamesAsync();
    const legacyRegex = new RegExp(`^review-${context.issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+`);
    const staleSessions = allSessions.filter(s => legacyRegex.test(s));
    for (const session of staleSessions) {
      // Derive coordinator name: review-PAN-830-12345-correctness -> review-coordinator-PAN-830-12345
      const coordName = session.replace(/^review-/, 'review-coordinator-').replace(/-[^-]+$/, '');
      if (allSessions.includes(coordName)) {
        console.log(`[review-agent] Skipping stale cleanup for ${session} — coordinator ${coordName} is active`);
        continue;
      }
      try {
        await killSessionAsync(session);
        console.log(`[review-agent] Killed legacy timestamp-based review session: ${session}`);
      } catch (err) {
        console.error(`[review-agent] Failed to kill legacy review session ${session}:`, err);
      }
    }
  } catch (err) {
    console.error(`[review-agent] Failed to list sessions during legacy review cleanup:`, err);
  }

  // `reviewId` is used for output dirs (.pan/review/<reviewId>/) and history
  // records only. Tmux sessions are canonical during the round but killed in
  // the finally block when runParallelReview exits (PAN-846). Next round spawns
  // fresh sessions.
  const reviewId = `review-${context.issueId}-${Date.now()}`;
  // Capture wall-clock start so we can persist accurate per-round timing into
  // round-N.json artifacts (consumed by Command Deck round dividers).
  const roundStartedAt = new Date().toISOString();

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

  // Guard: validate all reviewer prompt templates exist before spawning any sessions
  for (const agent of agents) {
    const promptName = `code-review-${agent.name}`;
    const promptTemplatePath = resolvePromptTemplateFn(promptName, context.projectPath);
    if (!existsSync(promptTemplatePath)) {
      return {
        result: {
          success: false,
          reviewResult: 'COMMENTED',
          notes: `Review aborted: no prompt template found for reviewer '${agent.name}'. Built-in names: correctness, security, performance, requirements. See docs/REVIEW-AGENT-ARCHITECTURE.md.`,
          output: `Review ${reviewId}`,
        },
        reviewId,
      };
    }
  }

  const outputDir = join(context.projectPath, '.pan', 'review', reviewId);
  await mkdir(outputDir, { recursive: true });

  // PAN-846: Ensure reviewer/synthesis sessions are always killed when this
  // round ends, regardless of outcome. Without this, canonical sessions with
  // `remain-on-exit on` linger indefinitely, leaking ~500–700 MB RSS each.
  try {

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
  let resumedCount = 0;
  let spawnedCount = 0;

  await Promise.all(agents.map(async agent => {
    const promptName = `code-review-${agent.name}`;
    const promptTemplatePath = resolvePromptTemplateFn(promptName, context.projectPath);
    const template = await parseReviewerTemplate(promptTemplatePath);
    const model = resolveReviewerModel(agent, template.model);
    const outputFile = join(outputDir, `${agent.name}.md`);
    const sessionName = getReviewerSessionName(
      agent.name as ReviewerRole,
      projectKey,
      context.issueId,
    );

    const contextHeader = `# Review Context\n\n${reviewerContext}\n**Output file**: ${outputFile}\n\n---\n\n`;
    const prompt = contextHeader + template.content;

    const promptFile = join(outputDir, `${agent.name}-prompt.md`);
    await writeFile(promptFile, prompt);

    reviewerSessions.push({ sessionName, outputFile, role: agent.name });

    // Resume-or-spawn (PAN-830). If the canonical session is alive from a
    // previous round, inject the new round's prompt directly. Otherwise
    // spawn fresh and pin `remain-on-exit on` so the pane survives across
    // rounds for Command Deck history.
    if (await sessionExistsAsync(sessionName)) {
      console.log(`[review-agent] Resuming reviewer ${sessionName} for new round`);
      await sendKeysAsync(sessionName, prompt, 'runParallelReview-resume');
      resumedCount++;
    } else {
      await spawnFn(sessionName, model, promptFile, context.projectPath);
      try {
        await setOptionAsync(sessionName, 'remain-on-exit', 'on');
      } catch (err) {
        console.warn(`[review-agent] Failed to set remain-on-exit on ${sessionName}: ${err instanceof Error ? err.message : err}`);
      }
      spawnedCount++;
    }
  }));

  console.log(`[review-agent] Reviewer sessions ready for review ${reviewId} (spawned=${spawnedCount}, resumed=${resumedCount})`);
  emitActivityEntry({ source: 'review-specialist', level: 'info', message: `${context.issueId} — ${reviewerSessions.length} reviewer(s) ready (spawned=${spawnedCount}, resumed=${resumedCount})`, issueId: context.issueId });

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
    emitActivityEntry({ source: 'review-specialist', level: 'error', message: `${context.issueId} — review aborted: ${failed.join(', ')} failed`, issueId: context.issueId });
    emitActivityTts({ utterance: `${context.issueId} review aborted, ${failed.join(', ')} failed`, priority: 0, issueId: context.issueId });
    const abortResult: ReviewResult = {
      success: false,
      reviewResult: 'COMMENTED',
      notes: `Review aborted: reviewer(s) failed or timed out (${failed.join(', ')}). Resubmit to retry.`,
      output: `Review ${reviewId}`,
    };
    try {
      await sendFeedbackToWorkAgent(context, abortResult);
    } catch (err) {
      console.error(`[review-agent] Failed to send abort feedback to work agent for ${context.issueId} (non-fatal):`, err);
    }
    return { result: abortResult, reviewId };
  }

  const synthTemplatePath = resolvePromptTemplateFn('code-review-synthesis', context.projectPath);
  const synthTemplate = await parseReviewerTemplate(synthTemplatePath);
  const synthModel = resolveReviewerModel({ name: 'synthesis' }, synthTemplate.model);
  const synthOutputFile = join(outputDir, 'synthesis.md');
  const synthSessionName = getReviewerSessionName('synthesis', projectKey, context.issueId);

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

  // Resume-or-spawn for synthesis (PAN-830). Same canonical-session lifetime
  // as the role reviewers above.
  if (await sessionExistsAsync(synthSessionName)) {
    console.log(`[review-agent] Resuming synthesis ${synthSessionName} for new round`);
    await sendKeysAsync(synthSessionName, synthPrompt, 'runParallelReview-synthesis-resume');
  } else {
    await spawnFn(synthSessionName, synthModel, synthPromptFile, context.projectPath);
    try {
      await setOptionAsync(synthSessionName, 'remain-on-exit', 'on');
    } catch (err) {
      console.warn(`[review-agent] Failed to set remain-on-exit on ${synthSessionName}: ${err instanceof Error ? err.message : err}`);
    }
  }
  emitActivityEntry({ source: 'review-specialist', level: 'info', message: `${context.issueId} — synthesis started`, issueId: context.issueId });
  await waitSynthesisFn(synthSessionName, synthOutputFile, REVIEW_TIMEOUT_MS);

  // ── Phase 4: Parse result ─────────────────────────────────────────────────
  const result = await parseSynthesisFn(outputDir, agents);

  await postReviewFn(context, result, outputDir);
  emitActivityEntry({ source: 'review-specialist', level: result.success ? (result.reviewResult === 'APPROVED' ? 'success' : 'warn') : 'error', message: `${context.issueId} — review complete: ${result.reviewResult}`, issueId: context.issueId });

  // ── Phase 5: Log to history + notify work agent ───────────────────────────
  // These were previously in the deprecated spawnReviewAgent wrapper; moved here
  // so both the coordinator session path (pan review run) and any direct
  // caller of runParallelReview get consistent history + feedback behavior.
  try {
    await logReviewHistory(context, result, reviewId);
  } catch (err) {
    console.error(`[review-agent] logReviewHistory failed for ${context.issueId} (non-fatal):`, err);
  }
  try {
    await sendFeedbackToWorkAgent(context, result);
    emitActivityEntry({ source: 'review-specialist', level: 'info', message: `${context.issueId} — feedback sent to work agent`, issueId: context.issueId });
  } catch (err) {
    console.error(`[review-agent] sendFeedbackToWorkAgent failed for ${context.issueId} (non-fatal):`, err);
  }

  // ── Phase 6: Archive the round (PAN-830) ──────────────────────────────────
  // At the end of every round we write a `round-N.json` artifact inside each
  // canonical reviewer's state directory describing the round (result, output
  // file, timestamps). The dashboard reads these to render the per-round
  // timeline in Command Deck. State directories themselves are never deleted
  // while the issue is alive; deep-wipe handles final teardown. Tmux sessions
  // are killed in the finally block (PAN-846) so they don't leak RAM.
  try {
    await archiveReviewerRound({
      projectKey,
      issueId: context.issueId,
      agents,
      reviewId,
      outputDir,
      reviewerResults,
      result,
      startedAt: roundStartedAt,
    });
  } catch (err) {
    console.error(`[review-agent] archiveReviewerRound failed for ${reviewId} (non-fatal):`, err);
  }

  return { result, reviewId };
  } finally {
    try {
      await cleanupReviewTempStash(context.issueId, context.projectPath);
    } catch (err) {
      console.error(`[review-agent] Failed to clean review-temp stash for ${context.issueId}:`, err);
    }
    await killAllReviewerSessions(projectKey, context.issueId, agents);
  }
}

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

/**
 * Dispatch a parallel code review asynchronously (fire-and-forget).
 *
 * Replaces `spawnEphemeralSpecialist('review-agent', ...)` — returns immediately
 * with `{ success: true }` while the review runs in an independent tmux
 * coordinator session owned by the tmux server (not this Node process).
 *
 * **Dashboard-restart invariant:** the review is orchestrated by a detached
 * tmux session running `pan review run <issueId>`. That session survives
 * server/dashboard restart — only the tmux server's lifecycle can end it.
 * See docs/REVIEW-AGENT-ARCHITECTURE.md.
 *
 * Upfront status writes happen synchronously before spawn so callers see the
 * `reviewing` state immediately. The coordinator session writes the terminal
 * status (passed/failed) directly via `setReviewStatus` when the CLI exits.
 */
export async function dispatchParallelReview(
  opts: { issueId: string; workspace: string; branch: string; prUrl?: string },
  {
    coordinatorSpawnFn = spawnReviewCoordinatorSession,
  }: {
    /**
     * Injectable tmux coordinator spawner. Tests pass a mock so they don't
     * touch real tmux. Production callers should omit and use the default
     * (spawnReviewCoordinatorSession).
     */
    coordinatorSpawnFn?: (
      opts: { issueId: string; workspace: string },
    ) => Promise<{ sessionName: string }>;
  } = {},
): Promise<{ success: boolean; message: string; error?: string }> {
  // Archive feedback from any previous review cycle so the work agent only
  // sees current-cycle feedback when it reads .planning/feedback/.
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

  // Set reviewing here so callers don't race against the async coordinator.
  // The coordinator (pan review run) will overwrite this with the terminal
  // status when it exits.
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
      try {
        await dropStash(opts.workspace, reviewTempStash.ref);
      } catch {}
    }
    return {
      success: false,
      message: 'Failed to initialize review status',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Emit event so frontend ActivityPanel shows live pipeline progress
  try {
    const { notifyPipeline } = await import('../pipeline-notifier.js');
    notifyPipeline({ type: 'task_queued', specialist: 'review-agent', issueId: opts.issueId });
  } catch {
    // Non-fatal: event emission is best-effort
  }

  // Spawn a detached tmux coordinator session running `pan review run`.
  // That session is owned by the tmux server and survives this process exiting,
  // which is what enforces the dashboard-restart invariant.
  try {
    const { sessionName } = await coordinatorSpawnFn({
      issueId: opts.issueId,
      workspace: opts.workspace,
    });
    console.log(`[review-agent] Review coordinator spawned for ${opts.issueId}: ${sessionName}`);
    emitActivityEntry({ source: 'review-specialist', level: 'info', message: `Review coordinator spawned for ${opts.issueId}: ${sessionName}`, issueId: opts.issueId });
    return {
      success: true,
      message: `Review coordinator spawned: ${sessionName}`,
    };
  } catch (err) {
    console.error(`[review-agent] Failed to spawn review coordinator for ${opts.issueId}:`, err);
    try {
      await cleanupReviewTempStash(opts.issueId, opts.workspace);
    } catch (cleanupError) {
      console.error(`[review-agent] Failed to clean review-temp stash for ${opts.issueId}:`, cleanupError);
    }
    setReviewStatus(opts.issueId, {
      reviewStatus: 'failed',
      reviewNotes: `Coordinator spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      reviewTempStashRef: undefined,
      reviewTempStashMessage: undefined,
      reviewTempStashSequence: undefined,
    });
    return {
      success: false,
      message: 'Failed to spawn review coordinator',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Spawn a detached tmux coordinator session that runs `pan review run <id>`.
 *
 * The session is named `review-coordinator-<issueId>-<timestamp>` and runs
 * from the workspace directory. It lives until `pan review run` exits (or is
 * killed externally via `pan review abort`). Dashboard restart does not
 * affect it — tmux owns the session, not this Node process.
 */
export async function spawnReviewCoordinatorSession(opts: {
  issueId: string;
  workspace: string;
}): Promise<{ sessionName: string }> {
  const sessionName = `review-coordinator-${opts.issueId}-${Date.now()}`;
  // `pan review run` is globally installed (via npm link or the release).
  // We wrap in `bash -lc` so PATH and nvm init run; `|| true` on exit so tmux
  // does not retain the session with a non-zero exit (keeps teardown clean).
  const command = `bash -lc 'pan review run ${opts.issueId} || true; exit'`;
  await createSessionAsync(sessionName, opts.workspace, command, {
    env: {
      PANOPTICON_AGENT_ID: '',
      PANOPTICON_ISSUE_ID: '',
      PANOPTICON_SESSION_TYPE: '',
    },
  });
  return { sessionName };
}

// spawnReviewAgent was removed — the coordinator-session path
// (dispatchParallelReview → spawnReviewCoordinatorSession → pan review run →
// runParallelReview) replaces the in-process orchestration it wrapped.
// History logging and work-agent feedback moved into runParallelReview (Phase 5).
// See docs/REVIEW-AGENT-ARCHITECTURE.md.
