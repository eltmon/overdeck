import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AGENTS_DIR } from './paths.js';
import { createSession, killSession, sendKeys, sendKeysAsync, sessionExists, getAgentSessions, capturePane } from './tmux.js';
import { initHook, checkHook, generateFixedPointPrompt } from './hooks.js';
import { startWork, completeWork, getAgentCV } from './cv.js';
import type { ComplexityLevel } from './cloister/complexity.js';
import { loadCloisterConfig } from './cloister/config.js';
import { loadSettings, type ModelId } from './settings.js';
import { getModelId, WorkTypeId } from './work-type-router.js';
import { getProviderForModel, getProviderEnv, setupCredentialFileAuth, clearCredentialFileAuth, requiresRouter } from './providers.js';
import { loadConfig } from './config.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { TrackerType } from './tracker/interface.js';
import { findProjectByPath } from './projects.js';

const execAsync = promisify(exec);

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-'];

/** Normalize agent ID: preserve known prefixes, add 'agent-' for bare issue IDs */
function normalizeAgentId(agentId: string): string {
  if (AGENT_PREFIXES.some(p => agentId.startsWith(p))) {
    return agentId;
  }
  return `agent-${agentId.toLowerCase()}`;
}

/**
 * Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for a model.
 * Reads the current API key from settings so resumed/recovered agents
 * always use the latest key.
 */
function getProviderEnvForModel(model: string): Record<string, string> {
  const provider = getProviderForModel(model as ModelId);
  if (provider.name === 'anthropic') return {};

  const settings = loadSettings();
  const apiKey = settings.api_keys?.[provider.name as keyof typeof settings.api_keys];
  if (apiKey) {
    return getProviderEnv(provider, apiKey);
  }
  console.warn(`Warning: No API key configured for ${provider.displayName}, falling back to Anthropic`);
  return {};
}

// ============================================================================
// Ready Signal Management (PAN-87)
// ============================================================================

/**
 * Get path to agent's ready signal file (written by SessionStart hook)
 */
function getReadySignalPath(agentId: string): string {
  return join(getAgentDir(agentId), 'ready.json');
}

/**
 * Clear ready signal before spawning (clean slate)
 */
function clearReadySignal(agentId: string): void {
  const readyPath = getReadySignalPath(agentId);
  if (existsSync(readyPath)) {
    try {
      unlinkSync(readyPath);
    } catch {
      // Ignore errors - non-critical
    }
  }
}

/**
 * Wait for SessionStart hook to signal ready (async - non-blocking)
 * Returns true if ready signal received, false if timeout
 */
async function waitForReadySignal(agentId: string, timeoutSeconds = 30): Promise<boolean> {
  const readyPath = getReadySignalPath(agentId);

  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Non-blocking sleep

    if (existsSync(readyPath)) {
      try {
        const content = readFileSync(readyPath, 'utf-8');
        const signal = JSON.parse(content);
        if (signal.ready === true) {
          return true;
        }
      } catch {
        // File exists but invalid - keep waiting
      }
    }
  }

  return false;
}

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  runtime: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  branch?: string; // Git branch name for this agent

  // Model routing & handoffs (Phase 4)
  complexity?: ComplexityLevel;
  handoffCount?: number;
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response';
  workType?: WorkTypeId; // Current work type ID

  // SageOx session tracking (PAN-278)
  sageoxSessionPath?: string; // Path to SageOx session folder for parent linking
}

export function getAgentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

export function getAgentState(agentId: string): AgentState | null {
  const stateFile = join(getAgentDir(agentId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = readFileSync(stateFile, 'utf8');
  return JSON.parse(content);
}

export function saveAgentState(state: AgentState): void {
  const dir = getAgentDir(state.id);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify(state, null, 2)
  );
}

// ============================================================================
// Hook-based State Management (PAN-80)
// ============================================================================

/**
 * Agent runtime state (hook-based tracking)
 */
export type AgentResolution = 'working' | 'done' | 'needs_input' | 'stuck' | 'completed' | 'unclear';

export interface AgentRuntimeState {
  state: 'active' | 'idle' | 'suspended' | 'uninitialized';
  lastActivity: string;
  currentTool?: string;
  sessionId?: string;
  suspendedAt?: string;
  resumedAt?: string;
  currentIssue?: string; // Issue ID the agent is currently working on
  resolution?: AgentResolution; // Lifecycle completion signal (PAN-309)
  resolutionCount?: number;     // How many times this resolution was set
  resolutionUpdatedAt?: string; // When resolution was last updated
}

/**
 * Activity log entry
 */
export interface ActivityEntry {
  ts: string;
  tool: string;
  action?: string;
  state?: 'active' | 'idle';
}

/**
 * Get the path to an agent's runtime state file (separate from config state)
 */
export function getAgentRuntimeFile(agentId: string): string {
  return join(getAgentDir(agentId), 'runtime.json');
}

/**
 * Get agent runtime state (from hooks)
 *
 * Reads from runtime.json (new) with fallback to state.json (legacy migration).
 * This separation prevents bash hooks from corrupting AgentState config.
 */
export function getAgentRuntimeState(agentId: string): AgentRuntimeState | null {
  const runtimeFile = getAgentRuntimeFile(agentId);
  const stateFile = join(getAgentDir(agentId), 'state.json');

  // Try runtime.json first (new location)
  if (existsSync(runtimeFile)) {
    try {
      const content = readFileSync(runtimeFile, 'utf8');
      return JSON.parse(content) as AgentRuntimeState;
    } catch {
      // Fall through to legacy
    }
  }

  // Fallback to state.json (legacy — runtime fields were mixed in)
  if (existsSync(stateFile)) {
    try {
      const content = readFileSync(stateFile, 'utf8');
      const parsed = JSON.parse(content);
      // Only use if it has runtime-specific fields
      if (parsed.state && parsed.lastActivity) {
        return parsed as AgentRuntimeState;
      }
    } catch {
      // Ignore
    }
  }

  // No state at all — uninitialized
  if (!existsSync(stateFile) && !existsSync(runtimeFile)) {
    return {
      state: 'uninitialized',
      lastActivity: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Save agent runtime state to runtime.json (separate from AgentState config)
 *
 * This writes ONLY to runtime.json, never touching state.json.
 * This separation is critical: bash hooks write runtime.json on every tool call,
 * while AgentState in state.json is only written at lifecycle events (spawn/stop/handoff).
 */
export function saveAgentRuntimeState(agentId: string, state: Partial<AgentRuntimeState>): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  const runtimeFile = getAgentRuntimeFile(agentId);

  // Merge with existing runtime state (read from runtime.json only, not state.json)
  let existing: AgentRuntimeState | null = null;
  if (existsSync(runtimeFile)) {
    try {
      existing = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    } catch {
      // Ignore corrupt file
    }
  }

  const merged: AgentRuntimeState = {
    ...(existing || { state: 'uninitialized', lastActivity: new Date().toISOString() }),
    ...state,
  };

  writeFileSync(runtimeFile, JSON.stringify(merged, null, 2));
}

/**
 * Append to activity log with automatic pruning to 100 entries
 */
export function appendActivity(agentId: string, entry: ActivityEntry): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  const activityFile = join(dir, 'activity.jsonl');

  // Append entry
  appendFileSync(activityFile, JSON.stringify(entry) + '\n');

  // Prune to last 100 entries
  if (existsSync(activityFile)) {
    try {
      const lines = readFileSync(activityFile, 'utf8').trim().split('\n');
      if (lines.length > 100) {
        const trimmed = lines.slice(-100);
        writeFileSync(activityFile, trimmed.join('\n') + '\n');
      }
    } catch (error) {
      // Ignore pruning errors - activity log is non-critical
    }
  }
}

/**
 * Read activity log (last N entries)
 */
export function getActivity(agentId: string, limit = 100): ActivityEntry[] {
  const activityFile = join(getAgentDir(agentId), 'activity.jsonl');

  if (!existsSync(activityFile)) {
    return [];
  }

  try {
    const lines = readFileSync(activityFile, 'utf8').trim().split('\n');
    const entries = lines
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ActivityEntry)
      .slice(-limit);

    return entries;
  } catch {
    return [];
  }
}

/**
 * Save Claude session ID for later resume
 */
export function saveSessionId(agentId: string, sessionId: string): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'session.id'), sessionId);
}

/**
 * Get saved Claude session ID
 */
export function getSessionId(agentId: string): string | null {
  const sessionFile = join(getAgentDir(agentId), 'session.id');

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    return readFileSync(sessionFile, 'utf8').trim();
  } catch {
    return null;
  }
}

export interface SpawnOptions {
  issueId: string;
  workspace: string;
  runtime?: string;
  model?: string;
  prompt?: string;
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response';
  workType?: WorkTypeId; // Explicit work type ID (overrides phase-based detection)
}

/**
 * Determine which model to use for an agent based on configuration
 *
 * New Priority (PAN-118):
 * 1. Explicitly provided model (options.model)
 * 2. Explicit work type ID (options.workType)
 * 3. Work type from phase (options.phase → issue-agent:{phase})
 * 4. Specialist work type (options.agentType → specialist-{type})
 * 5. Complexity-based routing (LEGACY - deprecated)
 * 6. Default fallback (claude-sonnet-4-6)
 */
function determineModel(options: SpawnOptions): string {
  console.log(`[DEBUG] determineModel called with:`, { model: options.model, workType: options.workType, phase: options.phase, agentType: options.agentType, difficulty: options.difficulty });

  // Explicit model always wins
  if (options.model) {
    console.log(`[DEBUG] Using explicit model: ${options.model}`);
    return options.model;
  }

  try {
    // Use work type router if work type or phase specified
    if (options.workType) {
      return getModelId(options.workType);
    }

    // Map phase to work type ID
    if (options.phase) {
      const workType: WorkTypeId = `issue-agent:${options.phase}` as WorkTypeId;
      return getModelId(workType);
    }

    // Map specialist agent type to work type ID
    if (options.agentType && options.agentType !== 'work-agent') {
      // Specialists: review-agent, test-agent, merge-agent
      const workType: WorkTypeId = `specialist-${options.agentType}` as WorkTypeId;
      return getModelId(workType);
    }

    // LEGACY: Complexity-based routing (deprecated but kept for backward compat)
    if (options.difficulty) {
      const settings = loadSettings();
      if (settings.models.complexity[options.difficulty]) {
        console.warn(`Using legacy complexity-based routing for ${options.difficulty}. Consider migrating to work types.`);
        return settings.models.complexity[options.difficulty];
      }
    }

    // Fall back to default model from Cloister config or claude-sonnet-4-6
    try {
      const cloisterConfig = loadCloisterConfig();
      const defaultModel = cloisterConfig.model_selection?.default_model || 'sonnet';
      const modelMap: Record<string, string> = {
        'opus': 'claude-opus-4-6',
        'sonnet': 'claude-sonnet-4-6',
        'haiku': 'claude-haiku-4-5',
      };
      return modelMap[defaultModel] || 'claude-sonnet-4-6';
    } catch {
      return 'claude-sonnet-4-6';
    }
  } catch (error) {
    // If work type router fails, fall back to default
    console.warn('Warning: Could not resolve model using work type router, using default');
    return options.model || 'claude-sonnet-4-6';
  }
}

/**
 * Transition an issue to "in_progress" in its tracker.
 *
 * Resolution order:
 * 1. Primary tracker from global config (e.g. Linear)
 * 2. Secondary tracker from global config (if configured)
 * 3. Project-specific tracker derived from the workspace path:
 *    looks up the project in projects.yaml and uses its github_repo or gitlab_repo
 *
 * This means projects that only have a github_repo (no linear_team) will
 * still get their issues transitioned correctly without any extra config.
 */
async function transitionIssueToInProgress(issueId: string, workspacePath?: string): Promise<void> {
  const config = loadConfig();
  const trackersConfig = config.trackers;

  // Try primary/secondary trackers (may not be configured)
  if (trackersConfig?.primary) {
    const trackerTypes: TrackerType[] = [trackersConfig.primary];
    if (trackersConfig.secondary) {
      trackerTypes.push(trackersConfig.secondary);
    }

    for (const trackerType of trackerTypes) {
      try {
        const tracker = createTrackerFromConfig(trackersConfig, trackerType);
        await tracker.transitionIssue(issueId, 'in_progress');
        console.log(`[agents] Transitioned ${issueId} to in_progress via ${trackerType}`);
        return;
      } catch {
        // Issue not found in this tracker or transition failed, try next
      }
    }
  }

  // Fall back to the project's own tracker derived from the workspace path.
  // This handles projects with github_repo or gitlab_repo but no linear_team.
  if (workspacePath) {
    const projectConfig = findProjectByPath(workspacePath);
    if (projectConfig?.github_repo) {
      const [owner, repo] = projectConfig.github_repo.split('/');
      try {
        const tracker = createTracker({ type: 'github', owner, repo });
        await tracker.transitionIssue(issueId, 'in_progress');
        console.log(`[agents] Transitioned ${issueId} to in_progress via project GitHub (${projectConfig.github_repo})`);
        return;
      } catch (err: any) {
        console.warn(`[agents] Could not transition via project GitHub (${projectConfig.github_repo}): ${err.message}`);
      }
    }
    if (projectConfig?.gitlab_repo) {
      console.warn(`[agents] GitLab project detected (${projectConfig.gitlab_repo}) but GitLab does not support in_progress label transitions`);
    }
  }
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const agentId = `agent-${options.issueId.toLowerCase()}`;

  // Check if already running
  if (sessionExists(agentId)) {
    throw new Error(`Agent ${agentId} already running. Use 'pan work tell' to message it.`);
  }

  // Initialize hook for this agent (FPP support)
  initHook(agentId);

  // Determine model based on configuration
  const selectedModel = determineModel(options);
  console.log(`[DEBUG] Selected model: ${selectedModel}`);

  // Create state
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    runtime: options.runtime || 'claude',
    model: selectedModel,
    status: 'starting',
    startedAt: new Date().toISOString(),
    // Initialize Phase 4 fields (legacy)
    complexity: options.difficulty,
    handoffCount: 0,
    costSoFar: 0,
    // Work type system (PAN-118)
    phase: options.phase,
    workType: options.workType,
  };

  saveAgentState(state);

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork, items } = checkHook(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(agentId);
    if (fixedPointPrompt) {
      prompt = fixedPointPrompt + '\n\n---\n\n' + prompt;
    }
  }

  // Write prompt to file for complex prompts (avoids shell escaping issues)
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  if (prompt) {
    writeFileSync(promptFile, prompt);
  }

  // Auto-setup hooks if not configured
  checkAndSetupHooks();

  // Ensure TLDR daemon is running for the workspace (non-blocking, non-fatal)
  try {
    const venvPath = join(options.workspace, '.venv');
    if (existsSync(venvPath)) {
      const { getTldrDaemonService } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonService(options.workspace, venvPath);
      const status = await tldrService.getStatus();
      if (!status.running) {
        await tldrService.start(true);
        console.log(`[${agentId}] Started TLDR daemon for workspace`);
      }
    }
  } catch {
    // Non-fatal — agents degrade to direct file reads if TLDR unavailable
  }

  // Write initial task cache for heartbeat hook
  writeTaskCache(agentId, options.issueId);

  // Clear ready signal before spawning (clean slate for PAN-87 fix)
  clearReadySignal(agentId);

  // Get provider-specific environment variables (BASE_URL, AUTH_TOKEN)
  const providerEnv = getProviderEnvForModel(selectedModel);

  // For credential-file providers (e.g. Kimi Code Plan), configure apiKeyHelper
  // so Claude Code can refresh short-lived tokens dynamically.
  // For all other providers, CLEAR any stale apiKeyHelper from previous runs
  // (e.g. switching from Kimi to Anthropic plan-based auth).
  const provider = getProviderForModel(selectedModel as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuth(provider, options.workspace);
  } else {
    clearCredentialFileAuth(options.workspace);
  }

  // Create tmux session and start claude
  // For prompts with special shell characters, use a launcher script to safely pass the prompt
  // The script reads the file into a variable, which bash then safely expands
  let claudeCmd: string;
  if (prompt) {
    const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
    const launcherContent = `#!/bin/bash
prompt=$(cat "${promptFile}")
exec claude --dangerously-skip-permissions --model ${state.model} "\$prompt"
`;
    writeFileSync(launcherScript, launcherContent, { mode: 0o755 });
    claudeCmd = `bash "${launcherScript}"`;
  } else {
    claudeCmd = `claude --dangerously-skip-permissions --model ${state.model}`;
  }

  // Pre-trust workspace directory in Claude Code to avoid the trust prompt
  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(options.workspace);
  } catch { /* non-fatal */ }

  // Build SageOx environment variables for session linking (only if project is SageOx-initialized)
  // Derive project root from workspace path: <project-root>/workspaces/<branch>
  const projectRoot = resolve(options.workspace, '..', '..');
  const sageoxEnabled = existsSync(join(projectRoot, '.sageox'));
  const sageoxEnv: Record<string, string> = {};

  if (sageoxEnabled) {
    sageoxEnv.OX_PROJECT_ROOT = projectRoot;

    // Add issue tracking for multi-agent pipelines
    if (options.issueId) {
      sageoxEnv.PAN_ISSUE_ID = options.issueId;
    }
    if (options.phase) {
      sageoxEnv.PAN_PHASE = options.phase;
    }

    // For non-planner agents, find the planner's session path for parent linking
    if (options.phase && (options.phase as string) !== 'planning') {
      const plannerAgentId = `agent-${options.issueId.toLowerCase()}`;
      const plannerState = getAgentState(plannerAgentId);
      if (plannerState?.sageoxSessionPath) {
        sageoxEnv.PAN_PARENT_SESSION = plannerState.sageoxSessionPath;
      }
    }
  }

  createSession(agentId, options.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: agentId,
      PANOPTICON_ISSUE_ID: options.issueId,
      PANOPTICON_SESSION_TYPE: options.phase || 'implementation',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      ...providerEnv, // Add provider-specific env vars (BASE_URL, AUTH_TOKEN, etc.)
      ...sageoxEnv // Add SageOx environment variables
    }
  });

  // Update status
  state.status = 'running';
  saveAgentState(state);

  // Track work in CV
  startWork(agentId, options.issueId);

  // Transition issue tracker to "in progress" (best-effort, don't block agent spawn)
  // Only for work agents, not planning/specialist agents
  if (!options.agentType || options.agentType === 'work-agent') {
    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For planner agents, capture SageOx session path after it becomes available
  if (sageoxEnabled && (options.phase as string) === 'planning') {
    captureSageoxSessionPath(agentId, projectRoot).catch((err) => {
      console.warn(`[agents] Could not capture SageOx session path: ${err.message}`);
    });
  }

  return state;
}

export function listRunningAgents(): (AgentState & { tmuxActive: boolean })[] {
  const tmuxSessions = getAgentSessions();
  const tmuxNames = new Set(tmuxSessions.map(s => s.name));

  const agents: (AgentState & { tmuxActive: boolean })[] = [];

  // Read all agent states
  if (!existsSync(AGENTS_DIR)) return agents;

  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const state = getAgentState(dir.name);
    if (state) {
      agents.push({
        ...state,
        tmuxActive: tmuxNames.has(state.id),
      });
    }
  }

  return agents;
}

export function stopAgent(agentId: string): void {
  const normalizedId = normalizeAgentId(agentId);

  if (sessionExists(normalizedId)) {
    // Capture tmux output before killing so logs remain viewable after stop
    try {
      const output = capturePane(normalizedId, 5000);
      if (output) {
        const agentDir = getAgentDir(normalizedId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'output.log'), output);
      }
    } catch {
      // Non-fatal — best effort log capture
    }

    killSession(normalizedId);
  }

  const state = getAgentState(normalizedId);
  if (state) {
    // Ensure id is set — runtime state files may lack it (PAN-150)
    if (!state.id) state.id = normalizedId;

    state.status = 'stopped';
    saveAgentState(state);
  }
}

export async function messageAgent(agentId: string, message: string): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  // Check if agent is suspended - auto-resume if so (PAN-80)
  const runtimeState = getAgentRuntimeState(normalizedId);
  if (runtimeState?.state === 'suspended') {
    console.log(`[agents] Auto-resuming suspended agent ${normalizedId} to deliver message`);
    const result = await resumeAgent(normalizedId, message);
    if (!result.success) {
      throw new Error(`Failed to auto-resume agent: ${result.error}`);
    }
    // Message already sent during resume
    return;
  }

  // Check if this is a remote agent
  const { loadRemoteAgentState, sendToRemoteAgent } = await import('./remote/remote-agents.js');
  const remoteState = loadRemoteAgentState(normalizedId);
  if (remoteState && remoteState.vmName) {
    console.log(`[agents] Sending message to remote agent ${normalizedId} on ${remoteState.vmName}`);
    await sendToRemoteAgent(normalizedId, remoteState.vmName, message);

    // Also save to mail queue for persistence
    const mailDir = join(getAgentDir(normalizedId), 'mail');
    mkdirSync(mailDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(mailDir, `${timestamp}.md`),
      `# Message\n\n${message}\n`
    );
    return;
  }

  if (!sessionExists(normalizedId)) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  await sendKeysAsync(normalizedId, message);

  // Also save to mail queue
  const mailDir = join(getAgentDir(normalizedId), 'mail');
  mkdirSync(mailDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(mailDir, `${timestamp}.md`),
    `# Message\n\n${message}\n`
  );
}

/**
 * Resume a suspended agent (PAN-80)
 *
 * Reads saved session ID and creates new tmux session with --resume flag.
 * Optionally sends a message after resuming.
 *
 * Auto-resume triggers:
 * - Specialists: When queued work arrives
 * - Work agents: When message is sent via /work-tell
 */
export async function resumeAgent(agentId: string, message?: string): Promise<{ success: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);

  // Check runtime state
  const runtimeState = getAgentRuntimeState(normalizedId);
  if (!runtimeState || runtimeState.state !== 'suspended') {
    return {
      success: false,
      error: `Cannot resume agent in state: ${runtimeState?.state || 'unknown'}`
    };
  }

  // Get saved session ID
  const sessionId = getSessionId(normalizedId);
  if (!sessionId) {
    return {
      success: false,
      error: 'No saved session ID found'
    };
  }

  // Get agent state for workspace info
  const agentState = getAgentState(normalizedId);
  if (!agentState) {
    return {
      success: false,
      error: 'Agent state not found'
    };
  }

  // Check if session already exists (shouldn't happen for suspended agents)
  if (sessionExists(normalizedId)) {
    return {
      success: false,
      error: 'Agent session already exists'
    };
  }

  try {
    // Clear ready signal before resuming (clean slate for PAN-87 fix)
    clearReadySignal(normalizedId);

    // Get provider env for the agent's model (reads latest API key from settings)
    const providerEnv = agentState.model ? getProviderEnvForModel(agentState.model) : {};

    // For credential-file providers, ensure apiKeyHelper is configured.
    // For all other providers, clear stale apiKeyHelper from previous runs.
    if (agentState.model) {
      const provider = getProviderForModel(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuth(provider, agentState.workspace);
      } else {
        clearCredentialFileAuth(agentState.workspace);
      }
    }

    // Create new tmux session with resume command
    const claudeCmd = `claude --resume "${sessionId}" --dangerously-skip-permissions`;
    createSession(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.phase || 'implementation',
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    });

    // If there's a message, wait for ready signal then send
    if (message) {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);

      if (ready) {
        // Send message
        await sendKeysAsync(normalizedId, message);
      } else {
        console.error('Claude SessionStart hook did not fire during resume, message not sent');
      }
    }

    // Update runtime state
    saveAgentRuntimeState(normalizedId, {
      state: 'active',
      resumedAt: new Date().toISOString(),
    });

    // Update agent state
    if (agentState) {
      agentState.status = 'running';
      agentState.lastActivity = new Date().toISOString();
      saveAgentState(agentState);
    }

    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to resume agent: ${msg}`
    };
  }
}

/**
 * Detect crashed agents (state shows running but tmux session is gone)
 */
export function detectCrashedAgents(): AgentState[] {
  const agents = listRunningAgents();
  return agents.filter(
    (agent) => agent.status === 'running' && !agent.tmuxActive
  );
}

/**
 * Recover a crashed agent by restarting it with context
 */
export function recoverAgent(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);
  const state = getAgentState(normalizedId);

  if (!state) {
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  if (!state.workspace || !state.model) {
    console.error(`[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`);
    return null;
  }

  // Check if already running
  if (sessionExists(normalizedId)) {
    return state;
  }

  // Update crash count in health file
  const healthFile = join(getAgentDir(normalizedId), 'health.json');
  let health = { consecutiveFailures: 0, killCount: 0, recoveryCount: 0 };
  if (existsSync(healthFile)) {
    try {
      health = { ...health, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
    } catch {}
  }
  health.recoveryCount = (health.recoveryCount || 0) + 1;
  writeFileSync(healthFile, JSON.stringify(health, null, 2));

  // Build recovery prompt
  const recoveryPrompt = generateRecoveryPrompt(state);

  // Get provider env for the agent's model (reads latest API key from settings)
  const providerEnv = state.model ? getProviderEnvForModel(state.model) : {};

  // For credential-file providers, ensure apiKeyHelper is configured.
  // For all other providers, clear stale apiKeyHelper from previous runs.
  if (state.model) {
    const provider = getProviderForModel(state.model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuth(provider, state.workspace);
    } else {
      clearCredentialFileAuth(state.workspace);
    }
  }

  // Restart the agent with recovery context (YOLO mode - skip permissions)
  const claudeCmd = `claude --dangerously-skip-permissions --model ${state.model} "${recoveryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  createSession(normalizedId, state.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: normalizedId,
      PANOPTICON_ISSUE_ID: state.issueId || '',
      PANOPTICON_SESSION_TYPE: state.phase || 'implementation',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      ...providerEnv
    }
  });

  // Update state
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  saveAgentState(state);

  return state;
}

/**
 * Generate a recovery prompt for a crashed agent
 */
function generateRecoveryPrompt(state: AgentState): string {
  const lines: string[] = [
    '# Agent Recovery',
    '',
    '⚠️ This agent session was recovered after a crash.',
    '',
    '## Previous Context',
    `- Issue: ${state.issueId}`,
    `- Workspace: ${state.workspace}`,
    `- Started: ${state.startedAt}`,
    '',
    '## Recovery Steps',
    '1. Check beads for context: `bd show ' + state.issueId + '`',
    '2. Review recent git commits: `git log --oneline -10`',
    '3. Check hook for pending work: `pan work hook check`',
    '4. Resume from last known state',
    '',
    '## FPP Reminder',
    '> "Any runnable action is a fixed point and must resolve before the system can rest."',
    '',
  ];

  // Add FPP work if available
  const { hasWork } = checkHook(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(state.id);
    if (fixedPointPrompt) {
      lines.push('---');
      lines.push('');
      lines.push(fixedPointPrompt);
    }
  }

  return lines.join('\n');
}

/**
 * Auto-recover all crashed agents
 */
export function autoRecoverAgents(): { recovered: string[]; failed: string[] } {
  const crashed = detectCrashedAgents();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const agent of crashed) {
    try {
      const result = recoverAgent(agent.id);
      if (result) {
        recovered.push(agent.id);
      } else {
        failed.push(agent.id);
      }
    } catch (error) {
      failed.push(agent.id);
    }
  }

  return { recovered, failed };
}

/**
 * Check if Panopticon hooks are configured, and auto-setup if not
 */
function checkAndSetupHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const hookPath = join(homedir(), '.panopticon', 'bin', 'heartbeat-hook');

  // Check if settings.json exists and has heartbeat hook configured
  if (existsSync(settingsPath)) {
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      const postToolUse = settings?.hooks?.PostToolUse || [];

      const hookConfigured = postToolUse.some((hookConfig: any) =>
        hookConfig.hooks?.some((hook: any) =>
          hook.command === hookPath ||
          hook.command?.includes('panopticon') ||
          hook.command?.includes('heartbeat-hook')
        )
      );

      if (hookConfigured) {
        return; // Already configured
      }
    } catch {
      // Ignore errors, will attempt setup
    }
  }

  // Hooks not configured - run setup silently
  try {
    console.log('Configuring Panopticon heartbeat hooks...');
    // Note: This runs during spawn which is now async, so we can use execAsync
    // But this is called from a sync context in checkAndSetupHooks, so we use fire-and-forget
    exec('pan setup hooks', (error: Error | null) => {
      if (error) {
        console.warn('⚠ Failed to auto-configure hooks. Run `pan setup hooks` manually.');
      } else {
        console.log('✓ Heartbeat hooks configured');
      }
    });
  } catch (error) {
    console.warn('⚠ Failed to auto-configure hooks. Run `pan setup hooks` manually.');
  }
}

/**
 * Write task cache for heartbeat hook to use
 */
function writeTaskCache(agentId: string, issueId: string): void {
  const cacheDir = join(getAgentDir(agentId));
  mkdirSync(cacheDir, { recursive: true });

  const cacheFile = join(cacheDir, 'current-task.json');
  writeFileSync(
    cacheFile,
    JSON.stringify({
      id: issueId,
      title: `Working on ${issueId}`,
      updated_at: new Date().toISOString()
    }, null, 2)
  );
}

/**
 * Capture SageOx session path for a planner agent.
 * This is used for parent-child session linking in multi-agent pipelines.
 * Subsequent agents (worker, reviewer, tester, merger) will use this path
 * as their PAN_PARENT_SESSION to link their sessions to the planner's session.
 */
async function captureSageoxSessionPath(agentId: string, projectRoot: string): Promise<void> {
  // Wait for SageOx session to be created by the hook (up to 10 seconds)
  const sessionsDir = join(projectRoot, '.sageox', 'sessions');
  let attempts = 0;
  const maxAttempts = 20;
  const delayMs = 500;

  while (attempts < maxAttempts) {
    // Check if sessions directory exists
    if (existsSync(sessionsDir)) {
      // Find the most recent session directory for this agent
      const sessions = readdirSync(sessionsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => ({
          name: d.name,
          path: join(sessionsDir, d.name),
          mtime: existsSync(join(sessionsDir, d.name, '.recording.json'))
            ? readFileSync(join(sessionsDir, d.name, '.recording.json'), 'utf-8')
            : null
        }))
        .filter(s => {
          // Check if this session belongs to our agent
          if (!s.mtime) return false;
          try {
            const state = JSON.parse(s.mtime);
            return state.agent_id === agentId || state.AgentID === agentId;
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          // Sort by modification time (newest first)
          const aTime = existsSync(join(a.path, '.recording.json'))
            ? (statSync(join(a.path, '.recording.json')).mtimeMs || 0)
            : 0;
          const bTime = existsSync(join(b.path, '.recording.json'))
            ? (statSync(join(b.path, '.recording.json')).mtimeMs || 0)
            : 0;
          return bTime - aTime;
        });

      if (sessions.length > 0) {
        // Update agent state with SageOx session path
        const state = getAgentState(agentId);
        if (state) {
          state.sageoxSessionPath = sessions[0].path;
          saveAgentState(state);
          console.log(`[agents] Captured SageOx session path for ${agentId}: ${sessions[0].path}`);
          return;
        }
      }
    }

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delayMs));
    attempts++;
  }

  throw new Error(`Could not find SageOx session for ${agentId} after ${maxAttempts * delayMs}ms`);
}
