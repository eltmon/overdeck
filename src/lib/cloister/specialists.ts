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
import { randomUUID, createHash } from 'crypto';
import { PANOPTICON_HOME } from '../paths.js';
import { getDevrootPath } from '../config.js';
import { getProject } from '../projects.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';
import { createSpecialistHandoff, logSpecialistHandoff } from './specialist-handoff-logger.js';
import { loadSettings, type ModelId } from '../settings.js';
import { getModelId, WorkTypeId } from '../work-type-router.js';
import { getProviderForModel, getProviderEnv, setupCredentialFileAuth, clearCredentialFileAuth } from '../providers.js';
import { sendKeysAsync, capturePaneAsync, waitForClaudePrompt, confirmDelivery } from '../tmux.js';
import { notifyPipeline } from '../pipeline-notifier.js';
import { isTaskReady } from './task-readiness.js';

const execAsync = promisify(exec);

/**
 * Resolve git directories and branch name from a workspace path.
 * Handles both monorepo (single .git at root) and polyrepo (multiple .git in subdirs).
 * When task.branch is missing, detects it from the checked-out branch in git repos.
 */
async function resolveWorkspaceGitInfo(workspace: string | undefined, taskBranch: string | undefined): Promise<{
  gitDirs: string[];
  branch: string;
  isPolyrepo: boolean;
}> {
  const gitDirs: string[] = [];
  let branch = taskBranch || 'unknown';

  if (!workspace || workspace === 'unknown') {
    return { gitDirs, branch, isPolyrepo: false };
  }

  // Detect git directories
  if (existsSync(join(workspace, '.git'))) {
    gitDirs.push(workspace);
  } else {
    try {
      const entries = readdirSync(workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && existsSync(join(workspace, entry.name, '.git'))) {
          gitDirs.push(join(workspace, entry.name));
        }
      }
    } catch {}
  }

  // Auto-resolve branch from git when not provided
  if (branch === 'unknown' && gitDirs.length > 0) {
    try {
      const { stdout } = await execAsync(
        `cd "${gitDirs[0]}" && git branch --show-current`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const detected = stdout.trim();
      if (detected) {
        branch = detected;
      }
    } catch {}
  }

  return { gitDirs, branch, isPolyrepo: gitDirs.length > 1 };
}

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
export type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent';

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
 * Generate a deterministic UUID from a string.
 * Uses SHA-256 hash formatted as a UUID v4-compatible string.
 * This ensures the same specialist+project always gets the same session ID
 * while satisfying Claude Code's UUID format requirement.
 */
function deterministicUUID(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Get session file path for a specialist.
 * Per-project specialists use a project-scoped subdirectory to prevent
 * session ID collision when multiple projects share the same specialist type.
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key (per-project specialists only)
 * @returns Path to session file
 */
export function getSessionFilePath(name: SpecialistType, projectKey?: string): string {
  if (projectKey) {
    return join(SPECIALISTS_DIR, 'projects', projectKey, `${name}.session`);
  }
  return join(SPECIALISTS_DIR, `${name}.session`);
}

/**
 * Read session ID from file
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key (per-project specialists only)
 * @returns Session ID or null if not found
 */
export function getSessionId(name: SpecialistType, projectKey?: string): string | null {
  const sessionFile = getSessionFilePath(name, projectKey);

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    const sessionId = readFileSync(sessionFile, 'utf-8').trim();
    // Validate UUID format — Claude Code requires valid UUIDs for --resume and --session-id.
    // Old deterministic IDs (e.g., "specialist-mind-your-now-review-agent") are not valid UUIDs.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      console.warn(`[specialist] Invalid session ID format for ${name} (${projectKey ?? 'global'}): ${sessionId} — discarding`);
      unlinkSync(sessionFile);
      return null;
    }
    return sessionId;
  } catch (error) {
    console.error(`Failed to read session file for ${name} (${projectKey ?? 'global'}):`, error);
    return null;
  }
}

/**
 * Write session ID to file
 *
 * @param name - Specialist name
 * @param sessionId - Session ID to store
 * @param projectKey - Optional project key (per-project specialists only)
 */
export function setSessionId(name: SpecialistType, sessionId: string, projectKey?: string): void {
  const sessionFile = getSessionFilePath(name, projectKey);
  const dir = projectKey
    ? join(SPECIALISTS_DIR, 'projects', projectKey)
    : SPECIALISTS_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(sessionFile, sessionId.trim(), 'utf-8');
  } catch (error) {
    console.error(`Failed to write session file for ${name} (${projectKey ?? 'global'}):`, error);
    throw error;
  }
}

/**
 * Delete session file
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key (per-project specialists only)
 * @returns True if file was deleted, false if it didn't exist
 */
export function clearSessionId(name: SpecialistType, projectKey?: string): boolean {
  const sessionFile = getSessionFilePath(name, projectKey);

  if (!existsSync(sessionFile)) {
    return false;
  }

  try {
    unlinkSync(sessionFile);
    return true;
  } catch (error) {
    console.error(`Failed to delete session file for ${name} (${projectKey ?? 'global'}):`, error);
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
    promptOverride?: string; // Use this prompt instead of building from template
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

  // Build task prompt (use override if provided, otherwise build from template)
  const basePrompt = task.promptOverride ?? await buildTaskPrompt(projectKey, specialistType, task, contextDigest);

  if (task.promptOverride) {
    console.log(`[specialist] Using promptOverride for ${projectKey}/${task.issueId} (${basePrompt.length} chars)`);
  }

  // Prepend session-aware preamble: specialists accumulate context via --resume,
  // so they may have seen this issue before. They MUST re-execute fresh every time.
  const taskPrompt = `IMPORTANT: This is a NEW task dispatch. You may have context from prior runs in this session — that is useful background knowledge, but you MUST execute this task fresh RIGHT NOW. Do NOT skip steps or report cached results. Read the code, run the commands, and call the status update APIs as instructed below. Prior results are stale — the code may have changed.

${basePrompt}`;

  // Spawn tmux session — use project path so specialist has correct context
  const tmuxSession = getTmuxSessionName(specialistType, projectKey);
  const project = getProject(projectKey);
  const cwd = project?.path || getDevrootPath() || homedir();

  // Pre-trust cwd so specialists don't hit the trust prompt
  try {
    const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(cwd);
  } catch { /* non-fatal */ }

  try {
    // Check if session already exists (stale from previous run)
    try {
      const { stdout: sessions } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""', { encoding: 'utf-8' });
      if (sessions.split('\n').map(s => s.trim()).includes(tmuxSession)) {
        const { getAgentRuntimeState } = await import('../agents.js');
        const existingState = getAgentRuntimeState(tmuxSession);
        if (existingState?.state === 'active') {
          return {
            success: false,
            message: `Specialist ${specialistType} (${projectKey}) is already running task ${existingState.currentIssue ?? 'unknown'}`,
            error: 'specialist_busy',
          };
        }
        // Stale session — kill it before spawning fresh
        console.log(`[specialist] Killing stale ${tmuxSession} session before respawn`);
        await execAsync(`tmux kill-session -t "${tmuxSession}"`, { encoding: 'utf-8' }).catch(() => {});
      }
    } catch {
      // Non-fatal: session check failure shouldn't block spawn
    }
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
    // Add Panopticon cost attribution env vars so heartbeat hook records correct stage/issue
    const sessionTypeLabel = specialistType.replace('-agent', ''); // review-agent → review
    const panopticonEnv: Record<string, string> = {
      PANOPTICON_AGENT_ID: tmuxSession,
      PANOPTICON_ISSUE_ID: task.issueId,
      PANOPTICON_SESSION_TYPE: sessionTypeLabel,
    };
    const envFlags = buildTmuxEnvFlags({ ...providerEnv, ...panopticonEnv });

    // For credential-file providers (e.g. Kimi), configure apiKeyHelper for token refresh.
    // For all other providers, clear stale apiKeyHelper from previous runs.
    const providerConfig = getProviderForModel(model as ModelId);
    if (providerConfig.authType === 'credential-file') {
      setupCredentialFileAuth(providerConfig, cwd);
    } else {
      clearCredentialFileAuth(cwd);
    }

    // Permission flags based on specialist type
    const permissionFlags = specialistType === 'merge-agent'
      ? '--dangerously-skip-permissions --permission-mode bypassPermissions'
      : '--dangerously-skip-permissions';

    // Write task prompt to file to avoid shell escaping issues
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    await execAsync(`mkdir -p "${agentDir}"`, { encoding: 'utf-8' });

    const promptFile = join(agentDir, 'task-prompt.md');
    writeFileSync(promptFile, taskPrompt);

    // Deterministic session ID: same specialist + project always gets the same UUID.
    // The UUID is computed from the identity string — no session file needed for dispatch.
    // --resume is always the default (session exists from prior runs).
    // On very first cold start, --resume fails and the launcher falls back to --session-id.
    const sessionName = `specialist-${projectKey}-${specialistType}`;
    const sessionId = deterministicUUID(sessionName);

    // Write session file for informational purposes (pan specialists list)
    setSessionId(specialistType, sessionId, projectKey);

    console.log(`[specialist] Dispatching ${specialistType} for ${projectKey}/${task.issueId} (session: ${sessionId.slice(0, 8)}...)`);

    // Single launcher script: always try --resume first (normal case).
    // Falls back to --session-id only on first cold start (session not in Claude's storage).
    // Prompt is always passed as CLI argument — no tmux key delivery needed.
    // Inner script runs Claude; outer launcher wraps with script(1) for real-time PTY output
    // so tmux capture-pane (God View) can see output while also logging to file.
    const launcherScript = join(agentDir, 'launcher.sh');
    const innerScript = join(agentDir, 'run-claude.sh');

    // Inner script: the actual Claude invocation.
    // test-agent NEVER resumes — each test run is stateless and must start fresh to avoid
    // reporting cached analysis from prior runs (accumulated history caused repeated false-FAILs
    // even after the underlying bug was fixed). All other specialists accumulate context.
    const useResume = specialistType !== 'test-agent';
    writeFileSync(innerScript, `#!/bin/bash
set -o pipefail
cd "${cwd}"
export PANOPTICON_AGENT_ID="${tmuxSession}"
export PANOPTICON_ISSUE_ID="${task.issueId}"
export PANOPTICON_SESSION_TYPE="${sessionTypeLabel}"
prompt=$(cat "${promptFile}")

${useResume ? `# Resume existing session (accumulates context over time)
claude ${permissionFlags} --resume "${sessionId}" --model ${model} "$prompt"
exit_code=$?

# First cold start: session doesn't exist yet in Claude's storage
if [ $exit_code -ne 0 ]; then
  echo "[launcher] First run — creating session"
  claude ${permissionFlags} --session-id "${sessionId}" --model ${model} "$prompt"
fi` : `# test-agent: always fresh session — no --resume to prevent stale result reporting
claude ${permissionFlags} --model ${model} "$prompt"`}

# Signal completion
echo ""
echo "## Specialist completed task"
`, { mode: 0o755 });

    // Outer launcher: wraps inner script with script(1) for PTY + tee for log file.
    // script -qfec forces a PTY so Claude outputs in real time (visible in tmux pane + God View).
    writeFileSync(launcherScript, `#!/bin/bash
script -qfec "bash '${innerScript}'" /dev/null 2>&1 | tee -a "${logFilePath}"
`, { mode: 0o755 });

    // Spawn Claude Code via launcher script (with provider env vars)
    // -c sets tmux session working directory to project path (prevents trust prompt — PAN-384)
    // Kill stale session first to prevent "duplicate session" error (PAN-430)
    await execAsync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null || true`, { encoding: 'utf-8' });
    await execAsync(
      `tmux new-session -d -s "${tmuxSession}" -c "${cwd}"${envFlags} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' }
    );

    // Set state to active
    const { saveAgentRuntimeState } = await import('../agents.js');
    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: task.issueId,
    });

    console.log(`[specialist] Spawned ${specialistType} for ${projectKey}/${task.issueId} (run: ${runId})`);


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
 * Shared test-agent prompt builder — used by both buildTaskPrompt (ephemeral spawn)
 * and wakeSpecialistWithTask (queue-based wake). Extracted to avoid the bug where
 * ephemeral test specialists got empty prompts.
 */
async function buildTestAgentPromptContent(task: {
  issueId: string;
  branch?: string;
  workspace?: string;
}): Promise<string> {
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  const testWorkspace = task.workspace || 'unknown';
  const testGitInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
  const testIsPolyrepo = testGitInfo.isPolyrepo;

  const { extractTeamPrefix, findProjectByTeam } = await import('../projects.js');
  const testTeamPrefix = extractTeamPrefix(task.issueId);
  const testProjectConfig = testTeamPrefix ? findProjectByTeam(testTeamPrefix) : null;
  const testConfigs = testProjectConfig?.tests;

  let testCommands = '';
  let baselineCommands = '';
  const featureName = task.issueId.toLowerCase();
  const mainWorkspacePath = testWorkspace.replace(/workspaces\/feature-[^/]+/, 'workspaces/main');
  const projectRootPath = testProjectConfig?.path || testWorkspace.replace(/\/workspaces\/.*/, '');

  if (testConfigs && Object.keys(testConfigs).length > 0) {
    const testEntries = Object.entries(testConfigs);
    const testSuites: string[] = [];
    const baselineSuites: string[] = [];
    for (const [name, cfg] of testEntries) {
      const testDir = testIsPolyrepo
        ? `${testWorkspace}/${cfg.path}`
        : (cfg.path === '.' ? testWorkspace : `${testWorkspace}/${cfg.path}`);
      const baseDir = testIsPolyrepo
        ? `${mainWorkspacePath}/${cfg.path}`
        : (cfg.path === '.' ? mainWorkspacePath : `${mainWorkspacePath}/${cfg.path}`);
      const fallbackDir = cfg.path === '.' ? projectRootPath : `${projectRootPath}/${cfg.path}`;
      testSuites.push(`echo "\\n=== Test suite: ${name} (${cfg.type}) ===" && cd "${testDir}" && ${cfg.command} 2>&1; echo "EXIT_CODE_${name}: $?"`);
      baselineSuites.push(`echo "\\n=== Baseline: ${name} (${cfg.type}) ===" && cd "${baseDir}" 2>/dev/null && ${cfg.command} 2>&1 || (cd "${fallbackDir}" 2>/dev/null && ${cfg.command} 2>&1) || echo "BASELINE_SKIP_${name}: could not run baseline"; echo "EXIT_CODE_${name}: $?"`);
    }
    testCommands = testSuites.map((cmd, i) => `# Suite ${i + 1}\n${cmd}`).join('\n');
    baselineCommands = baselineSuites.map((cmd, i) => `# Suite ${i + 1}\n${cmd}`).join('\n');
  } else if (testIsPolyrepo) {
    const testSuites: string[] = [];
    const baselineSuites: string[] = [];
    for (const gitDir of testGitInfo.gitDirs) {
      const repoName = basename(gitDir);
      testSuites.push(`echo "\\n=== ${repoName} ===" && cd "${gitDir}" && if [ -f pom.xml ]; then ./mvnw test 2>&1; elif [ -f package.json ]; then npm test 2>&1; else echo "No test runner found"; fi; echo "EXIT_CODE_${repoName}: $?"`);
      const baseDir = `${mainWorkspacePath}/${repoName}`;
      baselineSuites.push(`echo "\\n=== Baseline: ${repoName} ===" && cd "${baseDir}" 2>/dev/null && if [ -f pom.xml ]; then ./mvnw test 2>&1; elif [ -f package.json ]; then npm test 2>&1; else echo "No test runner found"; fi; echo "EXIT_CODE_${repoName}: $?"`);
    }
    testCommands = testSuites.join('\n');
    baselineCommands = baselineSuites.join('\n');
  } else {
    testCommands = `cd "${testWorkspace}" && npm test 2>&1; echo "EXIT_CODE: $?"`;
    baselineCommands = `cd "${mainWorkspacePath}" 2>/dev/null && npm test 2>&1 || (cd "${projectRootPath}" && npm test 2>&1); echo "EXIT_CODE: $?"`;
  }

  const testConfigSummary = testConfigs
    ? Object.entries(testConfigs).map(([name, cfg]) => `- **${name}** (${cfg.type}): \`${cfg.command}\` in \`${cfg.path}/\``).join('\n')
    : testIsPolyrepo
      ? testGitInfo.gitDirs.map(d => `- **${basename(d)}**: auto-detected`).join('\n')
      : '- Single test suite at workspace root';

  const timeoutMs = testConfigs && Object.values(testConfigs).some(c => c.type === 'maven') ? '600000' : '300000';

  return `Your task:
1. Run ALL test suites — redirect output to file, read only summaries
2. If ALL pass, skip baseline and report PASS
3. If failures, run baseline on main and compare
4. Only fail for NEW regressions (not pre-existing)
5. Update status via API when done

## Test Suites

${testConfigSummary}

## CRITICAL: Context Management — Output Redirection

**NEVER let full test output flow into your context.** Always redirect to file and read only summaries.

## CRITICAL: Bash Timeout for Test Commands

**ALWAYS use timeout: ${timeoutMs} when running test commands.**

## Step 1: Run Feature Branch Tests

\`\`\`bash
(
${testCommands}
) > /tmp/test-feature.txt 2>&1
# Use timeout: ${timeoutMs} for this command
echo "--- Feature test output tail ---"
tail -40 /tmp/test-feature.txt
grep "EXIT_CODE" /tmp/test-feature.txt
\`\`\`

## Step 2: Check Results

- If ALL exit codes are 0 → skip baseline, go to "Update Status"
- If any failures → continue to Step 3

## Step 3: Baseline Comparison (ONLY if failures found)

\`\`\`bash
(
${baselineCommands}
) > /tmp/test-main.txt 2>&1
# Use timeout: ${timeoutMs} for this command
echo "--- Baseline test output tail ---"
tail -40 /tmp/test-main.txt
grep "EXIT_CODE" /tmp/test-main.txt
\`\`\`

Then compare failures:
\`\`\`bash
grep -E "FAIL|✗|Error|failed|BUILD FAILURE" /tmp/test-feature.txt | head -30
grep -E "FAIL|✗|Error|failed|BUILD FAILURE" /tmp/test-main.txt | head -30
\`\`\`

**Pass criteria:** Feature branch introduces ZERO new test failures vs main.
**Fail criteria:** Feature branch introduces NEW failures not present on main.

## REQUIRED: Update Status via API

You MUST execute the appropriate curl command and verify it succeeds.

If NO new regressions (tests PASS):
\`\`\`bash
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"testStatus":"passed","testNotes":"[summary]"}' | jq .
\`\`\`

If NEW regressions found (tests FAIL):
\`\`\`bash
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"testStatus":"failed","testNotes":"[describe NEW failures]"}' | jq .
\`\`\`

## Container Smoke Test

After unit tests pass, verify Docker workspace frontend is accessible if containers are running:
\`\`\`bash
docker ps --filter "name=${featureName}" --format "{{.Names}} {{.Status}}" 2>/dev/null
\`\`\`

IMPORTANT: Do NOT hand off to merge-agent. Human clicks Merge button when ready.`;
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

    case 'test-agent': {
      // Delegate to shared test-agent prompt builder
      const testPrompt = await buildTestAgentPromptContent(task);
      prompt += testPrompt;
      break;
    }

    case 'merge-agent': {
      const bInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      if (bInfo.isPolyrepo) {
        prompt += `This is a POLYREPO project with ${bInfo.gitDirs.length} repos: ${bInfo.gitDirs.map(d => basename(d)).join(', ')}.
You must merge each repo separately.\n\n`;
      }
      prompt += `Your task:
1. Fetch the latest main branch
2. Attempt to merge ${bInfo.branch} into main
3. Resolve conflicts intelligently if needed
4. Run tests to verify merge is clean
5. Complete merge if tests pass
6. NEVER use git push --force`;
      break;
    }
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
    // Session exists — but check if the pane actually has a running process.
    // When Claude Code crashes, the pane's process exits but the tmux session persists,
    // making has-session return success even though nothing is running.
    const { stdout } = await execAsync(
      `tmux list-panes -t ${tmuxSession} -F "#{pane_pid}" 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    const panePid = stdout.trim();
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

  const sessionId = getSessionId(name, projectKey);
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
  const cwd = getDevrootPath() || homedir();

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

    // For credential-file providers (e.g. Kimi), configure apiKeyHelper for token refresh.
    // For all other providers, clear stale apiKeyHelper from previous runs.
    const providerCfg = getProviderForModel(model as ModelId);
    if (providerCfg.authType === 'credential-file') {
      setupCredentialFileAuth(providerCfg, cwd);
    } else {
      clearCredentialFileAuth(cwd);
    }

    // Write identity prompt and launcher script to avoid shell escaping issues
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    await execAsync(`mkdir -p "${agentDir}"`, { encoding: 'utf-8' });

    const promptFile = join(agentDir, 'identity-prompt.md');
    const launcherScript = join(agentDir, 'launcher.sh');

    writeFileSync(promptFile, identityPrompt);
    const newSessionId = randomUUID();
    writeFileSync(launcherScript, `#!/bin/bash
cd "${cwd}"
prompt=$(cat "${promptFile}")
exec claude --dangerously-skip-permissions --session-id "${newSessionId}" --model ${model} "$prompt"
`, { mode: 0o755 });
    setSessionId(name, newSessionId);

    // Pre-trust cwd so specialists don't hit the trust prompt (same as spawnSpecialist)
    try {
      const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
      preTrustDirectory(cwd);
    } catch { /* non-fatal */ }

    // Spawn Claude Code via launcher script (with provider env vars)
    // -c sets tmux session working directory to project path (prevents trust prompt)
    // Kill stale session first to prevent "duplicate session" error (PAN-430)
    await execAsync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null || true`, { encoding: 'utf-8' });
    await execAsync(
      `tmux new-session -d -s "${tmuxSession}" -c "${cwd}"${envFlags} "bash '${launcherScript}'"`,
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
    // 1. Cancel any pending command with Ctrl+C and wait for Claude to return to idle.
    //    Do NOT send 'cd ~' here — that triggers LLM inference (2-5s) and creates a race:
    //    the task message arrives while Claude is still processing the cd command and gets lost.
    await execAsync(`tmux send-keys -t "${tmuxSession}" C-c`, { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // 2. Clear any partial input on the prompt line
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
    skipBusyGuard?: boolean; // Skip busy check (caller already verified idle + set active)
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

  // Guard: if specialist is running and busy, refuse to send a new task.
  // Sending a message to a busy Claude session causes "Interrupted" behavior —
  // the running tool is cancelled and the previous task is abandoned mid-flight.
  // Callers should use wakeSpecialistOrQueue() for automatic busy handling.
  // Skip this guard when called from wakeSpecialistOrQueue (skipBusyGuard),
  // since the caller already verified idle state and pre-set active to prevent races.
  if (wasAlreadyRunning && !options.skipBusyGuard) {
    const { getAgentRuntimeState } = await import('../agents.js');
    const runtimeState = getAgentRuntimeState(tmuxSession);
    if (runtimeState?.state === 'active') {
      console.warn(`[specialist] ${name} is busy (working on ${runtimeState.currentIssue}), refusing to interrupt`);
      return {
        success: false,
        message: `Specialist ${name} is busy (working on ${runtimeState.currentIssue}). Use wakeSpecialistOrQueue() instead.`,
        tmuxSession,
        wasAlreadyRunning: true,
        error: 'specialist_busy',
      };
    }
  }

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

    // Use devroot (~/Projects) — already trusted in Claude Code
    const cwd = getDevrootPath() || join(process.env.HOME || '/home/eltmon', 'Projects');

    // Pre-trust cwd so specialists don't hit the trust prompt
    try {
      const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
      preTrustDirectory(cwd);
    } catch { /* non-fatal */ }

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
      // Add Panopticon cost attribution env vars
      const wakeSessionType = name.replace('-agent', ''); // review-agent → review
      const wakePanEnv: Record<string, string> = {
        PANOPTICON_AGENT_ID: tmuxSession,
        PANOPTICON_SESSION_TYPE: wakeSessionType,
      };
      if (issueId) {
        wakePanEnv.PANOPTICON_ISSUE_ID = issueId;
      }
      const envFlags = buildTmuxEnvFlags({ ...providerEnv, ...wakePanEnv });

      // For credential-file providers (e.g. Kimi), configure apiKeyHelper for token refresh.
      // For all other providers, clear stale apiKeyHelper from previous runs.
      const provCfg = getProviderForModel(model as ModelId);
      if (provCfg.authType === 'credential-file') {
        setupCredentialFileAuth(provCfg, cwd);
      } else {
        clearCredentialFileAuth(cwd);
      }

      // merge-agent needs full bypass to handle git stash drop, reset, etc.
      const permissionFlags = name === 'merge-agent'
        ? '--dangerously-skip-permissions --permission-mode bypassPermissions'
        : '--dangerously-skip-permissions';

      // Start with --resume if we have a session, otherwise generate a new session ID
      let claudeCmd: string;
      if (sessionId) {
        claudeCmd = `claude --resume "${sessionId}" ${modelFlag} ${permissionFlags}`;
      } else {
        const newSessionId = randomUUID();
        claudeCmd = `claude --session-id "${newSessionId}" ${modelFlag} ${permissionFlags}`;
        setSessionId(name, newSessionId);
      }

      // Kill stale session first to prevent "duplicate session" error (PAN-430)
      await execAsync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null || true`, { encoding: 'utf-8' });
      await execAsync(
        `tmux new-session -d -s "${tmuxSession}" -c "${cwd}"${envFlags} "${claudeCmd}"`,
        { encoding: 'utf-8' }
      );

      if (waitForReady) {
        // Poll for Claude's interactive prompt instead of fixed sleep.
        // Fresh starts can take 5-10s; 15s timeout covers slow models.
        const ready = await waitForClaudePrompt(tmuxSession, 15000);
        if (!ready) {
          console.warn(`[specialist] ${name}: prompt not detected within 15s, proceeding anyway`);
        }
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

  // Wait for Claude to be at its interactive prompt before sending the task.
  // For already-running specialists this should be near-instant; for freshly-started
  // ones the waitForReady above already waited, but resetSpecialist's C-c may have
  // interrupted something so we re-confirm here.
  const promptReady = await waitForClaudePrompt(tmuxSession, wasAlreadyRunning ? 5000 : 15000);
  if (!promptReady) {
    console.warn(`[specialist] ${name}: prompt not detected after reset, proceeding anyway`);
  }

  // Send the task prompt
  try {
    // For large prompts (>500 chars or multiline), write to file to avoid tmux paste issues
    // Tmux send-keys with large text shows as "[Pasted text #1 +N lines]" which Claude doesn't process
    const isLargePrompt = taskPrompt.length > 500 || taskPrompt.includes('\n');

    // Prepare the message to send
    let messageToSend: string;
    if (isLargePrompt) {
      if (!existsSync(TASKS_DIR)) {
        mkdirSync(TASKS_DIR, { recursive: true });
      }
      const taskFile = join(TASKS_DIR, `${name}-${Date.now()}.md`);
      writeFileSync(taskFile, taskPrompt, 'utf-8');
      messageToSend = `Read and execute the task in: ${taskFile}`;
    } else {
      messageToSend = taskPrompt;
    }

    // Snapshot tmux output BEFORE sending so we can detect new activity
    const outputBefore = await capturePaneAsync(tmuxSession, 50);

    // Send the task message
    await sendKeysAsync(tmuxSession, messageToSend);

    // Verify Claude received the message by watching for new output (tool calls, responses).
    // This catches silent delivery failures — the structural root cause of lost tasks.
    const delivered = await confirmDelivery(tmuxSession, outputBefore, 10000);
    if (!delivered) {
      console.warn(`[specialist] ${name}: no activity detected after task send, retrying...`);
      // Re-snapshot and retry once
      const retryBefore = await capturePaneAsync(tmuxSession, 50);
      await sendKeysAsync(tmuxSession, messageToSend);
      const retryDelivered = await confirmDelivery(tmuxSession, retryBefore, 10000);
      if (!retryDelivered) {
        return {
          success: false,
          message: `Task message not received by specialist ${name} after retry`,
          tmuxSession,
          wasAlreadyRunning,
          error: 'delivery_failed',
        };
      }
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
  },
  options: { skipBusyGuard?: boolean } = {}
): Promise<ReturnType<typeof wakeSpecialist>> {
  // Build context-aware prompt based on specialist type and task
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  let prompt: string;

  switch (name) {
    case 'merge-agent': {
      const mergeWorkspace = task.workspace || 'unknown';
      const mergeInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const mergeBranch = mergeInfo.branch;

      const mergeRepoInstructions = mergeInfo.isPolyrepo
        ? `\nIMPORTANT: This is a POLYREPO project. There are ${mergeInfo.gitDirs.length} separate git repositories to merge:
${mergeInfo.gitDirs.map((d, i) => `${i + 1}. ${basename(d)}: ${d}`).join('\n')}

The workspace root is NOT a git repo. You must cd into each subdirectory to run git commands.
You MUST complete the merge for ALL repos.\n`
        : '';

      prompt = `New merge task for ${task.issueId}:

Branch: ${mergeBranch}
Workspace: ${mergeWorkspace}
${mergeInfo.isPolyrepo ? `Polyrepo: git repos in subdirectories: ${mergeInfo.gitDirs.map(d => basename(d)).join(', ')}` : ''}
${task.prUrl ? `PR URL: ${task.prUrl}` : ''}
${mergeRepoInstructions}
For ${mergeInfo.isPolyrepo ? 'EACH repo' : 'the repo'}, perform these steps:

PHASE 1 — SYNC & BASELINE (before merge):
1. ${mergeInfo.isPolyrepo ? 'cd into the repo directory' : `cd ${mergeWorkspace}`}
2. git checkout main
3. git fetch origin main
4. Sync local main with origin/main:
   Run: git rev-list --left-right --count main...origin/main
   If REMOTE_AHEAD > 0: git rebase origin/main
   If rebase conflicts: abort and report failure.
5. Run tests on main to establish a baseline. Record BASELINE_PASS and BASELINE_FAIL.

PHASE 2 — MERGE (dry run):
6. git merge ${mergeBranch} --no-edit
7. If conflicts: resolve them intelligently, then git add and git commit
8. If clean merge: the merge commit is auto-created (or fast-forward)

PHASE 3 — VERIFY:
9. Run tests again. Record MERGE_PASS and MERGE_FAIL.

PHASE 4 — DECIDE:
10. Compare results:
    - If MERGE_FAIL > BASELINE_FAIL (NEW test failures): ROLLBACK with git reset --hard ORIG_HEAD and report FAILED
    - If MERGE_FAIL <= BASELINE_FAIL (no new failures): Report PASSED (merge is validated)
    - Pre-existing failures on main are NOT a reason to rollback

CRITICAL: Do NOT push to main. Do NOT run git push origin main.
The merge validation stays LOCAL. A human will click Merge in the dashboard to push.

PHASE 5 — REPORT:
11. Call the Panopticon API to report results:
    curl -s -X POST ${apiUrl}/api/specialists/done \\
      -H "Content-Type: application/json" \\
      -d '{"specialist":"merge","issueId":"${task.issueId}","status":"passed|failed","notes":"<summary>"}'

CRITICAL: You MUST call the /api/specialists/done endpoint whether you succeed or fail.
CRITICAL: NEVER push to main — only humans merge. Your job is to VALIDATE the merge, not execute it.
CRITICAL: NEVER use git push --force.
CRITICAL: Do NOT delete the feature branch.`;
      break;
    }

    case 'review-agent': {
      // Pre-check: detect stale branch (0 diff from main) before waking the agent
      const workspace = task.workspace || 'unknown';

      // Resolve git directories and branch from workspace
      const reviewGitInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const gitDirs = reviewGitInfo.gitDirs;
      // Use first git dir for pre-check (primary repo), fall back to workspace root
      const gitDir = gitDirs[0] || workspace;

      let staleBranch = false;
      if (workspace !== 'unknown' && gitDirs.length > 0) {
        try {
          // For polyrepos, check all git dirs — if ANY has changes, it's not stale
          let totalChangedFiles = 0;
          for (const dir of gitDirs) {
            const { stdout: dirDiff } = await execAsync(
              `cd "${dir}" && git fetch origin main 2>/dev/null; git diff --name-only main...HEAD 2>/dev/null`,
              { encoding: 'utf-8', timeout: 15000 }
            );
            totalChangedFiles += dirDiff.trim().split('\n').filter((f: string) => f.length > 0).length;
          }
          if (totalChangedFiles === 0) {
            staleBranch = true;
            console.log(`[specialist] review-agent: stale branch detected for ${task.issueId} — 0 files changed vs main`);

            // Auto-complete the review: set reviewStatus to passed
            const { setReviewStatus } = await import('../review-status.js');
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

      // Build git commands for the prompt — polyrepo workspaces need git commands in subdirectories
      const isPolyrepo = gitDirs.length > 1;
      const gitDiffCommands = gitDirs.length > 0
        ? gitDirs.map(d => `cd "${d}" && git diff --name-only main...HEAD`).join('\n')
        : `cd "${workspace}" && git diff --name-only main...HEAD`;
      const gitDiffFileCmd = gitDirs.length > 0
        ? `cd "${gitDir}" && git diff main...HEAD -- <file>`
        : `cd "${workspace}" && git diff main...HEAD -- <file>`;

      prompt = `New review task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${workspace}
${isPolyrepo ? `Polyrepo: git repos in subdirectories: ${gitDirs.map(d => basename(d)).join(', ')}` : ''}
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
${isPolyrepo ? `This is a polyrepo — run git diff in each repo subdirectory:` : ''}
\`\`\`bash
${gitDiffCommands}
\`\`\`

**If the diff is EMPTY (0 files changed across all repos):** The branch is stale or already merged into main. In this case:
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
${gitDiffCommands}
\`\`\`

**Step 2:** Read the CURRENT version of each changed file using the Read tool.
Review the actual file contents — do NOT rely solely on diff output.

**Step 3:** If you need to see what specifically changed, use:
\`\`\`bash
${gitDiffFileCmd}
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

    case 'test-agent': {
      // Resolve polyrepo structure and project test config
      const testWorkspace = task.workspace || 'unknown';
      const testGitInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const testIsPolyrepo = testGitInfo.isPolyrepo;

      // Look up project test config from projects.yaml
      const { extractTeamPrefix, findProjectByTeam } = await import('../projects.js');
      const testTeamPrefix = extractTeamPrefix(task.issueId);
      const testProjectConfig = testTeamPrefix ? findProjectByTeam(testTeamPrefix) : null;
      const testConfigs = testProjectConfig?.tests;

      // Build per-repo test commands from projects.yaml config
      let testCommands = '';
      let baselineCommands = '';
      const featureName = task.issueId.toLowerCase();
      // Derive main workspace path for baseline comparison
      const mainWorkspacePath = testWorkspace.replace(/workspaces\/feature-[^/]+/, 'workspaces/main');
      const projectRootPath = testProjectConfig?.path || testWorkspace.replace(/\/workspaces\/.*/, '');

      if (testConfigs && Object.keys(testConfigs).length > 0) {
        // Use projects.yaml test config — each entry may target a different repo subdirectory
        const testEntries = Object.entries(testConfigs);
        const testSuites: string[] = [];
        const baselineSuites: string[] = [];
        for (const [name, cfg] of testEntries) {
          const testDir = testIsPolyrepo
            ? `${testWorkspace}/${cfg.path}`
            : (cfg.path === '.' ? testWorkspace : `${testWorkspace}/${cfg.path}`);
          const baseDir = testIsPolyrepo
            ? `${mainWorkspacePath}/${cfg.path}`
            : (cfg.path === '.' ? mainWorkspacePath : `${mainWorkspacePath}/${cfg.path}`);
          // Fall back to project root for monorepo baseline if main workspace doesn't exist
          const fallbackDir = cfg.path === '.' ? projectRootPath : `${projectRootPath}/${cfg.path}`;
          testSuites.push(`echo "\\n=== Test suite: ${name} (${cfg.type}) ===" && cd "${testDir}" && ${cfg.command} 2>&1; echo "EXIT_CODE_${name}: $?"`);
          baselineSuites.push(`echo "\\n=== Baseline: ${name} (${cfg.type}) ===" && cd "${baseDir}" 2>/dev/null && ${cfg.command} 2>&1 || (cd "${fallbackDir}" 2>/dev/null && ${cfg.command} 2>&1) || echo "BASELINE_SKIP_${name}: could not run baseline"; echo "EXIT_CODE_${name}: $?"`);
        }
        testCommands = testSuites.map((cmd, i) => `# Suite ${i + 1}\n${cmd}`).join('\n');
        baselineCommands = baselineSuites.map((cmd, i) => `# Suite ${i + 1}\n${cmd}`).join('\n');
      } else if (testIsPolyrepo) {
        // No projects.yaml config but detected polyrepo — discover test commands per repo
        const testSuites: string[] = [];
        const baselineSuites: string[] = [];
        for (const gitDir of testGitInfo.gitDirs) {
          const repoName = basename(gitDir);
          // Auto-detect test runner in each repo
          testSuites.push(`echo "\\n=== ${repoName} ===" && cd "${gitDir}" && if [ -f pom.xml ]; then ./mvnw test 2>&1; elif [ -f package.json ]; then npm test 2>&1; else echo "No test runner found"; fi; echo "EXIT_CODE_${repoName}: $?"`);
          const baseDir = `${mainWorkspacePath}/${repoName}`;
          baselineSuites.push(`echo "\\n=== Baseline: ${repoName} ===" && cd "${baseDir}" 2>/dev/null && if [ -f pom.xml ]; then ./mvnw test 2>&1; elif [ -f package.json ]; then npm test 2>&1; else echo "No test runner found"; fi; echo "EXIT_CODE_${repoName}: $?"`);
        }
        testCommands = testSuites.join('\n');
        baselineCommands = baselineSuites.join('\n');
      } else {
        // Monorepo fallback — single test command
        testCommands = `cd "${testWorkspace}" && npm test 2>&1; echo "EXIT_CODE: $?"`;
        baselineCommands = `cd "${mainWorkspacePath}" 2>/dev/null && npm test 2>&1 || (cd "${projectRootPath}" && npm test 2>&1); echo "EXIT_CODE: $?"`;
      }

      // Build test suite summary for the prompt
      const testConfigSummary = testConfigs
        ? Object.entries(testConfigs).map(([name, cfg]) => `- **${name}** (${cfg.type}): \`${cfg.command}\` in \`${cfg.path}/\``).join('\n')
        : testIsPolyrepo
          ? testGitInfo.gitDirs.map(d => `- **${basename(d)}**: auto-detected`).join('\n')
          : '- Single test suite at workspace root';

      prompt = `New test task for ${task.issueId}:

Branch: ${task.branch || 'unknown'}
Workspace: ${testWorkspace}
${testIsPolyrepo ? `Polyrepo: git repos in subdirectories: ${testGitInfo.gitDirs.map(d => basename(d)).join(', ')}` : ''}

## Test Suites

${testConfigSummary}

Your task:
1. Run ALL test suites — redirect output to file, read only summaries
2. If ALL pass, skip baseline and report PASS
3. If failures, run baseline on main and compare
4. Only fail for NEW regressions (not pre-existing)
5. Update status via API when done

## CRITICAL: Context Management — Output Redirection

**NEVER let full test output flow into your context.** Always redirect to file and read only summaries.
Raw test output from large suites (1000+ tests) WILL fill your context and cause compaction, losing your task.

## CRITICAL: Bash Timeout for Test Commands

**ALWAYS use timeout: 300000 (5 minutes) when running test commands.**
For Maven/Spring Boot tests, use timeout: 600000 (10 minutes) — they take longer.

## Step 1: Run Feature Branch Tests

${testIsPolyrepo || (testConfigs && Object.keys(testConfigs).length > 1)
  ? `**Run ALL test suites** — each suite is a separate repo/runner. Redirect ALL output to one file.`
  : ''}

\`\`\`bash
(
${testCommands}
) > /tmp/test-feature.txt 2>&1
# Use timeout: ${testConfigs && Object.values(testConfigs).some(c => c.type === 'maven') ? '600000' : '300000'} for this command
echo "--- Feature test output tail ---"
tail -40 /tmp/test-feature.txt
grep "EXIT_CODE" /tmp/test-feature.txt
\`\`\`

## Step 2: Check Results

- If ALL exit codes are 0 → skip baseline, go to "Update Status"
- If any failures → continue to Step 3

## Step 3: Baseline Comparison (ONLY if failures found)

\`\`\`bash
(
${baselineCommands}
) > /tmp/test-main.txt 2>&1
# Use timeout: ${testConfigs && Object.values(testConfigs).some(c => c.type === 'maven') ? '600000' : '300000'} for this command
echo "--- Baseline test output tail ---"
tail -40 /tmp/test-main.txt
grep "EXIT_CODE" /tmp/test-main.txt
\`\`\`

Then compare failures (targeted, NOT full output):
\`\`\`bash
grep -E "FAIL|✗|Error|failed|BUILD FAILURE" /tmp/test-feature.txt | head -30
grep -E "FAIL|✗|Error|failed|BUILD FAILURE" /tmp/test-main.txt | head -30
\`\`\`

Tests that fail on BOTH = pre-existing (don't block). Tests that fail ONLY on feature = NEW regression (block).

**Pass criteria:** Feature branch introduces ZERO new test failures vs main.
**Fail criteria:** Feature branch introduces NEW failures not present on main.

## REQUIRED: Update Status via API

You MUST execute the appropriate curl command and verify it succeeds. Do NOT just describe it - actually RUN it with Bash.

If NO new regressions (tests PASS):
\`\`\`bash
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"testStatus":"passed","testNotes":"[summary including pre-existing failures if any, and which suites were tested]"}' | jq .
\`\`\`

If NEW regressions found (tests FAIL):
\`\`\`bash
curl -s -X POST ${apiUrl}/api/workspaces/${task.issueId}/review-status -H "Content-Type: application/json" -d '{"testStatus":"failed","testNotes":"[describe NEW failures only — specify which suite/repo]"}' | jq .
\`\`\`
Then use send-feedback-to-agent skill to notify issue agent of NEW failures only.

⚠️ VERIFICATION: After running curl, confirm you see valid JSON output with the updated status. If you get an error or empty response, the update FAILED - report this.

**NEVER run test commands without redirecting to a file.** This is not optional.

## REQUIRED: Container Smoke Test

After unit tests pass, verify the Docker workspace frontend is accessible.
This is NOT optional — UI changes that pass unit tests but break in containers must be caught.

\`\`\`bash
# Check if containers are running for this workspace
docker ps --filter "name=${featureName}" --format "{{.Names}} {{.Status}}" 2>/dev/null
\`\`\`

If containers are running, test these URLs:
- **Frontend**: \`curl -sk https://feature-${featureName}.${testProjectConfig?.workspace?.dns?.domain || 'pan.localhost'}/ | head -5\`
- **API proxy**: \`curl -sk https://feature-${featureName}.${testProjectConfig?.workspace?.dns?.domain || 'pan.localhost'}/api/health\`
- **API issues**: \`curl -sk https://feature-${featureName}.${testProjectConfig?.workspace?.dns?.domain || 'pan.localhost'}/api/issues | head -100\`

**Pass criteria:**
1. Frontend returns HTML containing \`<div id="root">\`
2. \`/api/health\` returns JSON with \`"status":"ok"\`
3. \`/api/issues\` returns JSON array (not an error)

**If ANY of these fail, the test FAILS** — report via the API with details about which check failed.
If containers are NOT running, note it but don't fail (containers may not be configured for this project).

IMPORTANT: Do NOT hand off to merge-agent. Human clicks Merge button when ready.`;
      break;
    }

    default:
      prompt = `Task for ${task.issueId}: Please process this task and report findings.`;
  }

  return wakeSpecialist(name, prompt, { issueId: task.issueId, skipBusyGuard: options.skipBusyGuard });
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

  // DAG-aware readiness gate: if a vBRIEF item ID is provided in context,
  // check that all its blocking dependencies are completed before scheduling.
  // This prevents scheduling work whose dependencies aren't done yet.
  const vbriefItemId = task.context?.vbriefItemId as string | undefined;
  const workspacePath = task.workspace || (task.context?.workspace as string | undefined);
  if (vbriefItemId && workspacePath) {
    try {
      if (!isTaskReady(vbriefItemId, workspacePath)) {
        return {
          success: false,
          queued: false,
          message: `Task "${vbriefItemId}" has incomplete blocking dependencies — not ready to schedule`,
        };
      }
    } catch (readinessErr: any) {
      // Non-fatal: proceed if readiness check fails
      console.warn(`[specialist] Task readiness check failed for ${vbriefItemId}: ${readinessErr.message}`);
    }
  }

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
    const wakeResult = await wakeSpecialistWithTask(name, task, { skipBusyGuard: true });

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

  notifyPipeline({ type: 'task_queued', specialist: specialistName, issueId: task.issueId });

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
