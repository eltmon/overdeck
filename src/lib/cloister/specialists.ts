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

/**
 * ===========================================================================
 * Per-Project Specialist Functions
 * ===========================================================================
 */

/**
 * Get the directory for a project's specialist
 */
export function getProjectSpecialistDir(projectKey: string, specialistType: SpecialistAgentName): string {
  return join(SPECIALISTS_DIR, projectKey, specialistType);
}

/**
 * Ensure per-project specialist directory structure exists
 */
export function ensureProjectSpecialistDir(projectKey: string, specialistType: SpecialistAgentName): void {
  const specialistDir = getProjectSpecialistDir(projectKey, specialistType);
  const runsDir = join(specialistDir, 'runs');
  const contextDir = join(specialistDir, 'context');

  if (!existsSync(runsDir)) {
    mkdirSync(runsDir, { recursive: true });
  }
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }
}

/**
 * Get metadata for a specific (projectKey, registryKey) pair.
 * registryKey is either a plain specialistType (legacy) or a compound key from makeSpecialistRegistryKey().
 */
export function getRunMetadata(
  projectKey: string,
  registryKey: string,
): ProjectSpecialistMetadata {
  const registry = loadRegistry();

  if (!registry.projects[projectKey]) {
    registry.projects[projectKey] = {};
  }

  if (!registry.projects[projectKey][registryKey]) {
    registry.projects[projectKey][registryKey] = {
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      currentRun: null,
    };
    saveRegistry(registry);
  }

  return registry.projects[projectKey][registryKey];
}

/**
 * Update metadata for a specific (projectKey, registryKey) pair.
 */
export function updateRunMetadata(
  projectKey: string,
  registryKey: string,
  updates: Partial<ProjectSpecialistMetadata>
): void {
  const registry = loadRegistry();

  if (!registry.projects[projectKey]) {
    registry.projects[projectKey] = {};
  }

  if (!registry.projects[projectKey][registryKey]) {
    registry.projects[projectKey][registryKey] = {
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      currentRun: null,
    };
  }

  registry.projects[projectKey][registryKey] = {
    ...registry.projects[projectKey][registryKey],
    ...updates,
  };

  saveRegistry(registry);
}

/**
 * Get per-project specialist metadata — backward-compat wrapper.
 * Searches compound-key entries for this project+type; returns the active run, or most recent.
 */
export function getProjectSpecialistMetadata(
  projectKey: string,
  specialistType: SpecialistAgentName
): ProjectSpecialistMetadata {
  const registry = loadRegistry();
  const projectBucket = registry.projects[projectKey] ?? {};

  // Check for exact legacy key first
  if (projectBucket[specialistType]) {
    return projectBucket[specialistType];
  }

  // Search compound keys for the most relevant entry
  const prefix = `${specialistType}:`;
  const candidates = Object.entries(projectBucket)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v);

  // Prefer active run, then most recently started
  const active = candidates.find(c => c.currentRun !== null);
  if (active) return active;
  const sorted = candidates.sort((a, b) =>
    (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? '')
  );
  if (sorted.length > 0) return sorted[0];

  // No entry found — return blank default (don't save it)
  return { runCount: 0, lastRunAt: null, lastRunStatus: null, currentRun: null };
}

/**
 * Update per-project specialist metadata — backward-compat wrapper.
 * Updates the active compound-key entry, or the legacy plain-key entry.
 */
export function updateProjectSpecialistMetadata(
  projectKey: string,
  specialistType: SpecialistAgentName,
  updates: Partial<ProjectSpecialistMetadata>
): void {
  const registry = loadRegistry();
  const projectBucket = registry.projects[projectKey] ?? {};

  // Try legacy key first
  if (projectBucket[specialistType]) {
    updateRunMetadata(projectKey, specialistType, updates);
    return;
  }

  // Find the active compound-key entry for this type
  const prefix = `${specialistType}:`;
  const activeKey = Object.keys(projectBucket).find(k =>
    k.startsWith(prefix) && projectBucket[k].currentRun !== null
  );
  if (activeKey) {
    updateRunMetadata(projectKey, activeKey, updates);
    return;
  }

  // Fall back to most recent
  const latestKey = Object.keys(projectBucket)
    .filter(k => k.startsWith(prefix))
    .sort((a, b) => (projectBucket[b].lastRunAt ?? '').localeCompare(projectBucket[a].lastRunAt ?? ''))
    .shift();
  if (latestKey) {
    updateRunMetadata(projectKey, latestKey, updates);
  }
}

/**
 * Increment run count for a project's specialist.
 * registryKey may be a plain specialistType (legacy) or a compound key.
 */
export function incrementProjectRunCount(projectKey: string, registryKey: string): void {
  const metadata = getRunMetadata(projectKey, registryKey);
  updateRunMetadata(projectKey, registryKey, {
    runCount: metadata.runCount + 1,
    lastRunAt: new Date().toISOString(),
  });
}

/**
 * Set current run for a project's specialist.
 * registryKey may be a plain specialistType (legacy) or a compound key.
 */
export function setCurrentRun(
  projectKey: string,
  registryKey: string,
  runId: string | null
): void {
  updateRunMetadata(projectKey, registryKey, { currentRun: runId });
}

/**
 * Update run status for a project's specialist.
 * registryKey may be a plain specialistType (legacy) or a compound key.
 */
export function updateRunStatus(
  projectKey: string,
  registryKey: string,
  status: 'passed' | 'failed' | 'blocked' | null
): void {
  updateRunMetadata(projectKey, registryKey, { lastRunStatus: status });
}

/**
 * List all projects that have specialists configured
 */
export function listProjectsWithSpecialists(): string[] {
  const registry = loadRegistry();
  return Object.keys(registry.projects);
}

/**
 * List all specialist types for a project
 */
export function listSpecialistsForProject(projectKey: string): SpecialistAgentName[] {
  const registry = loadRegistry();
  const project = registry.projects[projectKey];

  if (!project) {
    return [];
  }

  return Object.keys(project) as SpecialistAgentName[];
}

/**
 * Get all per-project specialist statuses (PAN-754: compound-key aware).
 * Walks registry including compound keys (type:issueId[:role]) and returns
 * enriched entries with issueId, model, currentActivity for the Agents page.
 */
export async function getAllProjectSpecialistStatuses(): Promise<Array<{
  projectKey: string;
  specialistType: SpecialistAgentName;
  registryKey: string;
  issueId?: string;
  role?: string;
  metadata: ProjectSpecialistMetadata;
  isRunning: boolean;
  tmuxSession: string;
}>> {
  const registry = loadRegistry();
  const { getAgentRuntimeStateSync } = await import('../agents.js');

  const results: Array<{
    projectKey: string;
    specialistType: SpecialistAgentName;
    registryKey: string;
    issueId?: string;
    role?: string;
    metadata: ProjectSpecialistMetadata;
    isRunning: boolean;
    tmuxSession: string;
  }> = [];

  for (const [projectKey, specialists] of Object.entries(registry.projects)) {
    for (const [registryKey, metadata] of Object.entries(specialists)) {
      const { specialistType, issueId, role } = parseSpecialistRegistryKey(registryKey);

      // Determine tmux session: use stored field when available
      const tmuxSession = metadata.tmuxSession
        ?? getTmuxSessionName(specialistType as SpecialistAgentName, projectKey, issueId);

      const runtimeState = getAgentRuntimeStateSync(tmuxSession);
      const sessionRunning = await isRunning(specialistType as SpecialistAgentName, projectKey).catch(() => false);
      const running = isProjectSpecialistActivelyRunning(runtimeState, sessionRunning);
      const effectiveMetadata = running ? metadata : { ...metadata, currentRun: null };

      results.push({
        projectKey,
        specialistType: specialistType as SpecialistAgentName,
        registryKey,
        issueId,
        role,
        metadata: effectiveMetadata,
        isRunning: running,
        tmuxSession,
      });
    }
  }

  return results;
}

/**
 * Update context token count for a specialist
 *
 * @param name - Specialist name
 * @param tokens - Total context tokens
 */
export function updateContextTokens(name: SpecialistAgentName, tokens: number): void {
  updateSpecialistMetadata(name, { contextTokens: tokens });
}

/**
 * Enable a specialist
 *
 * @param name - Specialist name
 */
export function enableSpecialist(name: SpecialistAgentName): void {
  updateSpecialistMetadata(name, { enabled: true });
}

/**
 * Disable a specialist
 *
 * @param name - Specialist name
 */
export function disableSpecialist(name: SpecialistAgentName): void {
  updateSpecialistMetadata(name, { enabled: false });
}

/**
 * Check if a specialist is enabled
 *
 * @param name - Specialist name
 * @returns True if specialist is enabled
 */
export function isEnabled(name: SpecialistAgentName): boolean {
  const metadata = getSpecialistMetadata(name);
  return metadata?.enabled ?? false;
}

/**
 * Get all enabled specialists
 *
 * @returns Array of enabled specialists
 */
export function getEnabledSpecialists(): LegacySpecialistDefinition[] {
  return getAllSpecialists().filter((s) => s.enabled);
}

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
