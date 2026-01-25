/**
 * Review Agent - Automatic code review using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { PANOPTICON_HOME } from '../paths.js';
import {
  getSessionId,
  setSessionId,
  recordWake,
  getTmuxSessionName,
} from './specialists.js';

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
  context?: Record<string, any>;
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
 * Build the prompt for review-agent (non-blocking)
 */
async function buildReviewPrompt(context: ReviewContext): Promise<string> {
  const templatePath = join(__dirname, 'prompts', 'review-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Review agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Get files changed from PR if not provided (non-blocking)
  let filesChanged = context.filesChanged || [];
  if (filesChanged.length === 0) {
    filesChanged = await getFilesChangedFromPR(context.prUrl, context.projectPath);
  }

  // Replace template variables
  const prompt = template
    .replace(/\{\{projectPath\}\}/g, context.projectPath)
    .replace(/\{\{prUrl\}\}/g, context.prUrl)
    .replace(/\{\{issueId\}\}/g, context.issueId)
    .replace(/\{\{branch\}\}/g, context.branch)
    .replace(
      /\{\{filesChanged\}\}/g,
      filesChanged.length > 0
        ? filesChanged.map((f) => `  - ${f}`).join('\n')
        : '  (Use `gh pr diff` to see changes)'
    );

  return prompt;
}

/**
 * Get files changed in PR using gh CLI (non-blocking)
 */
async function getFilesChangedFromPR(prUrl: string, projectPath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`gh pr view ${prUrl} --json files --jq '.files[].path'`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    return stdout
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
 * Send review feedback to the work agent via tmux
 * This ensures the agent knows what to fix
 */
async function sendFeedbackToWorkAgent(
  context: ReviewContext,
  result: ReviewResult
): Promise<void> {
  const agentSession = `agent-${context.issueId.toLowerCase()}`;

  try {
    // Check if agent session exists (non-blocking)
    await execAsync(`tmux has-session -t ${agentSession} 2>/dev/null`);
  } catch {
    console.log(`[review-agent] No agent session found for ${agentSession}, skipping feedback`);
    return;
  }

  // Build feedback message
  let feedback = `**Review Feedback from review-agent**\n\n`;
  feedback += `**Status:** ${result.reviewResult}\n\n`;

  if (result.notes) {
    feedback += `**Issues Found:**\n${result.notes}\n\n`;
  }

  if (result.securityIssues && result.securityIssues.length > 0) {
    feedback += `**Security Issues:**\n${result.securityIssues.map(i => `- ${i}`).join('\n')}\n\n`;
  }

  if (result.performanceIssues && result.performanceIssues.length > 0) {
    feedback += `**Performance Issues:**\n${result.performanceIssues.map(i => `- ${i}`).join('\n')}\n\n`;
  }

  if (result.reviewResult === 'CHANGES_REQUESTED') {
    feedback += `**Required Actions:**\nPlease address the issues above and push your changes. The review will re-run automatically.\n`;
  } else if (result.reviewResult === 'APPROVED') {
    feedback += `**Next Steps:**\nYour code has been approved! It will proceed to testing.\n`;
  }

  // Escape the feedback for tmux
  const escapedFeedback = feedback.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  try {
    // Send the feedback message (non-blocking)
    await execAsync(`tmux send-keys -t ${agentSession} "${escapedFeedback}"`);
    // Send Enter to submit
    await execAsync(`tmux send-keys -t "${agentSession}" C-m`, { encoding: 'utf-8' });
    console.log(`[review-agent] Sent feedback to ${agentSession}`);
  } catch (error) {
    console.error(`[review-agent] Failed to send feedback to ${agentSession}:`, error);
  }
}

/**
 * Log review to history
 */
function logReviewHistory(
  context: ReviewContext,
  result: ReviewResult,
  sessionId?: string
): void {
  // Ensure history directory exists
  if (!existsSync(REVIEW_HISTORY_DIR)) {
    mkdirSync(REVIEW_HISTORY_DIR, { recursive: true });
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

  appendFileSync(REVIEW_HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Validate that we have a workspace and main project is on main branch
 *
 * Specialists should ALWAYS run in workspaces, never in the main project.
 * The main project should ALWAYS be on main branch.
 */
async function validateWorkspaceAndBranch(context: ReviewContext): Promise<{ valid: boolean; error?: string; workingDir: string }> {
  // Workspace is required - specialists should never run without one
  if (!context.workspace) {
    return {
      valid: false,
      error: 'No workspace provided. Review agent requires a workspace to run in.',
      workingDir: context.projectPath,
    };
  }

  // Check workspace exists
  if (!existsSync(context.workspace)) {
    return {
      valid: false,
      error: `Workspace does not exist: ${context.workspace}`,
      workingDir: context.projectPath,
    };
  }

  // Safeguard: Check that main project is on main branch
  // This catches when something has incorrectly checked out a feature branch in the main project
  try {
    const { stdout: currentBranch } = await execAsync('git branch --show-current', {
      cwd: context.projectPath,
      encoding: 'utf-8',
    });
    const branch = currentBranch.trim();

    if (branch && branch !== 'main' && branch !== 'master') {
      console.warn(`[review-agent] WARNING: Main project at ${context.projectPath} is on branch '${branch}' instead of 'main'`);
      console.warn(`[review-agent] This indicates a bug - the main project should ALWAYS stay on main.`);
      console.warn(`[review-agent] Proceeding with workspace anyway, but this should be investigated.`);
      // Don't fail, just warn - we'll use the workspace which has the correct branch
    }
  } catch (err) {
    // Non-fatal - just log and continue
    console.warn(`[review-agent] Could not check main project branch: ${err}`);
  }

  return {
    valid: true,
    workingDir: context.workspace,
  };
}

/**
 * Spawn review-agent to review a pull request
 *
 * @param context - Review context
 * @returns Promise that resolves with review result
 */
export async function spawnReviewAgent(context: ReviewContext): Promise<ReviewResult> {
  console.log(`[review-agent] Starting code review for ${context.issueId} (${context.prUrl})`);

  // Validate workspace and branch state
  const validation = await validateWorkspaceAndBranch(context);
  if (!validation.valid) {
    console.error(`[review-agent] ${validation.error}`);
    return {
      success: false,
      reviewResult: 'COMMENTED',
      notes: validation.error,
    };
  }

  const workingDir = validation.workingDir;
  console.log(`[review-agent] Working directory: ${workingDir}`);

  // Get existing session ID
  const sessionId = getSessionId('review-agent');

  // Build prompt (non-blocking)
  const prompt = await buildReviewPrompt(context);

  // Build Claude command args
  const args = ['--model', 'sonnet', '--print', '-p', prompt];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  console.log(`[review-agent] Session: ${sessionId || 'new session'}`);
  console.log(`[review-agent] PR: ${context.prUrl}`);

  // Spawn Claude process in the WORKSPACE (not projectPath!)
  // Workspace has the feature branch checked out; projectPath should stay on main
  const proc = spawn('claude', args, {
    cwd: workingDir,
    env: {
      ...process.env,
      PANOPTICON_AGENT_ID: 'review-agent',
    },
  });

  // Capture output
  let output = '';
  let errorOutput = '';

  proc.stdout?.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;
    // Also stream to console for visibility
    process.stdout.write(chunk);
  });

  proc.stderr?.on('data', (data) => {
    const chunk = data.toString();
    errorOutput += chunk;
    process.stderr.write(chunk);
  });

  // Create timeout promise
  const timeoutPromise = new Promise<ReviewResult>((_, reject) => {
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('review-agent timeout after 20 minutes'));
    }, REVIEW_TIMEOUT_MS);
  });

  // Create completion promise
  const completionPromise = new Promise<ReviewResult>((resolve, reject) => {
    proc.on('close', (code) => {
      console.log(`[review-agent] Process exited with code ${code}`);

      // Try to extract session ID from output if this was a new session
      if (!sessionId && output) {
        // Look for session ID in output (Claude Code prints it)
        const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
        if (sessionMatch) {
          const newSessionId = sessionMatch[1];
          setSessionId('review-agent', newSessionId);
          recordWake('review-agent', newSessionId);
          console.log(`[review-agent] Captured session ID: ${newSessionId}`);
        }
      } else if (sessionId) {
        recordWake('review-agent');
      }

      // Parse output for results
      const result = parseAgentOutput(output);

      // Log to history
      logReviewHistory(context, result, sessionId || undefined);

      resolve(result);
    });

    proc.on('error', (error) => {
      console.error(`[review-agent] Process error:`, error);
      reject(error);
    });
  });

  // Race between timeout and completion
  try {
    const result = await Promise.race([completionPromise, timeoutPromise]);

    // Send feedback to the work agent so they know what to fix
    await sendFeedbackToWorkAgent(context, result);

    return result;
  } catch (error: any) {
    console.error(`[review-agent] Failed:`, error);

    const result: ReviewResult = {
      success: false,
      reviewResult: 'COMMENTED',
      notes: error.message || 'Unknown error',
      output: output || errorOutput,
    };

    logReviewHistory(context, result, sessionId || undefined);

    // Send feedback even on failure so agent knows something went wrong
    await sendFeedbackToWorkAgent(context, result);

    return result;
  }
}
