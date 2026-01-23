/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PANOPTICON_HOME } from '../paths.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';

const execAsync = promisify(exec);

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const REGISTRY_FILE = join(SPECIALISTS_DIR, 'registry.json');

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
}

/**
 * Registry of all specialist agents
 */
export interface SpecialistRegistry {
  version: string;
  specialists: SpecialistMetadata[];
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
      version: '1.0',
      specialists: DEFAULT_SPECIALISTS,
      lastUpdated: new Date().toISOString(),
    };
    saveRegistry(registry);
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
  return registry.specialists.find((s) => s.name === name) || null;
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

  const index = registry.specialists.findIndex((s) => s.name === name);

  if (index === -1) {
    throw new Error(`Specialist ${name} not found in registry`);
  }

  registry.specialists[index] = {
    ...registry.specialists[index],
    ...updates,
    name, // Ensure name doesn't change
  };

  saveRegistry(registry);
}

/**
 * Get all specialist metadata
 *
 * @returns Array of all specialists
 */
export function getAllSpecialists(): SpecialistMetadata[] {
  const registry = loadRegistry();
  return registry.specialists;
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
 * @returns Expected tmux session name
 */
export function getTmuxSessionName(name: SpecialistType): string {
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
 * @returns True if specialist has an active tmux session
 */
export async function isRunning(name: SpecialistType): Promise<boolean> {
  const tmuxSession = getTmuxSessionName(name);

  try {
    await execAsync(`tmux has-session -t ${tmuxSession}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a specialist is idle (waiting at the prompt)
 *
 * Checks the tmux pane output to see if the last line is the idle prompt (❯).
 * This is more reliable than heartbeat timing since it directly detects
 * when Claude Code is waiting for input.
 *
 * @param name - Specialist name
 * @returns true if specialist appears to be at the idle prompt
 */
export async function isIdleAtPrompt(name: SpecialistType): Promise<boolean> {
  const tmuxSession = getTmuxSessionName(name);

  try {
    // Capture the last few lines of the tmux pane
    const { stdout: output } = await execAsync(
      `tmux capture-pane -t "${tmuxSession}" -p | tail -12`,
      { encoding: 'utf-8' }
    );
    const trimmedOutput = output.trim();

    const lines = trimmedOutput.split('\n').filter(line => line.trim());
    if (lines.length === 0) return false;

    const allText = lines.join('\n');

    // FIRST: Check for active work indicators ANYWHERE in recent output
    // These take priority over any prompt detection
    const activeIndicators = [
      'esc to interrupt',      // Active task
      'Choreographing',        // Thinking
      'Nebulizing',            // Processing
      'Baking',                // Processing
      '◐', '◑', '◒', '◓',      // Quarter spinners
      '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', // Braille spinners
      'thinking)',             // "(thinking)" indicator
      '↓.*tokens',             // Token streaming indicator
    ];

    for (const indicator of activeIndicators) {
      if (allText.includes(indicator)) {
        return false; // Definitely active
      }
    }

    // Check for active patterns with regex
    const activePatterns = [
      /Writing.*\.\.\./i,
      /Reading.*\.\.\./i,
      /Editing.*\.\.\./i,
      /Running.*\.\.\./i,
      /Searching.*\.\.\./i,
      /Analyzing.*\.\.\./i,
      /Processing.*\.\.\./i,
      /Generating/i,
      /tokens\s*\)/i,          // "tokens)" at end of thinking indicator
    ];

    for (const pattern of activePatterns) {
      if (pattern.test(allText)) {
        return false; // Active work indicator found
      }
    }

    // NOW check if we're at idle prompt
    // Look for the prompt character on its own line (not in status bar)
    const promptLinePattern = /^❯\s*$/m;
    const hasCleanPrompt = promptLinePattern.test(trimmedOutput);

    if (hasCleanPrompt) {
      return true; // Clean prompt line = idle
    }

    // Check for prompt with unsent text in buffer (shows "↵ send" or "↵ enter" at end)
    // Example: "❯ check test-agent status                                                ↵ send"
    // This means idle at prompt with text typed but not submitted
    const promptWithUnsentText = /^❯\s+.+↵\s*(send|enter)/m;
    if (promptWithUnsentText.test(trimmedOutput)) {
      return true; // At prompt with unsent text = still idle
    }

    // Check if last meaningful line (before status) shows prompt
    // Status lines typically contain: MCPs, hooks, CLAUDE.md, permissions
    const nonStatusLines = lines.filter(line =>
      !line.includes('MCPs') &&
      !line.includes('hooks') &&
      !line.includes('CLAUDE.md') &&
      !line.includes('bypass permissions')
    );

    if (nonStatusLines.length > 0) {
      const lastMeaningful = nonStatusLines[nonStatusLines.length - 1].trim();
      if (lastMeaningful === '❯' || lastMeaningful.endsWith('❯')) {
        return true;
      }
    }

    // Default: if we can't tell, assume not idle (safer for showing "active")
    return false;
  } catch {
    // If we can't capture the pane, assume not idle (safer)
    return false;
  }
}

/**
 * Get complete status for a specialist
 *
 * Combines metadata, session info, and runtime state.
 *
 * @param name - Specialist name
 * @returns Complete specialist status
 */
export async function getSpecialistStatus(name: SpecialistType): Promise<SpecialistStatus> {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = getSessionId(name);
  const running = await isRunning(name);
  const contextTokens = countContextTokens(name);

  // Determine state by checking if the specialist is at the idle prompt
  // If running but idle at prompt (❯), they're sleeping
  // If running and NOT at prompt, they're active (working on something)
  let state: SpecialistState;
  if (running) {
    const idle = await isIdleAtPrompt(name);
    state = idle ? 'sleeping' : 'active';
  } else if (sessionId) {
    // Has session ID but not running = sleeping
    state = 'sleeping';
  } else {
    state = 'uninitialized';
  }

  return {
    ...metadata,
    sessionId: sessionId || undefined,
    contextTokens: contextTokens || undefined,
    state,
    isRunning: running,
    tmuxSession: getTmuxSessionName(name),
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

  // Create identity prompt for the specialist
  const identityPrompt = `You are the ${name} specialist agent for Panopticon.
Your role: ${name === 'merge-agent' ? 'Resolve merge conflicts and ensure clean integrations' :
             name === 'review-agent' ? 'Review code changes and provide quality feedback' :
             name === 'test-agent' ? 'Execute and analyze test results' : 'Assist with development tasks'}

You will be woken up when your services are needed. For now, acknowledge your initialization and wait.
Say: "I am the ${name} specialist, ready and waiting for tasks."`;

  try {
    // Spawn Claude Code fresh in tmux
    await execAsync(
      `tmux new-session -d -s "${tmuxSession}" -c "${cwd}" "claude --dangerously-skip-permissions"`,
      { encoding: 'utf-8' }
    );

    // Wait for Claude to start, then send identity prompt
    await new Promise(resolve => setTimeout(resolve, 3000));

    const escapedPrompt = identityPrompt.replace(/'/g, "'\\''");
    // Send text and Enter SEPARATELY to avoid Enter being interpreted as newline
    await execAsync(`tmux send-keys -t "${tmuxSession}" '${escapedPrompt}'`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-m`, { encoding: 'utf-8' });

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

    // 2. Reset working directory
    await execAsync(`tmux send-keys -t "${tmuxSession}" 'cd ~'`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 100));
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-m`, { encoding: 'utf-8' });
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
  } = {}
): Promise<{
  success: boolean;
  message: string;
  tmuxSession?: string;
  wasAlreadyRunning: boolean;
  error?: string;
}> {
  const { waitForReady = true, startIfNotRunning = true } = options;
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
      // Start with --resume if we have a session, otherwise fresh
      const claudeCmd = sessionId
        ? `claude --resume "${sessionId}" --dangerously-skip-permissions`
        : `claude --dangerously-skip-permissions`;

      await execAsync(
        `tmux new-session -d -s "${tmuxSession}" -c "${cwd}" "${claudeCmd}"`,
        { encoding: 'utf-8' }
      );

      if (waitForReady) {
        // Wait for Claude to be ready
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to start specialist ${name}: ${error.message}`,
        wasAlreadyRunning: false,
        error: error.message,
      };
    }
  }

  // Reset specialist state to clear stale context from previous tasks
  await resetSpecialist(name);

  // Send the task prompt
  try {
    const escapedPrompt = taskPrompt.replace(/'/g, "'\\''");
    // Send text and Enter SEPARATELY (critical for tmux)
    await execAsync(`tmux send-keys -t "${tmuxSession}" '${escapedPrompt}'`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 200));
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-m`, { encoding: 'utf-8' });

    // Record wake event
    recordWake(name, sessionId || undefined);

    return {
      success: true,
      message: wasAlreadyRunning
        ? `Sent task to running specialist ${name}`
        : `Started specialist ${name} and sent task`,
      tmuxSession,
      wasAlreadyRunning,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to send task to specialist ${name}: ${error.message}`,
      tmuxSession,
      wasAlreadyRunning,
      error: error.message,
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
    context?: Record<string, any>;
  }
): Promise<ReturnType<typeof wakeSpecialist>> {
  // Build context-aware prompt based on specialist type and task
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

    case 'review-agent':
      prompt = `New review task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${task.workspace || 'unknown'}
${task.prUrl ? `PR URL: ${task.prUrl}` : ''}

Your task:
1. Review all changes in the branch
2. Check for code quality issues, security concerns, and best practices
3. Verify test coverage is adequate
4. Provide specific, actionable feedback

When done, provide feedback on:
- Critical issues that must be fixed
- Suggestions for improvement
- Patterns that should be documented

Use the send-feedback-to-agent skill to report findings back to the issue agent.`;
      break;

    case 'test-agent':
      prompt = `New test task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${task.workspace || 'unknown'}

Your task:
1. Run the full test suite
2. Analyze any failures in detail
3. Identify root causes (code bug vs test bug vs environment issue)
4. Suggest fixes

When done, provide feedback on:
- Test results summary
- Root cause analysis for any failures
- Recommended fixes

Use the send-feedback-to-agent skill to report findings back to the issue agent.`;
      break;

    default:
      prompt = `Task for ${task.issueId}: Please process this task and report findings.`;
  }

  return wakeSpecialist(name, prompt);
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
    context?: Record<string, any>;
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
    context?: Record<string, any>;
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

  return pushToHook(specialistName, item);
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

  // Try to send feedback to the issue agent's tmux session
  const agentSession = `agent-${toIssueId.toLowerCase()}`;

  try {
    await execAsync(`tmux has-session -t "${agentSession}" 2>/dev/null`, { encoding: 'utf-8' });

    // Format feedback message for the agent
    const feedbackMessage = formatFeedbackForAgent(fullFeedback);
    const escapedMessage = feedbackMessage.replace(/'/g, "'\\''");

    // Send to agent
    await execAsync(`tmux send-keys -t "${agentSession}" '${escapedMessage}'`, { encoding: 'utf-8' });
    await execAsync(`tmux send-keys -t "${agentSession}" C-m`, { encoding: 'utf-8' });

    console.log(`[specialist] Sent feedback from ${fromSpecialist} to ${agentSession}`);
    return true;
  } catch {
    // Agent session doesn't exist or send failed
    console.log(`[specialist] Could not send feedback to ${agentSession} (session may not exist)`);
    // Feedback is still logged, can be retrieved later
    return false;
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
