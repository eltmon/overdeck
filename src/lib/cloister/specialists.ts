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

export {
  countContextTokens,
  findSessionFile,
  getAllSpecialistStatus,
  getSpecialistStatus,
  initializeEnabledSpecialists,
  isRunning,
} from './specialists-status.js';

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
