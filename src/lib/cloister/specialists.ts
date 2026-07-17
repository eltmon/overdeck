/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { OVERDECK_HOME } from '../paths.js';
import { getDevrootPathSync } from '../config.js';
import { getClaudePermissionFlagsStringSync } from '../claude-permissions.js';
import { getProjectSync } from '../projects.js';
import { getAllSessionFilesSync, parseClaudeSessionSync } from '../cost-parsers/jsonl-parser.js';
import { createSpecialistHandoff, logSpecialistHandoff } from './specialist-handoff-logger.js';
import type { ModelId } from '../settings.js';
import { loadCloisterConfigSync } from './config.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from '../providers.js';
import { getProviderEnvForModel } from '../agents.js';
import { generateLauncherScriptSync, generateLauncherWrapperSync } from '../launcher-generator.js';
import { listPaneValues, sessionExists } from '../tmux.js';
import { notifyPipelineSync } from '../pipeline-notifier.js';
import { isTaskReadySync } from './task-readiness.js';
import { readRecordedClaudeSessionId } from './specialists-spawn.js';
import { getEnabledSpecialists } from './specialists-project-meta.js';
import {
  SPECIALISTS_DIR,
  getAllSpecialists,
  getSpecialistMetadata,
  getTmuxSessionName,
  isProjectSpecialistActivelyRunning,
  loadRegistry,
  parseSpecialistRegistryKey,
  saveRegistry,
  updateSpecialistMetadata,
  type LegacySpecialistDefinition,
  type LegacySpecialistRuntimeStatus,
  type ProjectSpecialistMetadata,
  type SpecialistAgentName,
  type SpecialistLifecycleState,
} from './specialists-registry.js';

export { buildSpecialistBaseCommand, buildSpecialistCavemanExports } from './specialists-spawn.js';

const execAsync = promisify(exec);

export {
  REVIEWER_ROLES,
  getAllSpecialists,
  getReviewerSessionName,
  getSpecialistMetadata,
  getSpecialistState,
  getTmuxSessionName,
  initSpecialistsDirectory,
  isInitialized,
  isProjectSpecialistActivelyRunning,
  loadRegistry,
  makeSpecialistRegistryKey,
  parseReviewerSessionName,
  parseSpecialistRegistryKey,
  pruneSpecialistRegistryEntriesForIssue,
  recordWake,
  saveRegistry,
  updateSpecialistMetadata,
  type LegacySpecialistDefinition,
  type LegacySpecialistRuntimeStatus,
  type ProjectSpecialistMetadata,
  type ResolutionStep,
  type ReviewerRole,
  type SpecialistAgentName,
  type SpecialistRegistry,
} from './specialists-registry.js';

export {
  exitGracePeriod,
  findActiveRegistryKey,
  getGracePeriodState,
  pauseGracePeriod,
  resumeGracePeriod,
  signalSpecialistCompletion,
  startGracePeriod,
  terminateSpecialist,
  type GracePeriodState,
  type TaskContext,
} from './specialists-lifecycle.js';

export {
  disableSpecialist,
  enableSpecialist,
  ensureProjectSpecialistDir,
  getAllProjectSpecialistStatuses,
  getEnabledSpecialists,
  getProjectSpecialistDir,
  getProjectSpecialistMetadata,
  getRunMetadata,
  incrementProjectRunCount,
  isEnabled,
  listProjectsWithSpecialists,
  listSpecialistsForProject,
  setCurrentRun,
  updateContextTokens,
  updateProjectSpecialistMetadata,
  updateRunMetadata,
  updateRunStatus,
} from './specialists-project-meta.js';

/**
 * Find JSONL file for a session ID
 *
 * Searches through Claude Code project directories to find the JSONL file.
 *
 * @param sessionId - Session ID to find
 * @returns Path to JSONL file or null if not found
 */
export function findSessionFile(sessionId: string): string | null {
  try {
    const allFiles = getAllSessionFilesSync();

    for (const file of allFiles) {
      const fileSessionId = basename(file, '.jsonl');
      if (fileSessionId === sessionId) {
        return file;
      }
    }
  } catch {
    // Session files not available
  }

  return null;
}

/**
 * Count context tokens for a specialist session
 *
 * Reads the JSONL file for the specialist's session and sums all token usage.
 * This gives an approximate count of context size.
 *
 * @param name - Specialist name
 * @returns Total token count or null if session not found
 */
export function countContextTokens(name: SpecialistAgentName): number | null {
  const sessionId = readRecordedClaudeSessionId(getTmuxSessionName(name));

  if (!sessionId) {
    return null;
  }

  const sessionFile = findSessionFile(sessionId);

  if (!sessionFile) {
    return null;
  }

  const sessionUsage = parseClaudeSessionSync(sessionFile);

  if (!sessionUsage) {
    return null;
  }

  // Sum all token types for total context
  return (
    sessionUsage.usage.inputTokens +
    sessionUsage.usage.outputTokens +
    (sessionUsage.usage.cacheReadTokens || 0) +
    (sessionUsage.usage.cacheWriteTokens || 0)
  );
}

/**
 * Check if a specialist is currently running in tmux
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns True if specialist has an active tmux session
 */
export async function isRunning(name: SpecialistAgentName, projectKey?: string): Promise<boolean> {
  const tmuxSession = getTmuxSessionName(name, projectKey);

  try {
    const exists = await Effect.runPromise(sessionExists(tmuxSession));
    if (!exists) return false;
    // Session exists — but check if the pane actually has a running process.
    // When Claude Code crashes, the pane's process exits but the tmux session persists,
    // making has-session return success even though nothing is running.
    const panePid = (await Effect.runPromise(listPaneValues(tmuxSession, '#{pane_pid}')))[0]?.trim() ?? '';
    if (!panePid) return false;
    // Check if the pane's process has any child processes (Claude Code / bash)
    const { stdout: children } = await execAsync(
      `ps --ppid ${panePid} --no-headers 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    );
    return children.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get complete status for a specialist
 *
 * Combines metadata, session info, and runtime state (PAN-80: uses hook-based state).
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns Complete specialist status
 */
export async function getSpecialistStatus(
  name: SpecialistAgentName,
  projectKey?: string
): Promise<LegacySpecialistRuntimeStatus> {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = readRecordedClaudeSessionId(getTmuxSessionName(name, projectKey));
  const running = await isRunning(name, projectKey);
  const contextTokens = countContextTokens(name);

  // Determine state from hook-based runtime state (PAN-80)
  const { getAgentRuntimeStateSync } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name, projectKey);
  const runtimeState = getAgentRuntimeStateSync(tmuxSession);

  let state: SpecialistLifecycleState;
  if (runtimeState) {
    // Map runtime state to specialist state
    switch (runtimeState.state) {
      case 'active':
        state = 'active';
        break;
      case 'idle':
        state = 'sleeping'; // Idle = at prompt waiting
        break;
      case 'suspended':
        state = 'sleeping'; // Suspended = session saved, not running
        break;
      case 'uninitialized':
      default:
        state = 'uninitialized';
        break;
    }
  } else {
    // Fallback if no runtime state available
    if (running && sessionId) {
      state = 'sleeping';
    } else if (sessionId) {
      state = 'sleeping';
    } else {
      state = 'uninitialized';
    }
  }

  return {
    ...metadata,
    sessionId: sessionId || undefined,
    contextTokens: contextTokens || undefined,
    state,
    isRunning: running,
    tmuxSession: getTmuxSessionName(name, projectKey),
    currentIssue: running ? runtimeState?.currentIssue : undefined,
  };
}

/**
 * Get status for all specialists
 *
 * @returns Array of specialist statuses
 */
export async function getAllSpecialistStatus(): Promise<LegacySpecialistRuntimeStatus[]> {
  const specialists = getAllSpecialists();
  return Promise.all(specialists.map((metadata) => getSpecialistStatus(metadata.name)));
}


/**
 * Initialize all enabled but uninitialized specialists
 *
 * Called during Cloister startup to ensure specialists are ready.
 *
 * @returns Promise with array of initialization results
 */
export async function initializeEnabledSpecialists(): Promise<Array<{
  name: SpecialistAgentName;
  success: boolean;
  message: string;
}>> {
  const enabled = getEnabledSpecialists();
  const results: Array<{ name: SpecialistAgentName; success: boolean; message: string }> = [];

  for (const specialist of enabled) {
    results.push({
      name: specialist.name,
      success: true,
      message: 'Legacy global specialist initialization removed; role flows spawn agents on demand.',
    });
  }

  return results;
}

/**
 * ===========================================================================
 * Specialist Feedback System
 * ===========================================================================
 *
 * Specialists accumulate context and expertise. This system allows them to
 * share learnings back to issue agents, creating a feedback loop that
 * improves the overall system over time.
 */

/**
 * Feedback from a specialist to an issue agent
 */
export interface SpecialistFeedback {
  id: string;
  timestamp: string;
  fromSpecialist: SpecialistAgentName;
  toIssueId: string;
  feedbackType: 'success' | 'failure' | 'warning' | 'insight';
  category: 'merge' | 'test' | 'review' | 'general';
  summary: string;
  details: string;
  actionItems?: string[];
  patterns?: string[];  // Patterns the specialist noticed
  suggestions?: string[];  // Suggestions for the issue agent
}

const FEEDBACK_DIR = join(OVERDECK_HOME, 'specialists', 'feedback');
const FEEDBACK_LOG = join(FEEDBACK_DIR, 'feedback.jsonl');

/**
 * Send feedback from a specialist to an issue agent
 *
 * This is the key mechanism for specialists to share their accumulated
 * expertise back to the issue agents that spawned the work.
 *
 * @param feedback - The feedback to send
 * @returns True if feedback was sent successfully
 */
export async function sendFeedbackToAgent(
  feedback: Omit<SpecialistFeedback, 'id' | 'timestamp'>
): Promise<boolean> {
  const { fromSpecialist, toIssueId, summary, details } = feedback;

  // Ensure feedback directory exists
  if (!existsSync(FEEDBACK_DIR)) {
    mkdirSync(FEEDBACK_DIR, { recursive: true });
  }

  // Create full feedback record
  const fullFeedback: SpecialistFeedback = {
    ...feedback,
    id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
  };

  // Log feedback to JSONL
  try {
    const line = JSON.stringify(fullFeedback) + '\n';
    appendFileSync(FEEDBACK_LOG, line, 'utf-8');
  } catch (error) {
    console.error(`[specialist] Failed to log feedback:`, error);
  }

  // Try to send feedback to the issue agent
  const agentSession = `agent-${toIssueId.toLowerCase()}`;

  // Format feedback message for the agent
  const feedbackMessage = formatFeedbackForAgent(fullFeedback);

  // Write feedback to workspace file
  const { writeFeedbackFile } = await import('./feedback-writer.js');
  const specialistMap: Record<string, 'review-agent' | 'test-agent' | 'merge-agent'> = {
    'review-agent': 'review-agent',
    'test-agent': 'test-agent',
    'merge-agent': 'merge-agent',
  };
  const specialist = specialistMap[fromSpecialist] || 'review-agent';
  const outcome = feedback.feedbackType === 'success' ? 'approved' : feedback.feedbackType === 'failure' ? 'failed' : feedback.feedbackType;

  const fileResult = await Effect.runPromise(writeFeedbackFile({
    issueId: toIssueId,
    specialist,
    outcome,
    summary: summary.slice(0, 100),
    markdownBody: feedbackMessage,
  }));

  if (!fileResult.success) {
    console.error(`[specialist] Failed to write feedback file for ${toIssueId}: ${fileResult.error}`);
    return false;
  }

  // Send a short, explicit message with the ABSOLUTE path.
  try {
    const { messageAgent } = await import('../agents.js');
    const msg = `SPECIALIST FEEDBACK: ${fromSpecialist} reported ${feedback.feedbackType.toUpperCase()} for ${toIssueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then address the feedback and continue working. Do NOT stop at the prompt.`;
    await messageAgent(agentSession, msg);
    console.log(`[specialist] Sent feedback from ${fromSpecialist} to ${agentSession} (file: ${fileResult.filePath})`);
    return true;
  } catch (err) {
    // Agent may be gone — feedback file is still in the workspace for crash recovery
    console.log(`[specialist] Could not send reference to ${agentSession} (file written): ${err}`);
    return true; // File was written successfully, that's the important part
  }
}

/**
 * Format feedback for display to an agent
 */
function formatFeedbackForAgent(feedback: SpecialistFeedback): string {
  const { fromSpecialist, feedbackType, category, summary, details, actionItems, patterns, suggestions } = feedback;

  const typeEmoji = {
    success: '✅',
    failure: '❌',
    warning: '⚠️',
    insight: '💡',
  }[feedbackType];

  let message = `\n${typeEmoji} **Feedback from ${fromSpecialist}** (${category})\n\n`;
  message += `**Summary:** ${summary}\n\n`;
  message += `**Details:**\n${details}\n`;

  if (actionItems?.length) {
    message += `\n**Action Items:**\n`;
    actionItems.forEach((item, i) => {
      message += `${i + 1}. ${item}\n`;
    });
  }

  if (patterns?.length) {
    message += `\n**Patterns Noticed:**\n`;
    patterns.forEach(pattern => {
      message += `- ${pattern}\n`;
    });
  }

  if (suggestions?.length) {
    message += `\n**Suggestions:**\n`;
    suggestions.forEach(suggestion => {
      message += `- ${suggestion}\n`;
    });
  }

  return message;
}

/**
 * Get pending feedback for an issue that hasn't been delivered yet
 *
 * @param issueId - Issue ID to get feedback for
 * @returns Array of feedback records
 */
export function getPendingFeedback(issueId: string): SpecialistFeedback[] {
  if (!existsSync(FEEDBACK_LOG)) {
    return [];
  }

  try {
    const content = readFileSync(FEEDBACK_LOG, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    const allFeedback = lines.map(line => JSON.parse(line) as SpecialistFeedback);

    // Filter to this issue
    return allFeedback.filter(f => f.toIssueId.toLowerCase() === issueId.toLowerCase());
  } catch (error) {
    console.error(`[specialist] Failed to read feedback log:`, error);
    return [];
  }
}

/**
 * Get feedback statistics for all specialists
 *
 * @returns Feedback stats by specialist and type
 */
export function getFeedbackStats(): {
  bySpecialist: Record<SpecialistAgentName, number>;
  byType: Record<string, number>;
  total: number;
} {
  const stats = {
    bySpecialist: {
      'merge-agent': 0,
      'review-agent': 0,
      'test-agent': 0,
    } as Record<SpecialistAgentName, number>,
    byType: {} as Record<string, number>,
    total: 0,
  };

  if (!existsSync(FEEDBACK_LOG)) {
    return stats;
  }

  try {
    const content = readFileSync(FEEDBACK_LOG, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    for (const line of lines) {
      const feedback = JSON.parse(line) as SpecialistFeedback;
      stats.bySpecialist[feedback.fromSpecialist] = (stats.bySpecialist[feedback.fromSpecialist] || 0) + 1;
      stats.byType[feedback.feedbackType] = (stats.byType[feedback.feedbackType] || 0) + 1;
      stats.total++;
    }
  } catch (error) {
    console.error(`[specialist] Failed to read feedback stats:`, error);
  }

  return stats;
}
