/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PANOPTICON_HOME } from '../paths.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';
import { createSpecialistHandoff, logSpecialistHandoff } from './specialist-handoff-logger.js';
import { loadSettings, type ModelId } from '../settings.js';
import { getModelId, WorkTypeId } from '../work-type-router.js';
import { getProviderForModel, getProviderEnv } from '../providers.js';
import { sendKeysAsync } from '../tmux.js';

const execAsync = promisify(exec);

/**
 * Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for a model.
 * For non-Anthropic providers (Kimi, Z.AI, etc.), returns env vars needed
 * to redirect Claude Code API calls to the correct endpoint.
 */
function getProviderEnvForModel(model: string): Record<string, string> {
  const provider = getProviderForModel(model as ModelId);
  if (provider.name === 'anthropic') return {};

  const settings = loadSettings();
  const apiKey = settings.api_keys?.[provider.name as keyof typeof settings.api_keys];
  if (apiKey) {
    return getProviderEnv(provider, apiKey);
  }
  console.warn(`[specialist] No API key for ${provider.displayName}, falling back to Anthropic`);
  return {};
}

/**
 * Build tmux -e flags for environment variables
 */
function buildTmuxEnvFlags(env: Record<string, string>): string {
  let flags = '';
  for (const [key, value] of Object.entries(env)) {
    flags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
  }
  return flags;
}

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const REGISTRY_FILE = join(SPECIALISTS_DIR, 'registry.json');
const TASKS_DIR = join(SPECIALISTS_DIR, 'tasks');

/**
 * Supported specialist types
 */
export type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent';

/**
 * Specialist state
 */
export type SpecialistState = 'sleeping' | 'active' | 'uninitialized';

/**
 * Specialist metadata
 */
export interface SpecialistMetadata {
  name: SpecialistType;
  displayName: string;
  description: string;
  enabled: boolean;
  autoWake: boolean;
  sessionId?: string;
  lastWake?: string; // ISO 8601 timestamp
  contextTokens?: number;
}

/**
 * Specialist status including runtime state
 */
export interface SpecialistStatus extends SpecialistMetadata {
  state: SpecialistState;
  isRunning: boolean;
  tmuxSession?: string;
  currentIssue?: string; // Issue ID currently being worked on
}

/**
 * Per-project specialist metadata
 */
export interface ProjectSpecialistMetadata {
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: 'passed' | 'failed' | 'blocked' | null;
  currentRun: string | null; // Run ID if active
  sessionId?: string; // Legacy session ID for transition period
}

/**
 * Registry of all specialist agents (per-project structure)
 */
export interface SpecialistRegistry {
  version: string;
  // Global defaults for specialist configuration
  defaults: {
    contextRuns: number;
    digestModel: string | null;
    retention: { maxDays: number; maxRuns: number };
  };
  // Per-project specialist metadata
  projects: {
    [projectKey: string]: {
      [specialistType: string]: ProjectSpecialistMetadata;
    };
  };
  // Legacy: Global specialists list (for backward compatibility)
  specialists?: SpecialistMetadata[];
  lastUpdated: string; // ISO 8601 timestamp
}

/**
 * Default specialist definitions
 */
const DEFAULT_SPECIALISTS: SpecialistMetadata[] = [
  {
    name: 'merge-agent',
    displayName: 'Merge Agent',
    description: 'PR merging and conflict resolution',
    enabled: true,
    autoWake: true,
  },
  {
    name: 'review-agent',
    displayName: 'Review Agent',
    description: 'Code review and quality checks',
    enabled: true,
    autoWake: true,
  },
  {
    name: 'test-agent',
    displayName: 'Test Agent',
    description: 'Test execution and analysis',
    enabled: true,
    autoWake: true,
  },
];

/**
 * Initialize specialists directory and registry
 *
 * Creates directory structure and default registry.json if needed.
 * Safe to call multiple times - idempotent.
 */
export function initSpecialistsDirectory(): void {
  // Ensure specialists directory exists
  if (!existsSync(SPECIALISTS_DIR)) {
    mkdirSync(SPECIALISTS_DIR, { recursive: true });
  }

  // Create default registry if it doesn't exist
  if (!existsSync(REGISTRY_FILE)) {
    const registry: SpecialistRegistry = {
      version: '2.0', // Updated for per-project structure
      defaults: {
        contextRuns: 5,
        digestModel: null,
        retention: {
          maxDays: 30,
          maxRuns: 50,
        },
      },
      projects: {},
      // Keep legacy specialists for backward compatibility during transition
      specialists: DEFAULT_SPECIALISTS,
      lastUpdated: new Date().toISOString(),
    };
    saveRegistry(registry);
  } else {
    // Migrate old registry if needed
    migrateRegistryIfNeeded();
  }
}

/**
 * Migrate old registry format to new per-project structure
 */
function migrateRegistryIfNeeded(): void {
  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(content) as SpecialistRegistry;

    // Check if already migrated
    if (registry.version === '2.0' || registry.projects) {
      return;
    }

    // Migrate to new structure
    console.log('[specialists] Migrating registry to per-project structure...');

    const migratedRegistry: SpecialistRegistry = {
      version: '2.0',
      defaults: {
        contextRuns: 5,
        digestModel: null,
        retention: {
          maxDays: 30,
          maxRuns: 50,
        },
      },
      projects: {},
      specialists: registry.specialists, // Keep for backward compat
      lastUpdated: new Date().toISOString(),
    };

    saveRegistry(migratedRegistry);
    console.log('[specialists] Registry migration complete');
  } catch (error) {
    console.error('[specialists] Failed to migrate registry:', error);
  }
}

/**
 * Load the specialist registry
 *
 * @returns Specialist registry
 */
export function loadRegistry(): SpecialistRegistry {
  initSpecialistsDirectory();

  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load specialist registry:', error);
    // Return default registry
    return {
      version: '1.0',
      defaults: {
        contextRuns: 5,
        digestModel: null,
        retention: { maxDays: 30, maxRuns: 50 },
      },
      projects: {},
      specialists: DEFAULT_SPECIALISTS,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save the specialist registry
 *
 * @param registry - Registry to save
 */
export function saveRegistry(registry: SpecialistRegistry): void {
  // Only ensure directory exists, don't call initSpecialistsDirectory to avoid recursion
  if (!existsSync(SPECIALISTS_DIR)) {
    mkdirSync(SPECIALISTS_DIR, { recursive: true });
  }

  registry.lastUpdated = new Date().toISOString();

  try {
    const content = JSON.stringify(registry, null, 2);
    writeFileSync(REGISTRY_FILE, content, 'utf-8');
  } catch (error) {
    console.error('Failed to save specialist registry:', error);
    throw error;
  }
}

/**
 * Get session file path for a specialist
 *
 * @param name - Specialist name
 * @returns Path to session file
 */
export function getSessionFilePath(name: SpecialistType): string {
  return join(SPECIALISTS_DIR, `${name}.session`);
}

/**
 * Read session ID from file
 *
 * @param name - Specialist name
 * @returns Session ID or null if not found
 */
export function getSessionId(name: SpecialistType): string | null {
  const sessionFile = getSessionFilePath(name);

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    return readFileSync(sessionFile, 'utf-8').trim();
  } catch (error) {
    console.error(`Failed to read session file for ${name}:`, error);
    return null;
  }
}

/**
 * Write session ID to file
 *
 * @param name - Specialist name
 * @param sessionId - Session ID to store
 */
export function setSessionId(name: SpecialistType, sessionId: string): void {
  initSpecialistsDirectory();

  const sessionFile = getSessionFilePath(name);

  try {
    writeFileSync(sessionFile, sessionId.trim(), 'utf-8');
  } catch (error) {
    console.error(`Failed to write session file for ${name}:`, error);
    throw error;
  }
}

/**
 * Delete session file
 *
 * @param name - Specialist name
 * @returns True if file was deleted, false if it didn't exist
 */
export function clearSessionId(name: SpecialistType): boolean {
  const sessionFile = getSessionFilePath(name);

  if (!existsSync(sessionFile)) {
    return false;
  }

  try {
    unlinkSync(sessionFile);
    return true;
  } catch (error) {
    console.error(`Failed to delete session file for ${name}:`, error);
    throw error;
  }
}

/**
 * Get metadata for a specific specialist
 *
 * @param name - Specialist name
 * @returns Specialist metadata or null if not found
 */
export function getSpecialistMetadata(name: SpecialistType): SpecialistMetadata | null {
  const registry = loadRegistry();
  return (registry.specialists ?? []).find((s) => s.name === name) || null;
}

/**
 * Update specialist metadata
 *
 * @param name - Specialist name
 * @param updates - Partial metadata to update
 */
export function updateSpecialistMetadata(
  name: SpecialistType,
  updates: Partial<SpecialistMetadata>
): void {
  const registry = loadRegistry();

  const specialists = registry.specialists ?? [];
  const index = specialists.findIndex((s) => s.name === name);

  if (index === -1) {
    throw new Error(`Specialist ${name} not found in registry`);
  }

  specialists[index] = {
    ...specialists[index],
    ...updates,
    name, // Ensure name doesn't change
  };
  registry.specialists = specialists;

  saveRegistry(registry);
}

/**
 * Get all specialist metadata
 *
 * @returns Array of all specialists
 */
export function getAllSpecialists(): SpecialistMetadata[] {
  const registry = loadRegistry();
  return registry.specialists ?? [];
}

/**
 * Check if a specialist is initialized (has session file)
 *
 * @param name - Specialist name
 * @returns True if specialist has a session file
 */
export function isInitialized(name: SpecialistType): boolean {
  return getSessionId(name) !== null;
}

/**
 * Get the state of a specialist based on session file
 *
 * Note: This only checks if session exists, not if it's actually running.
 * Use getSpecialistStatus() for runtime state.
 *
 * @param name - Specialist name
 * @returns Specialist state
 */
export function getSpecialistState(name: SpecialistType): Exclude<SpecialistState, 'active'> {
  return isInitialized(name) ? 'sleeping' : 'uninitialized';
}

/**
 * Get tmux session name for a specialist
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns Expected tmux session name
 */
export function getTmuxSessionName(name: SpecialistType, projectKey?: string): string {
  if (projectKey) {
    return `specialist-${projectKey}-${name}`;
  }
  // Legacy format for backward compatibility
  return `specialist-${name}`;
}

/**
 * Record wake event in metadata
 *
 * @param name - Specialist name
 * @param sessionId - New session ID (if changed)
 */
export function recordWake(name: SpecialistType, sessionId?: string): void {
  const updates: Partial<SpecialistMetadata> = {
    lastWake: new Date().toISOString(),
  };

  if (sessionId) {
    updates.sessionId = sessionId;
  }

  updateSpecialistMetadata(name, updates);
}

/**
 * ===========================================================================
 * Ephemeral Lifecycle Management
 * ===========================================================================
 */

/**
 * Grace period state for a specialist
 */
export interface GracePeriodState {
  active: boolean;
  startedAt: string;
  duration: number; // milliseconds
  paused: boolean;
  pausedAt?: string;
  remainingTime?: number; // milliseconds when paused
}

const gracePeriodStates = new Map<string, GracePeriodState>();

/**
 * Spawn an ephemeral specialist for a project
 *
 * Creates a new specialist session that will run for this task and then terminate.
 * The specialist is seeded with context from recent runs.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param task - Task details
 * @returns Spawn result with run ID and session info
 */
export async function spawnEphemeralSpecialist(
  projectKey: string,
  specialistType: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  }
): Promise<{
  success: boolean;
  runId?: string;
  tmuxSession?: string;
  message: string;
  error?: string;
}> {
  // Ensure project specialist directory exists
  ensureProjectSpecialistDir(projectKey, specialistType);

  // Load context digest
  const { loadContextDigest } = await import('./specialist-context.js');
  const contextDigest = loadContextDigest(projectKey, specialistType);

  // Create run log
  const { createRunLog } = await import('./specialist-logs.js');
  const { runId, filePath: logFilePath } = createRunLog(
    projectKey,
    specialistType,
    task.issueId,
    contextDigest || undefined
  );

  // Update metadata
  setCurrentRun(projectKey, specialistType, runId);
  incrementProjectRunCount(projectKey, specialistType);

  // Build task prompt
  const taskPrompt = await buildTaskPrompt(projectKey, specialistType, task, contextDigest);

  // Spawn tmux session
  const tmuxSession = getTmuxSessionName(specialistType, projectKey);
  const cwd = process.env.HOME || '/home/exedev';

  try {
    // Determine model for this specialist
    let model = 'claude-sonnet-4-6'; // default
    try {
      const workTypeId: WorkTypeId = `specialist-${specialistType}` as WorkTypeId;
      model = getModelId(workTypeId);
    } catch (error) {
      console.warn(`Warning: Could not resolve model for ${specialistType}, using default`);
    }

    // Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for non-Anthropic models
    const providerEnv = getProviderEnvForModel(model);
    const envFlags = buildTmuxEnvFlags(providerEnv);

    // Permission flags based on specialist type
    const permissionFlags = specialistType === 'merge-agent'
      ? '--dangerously-skip-permissions --permission-mode bypassPermissions'
      : '--dangerously-skip-permissions';

    // Write task prompt to file to avoid shell escaping issues
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    await execAsync(`mkdir -p "${agentDir}"`, { encoding: 'utf-8' });

    const promptFile = join(agentDir, 'task-prompt.md');
    writeFileSync(promptFile, taskPrompt);

    // Create launcher script that pipes output to log file
    const launcherScript = join(agentDir, 'launcher.sh');
    writeFileSync(launcherScript, `#!/bin/bash
cd "${cwd}"
prompt=$(cat "${promptFile}")

# Run Claude and tee output to log file
claude ${permissionFlags} --model ${model} "$prompt" 2>&1 | tee -a "${logFilePath}"

# Signal completion
echo ""
echo "## Specialist completed task"
`, { mode: 0o755 });

    // Spawn Claude Code via launcher script (with provider env vars)
    await execAsync(
      `tmux new-session -d -s "${tmuxSession}"${envFlags} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' }
    );

    // Set state to active
    const { saveAgentRuntimeState } = await import('../agents.js');
    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: task.issueId,
    });

    console.log(`[specialist] Spawned ephemeral ${specialistType} for ${projectKey}/${task.issueId} (run: ${runId})`);

    return {
      success: true,
      runId,
      tmuxSession,
      message: `Spawned specialist ${specialistType} for ${task.issueId}`,
    };
  } catch (error: any) {
    console.error(`[specialist] Failed to spawn ${specialistType}:`, error);

    // Clean up metadata
    setCurrentRun(projectKey, specialistType, null);

    return {
      success: false,
      message: `Failed to spawn specialist: ${error.message}`,
      error: error.message,
    };
  }
}

/**
 * Build task prompt for a specialist
 */
async function buildTaskPrompt(
  projectKey: string,
  specialistType: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  },
  contextDigest: string | null
): Promise<string> {
  const { getSpecialistPromptOverride } = await import('../projects.js');
  const customPrompt = getSpecialistPromptOverride(projectKey, specialistType);

  let prompt = `# ${specialistType} Task - ${task.issueId}\n\n`;

  // Add context digest if available
  if (contextDigest) {
    prompt += `## Context from Recent Runs\n\n${contextDigest}\n\n`;
  }

  // Add custom project-specific prompt if configured
  if (customPrompt) {
    prompt += `## Project-Specific Guidelines\n\n${customPrompt}\n\n`;
  }

  // Add task details
  prompt += `## Current Task\n\n`;
  prompt += `Issue: ${task.issueId}\n`;
  if (task.branch) prompt += `Branch: ${task.branch}\n`;
  if (task.workspace) prompt += `Workspace: ${task.workspace}\n`;
  if (task.prUrl) prompt += `PR URL: ${task.prUrl}\n`;
  prompt += `\n`;

  // Add specialist-specific instructions
  switch (specialistType) {
    case 'review-agent':
      prompt += `Your task:
0. FIRST: Check if branch has any changes vs main (git diff --name-only main...HEAD)
   - If 0 files changed: mark as passed with note "branch identical to main" and STOP
1. Review all changes in the branch
2. Check for code quality issues, security concerns, and best practices
3. Verify test FILES exist for new code (DO NOT run tests)
4. Provide specific, actionable feedback
5. Update status via API when done

IMPORTANT: DO NOT run tests. You are the REVIEW agent.

Update status via API:
- If no changes (stale branch): POST to /api/workspaces/${task.issueId}/review-status with {"reviewStatus":"passed","reviewNotes":"No changes — branch identical to main"}
- If issues found: POST to /api/workspaces/${task.issueId}/review-status with {"reviewStatus":"blocked","reviewNotes":"..."}
- If review passes: POST with {"reviewStatus":"passed"} then queue test-agent`;
      break;

    case 'test-agent':
      prompt += `Your task:
1. Run the full test suite
2. Analyze any failures in detail
3. Identify root causes
4. Update status via API when done

Update status via API:
- If tests pass: POST to /api/workspaces/${task.issueId}/review-status with {"testStatus":"passed"}
- If tests fail: POST with {"testStatus":"failed","testNotes":"..."}`;
      break;

    case 'merge-agent':
      prompt += `Your task:
1. Fetch the latest main branch
2. Attempt to merge ${task.branch} into main
3. Resolve conflicts intelligently if needed
4. Run tests to verify merge is clean
5. Complete merge if tests pass`;
      break;
  }

  prompt += `\n\nWhen you complete your task, report your findings and status.`;

  return prompt;
}

/**
 * Start grace period for a specialist
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param duration - Grace period duration in milliseconds (default: 60000)
 */
export function startGracePeriod(
  projectKey: string,
  specialistType: SpecialistType,
  duration: number = 60000
): void {
  const key = `${projectKey}-${specialistType}`;

  gracePeriodStates.set(key, {
    active: true,
    startedAt: new Date().toISOString(),
    duration,
    paused: false,
  });

  console.log(`[specialist] Grace period started for ${projectKey}/${specialistType} (${duration}ms)`);

  // Schedule termination after grace period
  setTimeout(() => {
    const state = gracePeriodStates.get(key);
    if (state && state.active && !state.paused) {
      terminateSpecialist(projectKey, specialistType);
    }
  }, duration);
}

/**
 * Pause grace period countdown
 */
export function pauseGracePeriod(projectKey: string, specialistType: SpecialistType): boolean {
  const key = `${projectKey}-${specialistType}`;
  const state = gracePeriodStates.get(key);

  if (!state || !state.active) {
    return false;
  }

  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  const remaining = state.duration - elapsed;

  state.paused = true;
  state.pausedAt = new Date().toISOString();
  state.remainingTime = remaining;

  gracePeriodStates.set(key, state);
  console.log(`[specialist] Grace period paused for ${projectKey}/${specialistType}`);

  return true;
}

/**
 * Resume grace period countdown
 */
export function resumeGracePeriod(projectKey: string, specialistType: SpecialistType): boolean {
  const key = `${projectKey}-${specialistType}`;
  const state = gracePeriodStates.get(key);

  if (!state || !state.active || !state.paused) {
    return false;
  }

  state.paused = false;
  state.startedAt = new Date().toISOString();
  state.pausedAt = undefined;

  gracePeriodStates.set(key, state);
  console.log(`[specialist] Grace period resumed for ${projectKey}/${specialistType}`);

  // Schedule termination for remaining time
  setTimeout(() => {
    const currentState = gracePeriodStates.get(key);
    if (currentState && currentState.active && !currentState.paused) {
      terminateSpecialist(projectKey, specialistType);
    }
  }, state.remainingTime || 0);

  return true;
}

/**
 * Exit grace period immediately (terminate now)
 */
export function exitGracePeriod(projectKey: string, specialistType: SpecialistType): void {
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  terminateSpecialist(projectKey, specialistType);
}

/**
 * Get grace period state
 */
export function getGracePeriodState(
  projectKey: string,
  specialistType: SpecialistType
): GracePeriodState | null {
  const key = `${projectKey}-${specialistType}`;
  return gracePeriodStates.get(key) || null;
}

/**
 * Signal that a specialist has completed its task
 *
 * This should be called when the specialist finishes its work.
 * It updates the run status and starts the grace period.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param result - Task result
 */
export function signalSpecialistCompletion(
  projectKey: string,
  specialistType: SpecialistType,
  result: {
    status: 'passed' | 'failed' | 'blocked';
    notes?: string;
  }
): void {
  const metadata = getProjectSpecialistMetadata(projectKey, specialistType);

  // Update status
  updateRunStatus(projectKey, specialistType, result.status);

  // Finalize log if there's a current run
  if (metadata.currentRun) {
    const { finalizeRunLog } = require('./specialist-logs.js');

    try {
      finalizeRunLog(projectKey, specialistType, metadata.currentRun, {
        status: result.status,
        notes: result.notes,
      });
    } catch (error) {
      console.error(`[specialist] Failed to finalize log:`, error);
    }
  }

  // Start grace period (60 seconds)
  startGracePeriod(projectKey, specialistType, 60000);

  console.log(`[specialist] ${specialistType} completed for ${projectKey} (status: ${result.status})`);
}

/**
 * Terminate a specialist session
 *
 * Kills the tmux session, finalizes logs, and schedules digest generation.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
export async function terminateSpecialist(
  projectKey: string,
  specialistType: SpecialistType
): Promise<void> {
  const tmuxSession = getTmuxSessionName(specialistType, projectKey);
  const metadata = getProjectSpecialistMetadata(projectKey, specialistType);

  try {
    // Kill tmux session
    await execAsync(`tmux kill-session -t "${tmuxSession}"`);
    console.log(`[specialist] Terminated ${projectKey}/${specialistType}`);
  } catch (error) {
    console.error(`[specialist] Failed to kill tmux session ${tmuxSession}:`, error);
  }

  // Finalize log if there's a current run
  if (metadata.currentRun) {
    const { finalizeRunLog } = await import('./specialist-logs.js');

    try {
      finalizeRunLog(projectKey, specialistType, metadata.currentRun, {
        status: metadata.lastRunStatus || 'incomplete',
        notes: 'Specialist terminated',
      });
    } catch (error) {
      console.error(`[specialist] Failed to finalize log:`, error);
    }

    // Clear current run
    setCurrentRun(projectKey, specialistType, null);
  }

  // Clear grace period state
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  // Update runtime state
  const { saveAgentRuntimeState } = await import('../agents.js');
  saveAgentRuntimeState(tmuxSession, {
    state: 'suspended',
    lastActivity: new Date().toISOString(),
  });

  // Schedule digest generation (async, fire-and-forget)
  const { scheduleDigestGeneration } = await import('./specialist-context.js');
  scheduleDigestGeneration(projectKey, specialistType);

  // Run log cleanup for this project/specialist (async, fire-and-forget)
  scheduleLogCleanup(projectKey, specialistType);
}

/**
 * Schedule log cleanup for a project's specialist (async, fire-and-forget)
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
function scheduleLogCleanup(projectKey: string, specialistType: SpecialistType): void {
  // Run async without awaiting
  Promise.resolve().then(async () => {
    try {
      const { cleanupOldLogs } = await import('./specialist-logs.js');
      const { getSpecialistRetention } = await import('../projects.js');

      const retention = getSpecialistRetention(projectKey);
      const deleted = cleanupOldLogs(projectKey, specialistType, { maxDays: retention.max_days, maxRuns: retention.max_runs });

      if (deleted > 0) {
        console.log(`[specialist] Cleaned up ${deleted} old logs for ${projectKey}/${specialistType}`);
      }
    } catch (error) {
      console.error(`[specialist] Log cleanup failed for ${projectKey}/${specialistType}:`, error);
    }
  });
}

/**
 * ===========================================================================
 * Per-Project Specialist Functions
 * ===========================================================================
 */

/**
 * Get the directory for a project's specialist
 */
export function getProjectSpecialistDir(projectKey: string, specialistType: SpecialistType): string {
  return join(SPECIALISTS_DIR, projectKey, specialistType);
}

/**
 * Ensure per-project specialist directory structure exists
 */
export function ensureProjectSpecialistDir(projectKey: string, specialistType: SpecialistType): void {
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
 * Get per-project specialist metadata
 */
export function getProjectSpecialistMetadata(
  projectKey: string,
  specialistType: SpecialistType
): ProjectSpecialistMetadata {
  const registry = loadRegistry();

  if (!registry.projects[projectKey]) {
    registry.projects[projectKey] = {};
  }

  if (!registry.projects[projectKey][specialistType]) {
    // Initialize with defaults
    registry.projects[projectKey][specialistType] = {
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      currentRun: null,
    };
    saveRegistry(registry);
  }

  return registry.projects[projectKey][specialistType];
}

/**
 * Update per-project specialist metadata
 */
export function updateProjectSpecialistMetadata(
  projectKey: string,
  specialistType: SpecialistType,
  updates: Partial<ProjectSpecialistMetadata>
): void {
  const registry = loadRegistry();

  if (!registry.projects[projectKey]) {
    registry.projects[projectKey] = {};
  }

  if (!registry.projects[projectKey][specialistType]) {
    registry.projects[projectKey][specialistType] = {
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      currentRun: null,
    };
  }

  registry.projects[projectKey][specialistType] = {
    ...registry.projects[projectKey][specialistType],
    ...updates,
  };

  saveRegistry(registry);
}

/**
 * Increment run count for a project's specialist
 */
export function incrementProjectRunCount(projectKey: string, specialistType: SpecialistType): void {
  const metadata = getProjectSpecialistMetadata(projectKey, specialistType);
  updateProjectSpecialistMetadata(projectKey, specialistType, {
    runCount: metadata.runCount + 1,
    lastRunAt: new Date().toISOString(),
  });
}

/**
 * Set current run for a project's specialist
 */
export function setCurrentRun(
  projectKey: string,
  specialistType: SpecialistType,
  runId: string | null
): void {
  updateProjectSpecialistMetadata(projectKey, specialistType, { currentRun: runId });
}

/**
 * Update run status for a project's specialist
 */
export function updateRunStatus(
  projectKey: string,
  specialistType: SpecialistType,
  status: 'passed' | 'failed' | 'blocked' | null
): void {
  updateProjectSpecialistMetadata(projectKey, specialistType, { lastRunStatus: status });
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
export function listSpecialistsForProject(projectKey: string): SpecialistType[] {
  const registry = loadRegistry();
  const project = registry.projects[projectKey];

  if (!project) {
    return [];
  }

  return Object.keys(project) as SpecialistType[];
}

/**
 * Get all per-project specialist statuses
 */
export async function getAllProjectSpecialistStatuses(): Promise<Array<{
  projectKey: string;
  specialistType: SpecialistType;
  metadata: ProjectSpecialistMetadata;
  isRunning: boolean;
  tmuxSession: string;
}>> {
  const registry = loadRegistry();
  const results: Array<{
    projectKey: string;
    specialistType: SpecialistType;
    metadata: ProjectSpecialistMetadata;
    isRunning: boolean;
    tmuxSession: string;
  }> = [];

  for (const [projectKey, specialists] of Object.entries(registry.projects)) {
    for (const [specialistType, metadata] of Object.entries(specialists)) {
      const tmuxSession = getTmuxSessionName(specialistType as SpecialistType, projectKey);
      const running = await isRunning(specialistType as SpecialistType, projectKey);

      results.push({
        projectKey,
        specialistType: specialistType as SpecialistType,
        metadata,
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
export function updateContextTokens(name: SpecialistType, tokens: number): void {
  updateSpecialistMetadata(name, { contextTokens: tokens });
}

/**
 * List all session files in the specialists directory
 *
 * @returns Array of specialist names that have session files
 */
export function listSessionFiles(): SpecialistType[] {
  initSpecialistsDirectory();

  try {
    const files = readdirSync(SPECIALISTS_DIR);
    const sessionFiles = files.filter((f) => f.endsWith('.session'));

    return sessionFiles.map((f) => f.replace('.session', '') as SpecialistType);
  } catch (error) {
    console.error('Failed to list session files:', error);
    return [];
  }
}

/**
 * Enable a specialist
 *
 * @param name - Specialist name
 */
export function enableSpecialist(name: SpecialistType): void {
  updateSpecialistMetadata(name, { enabled: true });
}

/**
 * Disable a specialist
 *
 * @param name - Specialist name
 */
export function disableSpecialist(name: SpecialistType): void {
  updateSpecialistMetadata(name, { enabled: false });
}

/**
 * Check if a specialist is enabled
 *
 * @param name - Specialist name
 * @returns True if specialist is enabled
 */
export function isEnabled(name: SpecialistType): boolean {
  const metadata = getSpecialistMetadata(name);
  return metadata?.enabled ?? false;
}

/**
 * Get all enabled specialists
 *
 * @returns Array of enabled specialists
 */
export function getEnabledSpecialists(): SpecialistMetadata[] {
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
    const allFiles = getAllSessionFiles();

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
export function countContextTokens(name: SpecialistType): number | null {
  const sessionId = getSessionId(name);

  if (!sessionId) {
    return null;
  }

  const sessionFile = findSessionFile(sessionId);

  if (!sessionFile) {
    return null;
  }

  const sessionUsage = parseClaudeSession(sessionFile);

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
export async function isRunning(name: SpecialistType, projectKey?: string): Promise<boolean> {
  const tmuxSession = getTmuxSessionName(name, projectKey);

  try {
    await execAsync(`tmux has-session -t ${tmuxSession}`);
    return true;
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
  name: SpecialistType,
  projectKey?: string
): Promise<SpecialistStatus> {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = getSessionId(name);
  const running = await isRunning(name, projectKey);
  const contextTokens = countContextTokens(name);

  // Determine state from hook-based runtime state (PAN-80)
  const { getAgentRuntimeState } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name, projectKey);
  const runtimeState = getAgentRuntimeState(tmuxSession);

  let state: SpecialistState;
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
    currentIssue: runtimeState?.currentIssue,
  };
}

/**
 * Get status for all specialists
 *
 * @returns Array of specialist statuses
 */
export async function getAllSpecialistStatus(): Promise<SpecialistStatus[]> {
  const specialists = getAllSpecialists();
  return Promise.all(specialists.map((metadata) => getSpecialistStatus(metadata.name)));
}

/**
 * Initialize a specialist agent
 *
 * Creates a tmux session and starts Claude Code with an identity prompt.
 * This is for first-time initialization of specialists that don't have session files.
 *
 * @param name - Specialist name
 * @returns Promise with initialization result
 */
export async function initializeSpecialist(name: SpecialistType): Promise<{
  success: boolean;
  message: string;
  tmuxSession?: string;
  error?: string;
}> {
  // Check if already running
  if (await isRunning(name)) {
    return {
      success: false,
      message: `Specialist ${name} is already running`,
      error: 'already_running',
    };
  }

  // Check if already initialized
  if (getSessionId(name)) {
    return {
      success: false,
      message: `Specialist ${name} is already initialized. Use wake to start it.`,
      error: 'already_initialized',
    };
  }

  const tmuxSession = getTmuxSessionName(name);
  const cwd = process.env.HOME || '/home/eltmon';

  // Determine model for this specialist using work type router
  let model = 'claude-sonnet-4-6'; // default fallback
  try {
    // Map specialist name to work type ID
    const workTypeId: WorkTypeId = `specialist-${name}` as WorkTypeId;
    model = getModelId(workTypeId);
  } catch (error) {
    console.warn(`Warning: Could not resolve model for ${name}, using default model`);
  }

  // Create identity prompt for the specialist
  const identityPrompt = `You are the ${name} specialist agent for Panopticon.
Your role: ${name === 'merge-agent' ? 'Resolve merge conflicts and ensure clean integrations' :
             name === 'review-agent' ? 'Review code changes and provide quality feedback' :
             name === 'test-agent' ? 'Execute and analyze test results' : 'Assist with development tasks'}

You will be woken up when your services are needed. For now, acknowledge your initialization and wait.
Say: "I am the ${name} specialist, ready and waiting for tasks."`;

  try {
    // Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for non-Anthropic models
    const providerEnv = getProviderEnvForModel(model);
    const envFlags = buildTmuxEnvFlags(providerEnv);

    // Write identity prompt and launcher script to avoid shell escaping issues
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    await execAsync(`mkdir -p "${agentDir}"`, { encoding: 'utf-8' });

    const promptFile = join(agentDir, 'identity-prompt.md');
    const launcherScript = join(agentDir, 'launcher.sh');

    writeFileSync(promptFile, identityPrompt);
    writeFileSync(launcherScript, `#!/bin/bash
cd "${cwd}"
prompt=$(cat "${promptFile}")
exec claude --dangerously-skip-permissions --model ${model} "$prompt"
`, { mode: 0o755 });

    // Spawn Claude Code via launcher script (with provider env vars)
    await execAsync(
      `tmux new-session -d -s "${tmuxSession}"${envFlags} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' }
    );

    // Record wake event
    recordWake(name);

    return {
      success: true,
      message: `Specialist ${name} initialized and started`,
      tmuxSession,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to initialize specialist ${name}: ${errorMessage}`,
      error: errorMessage,
    };
  }
}

/**
 * Initialize all enabled but uninitialized specialists
 *
 * Called during Cloister startup to ensure specialists are ready.
 *
 * @returns Promise with array of initialization results
 */
export async function initializeEnabledSpecialists(): Promise<Array<{
  name: SpecialistType;
  success: boolean;
  message: string;
}>> {
  const enabled = getEnabledSpecialists();
  const results: Array<{ name: SpecialistType; success: boolean; message: string }> = [];

  for (const specialist of enabled) {
    const sessionId = getSessionId(specialist.name);

    if (!sessionId) {
      // Specialist is enabled but not initialized
      console.log(`  → Auto-initializing specialist: ${specialist.name}`);
      const result = await initializeSpecialist(specialist.name);
      results.push({
        name: specialist.name,
        success: result.success,
        message: result.message,
      });

      // Small delay between initializations to avoid overwhelming the system
      if (results.length < enabled.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else {
      results.push({
        name: specialist.name,
        success: true,
        message: `Already initialized with session ${sessionId.substring(0, 8)}...`,
      });
    }
  }

  return results;
}

/**
 * Reset specialist state before sending a new task
 *
 * Clears stale state from previous tasks:
 * 1. Sends Ctrl+C to cancel any pending command
 * 2. Runs 'cd ~' to reset working directory
 * 3. Sends Ctrl+U to clear the prompt buffer
 *
 * @param name - Specialist name
 */
async function resetSpecialist(name: SpecialistType): Promise<void> {
  const tmuxSession = getTmuxSessionName(name);

  try {
    // 1. Cancel any pending command with Ctrl+C
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-c`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 200));

    // 2. Reset working directory using centralized sendKeys
    await sendKeysAsync(tmuxSession, 'cd ~');
    await new Promise(resolve => setTimeout(resolve, 200));

    // 3. Clear the prompt buffer with Ctrl+U
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-u`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.error(`[specialist] Failed to reset ${name}:`, error);
    // Non-fatal - continue with wake
  }
}

/**
 * Wake a specialist to process a task
 *
 * Sends a task prompt to a running specialist. If the specialist isn't running,
 * starts it first (with --resume if it has a session).
 *
 * @param name - Specialist name
 * @param taskPrompt - The task prompt to send to the specialist
 * @param options - Additional options
 * @returns Promise with wake result
 */
export async function wakeSpecialist(
  name: SpecialistType,
  taskPrompt: string,
  options: {
    waitForReady?: boolean; // Wait for agent to be ready before sending prompt (default: true)
    startIfNotRunning?: boolean; // Start the agent if not running (default: true)
    issueId?: string; // Issue ID being worked on (for tracking)
  } = {}
): Promise<{
  success: boolean;
  message: string;
  tmuxSession?: string;
  wasAlreadyRunning: boolean;
  error?: string;
}> {
  const { waitForReady = true, startIfNotRunning = true, issueId } = options;
  const tmuxSession = getTmuxSessionName(name);
  const sessionId = getSessionId(name);
  const wasAlreadyRunning = await isRunning(name);

  // If not running, start it first
  if (!wasAlreadyRunning) {
    if (!startIfNotRunning) {
      return {
        success: false,
        message: `Specialist ${name} is not running`,
        wasAlreadyRunning: false,
        error: 'not_running',
      };
    }

    const cwd = process.env.HOME || '/home/eltmon';

    try {
      // Resolve model from work type router (respects config.yaml overrides)
      let model = 'claude-sonnet-4-6'; // default fallback
      try {
        const workTypeId: WorkTypeId = `specialist-${name}` as WorkTypeId;
        model = getModelId(workTypeId);
      } catch (error) {
        console.warn(`[specialist] Could not resolve model for ${name}, using default`);
      }
      const modelFlag = `--model ${model}`;

      // Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for non-Anthropic models
      const providerEnv = getProviderEnvForModel(model);
      const envFlags = buildTmuxEnvFlags(providerEnv);

      // merge-agent needs full bypass to handle git stash drop, reset, etc.
      const permissionFlags = name === 'merge-agent'
        ? '--dangerously-skip-permissions --permission-mode bypassPermissions'
        : '--dangerously-skip-permissions';

      // Start with --resume if we have a session, otherwise fresh
      const claudeCmd = sessionId
        ? `claude --resume "${sessionId}" ${modelFlag} ${permissionFlags}`
        : `claude ${modelFlag} ${permissionFlags}`;

      await execAsync(
        `tmux new-session -d -s "${tmuxSession}" -c "${cwd}"${envFlags} "${claudeCmd}"`,
        { encoding: 'utf-8' }
      );

      if (waitForReady) {
        // Wait for Claude to be ready
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to start specialist ${name}: ${msg}`,
        wasAlreadyRunning: false,
        error: msg,
      };
    }
  }

  // Reset specialist state to clear stale context from previous tasks
  await resetSpecialist(name);

  // Send the task prompt
  try {
    // For large prompts (>500 chars or multiline), write to file to avoid tmux paste issues
    // Tmux send-keys with large text shows as "[Pasted text #1 +N lines]" which Claude doesn't process
    const isLargePrompt = taskPrompt.length > 500 || taskPrompt.includes('\n');

    if (isLargePrompt) {
      // Ensure tasks directory exists
      if (!existsSync(TASKS_DIR)) {
        mkdirSync(TASKS_DIR, { recursive: true });
      }

      // Write task to file with timestamp
      const taskFile = join(TASKS_DIR, `${name}-${Date.now()}.md`);
      writeFileSync(taskFile, taskPrompt, 'utf-8');

      // Send a short message pointing to the task file
      // Use centralized sendKeys which handles Enter correctly
      const shortMessage = `Read and execute the task in: ${taskFile}`;
      await sendKeysAsync(tmuxSession, shortMessage);
    } else {
      // For short prompts, send directly via tmux
      // Use centralized sendKeys which handles Enter correctly
      await sendKeysAsync(tmuxSession, taskPrompt);
    }

    // Record wake event
    recordWake(name, sessionId || undefined);

    // Set state to active immediately (PAN-80: spinner should show right away)
    const { saveAgentRuntimeState } = await import('../agents.js');
    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: issueId,
    });

    return {
      success: true,
      message: wasAlreadyRunning
        ? `Sent task to running specialist ${name}`
        : `Started specialist ${name} and sent task`,
      tmuxSession,
      wasAlreadyRunning,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to send task to specialist ${name}: ${msg}`,
      tmuxSession,
      wasAlreadyRunning,
      error: msg,
    };
  }
}

/**
 * Wake specialist with a task from the queue
 *
 * Convenience wrapper that formats task details into a prompt.
 *
 * @param name - Specialist name
 * @param task - Task from the queue
 * @returns Promise with wake result
 */
export async function wakeSpecialistWithTask(
  name: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  }
): Promise<ReturnType<typeof wakeSpecialist>> {
  // Build context-aware prompt based on specialist type and task
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  let prompt: string;

  switch (name) {
    case 'merge-agent':
      prompt = `New merge task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${task.workspace || 'unknown'}
${task.prUrl ? `PR URL: ${task.prUrl}` : ''}

Your task:
1. Fetch the latest main branch
2. Attempt to merge ${task.branch} into main
3. If conflicts arise, resolve them intelligently based on context
4. Run the test suite to verify the merge is clean
5. If tests pass, complete the merge and push
6. If tests fail, analyze the failures and either fix them or report back

When done, provide feedback on:
- Any conflicts encountered and how you resolved them
- Test results
- Any patterns you notice that future agents should be aware of

Use the send-feedback-to-agent skill to report findings back to the issue agent.`;
      break;

    case 'review-agent': {
      // Pre-check: detect stale branch (0 diff from main) before waking the agent
      const workspace = task.workspace || 'unknown';
      let staleBranch = false;
      if (workspace !== 'unknown') {
        try {
          const { stdout: diffOutput } = await execAsync(
            `cd "${workspace}" && git fetch origin main 2>/dev/null; git diff --name-only main...HEAD 2>/dev/null`,
            { encoding: 'utf-8', timeout: 15000 }
          );
          const changedFiles = diffOutput.trim().split('\n').filter((f: string) => f.length > 0);
          if (changedFiles.length === 0) {
            staleBranch = true;
            console.log(`[specialist] review-agent: stale branch detected for ${task.issueId} — 0 files changed vs main`);

            // Auto-complete the review: set reviewStatus to passed
            const { setReviewStatus } = await import('../../dashboard/server/review-status.js');
            setReviewStatus(task.issueId.toUpperCase(), {
              reviewStatus: 'passed',
              reviewNotes: 'No changes to review — branch identical to main (already merged or stale)',
            });
            console.log(`[specialist] review-agent: auto-passed ${task.issueId} (stale branch)`);

            // Also try to signal via the specialists/done path for idle state management
            const tmuxSession = getTmuxSessionName('review-agent');
            const { saveAgentRuntimeState } = await import('../agents.js');
            saveAgentRuntimeState(tmuxSession, {
              state: 'idle',
              lastActivity: new Date().toISOString(),
            });

            return { success: true, message: `Stale branch auto-passed for ${task.issueId}`, wasAlreadyRunning: false, error: undefined };
          }
        } catch (err) {
          // If pre-check fails, fall through to normal wake — agent will handle it
          console.warn(`[specialist] review-agent: stale branch pre-check failed for ${task.issueId}:`, err);
        }
      }

      prompt = `New review task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${workspace}
${task.prUrl ? `PR URL: ${task.prUrl}` : ''}

Your task:
1. Review all changes in the branch compared to main
2. Check for code quality issues, security concerns, and best practices
3. Verify test FILES exist for new code (DO NOT run tests - test-agent does that)
4. Provide specific, actionable feedback

IMPORTANT: DO NOT run tests (npm test). You are the REVIEW agent - you only review code.
The TEST agent will run tests in the next step.

## How to Review Changes

**Step 0 (CRITICAL):** First check if there are ANY changes to review:
\`\`\`bash
cd ${workspace} && git diff --name-only main...HEAD
\`\`\`

**If the diff is EMPTY (0 files changed):** The branch is stale or already merged into main. In this case:
1. Do NOT attempt a full review
2. Update status as passed immediately:
\`\`\`bash
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"passed","reviewNotes":"No changes to review — branch identical to main (already merged or stale)"}' | jq .
\`\`\`
3. Tell the issue agent:
\`\`\`bash
pan work tell ${task.issueId} "Review complete: branch has 0 diff from main — already merged or stale. Marking as passed."
\`\`\`
4. Stop here — you are done.

**Step 1:** Get the list of changed files:
\`\`\`bash
cd ${workspace} && git diff --name-only main...HEAD
\`\`\`

**Step 2:** Read the CURRENT version of each changed file using the Read tool.
Review the actual file contents — do NOT rely solely on diff output.

**Step 3:** If you need to see what specifically changed, use:
\`\`\`bash
cd ${workspace} && git diff main...HEAD -- <file>
\`\`\`

## Avoiding False Positives

**CRITICAL:** When reviewing diffs, understand that:
- Lines starting with \`+\` are ADDITIONS (new code)
- Lines starting with \`-\` are DELETIONS (removed code)
- Lines without prefix are CONTEXT (unchanged surrounding code)
- The SAME content may appear in both \`-\` and \`+\` sections when code is moved or reformatted — this is NOT duplication
- A section shown in diff context does NOT mean it appears twice in the actual file
- **Always read the actual file** to verify before claiming duplicate or redundant content

Do NOT flag:
- Code that appears in both removed and added hunks (it was moved, not duplicated)
- Diff context lines as "duplicate sections" — they exist once in the real file
- Reformatted/restructured code as "duplicated"

## REQUIRED: Update Status via API

You MUST execute these curl commands and verify they succeed. Do NOT just describe them - actually RUN them with Bash.

If issues found:
\`\`\`bash
# EXECUTE THIS - verify you see JSON response with reviewStatus
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"blocked","reviewNotes":"[describe issues]"}' | jq .
\`\`\`
Then use send-feedback-to-agent skill to notify issue agent.

If review passes:
\`\`\`bash
# EXECUTE THIS FIRST - verify you see JSON response with reviewStatus:"passed"
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"passed"}' | jq .

# THEN EXECUTE THIS - verify you see JSON response with queued task
curl -s -X POST ${apiUrl}/api/specialists/test-agent/queue -H "Content-Type: application/json" -d '{"issueId":"${task.issueId}","workspace":"${task.workspace}","branch":"${task.branch}"}' | jq .
\`\`\`

⚠️ VERIFICATION: After running each curl, confirm you see valid JSON output. If you get an error, report it.`;
      break;
    }

    case 'test-agent':
      prompt = `New test task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${task.workspace || 'unknown'}

Your task:
1. Run the full test suite on the feature branch
2. Run the same test suite on the main branch (baseline)
3. Compare results: identify which failures are NEW vs pre-existing
4. Only fail the feature branch for NEW regressions
5. Update status via API when done

## CRITICAL: Bash Timeout for Test Commands

**ALWAYS use timeout: 300000 (5 minutes) when running test commands.**
Test suites commonly take 2-5 minutes. The default bash timeout is only 2 minutes and WILL cause premature failures.
Do NOT run test commands in background mode — run them directly with a 5-minute timeout.

Example:
\`\`\`bash
cd ${task.workspace || 'unknown'} && npm test 2>&1 | tail -30
# Use timeout: 300000 for this command
\`\`\`

## CRITICAL: Baseline Comparison

**You MUST compare test results against the main branch baseline.**

Pre-existing failures that also occur on main branch should NOT block the feature branch.

Steps:
1. Run \`npm test\` (or detected command) on the feature branch - record results (timeout: 300000)
2. Run tests on main branch baseline (timeout: 300000): \`cd ${task.context?.workspace ? task.context.workspace.replace(/workspaces\/feature-[^/]+/, '') : 'unknown'} && npm test 2>&1 | tail -30\`
3. Compare: any test that fails on BOTH branches is pre-existing
4. Only NEW failures (pass on main, fail on feature) should block

**Pass criteria:** The feature branch introduces ZERO new test failures compared to main.
**Fail criteria:** The feature branch introduces one or more NEW test failures not present on main.

Report pre-existing failures as informational notes, but do NOT block the feature for them.

## REQUIRED: Update Status via API

You MUST execute the appropriate curl command and verify it succeeds. Do NOT just describe it - actually RUN it with Bash.

If NO new regressions (tests PASS):
\`\`\`bash
# EXECUTE THIS - verify you see JSON response with testStatus:"passed"
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"testStatus":"passed","testNotes":"[summary including pre-existing failures if any]"}' | jq .
\`\`\`

If NEW regressions found (tests FAIL):
\`\`\`bash
# EXECUTE THIS - verify you see JSON response with testStatus:"failed"
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"testStatus":"failed","testNotes":"[describe NEW failures only]"}' | jq .
\`\`\`
Then use send-feedback-to-agent skill to notify issue agent of NEW failures only.

⚠️ VERIFICATION: After running curl, confirm you see valid JSON output with the updated status. If you get an error or empty response, the update FAILED - report this.

IMPORTANT: Do NOT hand off to merge-agent. Human clicks Merge button when ready.`;
      break;

    default:
      prompt = `Task for ${task.issueId}: Please process this task and report findings.`;
  }

  return wakeSpecialist(name, prompt, { issueId: task.issueId });
}

/**
 * Task context interface for handoffs and specialist tasks
 */
export interface TaskContext {
  prUrl?: string;
  workspace?: string;
  branch?: string;
  filesChanged?: string[];
  reason?: string;
  targetModel?: string;
  additionalInstructions?: string;
  [key: string]: string | string[] | undefined;
}

/**
 * Wake a specialist or queue the task if busy
 *
 * This wrapper checks if the specialist is busy before waking.
 * If the specialist is running but not idle, the task is queued instead.
 *
 * @param name - Specialist name
 * @param task - Task details
 * @param priority - Task priority (default: 'normal')
 * @param source - Source of the task (default: 'handoff')
 * @returns Promise with result indicating whether task was queued or executed
 */
export async function wakeSpecialistOrQueue(
  name: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  },
  options: {
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    source?: string;
  } = {}
): Promise<{
  success: boolean;
  queued: boolean;
  message: string;
  error?: string;
}> {
  const { priority = 'normal', source = 'handoff' } = options;

  // Check if specialist is running and get state (PAN-80)
  const running = await isRunning(name);
  const { getAgentRuntimeState } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name);
  const runtimeState = getAgentRuntimeState(tmuxSession);
  const idle = runtimeState?.state === 'idle' || runtimeState?.state === 'suspended';

  // If running and busy (active), queue the task
  if (running && !idle) {
    try {
      submitToSpecialistQueue(name, {
        priority,
        source,
        issueId: task.issueId,
        workspace: task.workspace,
        branch: task.branch,
        prUrl: task.prUrl,
        context: task.context,
      });

      console.log(`[specialist] ${name} busy, queued task for ${task.issueId} (priority: ${priority})`);

      return {
        success: true,
        queued: true,
        message: `Specialist ${name} is busy. Task queued with ${priority} priority.`,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        queued: false,
        message: `Failed to queue task for ${name}: ${msg}`,
        error: msg,
      };
    }
  }

  // Otherwise, wake the specialist directly
  // PAN-88: Set state to 'active' IMMEDIATELY to prevent race conditions
  // This must happen BEFORE the actual wake to block concurrent requests
  const { saveAgentRuntimeState } = await import('../agents.js');
  saveAgentRuntimeState(tmuxSession, {
    state: 'active',
    lastActivity: new Date().toISOString(),
    currentIssue: task.issueId,
  });
  console.log(`[specialist] ${name} marked active (preventing concurrent wakes)`);

  try {
    const wakeResult = await wakeSpecialistWithTask(name, task);

    if (!wakeResult.success) {
      // Wake failed - revert state to idle and clear currentIssue
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
        currentIssue: undefined,
      });
    }

    return {
      success: wakeResult.success,
      queued: false,
      message: wakeResult.message,
      error: wakeResult.error,
    };
  } catch (error: unknown) {
    // Exception - revert state to idle and clear currentIssue
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
      currentIssue: undefined,
    });

    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      queued: false,
      message: `Failed to wake specialist ${name}: ${msg}`,
      error: msg,
    };
  }
}

/**
 * ===========================================================================
 * Specialist Queue Helpers
 * ===========================================================================
 */

import { HookItem, pushToHook, checkHook, popFromHook } from '../hooks.js';

/**
 * Specialist queue item - extends HookItem with specialist-specific payload
 */
export interface SpecialistQueueItem extends HookItem {
  type: 'task';
  payload: {
    prUrl?: string;
    issueId: string;
    workspace?: string;
    branch?: string;
    filesChanged?: string[];
    context?: TaskContext;
  };
}

/**
 * Submit a task to a specialist's queue
 *
 * @param specialistName - Name of the specialist (e.g., 'review-agent', 'merge-agent')
 * @param task - Task details
 * @returns The created queue item
 */
export function submitToSpecialistQueue(
  specialistName: SpecialistType,
  task: {
    priority: 'urgent' | 'high' | 'normal' | 'low';
    source: string;
    prUrl?: string;
    issueId: string;
    workspace?: string;
    branch?: string;
    filesChanged?: string[];
    context?: TaskContext;
  }
): HookItem {
  // Put specialist-specific fields into context to match HookItem type
  const item: Omit<HookItem, 'id' | 'createdAt'> = {
    type: 'task',
    priority: task.priority,
    source: task.source,
    payload: {
      issueId: task.issueId,
      context: {
        ...task.context,
        prUrl: task.prUrl,
        workspace: task.workspace,
        branch: task.branch,
        filesChanged: task.filesChanged,
      },
    },
  };

  const queueItem = pushToHook(specialistName, item);

  // Log specialist handoff event
  const handoffEvent = createSpecialistHandoff(
    task.source, // From (e.g., 'review-agent' or 'issue-agent')
    specialistName, // To specialist
    task.issueId,
    task.priority,
    {
      workspace: task.workspace,
      branch: task.branch,
      prUrl: task.prUrl,
      source: task.source,
    }
  );
  logSpecialistHandoff(handoffEvent);

  return queueItem;
}

/**
 * Check if a specialist has pending work in their queue
 *
 * @param specialistName - Name of the specialist
 * @returns Queue status
 */
export function checkSpecialistQueue(specialistName: SpecialistType): {
  hasWork: boolean;
  urgentCount: number;
  items: HookItem[];
} {
  return checkHook(specialistName);
}

/**
 * Remove a completed task from a specialist's queue
 *
 * @param specialistName - Name of the specialist
 * @param itemId - ID of the completed task
 * @returns True if item was removed
 */
export function completeSpecialistTask(specialistName: SpecialistType, itemId: string): boolean {
  return popFromHook(specialistName, itemId);
}

/**
 * Get the next task from a specialist's queue (highest priority)
 *
 * Does NOT remove the task - use completeSpecialistTask() after execution.
 *
 * @param specialistName - Name of the specialist
 * @returns The next task or null if queue is empty
 */
export function getNextSpecialistTask(specialistName: SpecialistType): HookItem | null {
  const { items } = checkSpecialistQueue(specialistName);
  return items.length > 0 ? items[0] : null;
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
  fromSpecialist: SpecialistType;
  toIssueId: string;
  feedbackType: 'success' | 'failure' | 'warning' | 'insight';
  category: 'merge' | 'test' | 'review' | 'general';
  summary: string;
  details: string;
  actionItems?: string[];
  patterns?: string[];  // Patterns the specialist noticed
  suggestions?: string[];  // Suggestions for the issue agent
}

const FEEDBACK_DIR = join(PANOPTICON_HOME, 'specialists', 'feedback');
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

  const fileResult = await writeFeedbackFile({
    issueId: toIssueId,
    specialist,
    outcome,
    summary: summary.slice(0, 100),
    markdownBody: feedbackMessage,
  });

  if (!fileResult.success) {
    console.error(`[specialist] Failed to write feedback file for ${toIssueId}: ${fileResult.error}`);
    return false;
  }

  // Send short reference pointing to the file
  try {
    const { messageAgent } = await import('../agents.js');
    const msg = `SPECIALIST FEEDBACK: ${fromSpecialist} reported ${feedback.feedbackType.toUpperCase()} for ${toIssueId}.\nRead and address: ${fileResult.relativePath}`;
    await messageAgent(agentSession, msg);
    console.log(`[specialist] Sent feedback from ${fromSpecialist} to ${agentSession} (file: ${fileResult.relativePath})`);
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
  bySpecialist: Record<SpecialistType, number>;
  byType: Record<string, number>;
  total: number;
} {
  const stats = {
    bySpecialist: {
      'merge-agent': 0,
      'review-agent': 0,
      'test-agent': 0,
    } as Record<SpecialistType, number>,
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
