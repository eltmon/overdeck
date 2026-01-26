import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AGENTS_DIR } from './paths.js';
import { createSession, killSession, sendKeys, sessionExists, getAgentSessions } from './tmux.js';
import { initHook, checkHook, generateFixedPointPrompt } from './hooks.js';
import { startWork, completeWork, getAgentCV } from './cv.js';
import type { ComplexityLevel } from './cloister/complexity.js';
import { loadSettings, type ModelId } from './settings.js';
import { getModelId, WorkTypeId } from './work-type-router.js';

const execAsync = promisify(exec);

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
  phase?: 'exploration' | 'planning' | 'implementation' | 'testing' | 'documentation' | 'review-response';
  workType?: WorkTypeId; // Current work type ID
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
export interface AgentRuntimeState {
  state: 'active' | 'idle' | 'suspended' | 'uninitialized';
  lastActivity: string;
  currentTool?: string;
  sessionId?: string;
  suspendedAt?: string;
  resumedAt?: string;
  currentIssue?: string; // Issue ID the agent is currently working on
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
 * Get agent runtime state (from hooks)
 */
export function getAgentRuntimeState(agentId: string): AgentRuntimeState | null {
  const stateFile = join(getAgentDir(agentId), 'state.json');

  // If file doesn't exist, agent is uninitialized
  if (!existsSync(stateFile)) {
    return {
      state: 'uninitialized',
      lastActivity: new Date().toISOString(),
    };
  }

  try {
    const content = readFileSync(stateFile, 'utf8');
    return JSON.parse(content) as AgentRuntimeState;
  } catch {
    return null;
  }
}

/**
 * Save agent runtime state
 */
export function saveAgentRuntimeState(agentId: string, state: Partial<AgentRuntimeState>): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  // Merge with existing state
  const existing = getAgentRuntimeState(agentId);
  const merged: AgentRuntimeState = {
    ...(existing || { state: 'uninitialized', lastActivity: new Date().toISOString() }),
    ...state,
  };

  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify(merged, null, 2)
  );
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
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'planning-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'planning' | 'implementation' | 'testing' | 'documentation' | 'review-response';
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
 * 6. Default fallback (claude-sonnet-4-5)
 */
function determineModel(options: SpawnOptions): string {
  // Explicit model always wins
  if (options.model) {
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
      if (options.agentType === 'planning-agent') {
        return getModelId('planning-agent');
      }
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

    // Fall back to default model
    return 'claude-sonnet-4-5';
  } catch (error) {
    // If work type router fails, fall back to default
    console.warn('Warning: Could not resolve model using work type router, using default');
    return options.model || 'claude-sonnet-4-5';
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

  // Write initial task cache for heartbeat hook
  writeTaskCache(agentId, options.issueId);

  // Clear ready signal before spawning (clean slate for PAN-87 fix)
  clearReadySignal(agentId);

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

  createSession(agentId, options.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: agentId
    }
  });

  // Update status
  state.status = 'running';
  saveAgentState(state);

  // Track work in CV
  startWork(agentId, options.issueId);

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
  // Normalize agent ID
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;

  if (sessionExists(normalizedId)) {
    killSession(normalizedId);
  }

  const state = getAgentState(normalizedId);
  if (state) {
    state.status = 'stopped';
    saveAgentState(state);
  }
}

export async function messageAgent(agentId: string, message: string): Promise<void> {
  // Normalize agent ID
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;

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

  if (!sessionExists(normalizedId)) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  sendKeys(normalizedId, message);

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
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;

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

    // Create new tmux session with resume command
    const claudeCmd = `claude --resume "${sessionId}" --dangerously-skip-permissions`;
    createSession(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        PANOPTICON_AGENT_ID: normalizedId
      }
    });

    // If there's a message, wait for ready signal then send
    if (message) {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);

      if (ready) {
        // Send message
        sendKeys(normalizedId, message);
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
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;
  const state = getAgentState(normalizedId);

  if (!state) {
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

  // Restart the agent with recovery context (YOLO mode - skip permissions)
  const claudeCmd = `claude --dangerously-skip-permissions --model ${state.model} "${recoveryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  createSession(normalizedId, state.workspace, claudeCmd);

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
