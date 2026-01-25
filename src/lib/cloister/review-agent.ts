/**
 * Review Agent - Automatic code review using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { startConvoy, waitForConvoy, type ConvoyContext } from '../convoy.js';

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
 * Parse convoy synthesis output to ReviewResult
 */
function parseConvoySynthesis(convoyOutputDir: string): ReviewResult {
  const synthesisPath = join(convoyOutputDir, 'synthesis.md');

  if (!existsSync(synthesisPath)) {
    return {
      success: false,
      reviewResult: 'COMMENTED',
      notes: 'Convoy did not produce synthesis output',
    };
  }

  const synthesisContent = readFileSync(synthesisPath, 'utf-8');

  // Parse synthesis for review result markers
  const result = parseAgentOutput(synthesisContent);

  // Also collect findings from individual review files
  const correctnessPath = join(convoyOutputDir, 'correctness.md');
  const securityPath = join(convoyOutputDir, 'security.md');
  const performancePath = join(convoyOutputDir, 'performance.md');

  const filesReviewed: string[] = [];

  // Extract file names from each review
  for (const path of [correctnessPath, securityPath, performancePath]) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      // Look for file references (simplified)
      const fileMatches = content.match(/\b[\w\/\-\.]+\.(ts|js|tsx|jsx|py|java|go|rs)\b/g);
      if (fileMatches) {
        filesReviewed.push(...fileMatches);
      }
    }
  }

  result.filesReviewed = [...new Set(filesReviewed)]; // Deduplicate

  return result;
}

/**
 * Spawn review-agent to review a pull request
 *
 * Now uses convoy system with parallel specialized reviewers.
 *
 * @param context - Review context
 * @returns Promise that resolves with review result
 */
export async function spawnReviewAgent(context: ReviewContext): Promise<ReviewResult> {
  console.log(`[review-agent] Starting convoy code review for ${context.issueId} (${context.prUrl})`);

  try {
    // Get files changed from PR if not provided
    let filesChanged = context.filesChanged || [];
    if (filesChanged.length === 0) {
      filesChanged = await getFilesChangedFromPR(context.prUrl, context.projectPath);
    }

    // Build convoy context
    const convoyContext: ConvoyContext = {
      projectPath: context.projectPath,
      prUrl: context.prUrl,
      issueId: context.issueId,
      files: filesChanged,
    };

    console.log(`[review-agent] Starting convoy with ${filesChanged.length} files`);

    // Start convoy
    const convoy = await startConvoy('code-review', convoyContext);

    console.log(`[review-agent] Convoy started: ${convoy.id}`);
    console.log(`[review-agent] Spawned agents: ${convoy.agents.map(a => a.role).join(', ')}`);

    // Wait for convoy to complete (20 minute timeout)
    const completedConvoy = await waitForConvoy(convoy.id, REVIEW_TIMEOUT_MS);

    console.log(`[review-agent] Convoy completed with status: ${completedConvoy.status}`);

    // Parse synthesis output
    const result = parseConvoySynthesis(completedConvoy.outputDir);

    // Add convoy metadata
    result.output = `Convoy ${completedConvoy.id} - Status: ${completedConvoy.status}`;

    // Log to history
    logReviewHistory(context, result, convoy.id);

    // Send feedback to work agent
    await sendFeedbackToWorkAgent(context, result);

    return result;
  } catch (error: any) {
    console.error(`[review-agent] Convoy review failed:`, error);

    const result: ReviewResult = {
      success: false,
      reviewResult: 'COMMENTED',
      notes: error.message || 'Convoy review failed',
    };

    logReviewHistory(context, result);

    // Send feedback even on failure
    await sendFeedbackToWorkAgent(context, result);

    return result;
  }
}
