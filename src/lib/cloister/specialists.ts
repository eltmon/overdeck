/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { PANOPTICON_HOME } from '../paths.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';

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
    enabled: false,
    autoWake: false,
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
export function isRunning(name: SpecialistType): boolean {
  const tmuxSession = getTmuxSessionName(name);

  try {
    execSync(`tmux has-session -t ${tmuxSession}`, { stdio: 'ignore' });
    return true;
  } catch {
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
export function getSpecialistStatus(name: SpecialistType): SpecialistStatus {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = getSessionId(name);
  const running = isRunning(name);
  const contextTokens = countContextTokens(name);

  // Determine state
  let state: SpecialistState;
  if (running) {
    state = 'active';
  } else if (sessionId) {
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
export function getAllSpecialistStatus(): SpecialistStatus[] {
  return getAllSpecialists().map((metadata) => getSpecialistStatus(metadata.name));
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
  if (isRunning(name)) {
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
    execSync(
      `tmux new-session -d -s "${tmuxSession}" -c "${cwd}" "claude --dangerously-skip-permissions"`,
      { encoding: 'utf-8' }
    );

    // Wait for Claude to start, then send identity prompt
    await new Promise(resolve => setTimeout(resolve, 3000));

    const escapedPrompt = identityPrompt.replace(/'/g, "'\\''");
    // Send text and Enter SEPARATELY to avoid Enter being interpreted as newline
    execSync(`tmux send-keys -t "${tmuxSession}" '${escapedPrompt}'`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 500));
    execSync(`tmux send-keys -t "${tmuxSession}" C-m`, { encoding: 'utf-8' });

    // Record wake event
    recordWake(name);

    return {
      success: true,
      message: `Specialist ${name} initialized and started`,
      tmuxSession,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to initialize specialist ${name}: ${error.message}`,
      error: error.message,
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
